"""Agent Task CRUD, approvals, commands, and snapshot assembly.

Hard rule (IDOR): every lookup by id filters by user_id. Foreign and missing
ids both return None → 404.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.agent_task import (
    AgentApproval,
    AgentArtifact,
    AgentEvent,
    AgentRun,
    AgentStep,
    AgentSubagent,
    AgentTask,
    AgentTaskInput,
)
from schemas.agent_task import (
    AgentApprovalOut,
    AgentArtifactOut,
    AgentEventOut,
    AgentRunOut,
    AgentStepOut,
    AgentSubagentOut,
    AgentTaskDetailOut,
    AgentTaskInputOut,
    AgentTaskListItemOut,
)
from services import agent_event_service

logger = logging.getLogger("lemma.services.agent_task")

_POLICY_STEPS = (
    ("describe", 1),
    ("questionnaire", 2),
    ("market_search", 3),
    ("compose", 4),
    ("select_portfolio", 5),
    ("funding", 6),
    ("monitor", 7),
)


def title_from_goal(goal_text: str) -> str:
    title = " ".join(goal_text.strip().split())
    return title[:50] or "新保障任务"


async def get_owned_task(
    db: AsyncSession, *, user_id: uuid.UUID, task_id: uuid.UUID
) -> AgentTask | None:
    result = await db.execute(
        select(AgentTask).where(
            AgentTask.id == task_id,
            AgentTask.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def get_task_by_client_request(
    db: AsyncSession, *, user_id: uuid.UUID, client_request_id: str
) -> AgentTask | None:
    result = await db.execute(
        select(AgentTask).where(
            AgentTask.user_id == user_id,
            AgentTask.client_request_id == client_request_id,
        )
    )
    return result.scalar_one_or_none()


async def get_task_by_policy_id(
    db: AsyncSession, *, user_id: uuid.UUID, policy_id: uuid.UUID
) -> AgentTask | None:
    result = await db.execute(
        select(AgentTask).where(
            AgentTask.user_id == user_id,
            AgentTask.primary_ref_type == "policy",
            AgentTask.primary_ref_id == policy_id,
        )
    )
    return result.scalar_one_or_none()


async def list_tasks(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
    include_archived: bool = False,
) -> list[AgentTask]:
    query = select(AgentTask).where(AgentTask.user_id == user_id)
    if not include_archived:
        query = query.where(AgentTask.archived_at.is_(None))
    result = await db.execute(
        query.order_by(AgentTask.updated_at.desc()).limit(limit).offset(offset)
    )
    return list(result.scalars())


async def rename_task(
    db: AsyncSession, *, task: AgentTask, title: str
) -> AgentTask:
    task.title = title.strip()
    await db.flush()
    return task


async def set_task_archived(
    db: AsyncSession, *, task: AgentTask, archived: bool
) -> AgentTask:
    if archived:
        if task.archived_at is None:
            task.archived_at = datetime.now(UTC)
    else:
        task.archived_at = None
    await db.flush()
    return task


def _step_outs(run: AgentRun) -> list[AgentStepOut]:
    return [
        AgentStepOut.model_validate(step, from_attributes=True)
        for step in (run.steps or [])
    ]


def _run_out(run: AgentRun) -> AgentRunOut:
    return AgentRunOut(
        id=run.id,
        status=run.status,  # type: ignore[arg-type]
        trigger=run.trigger,
        error_code=run.error_code,
        error_message=run.error_message,
        started_at=run.started_at,
        finished_at=run.finished_at,
        created_at=run.created_at,
        steps=_step_outs(run),
    )


def _input_out(item: AgentTaskInput) -> AgentTaskInputOut:
    return AgentTaskInputOut.model_validate(item, from_attributes=True)


def task_to_list_item(task: AgentTask) -> AgentTaskListItemOut:
    return AgentTaskListItemOut.model_validate(task, from_attributes=True)


async def load_task_detail(
    db: AsyncSession, *, user_id: uuid.UUID, task_id: uuid.UUID
) -> AgentTaskDetailOut | None:
    result = await db.execute(
        select(AgentTask)
        .where(AgentTask.id == task_id, AgentTask.user_id == user_id)
        .options(
            selectinload(AgentTask.runs).selectinload(AgentRun.steps),
            selectinload(AgentTask.artifacts),
            selectinload(AgentTask.approvals),
            selectinload(AgentTask.inputs),
            selectinload(AgentTask.subagents),
            selectinload(AgentTask.events),
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        return None

    events = sorted(task.events or [], key=lambda e: e.sequence)
    recent = events[-40:]
    latest_sequence = events[-1].sequence if events else 0
    return AgentTaskDetailOut(
        id=task.id,
        kind=task.kind,  # type: ignore[arg-type]
        status=task.status,  # type: ignore[arg-type]
        title=task.title,
        description=task.description,
        goal_text=task.goal_text,
        primary_ref_type=task.primary_ref_type,
        primary_ref_id=task.primary_ref_id,
        conversation_id=task.conversation_id,
        input_revision=task.input_revision,
        updated_at=task.updated_at,
        created_at=task.created_at,
        error_code=task.error_code,
        error_message=task.error_message,
        latest_sequence=latest_sequence,
        runs=[_run_out(run) for run in sorted(task.runs or [], key=lambda r: r.created_at)],
        artifacts=[
            AgentArtifactOut.model_validate(a, from_attributes=True)
            for a in sorted(task.artifacts or [], key=lambda a: a.created_at)
        ],
        approvals=[
            AgentApprovalOut.model_validate(a, from_attributes=True)
            for a in sorted(task.approvals or [], key=lambda a: a.created_at)
        ],
        inputs=[
            _input_out(item)
            for item in sorted(task.inputs or [], key=lambda item: item.revision)
        ],
        subagents=[
            AgentSubagentOut.model_validate(row, from_attributes=True)
            for row in sorted(task.subagents or [], key=lambda s: s.created_at)
        ],
        recent_events=[
            AgentEventOut.model_validate(e, from_attributes=True) for e in recent
        ],
    )


async def create_policy_steps(db: AsyncSession, *, run: AgentRun) -> list[AgentStep]:
    steps: list[AgentStep] = []
    for name, seq in _POLICY_STEPS:
        step = AgentStep(
            run_id=run.id,
            name=name,
            seq=seq,
            status="pending",
        )
        db.add(step)
        steps.append(step)
    await db.flush()
    return steps


async def create_task(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    goal_text: str,
    title: str | None = None,
    client_request_id: str | None = None,
    conversation_id: uuid.UUID | None = None,
) -> AgentTask:
    if client_request_id:
        existing = await get_task_by_client_request(
            db, user_id=user_id, client_request_id=client_request_id
        )
        if existing is not None:
            return existing

    task = AgentTask(
        user_id=user_id,
        kind=kind,
        status="running",
        title=title or title_from_goal(goal_text),
        goal_text=goal_text,
        conversation_id=conversation_id,
        client_request_id=client_request_id,
    )
    db.add(task)
    await db.flush()

    run = AgentRun(
        task_id=task.id,
        status="running",
        trigger="create",
        client_request_id=client_request_id,
        started_at=datetime.now(UTC),
    )
    db.add(run)
    await db.flush()
    await create_policy_steps(db, run=run)

    event = await agent_event_service.append_event(
        db,
        task_id=task.id,
        run_id=run.id,
        event_type="task.created",
        data={
            "taskId": str(task.id),
            "kind": kind,
            "title": task.title,
            "goalText": goal_text,
            "runId": str(run.id),
        },
    )
    await db.commit()
    await db.refresh(task)
    await agent_event_service.publish_notify(task.id, event.sequence)
    return task


async def attach_primary_policy(
    db: AsyncSession,
    *,
    task: AgentTask,
    policy_id: uuid.UUID,
    run_id: uuid.UUID | None = None,
    conversation_id: uuid.UUID | None = None,
) -> None:
    task.primary_ref_type = "policy"
    task.primary_ref_id = policy_id
    if conversation_id is not None:
        task.conversation_id = conversation_id
    artifact = AgentArtifact(
        task_id=task.id,
        run_id=run_id,
        ref_type="policy",
        ref_id=policy_id,
        role="primary",
        label=task.title,
    )
    db.add(artifact)
    event = await agent_event_service.append_event(
        db,
        task_id=task.id,
        run_id=run_id,
        event_type="artifact.upserted",
        data={
            "refType": "policy",
            "refId": str(policy_id),
            "role": "primary",
            "label": task.title,
        },
    )
    await db.commit()
    await agent_event_service.publish_notify(task.id, event.sequence)


async def get_latest_run(
    db: AsyncSession, *, task_id: uuid.UUID
) -> AgentRun | None:
    result = await db.execute(
        select(AgentRun)
        .where(AgentRun.task_id == task_id)
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def queue_user_input(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    input_type: str,
    text: str,
    client_request_id: str | None = None,
) -> tuple[AgentTask, AgentTaskInput, AgentRun | None, AgentEvent | None, bool] | None:
    """Persist a user interruption and advance its cancellation token.

    The task row is locked while assigning `input_revision`, so concurrent
    browser retries cannot produce two commands with the same revision. A
    newer intervention supersedes any unconsumed predecessor; workers only
    need to observe the task's monotonic revision at checkpoints.
    """
    result = await db.execute(
        select(AgentTask)
        .where(AgentTask.id == task_id, AgentTask.user_id == user_id)
        .with_for_update()
    )
    task = result.scalar_one_or_none()
    if task is None:
        return None

    # Guard: once the task reaches a terminal state (succeeded / cancelled /
    # failed) — typically because its policy became active on-chain — reject
    # further user inputs to prevent stale modifications.
    if task.status in ("succeeded", "cancelled", "failed"):
        from fastapi import HTTPException, status as http_status  # noqa: PLC0415

        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="task_locked_policy_active",
        )

    if client_request_id:
        existing_result = await db.execute(
            select(AgentTaskInput).where(
                AgentTaskInput.task_id == task_id,
                AgentTaskInput.client_request_id == client_request_id,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            run = await get_latest_run(db, task_id=task_id)
            # No new event or revision for an idempotent browser retry.
            return task, existing, run, None, False

    await db.execute(
        update(AgentTaskInput)
        .where(
            AgentTaskInput.task_id == task_id,
            AgentTaskInput.status.in_(("queued", "applying")),
        )
        .values(status="superseded")
    )
    task.input_revision += 1
    run = await get_latest_run(db, task_id=task_id)
    item = AgentTaskInput(
        task_id=task_id,
        run_id=run.id if run else None,
        type=input_type,
        text=text,
        revision=task.input_revision,
        status="queued",
        client_request_id=client_request_id,
    )
    db.add(item)
    await db.flush()
    event = await agent_event_service.append_event(
        db,
        task_id=task.id,
        run_id=run.id if run else None,
        event_type="input.queued",
        data={
            "inputId": str(item.id),
            "type": item.type,
            "text": item.text,
            "revision": item.revision,
        },
    )
    await db.flush()
    return task, item, run, event, True


async def mark_inputs_applying(
    db: AsyncSession, *, task_id: uuid.UUID, through_revision: int
) -> None:
    await db.execute(
        update(AgentTaskInput)
        .where(
            AgentTaskInput.task_id == task_id,
            AgentTaskInput.revision <= through_revision,
            AgentTaskInput.status == "queued",
        )
        .values(status="applying")
    )
    await db.flush()


async def mark_inputs_applied(
    db: AsyncSession, *, task_id: uuid.UUID, through_revision: int
) -> None:
    now = datetime.now(UTC)
    await db.execute(
        update(AgentTaskInput)
        .where(
            AgentTaskInput.task_id == task_id,
            AgentTaskInput.revision <= through_revision,
            AgentTaskInput.status.in_(("queued", "applying")),
        )
        .values(status="applied", applied_at=now)
    )
    await db.flush()


async def expire_pending_approvals(
    db: AsyncSession, *, task_id: uuid.UUID
) -> None:
    await db.execute(
        update(AgentApproval)
        .where(
            AgentApproval.task_id == task_id,
            AgentApproval.status == "pending",
        )
        .values(status="expired", updated_at=datetime.now(UTC))
    )
    await db.flush()


async def set_step_status(
    db: AsyncSession,
    *,
    run_id: uuid.UUID,
    name: str,
    status: str,
    progress: dict[str, Any] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    emit_event: bool = True,
) -> AgentStep | None:
    result = await db.execute(
        select(AgentStep).where(AgentStep.run_id == run_id, AgentStep.name == name)
    )
    step = result.scalar_one_or_none()
    if step is None:
        return None
    now = datetime.now(UTC)
    if status == "running" and step.started_at is None:
        step.started_at = now
    if status in ("succeeded", "failed", "skipped"):
        step.finished_at = now
    step.status = status
    if progress is not None:
        step.progress_json = progress
    if error_code is not None:
        step.error_code = error_code
    if error_message is not None:
        step.error_message = error_message
    await db.flush()

    if emit_event:
        run = await db.get(AgentRun, run_id)
        if run is not None:
            event = await agent_event_service.append_event(
                db,
                task_id=run.task_id,
                run_id=run_id,
                event_type="step.updated",
                data={
                    "stepId": str(step.id),
                    "name": step.name,
                    "seq": step.seq,
                    "status": step.status,
                    "errorCode": step.error_code,
                    "errorMessage": step.error_message,
                    "progress": step.progress_json,
                },
            )
            await db.flush()
            await agent_event_service.publish_notify(run.task_id, event.sequence)
    return step


async def create_approval(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    kind: str,
    payload: dict[str, Any] | None = None,
    run_id: uuid.UUID | None = None,
) -> AgentApproval:
    # Expire previous pending approvals of the same kind.
    pending = await db.execute(
        select(AgentApproval).where(
            AgentApproval.task_id == task_id,
            AgentApproval.kind == kind,
            AgentApproval.status == "pending",
        )
    )
    max_version = 0
    for row in pending.scalars():
        row.status = "expired"
        max_version = max(max_version, row.version)

    version_result = await db.execute(
        select(AgentApproval.version)
        .where(AgentApproval.task_id == task_id, AgentApproval.kind == kind)
        .order_by(AgentApproval.version.desc())
        .limit(1)
    )
    latest = version_result.scalar_one_or_none()
    next_version = (latest or max_version or 0) + 1

    approval = AgentApproval(
        task_id=task_id,
        run_id=run_id,
        kind=kind,
        status="pending",
        version=next_version,
        payload_json=payload,
    )
    db.add(approval)
    await db.flush()
    return approval


async def submit_approval_atomic(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    approval_id: uuid.UUID,
    version: int,
    response: dict[str, Any],
    client_request_id: str | None = None,
) -> AgentApproval | None:
    """CAS submit: only pending + matching version rows update."""
    task = await get_owned_task(db, user_id=user_id, task_id=task_id)
    if task is None:
        return None

    now = datetime.now(UTC)
    result = await db.execute(
        update(AgentApproval)
        .where(
            AgentApproval.id == approval_id,
            AgentApproval.task_id == task_id,
            AgentApproval.status == "pending",
            AgentApproval.version == version,
        )
        .values(
            status="submitted",
            response_json=response,
            client_request_id=client_request_id,
            submitted_at=now,
            updated_at=now,
        )
        .returning(AgentApproval.id)
    )
    row = result.first()
    if row is None:
        # Already submitted with same client key → return existing.
        existing = await db.get(AgentApproval, approval_id)
        if (
            existing is not None
            and existing.task_id == task_id
            and existing.status == "submitted"
            and client_request_id
            and existing.client_request_id == client_request_id
        ):
            return existing
        return None
    await db.flush()
    approval = await db.get(AgentApproval, approval_id)
    return approval


async def update_task_status(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
    clear_error: bool = False,
) -> None:
    task = await db.get(AgentTask, task_id)
    if task is None:
        return
    task.status = status
    if clear_error:
        task.error_code = None
        task.error_message = None
    if error_code is not None:
        task.error_code = error_code
    if error_message is not None:
        task.error_message = error_message
    await db.flush()


async def cancel_task(
    db: AsyncSession, *, user_id: uuid.UUID, task_id: uuid.UUID
) -> AgentTask | None:
    result = await db.execute(
        select(AgentTask)
        .where(AgentTask.id == task_id, AgentTask.user_id == user_id)
        .with_for_update()
    )
    task = result.scalar_one_or_none()
    if task is None:
        return None
    if task.status in ("succeeded", "cancelled"):
        return task
    # Bump revision so in-flight workers discard at the next checkpoint.
    task.input_revision += 1
    task.status = "cancelled"
    run = await get_latest_run(db, task_id=task.id)
    if run is not None and run.status in ("pending", "running", "waiting_approval"):
        run.status = "cancelled"
        run.finished_at = datetime.now(UTC)
    await db.execute(
        update(AgentTaskInput)
        .where(
            AgentTaskInput.task_id == task_id,
            AgentTaskInput.status.in_(("queued", "applying")),
        )
        .values(status="superseded")
    )
    event = await agent_event_service.append_event(
        db,
        task_id=task.id,
        run_id=run.id if run else None,
        event_type="task.cancelled",
        data={
            "taskId": str(task.id),
            "revision": task.input_revision,
        },
    )
    await db.commit()
    await agent_event_service.publish_notify(task.id, event.sequence)
    return task


async def emit_activity(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    run_id: uuid.UUID | None,
    summary: str,
    detail: dict[str, Any] | None = None,
) -> None:
    event = await agent_event_service.append_event(
        db,
        task_id=task_id,
        run_id=run_id,
        event_type="activity",
        data={"summary": summary, **(detail or {})},
    )
    await db.flush()
    await agent_event_service.publish_notify(task_id, event.sequence)
