"""Bridge A2A `full_system_task` onto the real xEngine 差分机 policy flow.

YAGNI: reuses `start_policy_task` + `submit_answers` + row polling. No second
orchestrator.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from a2a_agent.deepseek_client import chat_text
from a2a_agent.errors import A2ASkillError
from core.config import settings
from core.database import AsyncSessionLocal
from core.security import CurrentUser
from models.policy import Policy
from services.policy_agent_adapter import start_policy_task
from services.policy_planning_service import submit_answers

logger = logging.getLogger("lemma.a2a_agent.task_bridge")

OnStatus = Callable[[str], Awaitable[None]] | None
WaitReason = Literal["ok", "timeout", "missing", "failed"]

_SEARCH_TERMINAL = frozenset({"searched", "failed"})
# Success compose/lifecycle terminals. `failed` is terminal but not success.
_COMPOSE_SUCCESS = frozenset({"proposed", "funded", "active", "settled"})
_POLL_INTERVAL_S = 2.0
_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class WaitOutcome:
    """Discriminated wait result so callers do not mislabel missing/failed as timeout."""

    reason: WaitReason
    value: Any = None


def _wait_error_summary(
    phase: Literal["questionnaire", "compose"],
    reason: WaitReason,
    *,
    task_id: uuid.UUID,
    policy_id: uuid.UUID,
) -> str:
    if reason == "timeout":
        detail = f"timed out waiting for {phase}"
    elif reason == "missing":
        detail = f"failed: policy missing while waiting for {phase}"
    elif reason == "failed":
        detail = f"failed: policy failed before {phase}"
    else:
        detail = f"failed waiting for {phase}"
    return f"full_system_task {detail}. task_id: {task_id} policy_id: {policy_id}"


async def _emit(on_status: OnStatus, msg: str) -> None:
    if on_status is not None:
        await on_status(msg)


def _extract_questions(questionnaire: dict[str, Any]) -> list[dict[str, Any]]:
    raw = questionnaire.get("questions") or []
    return [q for q in raw if isinstance(q, dict) and q.get("id")]


def _parse_answers_json(text: str) -> dict[str, str] | None:
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    fence = _JSON_FENCE_RE.search(cleaned)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    out: dict[str, str] = {}
    for key, value in data.items():
        if value is None:
            continue
        out[str(key)] = str(value)
    return out or None


def _fallback_answers(questionnaire: dict[str, Any]) -> dict[str, str]:
    answers: dict[str, str] = {}
    for question in _extract_questions(questionnaire):
        qid = str(question["id"])
        options = question.get("options") or []
        if not options:
            continue
        first = options[0]
        if isinstance(first, dict):
            answers[qid] = str(
                first.get("label") or first.get("id") or first.get("value") or first
            )
        else:
            answers[qid] = str(first)
    return answers


async def _auto_answers(goal: str, questionnaire: dict[str, Any]) -> dict[str, str]:
    """Ask deepseek-v4-pro once for `{question_id: answer}` JSON."""
    questions = _extract_questions(questionnaire)
    if not questions:
        return {}
    payload = {
        "goal": goal,
        "questions": [
            {
                "id": q.get("id"),
                "title": q.get("title"),
                "options": q.get("options") or [],
            }
            for q in questions
        ],
    }
    try:
        raw = await chat_text(
            model=settings.deepseek_model_pro,
            system=(
                "You answer a risk-intake questionnaire for an insurance/policy "
                "planning agent. Reply with ONLY a JSON object mapping each "
                "question id to one chosen option string (must be from that "
                "question's options when options are provided). No markdown."
            ),
            user=json.dumps(payload, ensure_ascii=False),
            max_tokens=1024,
        )
        parsed = _parse_answers_json(raw)
        if parsed:
            # Keep only known question ids; fill gaps with first option.
            known = {str(q["id"]) for q in questions}
            answers = {k: v for k, v in parsed.items() if k in known}
            for qid, fallback in _fallback_answers(questionnaire).items():
                answers.setdefault(qid, fallback)
            return answers
    except Exception:  # noqa: BLE001 — degrade to deterministic first-option answers
        logger.exception("auto questionnaire answers via DeepSeek failed; using fallback")
    return _fallback_answers(questionnaire)


async def _wait_questionnaire(
    policy_id: uuid.UUID,
    *,
    task_id: uuid.UUID | None = None,
    on_status: OnStatus = None,
    timeout_s: float = 180.0,
) -> WaitOutcome:
    """Poll until questionnaire lands or search is terminal (whichever first)."""
    deadline = asyncio.get_event_loop().time() + timeout_s
    last_emit = 0.0
    while asyncio.get_event_loop().time() < deadline:
        async with AsyncSessionLocal() as db:
            policy = await db.get(Policy, policy_id)
            if policy is None:
                await _emit(on_status, "error:policy_missing")
                return WaitOutcome("missing")
            intake = policy.intake_json if isinstance(policy.intake_json, dict) else {}
            questionnaire = intake.get("questionnaire")
            search_status = policy.search_status or "searching"
            now = asyncio.get_event_loop().time()
            if now - last_emit >= 4.0:
                await _emit(
                    on_status,
                    f"status:{policy.status} search:{search_status}",
                )
                last_emit = now
            if isinstance(questionnaire, dict) and (
                questionnaire.get("questions") or questionnaire.get("factor_categories")
            ):
                return WaitOutcome("ok", questionnaire)
            if search_status in _SEARCH_TERMINAL and not questionnaire:
                # Search finished but questionnaire not ready yet — keep waiting
                # until timeout unless status is failed.
                if policy.status == "failed":
                    await _emit(on_status, "error:policy_failed_before_questionnaire")
                    return WaitOutcome("failed")
        await asyncio.sleep(_POLL_INTERVAL_S)
    await _emit(on_status, "error:questionnaire_timeout")
    return WaitOutcome("timeout")


def _policy_snapshot(policy: Policy) -> Any:
    """Copy fields needed for the summary so we never touch a closed session."""
    portfolios = [
        SimpleNamespace(
            tier=getattr(p, "tier", None),
            title=getattr(p, "title", None),
        )
        for p in list(policy.portfolios or [])
    ]
    intake = policy.intake_json if isinstance(policy.intake_json, dict) else None
    return SimpleNamespace(
        id=policy.id,
        status=policy.status,
        search_status=policy.search_status,
        title=policy.title,
        intake_json=dict(intake) if intake else None,
        portfolios=portfolios,
    )


async def _wait_compose(
    policy_id: uuid.UUID,
    *,
    task_id: uuid.UUID | None = None,
    on_status: OnStatus = None,
    timeout_s: float = 300.0,
) -> WaitOutcome:
    """Poll until policy reaches a compose/lifecycle terminal status."""
    deadline = asyncio.get_event_loop().time() + timeout_s
    last_emit = 0.0
    while asyncio.get_event_loop().time() < deadline:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Policy)
                .options(selectinload(Policy.portfolios))
                .where(Policy.id == policy_id)
            )
            policy = result.scalar_one_or_none()
            if policy is None:
                await _emit(on_status, "error:policy_missing")
                return WaitOutcome("missing")
            now = asyncio.get_event_loop().time()
            if now - last_emit >= 4.0:
                await _emit(
                    on_status,
                    f"status:{policy.status} search:{policy.search_status}",
                )
                last_emit = now
            if policy.status == "failed":
                await _emit(on_status, "error:policy_failed")
                return WaitOutcome("failed")
            if policy.status in _COMPOSE_SUCCESS:
                return WaitOutcome("ok", _policy_snapshot(policy))
        await asyncio.sleep(_POLL_INTERVAL_S)
    await _emit(on_status, "error:compose_timeout")
    return WaitOutcome("timeout")


def _portfolio_headlines(policy: Any) -> list[str]:
    portfolios = getattr(policy, "portfolios", None) or []
    lines: list[str] = []
    for p in portfolios:
        tier = getattr(p, "tier", None) or ""
        title = getattr(p, "title", None) or ""
        if tier and title:
            lines.append(f"- {tier}: {title}")
        elif title:
            lines.append(f"- {title}")
        elif tier:
            lines.append(f"- {tier}")
    return lines


def _build_summary(
    *,
    task_id: uuid.UUID,
    policy_id: uuid.UUID,
    policy: Any,
    answers: dict[str, str],
) -> str:
    status = getattr(policy, "status", "unknown")
    search_status = getattr(policy, "search_status", "unknown")
    title = getattr(policy, "title", "") or ""
    lines = [
        "Full-system policy task complete.",
        f"task_id: {task_id}",
        f"policy_id: {policy_id}",
        f"policy_status: {status}",
        f"search_status: {search_status}",
    ]
    if title:
        lines.append(f"title: {title}")
    lines.append(f"search_snapshot: status={search_status}")
    headlines = _portfolio_headlines(policy)
    if headlines:
        lines.append("portfolios:")
        lines.extend(headlines)
    else:
        lines.append("portfolios: (none)")
    if answers:
        lines.append("questionnaire_answers:")
        for qid, ans in answers.items():
            lines.append(f"- {qid}: {ans}")
    else:
        lines.append("questionnaire_answers: (none)")
    return "\n".join(lines)


async def run_full_system_task(
    goal: str,
    *,
    on_status: OnStatus = None,
) -> str:
    """Drive existing policy_planning flow and return a plain-text summary.

    Raises:
        A2ASkillError: soft/hard failures (misconfig, wait timeout/missing/failed,
            empty answers, submit miss, compose failed). Executor maps to FAILED.
    """
    raw_uid = (settings.a2a_system_user_id or "").strip()
    if not raw_uid:
        raise A2ASkillError(
            "A2A_SYSTEM_USER_ID is not configured; "
            "full_system_task cannot run without a system user."
        )
    try:
        user_id = uuid.UUID(raw_uid)
    except ValueError as exc:
        raise A2ASkillError(
            "A2A_SYSTEM_USER_ID is not a valid UUID; "
            "full_system_task cannot run."
        ) from exc

    user = CurrentUser(id=user_id, email="a2a@lemma.local", role="user")

    async with AsyncSessionLocal() as db:
        task, policy = await start_policy_task(db, user, goal_text=goal)
        task_id = task.id
        policy_id = policy.id
        try:
            await db.commit()
        except Exception:  # noqa: BLE001 — session may already be committed
            logger.debug("commit after start_policy_task skipped/failed", exc_info=True)

    await _emit(on_status, f"task:{task_id} policy:{policy_id}")

    q_wait = await _wait_questionnaire(
        policy_id, task_id=task_id, on_status=on_status, timeout_s=180.0
    )
    if q_wait.reason != "ok":
        raise A2ASkillError(
            _wait_error_summary(
                "questionnaire",
                q_wait.reason,
                task_id=task_id,
                policy_id=policy_id,
            )
        )
    questionnaire = q_wait.value

    answers = await _auto_answers(goal, questionnaire)
    if not answers:
        raise A2ASkillError(
            f"full_system_task could not produce questionnaire answers. "
            f"task_id: {task_id} policy_id: {policy_id}"
        )

    await _emit(on_status, "submitting:answers")
    async with AsyncSessionLocal() as db:
        detail = await submit_answers(
            db, user, policy_id=policy_id, answers=answers
        )
        if detail is None:
            raise A2ASkillError(
                f"full_system_task submit_answers failed (not found). "
                f"task_id: {task_id} policy_id: {policy_id}"
            )

    c_wait = await _wait_compose(
        policy_id, task_id=task_id, on_status=on_status, timeout_s=300.0
    )
    if c_wait.reason != "ok":
        raise A2ASkillError(
            _wait_error_summary(
                "compose", c_wait.reason, task_id=task_id, policy_id=policy_id
            )
        )
    final_policy = c_wait.value

    # Prefer answers stored on the policy; fall back to what we submitted.
    intake = (
        final_policy.intake_json
        if isinstance(final_policy.intake_json, dict)
        else {}
    )
    stored = intake.get("answers") if isinstance(intake.get("answers"), dict) else None
    used_answers = {str(k): str(v) for k, v in (stored or answers).items()}

    return _build_summary(
        task_id=task_id,
        policy_id=policy_id,
        policy=final_policy,
        answers=used_answers,
    )
