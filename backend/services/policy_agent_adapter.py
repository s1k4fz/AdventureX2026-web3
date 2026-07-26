"""Policy planning as the first Agent Task adapter.

Domain truth stays on `policies` / Celery. This module projects steps, approvals,
artifacts, and semantic events onto the generic Agent Shell.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core import aio
from core.database import AsyncSessionLocal
from core.security import CurrentUser
from services import (
    agent_event_service,
    agent_task_service,
    policy_planning_service,
    policy_service,
)

logger = logging.getLogger("lemma.services.policy_agent_adapter")


@dataclass(frozen=True)
class PolicyInputPlan:
    """Work to schedule only after the input transaction has committed."""

    task_id: uuid.UUID
    policy_id: uuid.UUID
    run_id: uuid.UUID | None
    input_revision: int
    need_text: str
    regenerate_questionnaire: bool
    restart_search: bool
    restart_compose: bool
    stage_hint: str | None = None
    restart_boundary: str = "none"


async def start_policy_task(
    db: AsyncSession,
    user: CurrentUser,
    *,
    goal_text: str,
    title: str | None = None,
    client_request_id: str | None = None,
    conversation_id: uuid.UUID | None = None,
) -> tuple[Any, Any]:
    """Create agent task + policy shell, kick questionnaire + market search."""
    task = await agent_task_service.create_task(
        db,
        user_id=user.id,
        kind="policy_planning",
        goal_text=goal_text,
        title=title,
        client_request_id=client_request_id,
        conversation_id=conversation_id,
    )
    # Idempotent re-entry: already linked to a policy.
    if task.primary_ref_id is not None:
        policy = await policy_service.get_owned_policy(
            db, user_id=user.id, policy_id=task.primary_ref_id
        )
        return task, policy

    run = await agent_task_service.get_latest_run(db, task_id=task.id)
    policy = await policy_planning_service.create_policy_shell(
        db,
        user,
        need_text=goal_text,
        conversation_id=conversation_id,
    )
    await agent_task_service.attach_primary_policy(
        db,
        task=task,
        policy_id=policy.id,
        run_id=run.id if run else None,
        conversation_id=conversation_id,
    )

    if run is not None:
        run.status = "running"
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="describe", status="succeeded"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="questionnaire", status="running"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="market_search", status="running"
        )
        await agent_task_service.emit_activity(
            db,
            task_id=task.id,
            run_id=run.id,
            summary="已创建保障任务，正在生成问卷并检索预测市场",
        )
        await db.commit()

    aio.spawn_protected(
        policy_planning_service.generate_and_store_questionnaire(
            policy.id, need=goal_text, expected_input_revision=task.input_revision
        )
    )
    aio.spawn_protected(
        watch_questionnaire_ready(
            task.id,
            policy.id,
            run.id if run else None,
            expected_input_revision=task.input_revision,
        )
    )
    # AI-powered task naming: generate a concise title and rich description
    # asynchronously so the schedule view has meaningful labels.
    from services import task_naming_service

    aio.spawn_protected(
        task_naming_service.apply_task_naming(
            task.id,
            goal_text,
            user_id=str(user.id),
            run_id=run.id if run else None,
        )
    )

    from tasks.policy_search import search_policy

    search_policy.delay(str(policy.id), goal_text, task.input_revision)
    return task, policy


async def watch_questionnaire_ready(
    task_id: uuid.UUID,
    policy_id: uuid.UUID,
    run_id: uuid.UUID | None,
    *,
    expected_input_revision: int = 0,
) -> None:
    """Poll until questionnaire lands, then open intake approval."""
    import asyncio

    from models.policy import Policy

    try:
        for _ in range(80):
            await asyncio.sleep(1.5)
            async with AsyncSessionLocal() as db:
                if not await is_policy_input_current(
                    policy_id, expected_input_revision, db=db
                ):
                    return
                policy = await db.get(Policy, policy_id)
                if policy is None:
                    return
                ready = bool((policy.intake_json or {}).get("questionnaire"))
                if not ready and policy.status != "failed":
                    continue

                if policy.status == "failed":
                    await agent_task_service.update_task_status(
                        db,
                        task_id=task_id,
                        status="failed",
                        error_code="policy_intake_failed",
                    )
                    if run_id:
                        await agent_task_service.set_step_status(
                            db,
                            run_id=run_id,
                            name="questionnaire",
                            status="failed",
                            error_code="policy_intake_failed",
                        )
                    event = await agent_event_service.append_event(
                        db,
                        task_id=task_id,
                        run_id=run_id,
                        event_type="task.failed",
                        data={
                            "code": "policy_intake_failed",
                            "message": "问卷生成失败",
                        },
                    )
                    await db.commit()
                    await agent_event_service.publish_notify(task_id, event.sequence)
                    return

                questionnaire = (policy.intake_json or {}).get("questionnaire") or {}
                if run_id:
                    await agent_task_service.set_step_status(
                        db, run_id=run_id, name="questionnaire", status="succeeded"
                    )
                approval = await agent_task_service.create_approval(
                    db,
                    task_id=task_id,
                    kind="intake_answers",
                    payload={"questionnaire": questionnaire},
                    run_id=run_id,
                )
                await agent_task_service.update_task_status(
                    db, task_id=task_id, status="waiting_user"
                )
                event = await agent_event_service.append_event(
                    db,
                    task_id=task_id,
                    run_id=run_id,
                    event_type="approval.created",
                    data={
                        "approvalId": str(approval.id),
                        "kind": "intake_answers",
                        "version": approval.version,
                    },
                )
                await agent_task_service.emit_activity(
                    db,
                    task_id=task_id,
                    run_id=run_id,
                    summary="风险问卷已就绪，请完成摸底后继续编排方案",
                )
                await db.commit()
                await agent_event_service.publish_notify(task_id, event.sequence)
                return
    except Exception:  # noqa: BLE001
        logger.exception("questionnaire watch failed for task %s", task_id)


async def policy_input_revision(
    policy_id: uuid.UUID, *, db: AsyncSession | None = None
) -> int | None:
    """Read the task cancellation token associated with a policy."""
    from sqlalchemy import select

    from models.agent_task import AgentTask

    async def _read(session: AsyncSession) -> int | None:
        result = await session.execute(
            select(AgentTask.input_revision).where(
                AgentTask.primary_ref_type == "policy",
                AgentTask.primary_ref_id == policy_id,
            )
        )
        value = result.scalar_one_or_none()
        return int(value) if value is not None else None

    if db is not None:
        return await _read(db)
    async with AsyncSessionLocal() as session:
        return await _read(session)


async def is_policy_input_current(
    policy_id: uuid.UUID,
    expected_input_revision: int,
    *,
    db: AsyncSession | None = None,
) -> bool:
    """True only while no newer user intervention has arrived."""
    revision = await policy_input_revision(policy_id, db=db)
    return revision is None or revision == expected_input_revision


def _append_user_constraint(previous: str, text: str, revision: int) -> str:
    suffix = f"\n\n用户补充约束（第 {revision} 次）：\n{text.strip()}"
    # Keep prompt growth bounded while retaining the original goal and latest
    # interruption. The input table remains the audit-complete source of truth.
    prefix = previous.strip()
    if len(prefix) > 18_000:
        prefix = prefix[:18_000].rstrip() + "\n…"
    return f"{prefix}{suffix}"


async def apply_user_input(
    db: AsyncSession,
    user: CurrentUser,
    *,
    task: Any,
    item: Any,
    run: Any | None,
) -> tuple[PolicyInputPlan | None, Any | None]:
    """Apply one queued input to the policy state machine.

    Inputs are never rejected because of the current stage. For mutable stages
    they advance the task's cancellation token, invalidate stale approvals,
    record stageHints, and schedule a fresh intake/search/compose pass after
    commit. For funded or monitoring stages they remain durable monitoring
    instructions instead of silently disappearing.
    """
    from models.policy import Policy
    from ai.runtime import (
        StageHint,
        dump_stage_hints,
        infer_active_stage,
        load_constraints_from_intake,
        restart_boundary_for,
    )

    if task.primary_ref_id is None:
        await agent_task_service.mark_inputs_applied(
            db, task_id=task.id, through_revision=item.revision
        )
        event = await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="input.applied",
            data={"inputId": str(item.id), "revision": item.revision},
        )
        return None, event

    policy = await db.get(Policy, task.primary_ref_id)
    if policy is None or policy.user_id != user.id:
        await agent_task_service.mark_inputs_applied(
            db, task_id=task.id, through_revision=item.revision
        )
        event = await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="input.applied",
            data={"inputId": str(item.id), "revision": item.revision},
        )
        return None, event

    step_statuses: dict[str, str] = {}
    if run is not None:
        from models.agent_task import AgentStep
        from sqlalchemy import select as sa_select

        step_rows = await db.execute(
            sa_select(AgentStep).where(AgentStep.run_id == run.id)
        )
        for step in step_rows.scalars():
            step_statuses[step.name] = step.status
    active_stage = infer_active_stage(
        policy_status=policy.status,
        search_status=policy.search_status,
        step_statuses=step_statuses,
    )
    input_type = "revise_goal" if item.type == "revise_goal" else "free_text"
    boundary = restart_boundary_for(
        active_stage=active_stage,
        input_type=input_type,  # type: ignore[arg-type]
        policy_status=policy.status,
    )

    if item.type == "revise_goal":
        task.goal_text = item.text
        task.title = agent_task_service.title_from_goal(item.text)
        task.description = None  # Clear stale description; AI will regenerate
        policy.need_text = item.text
        policy.title = item.text[:120]
        # Re-trigger AI naming for the revised goal
        from services import task_naming_service

        aio.spawn_protected(
            task_naming_service.apply_task_naming(
                task.id,
                item.text,
                user_id=str(user.id),
                run_id=run.id if run else None,
            )
        )
    else:
        policy.need_text = _append_user_constraint(
            policy.need_text, item.text, item.revision
        )

    intake = dict(policy.intake_json or {})
    history = list(intake.get("userInputs") or [])
    history.append(
        {
            "revision": item.revision,
            "type": item.type,
            "text": item.text,
        }
    )
    intake["userInputs"] = history[-12:]

    hints = load_constraints_from_intake(intake, goal=policy.need_text).stage_hints
    hints.append(
        StageHint(
            revision=item.revision,
            text=item.text,
            stage=active_stage,
            source=input_type,  # type: ignore[arg-type]
        )
    )
    intake["stageHints"] = dump_stage_hints(hints)

    if boundary == "monitoring_only":
        monitoring = list(intake.get("monitoringInstructions") or [])
        monitoring.append(item.text)
        intake["monitoringInstructions"] = monitoring[-12:]
        policy.intake_json = intake
        await agent_task_service.mark_inputs_applied(
            db, task_id=task.id, through_revision=item.revision
        )
        event = await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="input.applied",
            data={
                "inputId": str(item.id),
                "revision": item.revision,
                "mode": "monitoring",
                "activeStage": active_stage,
            },
        )
        await db.flush()
        return None, event

    previous_policy_status = policy.status
    regenerate_questionnaire = boundary == "questionnaire"
    if regenerate_questionnaire:
        intake.pop("questionnaire", None)
        intake.pop("answers", None)
        intake.pop("factorCategories", None)
        policy.intake_json = intake
        policy.status = "intake"
    else:
        policy.intake_json = intake
        if previous_policy_status not in ("intake",):
            policy.status = "composing"

    policy.search_status = "searching"
    await agent_task_service.mark_inputs_applying(
        db, task_id=task.id, through_revision=item.revision
    )
    await agent_task_service.expire_pending_approvals(db, task_id=task.id)
    await agent_task_service.update_task_status(db, task_id=task.id, status="running")

    if run is not None:
        run.status = "running"
        if regenerate_questionnaire:
            await agent_task_service.set_step_status(
                db, run_id=run.id, name="questionnaire", status="running"
            )
            await agent_task_service.set_step_status(
                db, run_id=run.id, name="compose", status="pending"
            )
        else:
            await agent_task_service.set_step_status(
                db, run_id=run.id, name="compose", status="running"
            )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="market_search", status="running"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="select_portfolio", status="pending"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="funding", status="pending"
        )

    event = await agent_event_service.append_event(
        db,
        task_id=task.id,
        run_id=run.id if run else None,
        event_type="input.applying",
        data={
            "inputId": str(item.id),
            "revision": item.revision,
            "activeStage": active_stage,
            "restartBoundary": boundary,
            "summary": "已接管新的用户输入，正在从安全检查点续跑",
        },
    )
    await db.flush()
    return (
        PolicyInputPlan(
            task_id=task.id,
            policy_id=policy.id,
            run_id=run.id if run else None,
            input_revision=item.revision,
            need_text=policy.need_text,
            regenerate_questionnaire=regenerate_questionnaire,
            restart_search=True,
            restart_compose=(
                boundary == "compose" and previous_policy_status != "composing"
            ),
            stage_hint=item.text,
            restart_boundary=boundary,
        ),
        event,
    )


def dispatch_user_input(plan: PolicyInputPlan) -> None:
    """Schedule post-commit work for one interruption without blocking API."""
    if plan.regenerate_questionnaire:
        aio.spawn_protected(
            policy_planning_service.generate_and_store_questionnaire(
                plan.policy_id,
                need=plan.need_text,
                expected_input_revision=plan.input_revision,
            )
        )
        aio.spawn_protected(
            watch_questionnaire_ready(
                plan.task_id,
                plan.policy_id,
                plan.run_id,
                expected_input_revision=plan.input_revision,
            )
        )
    if plan.restart_search:
        from tasks.policy_search import search_policy

        search_policy.delay(
            str(plan.policy_id), plan.need_text, plan.input_revision
        )
    if plan.restart_compose:
        from tasks.policy_compose import compose_policy

        compose_policy.delay(str(plan.policy_id))


async def on_search_terminal(
    *,
    policy_id: uuid.UUID,
    search_status: str,
    search_payload: dict[str, Any] | None = None,
    input_revision: int | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """Called from policy.search worker when broad search finishes."""
    try:
        async with AsyncSessionLocal() as db:
            from models.policy import Policy

            if input_revision is not None:
                if not await is_policy_input_current(
                    policy_id, input_revision, db=db
                ):
                    return

            policy = await db.get(Policy, policy_id)
            if policy is None:
                return
            task = await agent_task_service.get_task_by_policy_id(
                db, user_id=policy.user_id, policy_id=policy_id
            )
            if task is None:
                return
            if input_revision is not None and task.input_revision != input_revision:
                return
            run = await agent_task_service.get_latest_run(db, task_id=task.id)
            if run is None:
                return
            if search_status == "searched":
                await agent_task_service.set_step_status(
                    db,
                    run_id=run.id,
                    name="market_search",
                    status="succeeded",
                    progress=search_payload,
                )
                await agent_task_service.emit_activity(
                    db,
                    task_id=task.id,
                    run_id=run.id,
                    summary="预测市场广搜完成",
                    detail=search_payload or {},
                )
                event = await agent_event_service.append_event(
                    db,
                    task_id=task.id,
                    run_id=run.id,
                    event_type="research.updated",
                    data={
                        "phase": "terminal",
                        "status": "searched",
                        **(search_payload or {}),
                    },
                )
            else:
                code = error_code or "policy_search_failed"
                # Caller (policy.search worker) owns the user-facing message so
                # distinct failure reasons (expansion / translation / provider /
                # empty) read differently; fall back to the legacy defaults.
                message = error_message or (
                    "市场搜索超时，请重试"
                    if code == "policy_search_timeout"
                    else "未找到可用的预测市场"
                )
                await agent_task_service.set_step_status(
                    db,
                    run_id=run.id,
                    name="market_search",
                    status="failed",
                    error_code=code,
                )
                # Intake-phase search failure should surface on the task so
                # retry can re-kick search without waiting for compose.
                if policy.status == "intake":
                    await agent_task_service.update_task_status(
                        db,
                        task_id=task.id,
                        status="failed",
                        error_code=code,
                        error_message=message,
                    )
                event = await agent_event_service.append_event(
                    db,
                    task_id=task.id,
                    run_id=run.id,
                    event_type="step.failed",
                    data={
                        "step": "market_search",
                        "code": code,
                        "message": message,
                    },
                )
            await db.commit()
            await agent_event_service.publish_notify(task.id, event.sequence)
    except Exception:  # noqa: BLE001
        logger.exception("on_search_terminal failed for policy %s", policy_id)


async def on_subagent_event(
    *,
    policy_id: uuid.UUID,
    event_type: str,
    data: dict[str, Any],
    input_revision: int | None = None,
) -> None:
    """Persist subagent.* events + activity crumbs + research.updated projection."""
    try:
        async with AsyncSessionLocal() as db:
            from ai.runtime.subagents.types import KIND_LABELS, MAIN_AGENT_LABEL
            from models.policy import Policy

            if input_revision is not None:
                if not await is_policy_input_current(
                    policy_id, input_revision, db=db
                ):
                    return
            policy = await db.get(Policy, policy_id)
            if policy is None:
                return
            task = await agent_task_service.get_task_by_policy_id(
                db, user_id=policy.user_id, policy_id=policy_id
            )
            if task is None:
                return
            run = await agent_task_service.get_latest_run(db, task_id=task.id)
            run_id = run.id if run else None
            kind = str(data.get("kind") or "")
            label = KIND_LABELS.get(kind, kind or "子代理")  # type: ignore[arg-type]
            status = str(data.get("status") or "")
            summary = str(data.get("summary") or "")
            item_count = data.get("itemCount")
            brief_raw = data.get("brief") if isinstance(data.get("brief"), dict) else {}
            meta = (
                brief_raw.get("meta")
                if isinstance(brief_raw.get("meta"), dict)
                else {}
            )
            provider = meta.get("provider") or data.get("provider")
            fallback_from = meta.get("fallbackFrom") or data.get("fallbackFrom")
            latency_ms = meta.get("latencyMs") or data.get("latencyMs")
            citations = (
                brief_raw.get("citations")
                if isinstance(brief_raw.get("citations"), list)
                else []
            )
            error_code = data.get("errorCode") or brief_raw.get("error_code")
            error_message = data.get("errorMessage") or brief_raw.get(
                "error_message"
            )

            # Fan-out / fan-in: activity only (no per-source research projection).
            if event_type in ("subagent.fanout", "subagent.fanin"):
                if run_id:
                    await agent_task_service.set_step_status(
                        db,
                        run_id=run_id,
                        name="market_search",
                        status="running",
                        progress={
                            "phase": data.get("phase") or event_type,
                            "kinds": data.get("kinds"),
                        },
                    )
                event = await agent_event_service.append_event(
                    db,
                    task_id=task.id,
                    run_id=run_id,
                    event_type=event_type,
                    data=data,
                )
                if event_type == "subagent.fanout":
                    activity_summary = summary or (
                        f"{MAIN_AGENT_LABEL}派出调查员并行调查"
                    )
                else:
                    activity_summary = summary or "并行调查已汇集，情报官开始汇总"
                await agent_task_service.emit_activity(
                    db,
                    task_id=task.id,
                    run_id=run_id,
                    summary=activity_summary,
                    detail={
                        "phase": data.get("phase"),
                        "kinds": data.get("kinds"),
                    },
                )
                await agent_event_service.append_event(
                    db,
                    task_id=task.id,
                    run_id=run_id,
                    event_type="research.updated",
                    data={
                        "phase": data.get("phase") or event_type.split(".")[-1],
                        "summary": activity_summary,
                        "kinds": data.get("kinds"),
                    },
                )
                await db.commit()
                await agent_event_service.publish_notify(task.id, event.sequence)
                return

            if (
                event_type == "subagent.updated"
                and run_id
                and kind in KIND_LABELS
            ):
                from ai.runtime.subagents.persist import update_subagent_progress

                progress_payload = (
                    data.get("progress")
                    if isinstance(data.get("progress"), dict)
                    else {"summary": summary}
                )
                query = data.get("query")
                await update_subagent_progress(
                    db,
                    task_id=task.id,
                    run_id=run_id,
                    kind=kind,  # type: ignore[arg-type]
                    progress=progress_payload,
                    query_text=str(query)[:200] if query else None,
                )

            if run_id:
                progress = {
                    "subagent": {
                        "kind": kind,
                        "status": status,
                        "summary": summary,
                        "provider": provider,
                        "itemCount": item_count
                        if isinstance(item_count, int)
                        else 0,
                    }
                }
                await agent_task_service.set_step_status(
                    db,
                    run_id=run_id,
                    name="market_search",
                    status="running",
                    progress=progress,
                )

            event = await agent_event_service.append_event(
                db,
                task_id=task.id,
                run_id=run_id,
                event_type=event_type,
                data=data,
            )

            # Compatibility projection for older clients / journey search stage.
            sources_snap = {
                "phase": "source",
                "kind": kind,
                "status": status,
                "summary": summary,
                "provider": provider,
                "fallbackFrom": fallback_from,
                "latencyMs": latency_ms,
                "errorCode": error_code,
                "errorMessage": error_message,
                "sources": [
                    {
                        "kind": kind,
                        "status": status,
                        "summary": summary,
                        "itemCount": item_count
                        if isinstance(item_count, int)
                        else 0,
                        "provider": provider,
                        "fallbackFrom": fallback_from,
                        "latencyMs": latency_ms,
                        "errorCode": error_code,
                        "errorMessage": error_message,
                        "citations": citations[:6],
                        "meta": meta,
                    }
                ],
            }
            await agent_event_service.append_event(
                db,
                task_id=task.id,
                run_id=run_id,
                event_type="research.updated",
                data=sources_snap,
            )

            activity_summary = summary or f"{label} {status}"
            if event_type == "subagent.completed" and isinstance(item_count, int):
                provider_bit = f" · {provider}" if provider else ""
                activity_summary = f"{label}完成 · {item_count} 条{provider_bit}"
            elif event_type == "subagent.failed":
                err_bit = f"：{error_message}" if error_message else ""
                activity_summary = f"{label}失败{err_bit}"[:200]
            elif event_type == "subagent.started":
                activity_summary = f"启动 {label}"
            await agent_task_service.emit_activity(
                db,
                task_id=task.id,
                run_id=run_id,
                summary=activity_summary,
                detail={
                    "kind": kind,
                    "status": status,
                    "provider": provider,
                    "fallbackFrom": fallback_from,
                    "latencyMs": latency_ms,
                    "itemCount": item_count,
                    "errorCode": error_code,
                },
            )
            await db.commit()
            await agent_event_service.publish_notify(task.id, event.sequence)
    except Exception:  # noqa: BLE001
        logger.exception("on_subagent_event failed for policy %s", policy_id)


async def on_research_progress(
    *,
    policy_id: uuid.UUID,
    data: dict[str, Any],
    input_revision: int | None = None,
) -> None:
    """Mid-search progress → durable research.updated events."""
    try:
        async with AsyncSessionLocal() as db:
            from models.policy import Policy

            if input_revision is not None:
                if not await is_policy_input_current(
                    policy_id, input_revision, db=db
                ):
                    return
            policy = await db.get(Policy, policy_id)
            if policy is None:
                return
            task = await agent_task_service.get_task_by_policy_id(
                db, user_id=policy.user_id, policy_id=policy_id
            )
            if task is None:
                return
            run = await agent_task_service.get_latest_run(db, task_id=task.id)
            if run is not None:
                await agent_task_service.set_step_status(
                    db,
                    run_id=run.id,
                    name="market_search",
                    status="running",
                    progress=data,
                )
            event = await agent_event_service.append_event(
                db,
                task_id=task.id,
                run_id=run.id if run else None,
                event_type="research.updated",
                data=data,
            )
            await db.commit()
            await agent_event_service.publish_notify(task.id, event.sequence)
    except Exception:  # noqa: BLE001
        logger.exception("on_research_progress failed for policy %s", policy_id)


async def on_compose_progress(
    *,
    policy_id: uuid.UUID,
    event_type: str,
    data: dict[str, Any],
) -> None:
    """Mirror compose pub/sub events into durable agent events."""
    try:
        async with AsyncSessionLocal() as db:
            from models.policy import Policy

            policy = await db.get(Policy, policy_id)
            if policy is None:
                return
            task = await agent_task_service.get_task_by_policy_id(
                db, user_id=policy.user_id, policy_id=policy_id
            )
            if task is None:
                return
            run = await agent_task_service.get_latest_run(db, task_id=task.id)
            run_id = run.id if run else None

            if event_type == "search" and run_id:
                await agent_task_service.set_step_status(
                    db,
                    run_id=run_id,
                    name="compose",
                    status="running",
                    progress={"search": data},
                )
                mapped = "research.updated"
                payload = {"kind": "search", **data}
            elif event_type == "reasoning":
                # Convert raw CoT into auditable activity crumbs (no raw dump).
                text = (data.get("text") or "").strip()
                if not text:
                    return
                mapped = "activity"
                payload = {
                    "summary": "正在编排保障方案",
                    "crumb": text[:240],
                }
            elif event_type == "phase":
                summary = str(data.get("summary") or "正在生成保障方案").strip()
                if not summary:
                    return
                if run_id:
                    await agent_task_service.set_step_status(
                        db,
                        run_id=run_id,
                        name="compose",
                        status="running",
                        progress={"phase": data.get("phase"), "summary": summary},
                    )
                mapped = "model.explanation.updated"
                payload = {
                    "id": f"compose-progress-{run_id or policy_id}",
                    "summary": summary[:200],
                    "stage": "coverage_plan",
                    "status": "tool_calling",
                    "progress": 74 if data.get("phase") == "compose" else 58,
                    "phase": data.get("phase"),
                    "toolStatus": [
                        {"name": "预测市场匹配", "status": "done"},
                        {"name": "保障方案生成", "status": "running"},
                    ],
                }
            elif event_type == "done":
                if run_id:
                    await agent_task_service.set_step_status(
                        db, run_id=run_id, name="compose", status="succeeded"
                    )
                    await agent_task_service.set_step_status(
                        db, run_id=run_id, name="select_portfolio", status="running"
                    )
                await agent_task_service.update_task_status(
                    db, task_id=task.id, status="waiting_user"
                )
                approval = await agent_task_service.create_approval(
                    db,
                    task_id=task.id,
                    kind="select_portfolio",
                    payload={"policyId": str(policy_id)},
                    run_id=run_id,
                )
                await agent_task_service.mark_inputs_applied(
                    db,
                    task_id=task.id,
                    through_revision=task.input_revision,
                )
                await agent_event_service.append_event(
                    db,
                    task_id=task.id,
                    run_id=run_id,
                    event_type="input.applied",
                    data={"revision": task.input_revision},
                )
                mapped = "approval.created"
                payload = {
                    "approvalId": str(approval.id),
                    "kind": "select_portfolio",
                    "version": approval.version,
                    "policyId": str(policy_id),
                }
            elif event_type == "interrupted":
                mapped = "activity"
                payload = {
                    "summary": "已接管新的用户输入，正在从安全检查点续跑",
                    "revision": data.get("revision"),
                }
            elif event_type == "error":
                if run_id:
                    await agent_task_service.set_step_status(
                        db,
                        run_id=run_id,
                        name="compose",
                        status="failed",
                        error_code=data.get("code"),
                        error_message=data.get("message"),
                    )
                await agent_task_service.update_task_status(
                    db,
                    task_id=task.id,
                    status="failed",
                    error_code=data.get("code"),
                    error_message=data.get("message"),
                )
                mapped = "task.failed"
                payload = data
            else:
                return

            event = await agent_event_service.append_event(
                db,
                task_id=task.id,
                run_id=run_id,
                event_type=mapped,
                data=payload,
            )
            await db.commit()
            await agent_event_service.publish_notify(task.id, event.sequence)
    except Exception:  # noqa: BLE001
        logger.exception("on_compose_progress failed for policy %s", policy_id)


async def submit_intake_approval(
    db: AsyncSession,
    user: CurrentUser,
    *,
    task_id: uuid.UUID,
    approval_id: uuid.UUID,
    version: int,
    response: dict[str, Any],
    client_request_id: str | None = None,
) -> Any | None:
    approval = await agent_task_service.submit_approval_atomic(
        db,
        user_id=user.id,
        task_id=task_id,
        approval_id=approval_id,
        version=version,
        response=response,
        client_request_id=client_request_id,
    )
    if approval is None:
        return None

    task = await agent_task_service.get_owned_task(
        db, user_id=user.id, task_id=task_id
    )
    if task is None or task.primary_ref_id is None:
        return None

    answers_list = response.get("answers") or []
    answers = {
        item["questionId"]: item["answer"]
        for item in answers_list
        if isinstance(item, dict) and item.get("questionId") and item.get("answer")
    }
    # Also accept map form.
    if not answers and isinstance(response.get("answersMap"), dict):
        answers = {
            str(k): str(v) for k, v in response["answersMap"].items() if v is not None
        }

    detail = await policy_planning_service.submit_answers(
        db, user, policy_id=task.primary_ref_id, answers=answers
    )
    run = await agent_task_service.get_latest_run(db, task_id=task.id)
    if run is not None:
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="compose", status="running"
        )
        await agent_task_service.update_task_status(
            db, task_id=task.id, status="running"
        )
        await agent_task_service.emit_activity(
            db,
            task_id=task.id,
            run_id=run.id,
            summary="问卷已提交，正在编排三档保障方案",
        )
    event = await agent_event_service.append_event(
        db,
        task_id=task.id,
        run_id=run.id if run else None,
        event_type="approval.submitted",
        data={
            "approvalId": str(approval.id),
            "kind": approval.kind,
            "version": approval.version,
        },
    )
    await db.commit()
    await agent_event_service.publish_notify(task.id, event.sequence)
    return detail


async def submit_select_portfolio_approval(
    db: AsyncSession,
    user: CurrentUser,
    *,
    task_id: uuid.UUID,
    approval_id: uuid.UUID,
    version: int,
    response: dict[str, Any],
    client_request_id: str | None = None,
) -> Any | None:
    task = await agent_task_service.get_owned_task(
        db, user_id=user.id, task_id=task_id
    )
    if task is None or task.primary_ref_id is None:
        return None

    # A task tab can survive a page refresh while its policy was already
    # opened on-chain in another tab.  Reconcile this stale approval instead
    # of consuming it and then failing the funding-plan status gate with 409.
    from models.policy import Policy

    policy = await db.get(Policy, task.primary_ref_id)
    if policy is None:
        return None
    if policy.status in ("funded", "active", "settled"):
        projection = await mark_policy_opened(
            db,
            user_id=user.id,
            policy_id=policy.id,
            open_tx=policy.open_tx or "",
        )
        await db.commit()
        if projection is not None:
            projected_task_id, sequences = projection
            for sequence in sequences:
                await agent_event_service.publish_notify(projected_task_id, sequence)
        return {"reconciled": True}

    approval = await agent_task_service.submit_approval_atomic(
        db,
        user_id=user.id,
        task_id=task_id,
        approval_id=approval_id,
        version=version,
        response=response,
        client_request_id=client_request_id,
    )
    if approval is None:
        return None

    portfolio_id = response.get("portfolioId")
    if not portfolio_id:
        return None

    from services.policy_chain_service import build_funding_plan

    plan = await build_funding_plan(
        db,
        user_id=user.id,
        policy_id=task.primary_ref_id,
        portfolio_id=uuid.UUID(str(portfolio_id)),
        premium_override=response.get("premium"),
        position_overrides=response.get("positionOverrides"),
    )
    run = await agent_task_service.get_latest_run(db, task_id=task.id)
    if run is not None:
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="select_portfolio", status="succeeded"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="funding", status="running"
        )
    funding_payload = {
        "policyId": str(task.primary_ref_id),
        "portfolioId": str(portfolio_id),
    }
    funding_approval = await agent_task_service.create_approval(
        db,
        task_id=task.id,
        kind="confirm_funding",
        payload=funding_payload,
        run_id=run.id if run else None,
    )
    await agent_task_service.update_task_status(
        db, task_id=task.id, status="waiting_user"
    )
    # Emit a full hand-off sequence so the workbench can show concrete progress
    # (selected → funding running → waiting wallet) instead of a bare
    # confirm_funding approval with an empty observation card.
    events = [
        await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="approval.submitted",
            data={
                "approvalId": str(approval.id),
                "kind": approval.kind,
                "version": approval.version,
                "response": response,
            },
        ),
    ]
    if run is not None:
        for name, step_status in (
            ("select_portfolio", "succeeded"),
            ("funding", "running"),
        ):
            events.append(
                await agent_event_service.append_event(
                    db,
                    task_id=task.id,
                    run_id=run.id,
                    event_type="step.updated",
                    data={"name": name, "status": step_status},
                )
            )
    events.append(
        await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="activity",
            data={
                "summary": "档位已锁定，等待钱包确认链上出资",
                "portfolioId": str(portfolio_id),
            },
        )
    )
    events.append(
        await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="approval.created",
            data={
                "approvalId": str(funding_approval.id),
                "kind": "confirm_funding",
                "version": funding_approval.version,
                "payload": funding_payload,
            },
        )
    )
    await db.commit()
    for event in events:
        await agent_event_service.publish_notify(task.id, event.sequence)
    return plan


async def mark_policy_opened(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
    open_tx: str,
) -> tuple[uuid.UUID, list[int]] | None:
    """Project a confirmed on-chain opening back into the Agent task.

    Funding is only complete after ``confirm-open`` has verified the contract
    state.  Keeping this projection here prevents the workbench from moving to
    monitoring merely because the user navigated to the funding screen.
    """
    from models.agent_task import AgentApproval
    from sqlalchemy import select as sa_select

    task = await agent_task_service.get_task_by_policy_id(
        db, user_id=user_id, policy_id=policy_id
    )
    if task is None:
        return None

    run = await agent_task_service.get_latest_run(db, task_id=task.id)
    # Locate the actual funding confirmation before expiring stale approvals;
    # it is the one approval that should become submitted, not expired.
    pending = await db.execute(
        sa_select(AgentApproval)
        .where(
            AgentApproval.task_id == task.id,
            AgentApproval.kind == "confirm_funding",
            AgentApproval.status == "pending",
        )
        .order_by(AgentApproval.created_at.desc())
        .limit(1)
    )
    approval = pending.scalar_one_or_none()
    # Any other task approval is stale once the verified chain state is open.
    # This also repairs workspaces created before chain confirmation projected
    # back to the Agent runtime.
    await agent_task_service.expire_pending_approvals(db, task_id=task.id)
    if approval is not None:
        approval.status = "submitted"
        approval.response_json = {"confirmed": True, "openTx": open_tx}

    if run is not None:
        run.status = "running"
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="select_portfolio", status="succeeded"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="funding", status="succeeded"
        )
        await agent_task_service.set_step_status(
            db, run_id=run.id, name="monitor", status="running"
        )
    # Funding is the hand-off into the long-lived monitoring phase, not the
    # end of the task.  Keep the task open as ``monitoring`` so the workbench,
    # task sidebar, and future monitoring inputs agree with the active policy.
    await agent_task_service.update_task_status(
        db, task_id=task.id, status="monitoring", clear_error=True
    )

    events = []
    if approval is not None:
        events.append(
            await agent_event_service.append_event(
                db,
                task_id=task.id,
                run_id=run.id if run else None,
                event_type="approval.submitted",
                data={
                    "approvalId": str(approval.id),
                    "kind": "confirm_funding",
                    "version": approval.version,
                },
            )
        )
    for name, step_status in (
        ("select_portfolio", "succeeded"),
        ("funding", "succeeded"),
        ("monitor", "running"),
    ):
        events.append(
            await agent_event_service.append_event(
                db,
                task_id=task.id,
                run_id=run.id if run else None,
                event_type="step.updated",
                data={"name": name, "status": step_status},
            )
        )
    events.append(
        await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="task.monitoring",
            data={"policyId": str(policy_id), "openTx": open_tx},
        )
    )
    events.append(
        await agent_event_service.append_event(
            db,
            task_id=task.id,
            run_id=run.id if run else None,
            event_type="activity",
            data={"summary": "链上出资已确认，保障已生效并开始持续监控"},
        )
    )
    await db.flush()
    # The caller owns the surrounding chain-confirmation transaction and must
    # notify only after it commits; otherwise an SSE consumer can wake before
    # the events are visible in its own database session.
    return task.id, [event.sequence for event in events]
