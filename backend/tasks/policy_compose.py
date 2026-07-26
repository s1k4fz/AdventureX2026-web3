"""搜索前置 Celery task: compose = 等广搜终态 → compose → 落库。

进度只投影到 Agent events（不再 publish Redis policy:compose 通道）。
握手协议 P2: gate on search_status; interrupt 保留剩余 gate 预算（不归零）。
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from ai import init_ai_runtime, shutdown_ai_runtime
from ai.errors import is_retryable_error_code
from ai.policygen import stream_compose_portfolios
from ai.runtime import Budget, Plan, StageResult, StageRunner, load_constraints_from_intake
from ai.types import AIUseCase
from core.config import settings
from core.database import AsyncSessionLocal, engine
from services import policy_build_service, policy_search_service
from services.policy_compose_events import build_search_payload
from tasks.celery_app import celery_app

logger = logging.getLogger("lemma.tasks.policy_compose")

_RETRY = "retry"
_DONE = "done"
_INTERRUPTED = "interrupted"

_COMPOSE_FAILED = "policy_compose_failed"
_SEARCH_FAILED = "policy_search_failed"

_GATE_MAX_ATTEMPTS = 30
_GATE_RETRY_DELAY_S = 10
_INFRA_MAX_ATTEMPTS = 5
_INFRA_RETRY_DELAY_S = 10
_REFINE_BELOW_CANDIDATES = 12


class _TransientComposeError(Exception):
    """Transient provider failure — retry under infra budget."""


async def run_compose(policy_id: uuid.UUID, *, dispose: bool = True) -> str:
    """One compose attempt. Returns _RETRY / _DONE / _INTERRUPTED."""
    try:
        from services import policy_agent_adapter

        input_revision = await policy_agent_adapter.policy_input_revision(policy_id)
        expected_input_revision = input_revision or 0

        async def interrupted() -> bool:
            return not await policy_agent_adapter.is_policy_input_current(
                policy_id, expected_input_revision
            )

        async with AsyncSessionLocal() as db:
            search_status = await policy_search_service.read_search_status(
                db, policy_id=policy_id
            )
        if await interrupted():
            return _INTERRUPTED
        if search_status is None:
            return _DONE
        if search_status == policy_search_service.SEARCHING:
            return _RETRY

        if search_status == policy_search_service.SEARCH_FAILED:
            async with AsyncSessionLocal() as db:
                await policy_build_service.mark_failed(db, policy_id=policy_id)
            await policy_agent_adapter.on_compose_progress(
                policy_id=policy_id,
                event_type="error",
                data={"code": _SEARCH_FAILED, "message": "未找到可用的预测市场"},
            )
            return _DONE

        init_ai_runtime()
        try:
            async with AsyncSessionLocal() as db:
                inputs = await policy_build_service.load_compose_inputs(
                    db, policy_id=policy_id
                )
                candidates = await policy_search_service.load_market_candidates(
                    db, policy_id=policy_id
                )
                from models.policy import Policy

                policy_row = await db.get(Policy, policy_id)
                intake = dict(policy_row.intake_json or {}) if policy_row else {}

            if await interrupted():
                return _INTERRUPTED
            if inputs is None:
                return _DONE
            need, answers, coverage_end = inputs
            if not candidates:
                async with AsyncSessionLocal() as db:
                    await policy_build_service.mark_failed(db, policy_id=policy_id)
                await policy_agent_adapter.on_compose_progress(
                    policy_id=policy_id,
                    event_type="error",
                    data={
                        "code": _COMPOSE_FAILED,
                        "message": "保单编排未产出有效内容",
                    },
                )
                return _DONE

            constraints = load_constraints_from_intake(intake, goal=need)
            plan = Plan(
                goal=need,
                active_stage="compose",
                input_revision=expected_input_revision,
            )
            budget = Budget(
                compose_timeout_s=float(
                    getattr(settings, "agent_compose_timeout_seconds", 180.0) or 180.0
                ),
                web_search_max=0,
            )
            runner = StageRunner(
                plan=plan,
                constraints=constraints,
                budget=budget,
                policy_id=str(policy_id),
            )
            # EvidencePack from source-collect replaces silent WorldMonitor inject.
            prompt_vars = await runner.build_vars(
                include_world=False, allow_web_enrich=False
            )
            from ai.runtime.subagents import pack_from_intake

            pack = pack_from_intake(intake)
            if pack is not None:
                prompt_vars["evidence_pack"] = pack.as_prompt_block()
                # Keep analysis_context non-empty for templates that expect it.
                if not (prompt_vars.get("analysis_context") or "").strip():
                    prompt_vars["analysis_context"] = pack.as_prompt_block()
            runner.render_prompt(AIUseCase.PORTFOLIO_COMPOSE, prompt_vars)

            if not await runner.ensure_current(
                lambda: policy_agent_adapter.is_policy_input_current(
                    policy_id, expected_input_revision
                )
            ):
                return _INTERRUPTED

            try:
                from ai.policygen.market_search import search_markets_refined

                refined = []
                if len(candidates) < _REFINE_BELOW_CANDIDATES:
                    await policy_agent_adapter.on_compose_progress(
                        policy_id=policy_id,
                        event_type="phase",
                        data={
                            "summary": (
                                f"已匹配 {len(candidates)} 个候选，"
                                "正在用问卷偏好补齐最后一轮"
                            ),
                            "phase": "refine",
                        },
                    )
                    async with asyncio.timeout(
                        max(
                            1.0,
                            float(
                                getattr(
                                    settings,
                                    "agent_refined_search_timeout_seconds",
                                    15.0,
                                )
                                or 15.0
                            ),
                        )
                    ):
                        refined = await search_markets_refined(
                            need,
                            answers or {},
                            coverage_end=coverage_end,
                            policy_id=policy_id,
                            prompt_vars=prompt_vars,
                            is_cancelled=interrupted,
                        )
                if refined:
                    async with AsyncSessionLocal() as db:
                        await policy_search_service.merge_market_candidates(
                            db, policy_id=policy_id, new_candidates=refined
                        )
                    async with AsyncSessionLocal() as db:
                        candidates = await policy_search_service.load_market_candidates(
                            db, policy_id=policy_id
                        )
            except TimeoutError:
                logger.info(
                    "refined search exceeded fast-path budget for policy %s; "
                    "continuing with %d broad candidates",
                    policy_id,
                    len(candidates),
                )
            except Exception:  # noqa: BLE001
                logger.exception("refined search merge failed for policy %s", policy_id)

            if await interrupted():
                return _INTERRUPTED

            search_payload = build_search_payload(candidates)
            await policy_agent_adapter.on_compose_progress(
                policy_id=policy_id,
                event_type="search",
                data=search_payload,
            )
            await policy_agent_adapter.on_compose_progress(
                policy_id=policy_id,
                event_type="phase",
                data={
                    "summary": (
                        f"已锁定 {len(candidates)} 个有效候选，"
                        "正在比较风险暴露并生成三档方案"
                    ),
                    "phase": "compose",
                },
            )

            result = None
            error_code: str | None = None
            try:
                async with asyncio.timeout(budget.compose_timeout_s):
                    async for event in stream_compose_portfolios(
                        need,
                        answers,
                        candidates,
                        coverage_end=coverage_end,
                        prompt_vars=prompt_vars,
                    ):
                        if await interrupted():
                            await policy_agent_adapter.on_compose_progress(
                                policy_id=policy_id,
                                event_type="interrupted",
                                data={"revision": expected_input_revision},
                            )
                            return _INTERRUPTED
                        if event.kind == "reasoning":
                            if event.reasoning_text:
                                await policy_agent_adapter.on_compose_progress(
                                    policy_id=policy_id,
                                    event_type="reasoning",
                                    data={"text": event.reasoning_text},
                                )
                        elif event.kind == "result":
                            result = event.result
                            break
                        elif event.kind == "error":
                            error_code = event.error_code
                            logger.warning(
                                "compose failed for policy %s: %s (%s)",
                                policy_id,
                                event.error_message,
                                event.error_code,
                            )
                            break
            except TimeoutError:
                logger.warning(
                    "compose timed out for policy %s after %ss",
                    policy_id,
                    budget.compose_timeout_s,
                )
                error_code = _COMPOSE_FAILED

            if result is None and is_retryable_error_code(error_code):
                raise _TransientComposeError(error_code)

            if await interrupted():
                await policy_agent_adapter.on_compose_progress(
                    policy_id=policy_id,
                    event_type="interrupted",
                    data={"revision": expected_input_revision},
                )
                return _INTERRUPTED

            if result is None:
                async with AsyncSessionLocal() as db:
                    await policy_build_service.mark_failed(db, policy_id=policy_id)
                await policy_agent_adapter.on_compose_progress(
                    policy_id=policy_id,
                    event_type="error",
                    data={
                        "code": _COMPOSE_FAILED,
                        "message": "保单编排未产出有效内容",
                    },
                )
                return _DONE

            _ = StageResult(
                output=result,
                prompt_version=runner.ctx.prompt_version or "",
                discarded=False,
            )

            async with AsyncSessionLocal() as db:
                if await interrupted():
                    return _INTERRUPTED
                final_status = await policy_build_service.persist_portfolio_set(
                    db,
                    policy_id=policy_id,
                    result=result,
                    expected_input_revision=expected_input_revision,
                )
                if final_status == "stale":
                    await policy_agent_adapter.on_compose_progress(
                        policy_id=policy_id,
                        event_type="interrupted",
                        data={"revision": expected_input_revision},
                    )
                    return _INTERRUPTED
            if final_status == "proposed":
                await policy_agent_adapter.on_compose_progress(
                    policy_id=policy_id,
                    event_type="done",
                    data={},
                )
            else:
                await policy_agent_adapter.on_compose_progress(
                    policy_id=policy_id,
                    event_type="error",
                    data={
                        "code": _COMPOSE_FAILED,
                        "message": "保单编排未产出有效内容",
                    },
                )
            return _DONE
        finally:
            if dispose:
                await shutdown_ai_runtime()
    finally:
        if dispose:
            await engine.dispose()


async def _give_up(policy_id: uuid.UUID, code: str, message: str) -> None:
    try:
        from services import policy_agent_adapter

        async with AsyncSessionLocal() as db:
            await policy_build_service.mark_failed(db, policy_id=policy_id)
        await policy_agent_adapter.on_compose_progress(
            policy_id=policy_id,
            event_type="error",
            data={"code": code, "message": message},
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "failed to mark policy %s failed after budget exhaustion", policy_id
        )
    finally:
        await engine.dispose()


@celery_app.task(name="policy.compose", bind=True, max_retries=None)
def compose_policy(
    self,  # noqa: ANN001 — celery bind
    policy_id: str,
    gate_attempts: int = 0,
    infra_attempts: int = 0,
) -> None:
    try:
        outcome = asyncio.run(run_compose(uuid.UUID(policy_id)))
    except Exception as exc:  # noqa: BLE001
        if infra_attempts + 1 >= _INFRA_MAX_ATTEMPTS:
            logger.error("compose infra retries exhausted for policy %s", policy_id)
            asyncio.run(
                _give_up(
                    uuid.UUID(policy_id), _COMPOSE_FAILED, "保单编排失败，请重试"
                )
            )
            raise
        raise self.retry(
            exc=exc,
            countdown=_INFRA_RETRY_DELAY_S,
            args=[policy_id],
            kwargs={
                "gate_attempts": gate_attempts,
                "infra_attempts": infra_attempts + 1,
            },
        )
    if outcome == _RETRY:
        if gate_attempts + 1 >= _GATE_MAX_ATTEMPTS:
            logger.error(
                "broad search never reached a terminal state for policy %s",
                policy_id,
            )
            asyncio.run(
                _give_up(uuid.UUID(policy_id), _SEARCH_FAILED, "市场搜索超时，请重试")
            )
            return
        raise self.retry(
            countdown=_GATE_RETRY_DELAY_S,
            args=[policy_id],
            kwargs={
                "gate_attempts": gate_attempts + 1,
                "infra_attempts": infra_attempts,
            },
        )
    if outcome == _INTERRUPTED:
        # Preserve remaining gate budget — do NOT reset to 0 (avoids infinite wait).
        raise self.retry(
            countdown=0,
            args=[policy_id],
            kwargs={
                "gate_attempts": gate_attempts,
                "infra_attempts": infra_attempts,
            },
        )
