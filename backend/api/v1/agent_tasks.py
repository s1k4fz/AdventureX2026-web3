"""Agent Task API: create, list, detail, commands, approvals, replayable SSE."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal, get_db, shielded_session
from core.security import CurrentUser, get_current_user
from schemas.agent_task import (
    AgentApprovalSubmitIn,
    AgentCommandIn,
    AgentEventOut,
    AgentTaskCreateIn,
    AgentTaskDetailOut,
    AgentTaskListItemOut,
    AgentTaskUpdateIn,
)
from services import (
    agent_event_service,
    agent_task_service,
    policy_agent_adapter,
)

logger = logging.getLogger("lemma.api.agent_tasks")

router = APIRouter(prefix="/agent-tasks", tags=["agent-tasks"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="agent_task_not_found"
)
_CONFLICT = HTTPException(
    status_code=status.HTTP_409_CONFLICT, detail="approval_conflict"
)
_HEARTBEAT_S = 1.0


async def _retry_failed_task(
    db: AsyncSession,
    *,
    current_user: CurrentUser,
    task: object,
) -> None:
    """Re-kick search and/or compose based on failure codes / stuck searching."""
    primary_ref_id = getattr(task, "primary_ref_id", None)
    if primary_ref_id is None:
        return
    from models.policy import Policy
    from tasks.policy_compose import compose_policy
    from tasks.policy_search import search_policy

    policy = await db.get(Policy, primary_ref_id)
    if policy is None:
        return

    error = (getattr(task, "error_code", None) or "").strip()
    task_status = getattr(task, "status", None)
    search_stuck = policy.search_status in ("searching", "failed")
    search_failed = error in (
        "policy_search_failed",
        "policy_search_timeout",
    ) or policy.search_status == "failed"
    compose_failed = error in ("policy_compose_failed",) or (
        task_status == "failed" and not search_failed and policy.status == "failed"
    )

    if task_status not in ("failed", "running") and not search_stuck:
        return

    await agent_task_service.update_task_status(
        db,
        task_id=task.id,  # type: ignore[attr-defined]
        status="running",
        clear_error=True,
    )
    policy.search_status = "searching"
    intake = policy.intake_json if isinstance(policy.intake_json, dict) else {}
    has_answers = bool(intake.get("answers"))

    if search_failed or search_stuck or policy.status == "intake":
        if policy.status == "failed":
            policy.status = "composing" if has_answers else "intake"
        await db.commit()
        search_policy.delay(
            str(policy.id),
            policy.need_text or getattr(task, "goal_text", ""),
            getattr(task, "input_revision", 0),
        )
        if policy.status == "composing" or has_answers:
            compose_policy.delay(str(policy.id))
        return

    if compose_failed or task_status == "failed":
        if policy.status == "failed":
            policy.status = "composing"
        await db.commit()
        compose_policy.delay(str(policy.id))
        return

    await db.commit()


@router.post(
    "",
    response_model=AgentTaskDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_agent_task(
    payload: AgentTaskCreateIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskDetailOut:
    if payload.kind != "policy_planning":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="unsupported_task_kind",
        )
    task, _policy = await policy_agent_adapter.start_policy_task(
        db,
        current_user,
        goal_text=payload.goal_text,
        title=payload.title,
        client_request_id=payload.client_request_id,
        conversation_id=payload.conversation_id,
    )
    detail = await agent_task_service.load_task_detail(
        db, user_id=current_user.id, task_id=task.id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.get("", response_model=list[AgentTaskListItemOut])
async def list_agent_tasks(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    include_archived: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AgentTaskListItemOut]:
    tasks = await agent_task_service.list_tasks(
        db,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        include_archived=include_archived,
    )
    return [agent_task_service.task_to_list_item(task) for task in tasks]


@router.patch("/{task_id}", response_model=AgentTaskListItemOut)
async def update_agent_task(
    task_id: uuid.UUID,
    payload: AgentTaskUpdateIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskListItemOut:
    task = await agent_task_service.get_owned_task(
        db, user_id=current_user.id, task_id=task_id
    )
    if task is None:
        raise _NOT_FOUND
    if payload.title is not None:
        task = await agent_task_service.rename_task(
            db, task=task, title=payload.title
        )
    if payload.sets_archived and payload.archived is not None:
        task = await agent_task_service.set_task_archived(
            db, task=task, archived=payload.archived
        )
    await db.commit()
    await db.refresh(task)
    return agent_task_service.task_to_list_item(task)


@router.get("/by-policy/{policy_id}", response_model=AgentTaskDetailOut)
async def get_task_by_policy(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskDetailOut:
    task = await agent_task_service.get_task_by_policy_id(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if task is None:
        raise _NOT_FOUND
    detail = await agent_task_service.load_task_detail(
        db, user_id=current_user.id, task_id=task.id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.get("/{task_id}", response_model=AgentTaskDetailOut)
async def get_agent_task(
    task_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskDetailOut:
    detail = await agent_task_service.load_task_detail(
        db, user_id=current_user.id, task_id=task_id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.post("/{task_id}/commands", response_model=AgentTaskDetailOut)
async def post_command(
    task_id: uuid.UUID,
    payload: AgentCommandIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskDetailOut:
    task = await agent_task_service.get_owned_task(
        db, user_id=current_user.id, task_id=task_id
    )
    if task is None:
        raise _NOT_FOUND

    if payload.type == "cancel":
        await agent_task_service.cancel_task(
            db, user_id=current_user.id, task_id=task_id
        )
    elif payload.type == "retry":
        await _retry_failed_task(db, current_user=current_user, task=task)
    elif payload.type in ("free_text", "revise_goal"):
        text = (payload.text or "").strip()
        if text:
            queued = await agent_task_service.queue_user_input(
                db,
                user_id=current_user.id,
                task_id=task.id,
                input_type=payload.type,
                text=text,
                client_request_id=payload.client_request_id,
            )
            if queued is None:
                raise _NOT_FOUND
            queued_task, item, run, queued_event, is_new = queued
            plan = None
            applied_event = None
            if is_new:
                plan, applied_event = await policy_agent_adapter.apply_user_input(
                    db,
                    current_user,
                    task=queued_task,
                    item=item,
                    run=run,
                )
            await db.commit()
            if queued_event is not None:
                await agent_event_service.publish_notify(
                    queued_task.id, queued_event.sequence
                )
            if applied_event is not None:
                await agent_event_service.publish_notify(
                    queued_task.id, applied_event.sequence
                )
            if plan is not None:
                policy_agent_adapter.dispatch_user_input(plan)

    detail = await agent_task_service.load_task_detail(
        db, user_id=current_user.id, task_id=task_id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.post(
    "/{task_id}/approvals/{approval_id}/submit",
    response_model=AgentTaskDetailOut,
)
async def submit_approval(
    task_id: uuid.UUID,
    approval_id: uuid.UUID,
    payload: AgentApprovalSubmitIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskDetailOut:
    from models.agent_task import AgentApproval

    approval = await db.get(AgentApproval, approval_id)
    if approval is None or approval.task_id != task_id:
        raise _NOT_FOUND

    if approval.kind == "intake_answers":
        result = await policy_agent_adapter.submit_intake_approval(
            db,
            current_user,
            task_id=task_id,
            approval_id=approval_id,
            version=payload.version,
            response=payload.response,
            client_request_id=payload.client_request_id,
        )
        if result is None:
            raise _CONFLICT
    elif approval.kind == "select_portfolio":
        result = await policy_agent_adapter.submit_select_portfolio_approval(
            db,
            current_user,
            task_id=task_id,
            approval_id=approval_id,
            version=payload.version,
            response=payload.response,
            client_request_id=payload.client_request_id,
        )
        if result is None:
            raise _CONFLICT
    elif approval.kind == "confirm_funding":
        # A browser acknowledgement is not proof that funds reached the vault.
        # Only /policies/{id}/confirm-open may complete this approval after it
        # has read and verified the on-chain policy state.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="funding_requires_confirm_open",
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="unsupported_approval_kind",
        )

    detail = await agent_task_service.load_task_detail(
        db, user_id=current_user.id, task_id=task_id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.post("/{task_id}/cancel", response_model=AgentTaskDetailOut)
async def cancel_agent_task(
    task_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentTaskDetailOut:
    task = await agent_task_service.cancel_task(
        db, user_id=current_user.id, task_id=task_id
    )
    if task is None:
        raise _NOT_FOUND
    detail = await agent_task_service.load_task_detail(
        db, user_id=current_user.id, task_id=task_id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.get("/{task_id}/events")
async def stream_agent_events(
    task_id: uuid.UUID,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    after: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
) -> StreamingResponse:
    async with AsyncSessionLocal() as db:
        task = await agent_task_service.get_owned_task(
            db, user_id=current_user.id, task_id=task_id
        )
    if task is None:
        raise _NOT_FOUND

    cursor = after
    if last_event_id:
        try:
            cursor = max(cursor, int(last_event_id))
        except ValueError:
            pass

    return StreamingResponse(
        _event_stream(
            user_id=current_user.id, task_id=task_id, after_sequence=cursor
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _encode_event(event) -> str:
    payload = AgentEventOut.model_validate(event, from_attributes=True).model_dump(
        by_alias=True, mode="json"
    )
    return agent_event_service.to_sse(
        event.event_type, payload, event_id=event.sequence
    )


async def _event_stream(
    *, user_id: uuid.UUID, task_id: uuid.UUID, after_sequence: int
) -> AsyncIterator[str]:
    cursor = after_sequence
    async with shielded_session() as db:
        backlog = await agent_event_service.list_events_after(
            db, task_id=task_id, after_sequence=cursor
        )
    for event in backlog:
        cursor = event.sequence
        yield _encode_event(event)

    try:
        async for notified in agent_event_service.subscribe_notify(
            task_id, poll_timeout=_HEARTBEAT_S
        ):
            async with shielded_session() as db:
                owned = await agent_task_service.get_owned_task(
                    db, user_id=user_id, task_id=task_id
                )
                if owned is None:
                    yield agent_event_service.to_sse(
                        "error",
                        {
                            "code": "agent_task_not_found",
                            "message": "任务不存在或已删除",
                        },
                    )
                    return
                fresh = await agent_event_service.list_events_after(
                    db, task_id=task_id, after_sequence=cursor
                )
            for event in fresh:
                cursor = event.sequence
                yield _encode_event(event)
            if notified is None and not fresh:
                yield agent_event_service.to_sse("heartbeat", {})
    except (RedisError, OSError) as exc:
        logger.warning("agent event stream degraded to DB poll: %s", exc)
        while True:
            await asyncio.sleep(_HEARTBEAT_S)
            async with shielded_session() as db:
                owned = await agent_task_service.get_owned_task(
                    db, user_id=user_id, task_id=task_id
                )
                if owned is None:
                    yield agent_event_service.to_sse(
                        "error",
                        {
                            "code": "agent_task_not_found",
                            "message": "任务不存在或已删除",
                        },
                    )
                    return
                fresh = await agent_event_service.list_events_after(
                    db, task_id=task_id, after_sequence=cursor
                )
            for event in fresh:
                cursor = event.sequence
                yield _encode_event(event)
            if not fresh:
                yield agent_event_service.to_sse("heartbeat", {})
