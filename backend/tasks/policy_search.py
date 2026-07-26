"""搜索前置 Celery task: 多源 Subagent 采集（Polymarket + WM + 新闻/网页 + synthesizer）。

与问卷并发执行。Polymarket 硬门槛；其它源 best-effort。EvidencePack 写入
intake_json；候选池仍只来自 Polymarket。

情报源降级：
- 网页：博查 (BOCHA_API_KEY) → DuckDuckGo HTML
- 新闻：Google News RSS → 博查近一周检索
无需 Apify。
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from typing import Any

from ai import init_ai_runtime, shutdown_ai_runtime
from ai.runtime import Budget, Plan, load_constraints_from_intake
from ai.runtime.subagents import SubagentOrchestrator
from core.config import settings
from core.database import AsyncSessionLocal, engine
from services import policy_search_service
from tasks.celery_app import celery_app

logger = logging.getLogger("lemma.tasks.policy_search")


def _search_timeout_s() -> float:
    raw = os.environ.get("SEARCH_TIMEOUT_S")
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            pass
    return float(getattr(settings, "agent_search_timeout_seconds", 120.0) or 120.0)


_SEARCH_REASON_TO_CODE = {
    "expansion_failed": "market_expansion_failed",
    "untranslated_query": "market_untranslated_query",
    "provider_unavailable": "market_provider_unavailable",
    "empty_result": "policy_search_empty",
}
_SEARCH_ERROR_MESSAGES = {
    "market_expansion_failed": "查询扩展失败（AI 暂不可用），请重试",
    "market_untranslated_query": "无法把诉求转成可检索的英文市场查询，请补充英文关键词或重试",
    "market_provider_unavailable": "预测市场数据源暂不可用，请稍后重试",
    "policy_search_empty": "未找到匹配的预测市场",
}


def _terminal_search_status(candidates: list[Any]) -> str:
    """Polymarket candidates alone satisfy the search stage hard gate."""
    return (
        policy_search_service.SEARCHED
        if candidates
        else policy_search_service.SEARCH_FAILED
    )


def _classify_search_error(
    *, timed_out: bool, report: Any, candidates: list[Any]
) -> tuple[str | None, str | None]:
    if candidates:
        return None, None
    if report is not None:
        reason = getattr(report, "reason", None)
        code = _SEARCH_REASON_TO_CODE.get(reason or "", "policy_search_failed")
        message = _SEARCH_ERROR_MESSAGES.get(code, "未找到可用的预测市场")
        return code, message
    if timed_out:
        return "policy_search_timeout", "市场搜索超时，请重试"
    return "policy_search_failed", "未找到可用的预测市场"


async def _resolve_task_run(
    policy_id: uuid.UUID,
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    from models.policy import Policy
    from services import agent_task_service

    async with AsyncSessionLocal() as db:
        policy = await db.get(Policy, policy_id)
        if policy is None:
            return None, None
        task = await agent_task_service.get_task_by_policy_id(
            db, user_id=policy.user_id, policy_id=policy_id
        )
        if task is None:
            return None, None
        run = await agent_task_service.get_latest_run(db, task_id=task.id)
        return task.id, (run.id if run else None)


async def run_search(
    policy_id: uuid.UUID,
    need: str,
    input_revision: int | None = None,
    *,
    dispose: bool = True,
) -> None:
    init_ai_runtime()
    timed_out = False
    cancelled = False
    candidates: list[Any] = []
    report = None
    pack = None
    try:
        # Cancel checks fire after every keyword/progress step across all
        # subagents; each one is a full round trip to the remote pooler
        # (~1s). A short TTL keeps mid-flight cancellation responsive without
        # letting the checks themselves eat the search wall-clock budget.
        cancel_cache: dict[str, Any] = {"at": 0.0, "value": False}

        async def is_cancelled() -> bool:
            if input_revision is None:
                return False
            if cancel_cache["value"]:
                return True
            now = time.monotonic()
            if now - cancel_cache["at"] < 3.0:
                return cancel_cache["value"]
            from services import policy_agent_adapter

            stale = not await policy_agent_adapter.is_policy_input_current(
                policy_id, input_revision
            )
            cancel_cache["at"] = time.monotonic()
            cancel_cache["value"] = stale
            return stale

        async with AsyncSessionLocal() as db:
            from models.policy import Policy

            policy = await db.get(Policy, policy_id)
            intake = dict(policy.intake_json or {}) if policy else {}
        constraints = load_constraints_from_intake(intake, goal=need)
        plan = Plan(
            goal=need,
            active_stage="market_search",
            input_revision=input_revision or 0,
        )
        budget = Budget(
            search_timeout_s=_search_timeout_s(),
            web_search_max=0,
        )
        # No StageRunner web enrich — Apify/WM subagents own timely intel.
        prompt_vars: dict[str, str] = {
            "analysis_context": "",
            "workspace_contract": "",
            "stage_hints": constraints.hints_block() or "（无额外阶段提示）",
            "plan_summary": plan.summary(),
            "budget_note": budget.budget_note(),
        }

        task_id, run_id = await _resolve_task_run(policy_id)

        from services import policy_agent_adapter

        async def emit_event(event_type: str, data: dict[str, Any]) -> None:
            await policy_agent_adapter.on_subagent_event(
                policy_id=policy_id,
                event_type=event_type,
                data=data,
                input_revision=input_revision,
            )
            # Project the hard-gate candidate pool as soon as Polymarket
            # finishes. Optional intel/synthesis may still be running, but the
            # user can already see concrete supply instead of a generic loader.
            if event_type == "subagent.completed" and data.get("kind") == "polymarket":
                fast_candidates, _ = orch.market_snapshot()
                if fast_candidates:
                    from services.policy_compose_events import build_search_payload

                    await policy_agent_adapter.on_research_progress(
                        policy_id=policy_id,
                        data={
                            "phase": "market_matched",
                            "status": "validating",
                            "summary": (
                                f"已匹配 {len(fast_candidates)} 个可用市场，"
                                "正在并行校验辅助情报"
                            ),
                            **build_search_payload(fast_candidates),
                        },
                        input_revision=input_revision,
                    )

        orch = SubagentOrchestrator(
            policy_id=policy_id,
            goal=need,
            task_id=task_id,
            run_id=run_id,
            input_revision=input_revision,
            plan=plan,
            constraints=constraints,
            budget=budget,
            prompt_vars=prompt_vars,
            is_cancelled=is_cancelled if input_revision is not None else None,
            emit_event=emit_event,
        )

        try:
            async with asyncio.timeout(_search_timeout_s()):
                result = await orch.run()
        except TimeoutError:
            timed_out = True
            candidates, report = orch.market_snapshot()
            logger.warning(
                "source collect timed out for policy %s after %ss; "
                "retaining %d completed market candidates",
                policy_id,
                _search_timeout_s(),
                len(candidates),
            )
            result = None

        if result is not None and result.cancelled:
            cancelled = True
            logger.info(
                "discarding cancelled policy search for %s at revision %s",
                policy_id,
                input_revision,
            )
            return

        if result is not None:
            candidates = list(result.candidates)
            report = result.report
            pack = result.pack

        if input_revision is not None and await is_cancelled():
            logger.info(
                "discarding stale policy search for %s at revision %s",
                policy_id,
                input_revision,
            )
            return

        # Polymarket is the hard gate; optional source/synthesizer timeout must
        # not discard a usable candidate pool that already completed.
        status = _terminal_search_status(candidates)
        error_code, error_message = _classify_search_error(
            timed_out=timed_out, report=report, candidates=candidates
        )

        async with AsyncSessionLocal() as db:
            wrote = await policy_search_service.persist_search_outcome(
                db,
                policy_id=policy_id,
                candidates=(
                    candidates if status == policy_search_service.SEARCHED else []
                ),
                status=status,
                expected_input_revision=input_revision,
            )
            if not wrote:
                logger.info(
                    "CAS rejected search persist for policy %s revision %s",
                    policy_id,
                    input_revision,
                )
                return

        try:
            from services import policy_agent_adapter, policy_compose_events

            if input_revision is not None and await is_cancelled():
                return

            payload = None
            if candidates and status == policy_search_service.SEARCHED:
                payload = policy_compose_events.build_search_payload(candidates)
            if pack is not None:
                sources = pack.sources_wire()
                if payload is None:
                    payload = {}
                payload = {**payload, "sources": sources, "brief": pack.brief}
            await policy_agent_adapter.on_search_terminal(
                policy_id=policy_id,
                search_status=status,
                search_payload=payload,
                input_revision=input_revision,
                error_code=error_code,
                error_message=error_message,
            )
        except Exception:  # noqa: BLE001
            logger.exception("agent projection after search failed for %s", policy_id)
    finally:
        if cancelled:
            pass
        if dispose:
            # Progress flushers run on protected tasks; let them land before
            # the engine pool closes or they die with noisy pool errors.
            from core.aio import drain_protected_writes

            await drain_protected_writes()
            await shutdown_ai_runtime()
            await engine.dispose()


@celery_app.task(name="policy.search", ignore_result=True)
def search_policy(
    policy_id: str, need: str, input_revision: int | None = None
) -> None:
    """Sync Celery entrypoint."""
    asyncio.run(run_search(uuid.UUID(policy_id), need, input_revision))
