"""保单编排 orchestration（搜索前置）(差分机 / Difference Engine):
诉求 -> (并发: 问卷 + 广搜) -> 答案 -> compose.

Composes ai/policygen (the LLM brain) with policy_service / policy_search_service
(persistence); it never touches the ORM directly. 搜索前置状态机:
create_policy_shell -> intake (问卷 + 广搜 并发后台填充) ->
submit_answers -> composing (compose 选标的+组织在 Celery 里跑) -> proposed/failed.

异步取舍 (rules 第九章): the questionnaire is generated on a protected background
task (API process) so the chat tool turn gets the policy id immediately; the
request-level broad search runs in Celery (kicked off by the chat turn, see
chat_service). submit_answers no longer generates portfolios synchronously — it
records the answers, flips to `composing`, and enqueues the compose Celery task
(compose over the cached candidate pool, gated on search completion).
"""

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from ai.policygen import generate_risk_questionnaire
from core.database import AsyncSessionLocal
from core.security import CurrentUser
from models.policy import Policy
from schemas.policy import PolicyDetailOut
from services import policy_service

logger = logging.getLogger("lemma.services.policy_planning")

_COMPOSING = "composing"


async def create_policy_shell(
    db: AsyncSession,
    user: CurrentUser,
    *,
    need_text: str,
    conversation_id: uuid.UUID | None,
) -> Policy:
    """Create the intake policy row WITHOUT a questionnaire yet.

    Returns immediately with a policy id so the chat tool turn can attach the
    card and persist the turn without blocking on the slow questionnaire LLM
    call; generate_and_store_questionnaire fills intake_json afterwards.
    """
    return await policy_service.create_policy(
        db,
        user_id=user.id,
        need_text=need_text,
        conversation_id=conversation_id,
        intake_json=None,
    )


async def generate_and_store_questionnaire(
    policy_id: uuid.UUID,
    *,
    need: str,
    expected_input_revision: int | None = None,
) -> None:
    """Generate the risk questionnaire and store it on the policy.

    Runs on its OWN session as a protected background task (decoupled from the
    chat turn so it survives the client disconnecting). Any failure marks the
    policy failed — the card stops polling and shows the failure instead of an
    endless skeleton — and never propagates out of the background task.
    """
    async def input_is_current() -> bool:
        if expected_input_revision is None:
            return True
        from services import policy_agent_adapter

        return await policy_agent_adapter.is_policy_input_current(
            policy_id, expected_input_revision
        )

    try:
        intake_snapshot: dict | None = None
        async with AsyncSessionLocal() as db:
            policy = await db.get(Policy, policy_id)
            if policy is not None and isinstance(policy.intake_json, dict):
                intake_snapshot = dict(policy.intake_json)
        questionnaire = await generate_risk_questionnaire(
            need, intake_json=intake_snapshot
        )
    except Exception:  # noqa: BLE001 — background task: any failure -> failed, never raise
        logger.exception("questionnaire generation failed for policy %s", policy_id)
        if not await input_is_current():
            return
        async with AsyncSessionLocal() as db:
            await policy_service.mark_intake_failed(db, policy_id=policy_id)
        return
    if not await input_is_current():
        return
    async with AsyncSessionLocal() as db:
        if not await input_is_current():
            return
        await policy_service.store_questionnaire(
            db, policy_id=policy_id, questionnaire=questionnaire.model_dump()
        )


def _coverage_end_from_answers(answers: dict[str, str]) -> datetime | None:
    """Best-effort: parse a coverage end date/duration from the answers.

    Looks for keys like 'coverage-window', '保障期限', 'duration' and tries to
    interpret values as either ISO dates or simple durations (e.g. '3个月', '6 months').
    Returns None if nothing parseable is found.
    """
    duration_keywords = ("coverage", "duration", "period", "保障", "期限", "window")
    for key, value in answers.items():
        if not any(kw in key.lower() for kw in duration_keywords):
            continue
        # Try ISO date first
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(value.strip(), fmt).replace(tzinfo=UTC)
            except ValueError:
                continue
        # Try duration patterns: "N months/个月/weeks/天/days"
        match = re.search(r"(\d+)\s*(month|个月|months|week|weeks|周|day|days|天|year|years|年)", value, re.IGNORECASE)
        if match:
            num = int(match.group(1))
            unit = match.group(2).lower()
            now = datetime.now(UTC)
            if unit in ("month", "months", "个月"):
                return now + timedelta(days=num * 30)
            elif unit in ("week", "weeks", "周"):
                return now + timedelta(weeks=num)
            elif unit in ("day", "days", "天"):
                return now + timedelta(days=num)
            elif unit in ("year", "years", "年"):
                return now + timedelta(days=num * 365)
    return None


async def submit_answers(
    db: AsyncSession,
    user: CurrentUser,
    *,
    policy_id: uuid.UUID,
    answers: dict[str, str],
) -> PolicyDetailOut | None:
    """Record answers, flip to `composing`, enqueue the compose task.

    搜索前置: no portfolio is generated here — the broad search already ran (or is
    finishing) concurrently with the questionnaire; the compose Celery task gates
    on its completion, then composes (selects + organizes) over the cached pool.
    Returns the `composing` snapshot (empty portfolios) so the card streams progress.
    None -> 404 (IDOR).
    """
    policy = await policy_service.get_owned_policy(
        db, user_id=user.id, policy_id=policy_id
    )
    if policy is None:
        return None
    # 单发布者守卫 (决策⑥): only the intake->composing transition enqueues the
    # compose task, so a re-submit (already composing) never spawns a second
    # publisher racing the first on the same Redis channel.
    already_composing = policy.status == _COMPOSING
    policy.intake_json = {**(policy.intake_json or {}), "answers": answers}
    # Best-effort coverage_end derivation from answers
    coverage_end = _coverage_end_from_answers(answers)
    if coverage_end is not None:
        policy.coverage_end = coverage_end
    policy.status = _COMPOSING
    await db.commit()
    if not already_composing:
        # Lazy import: tasks import services, so importing at module top would cycle.
        from tasks.policy_compose import compose_policy

        compose_policy.delay(str(policy_id))
    return await policy_service.get_policy_detail(
        db, user_id=user.id, policy_id=policy_id
    )
