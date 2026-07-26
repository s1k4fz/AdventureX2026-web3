#!/usr/bin/env python3
"""Live Agent Task policy flow — real model + Polymarket (+ optional Bocha).

Usage (from backend/):

    RUN_LIVE_AGENT=1 .venv/bin/python scripts/live_agent_policy_flow.py

Optional:
    SEARCH_TIMEOUT_S=15   # force search timeout path
    LIVE_GOAL='担心美联储降息次数不及预期'

Requires: SUPABASE_URL, DATABASE_URL, DEEPSEEK_API_KEY (live model calls), network.
Writes artifacts under backend/artifacts/live_agent_flow_<ts>/.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ai import init_ai_runtime, shutdown_ai_runtime  # noqa: E402
from ai.prompts.registry import prompt_version  # noqa: E402
from ai.types import AIUseCase  # noqa: E402
from core.database import AsyncSessionLocal, engine  # noqa: E402
from core.security import CurrentUser  # noqa: E402
from models.policy import Policy  # noqa: E402
from services import (  # noqa: E402
    agent_event_service,
    agent_task_service,
    policy_agent_adapter,
    policy_planning_service,
    policy_search_service,
)
from tasks.policy_compose import run_compose  # noqa: E402
from tasks.policy_search import run_search  # noqa: E402


def _enabled() -> bool:
    return os.environ.get("RUN_LIVE_AGENT", "").strip() in {"1", "true", "yes"}


def _artifact_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = ROOT / "artifacts" / f"live_agent_flow_{stamp}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _dump(path: Path, name: str, payload: object) -> None:
    (path / name).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


async def _pick_user() -> CurrentUser:
    """Use an existing policy owner if present; else a synthetic UUID user."""
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select

        row = (
            await db.execute(select(Policy.user_id).limit(1))
        ).scalar_one_or_none()
    user_id = row or uuid.uuid4()
    return CurrentUser(id=user_id, email="live-agent@lemma.local", role="user")


async def _await_questionnaire(policy_id: uuid.UUID, *, timeout_s: float = 90) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        async with AsyncSessionLocal() as db:
            policy = await db.get(Policy, policy_id)
            if policy is None:
                raise RuntimeError("policy disappeared")
            q = (policy.intake_json or {}).get("questionnaire")
            if q:
                return q
            if policy.status == "failed":
                raise RuntimeError("questionnaire generation failed")
        await asyncio.sleep(1.5)
    raise TimeoutError("questionnaire not ready")


def _answers_from_questionnaire(questionnaire: dict) -> dict[str, str]:
    answers: dict[str, str] = {}
    for question in questionnaire.get("questions") or []:
        qid = question.get("id")
        options = question.get("options") or []
        if not qid or not options:
            continue
        first = options[0]
        if isinstance(first, dict):
            answers[str(qid)] = str(
                first.get("label") or first.get("id") or first.get("value") or first
            )
        else:
            answers[str(qid)] = str(first)
    return answers


async def scenario_happy(out: Path, user: CurrentUser, goal: str) -> dict:
    async with AsyncSessionLocal() as db:
        task, policy = await policy_agent_adapter.start_policy_task(
            db, user, goal_text=goal, title="live-happy"
        )
        await db.commit()
        task_id, policy_id = task.id, policy.id
        revision = task.input_revision

    questionnaire = await _await_questionnaire(policy_id)
    _dump(out, "questionnaire.json", questionnaire)

    # Broad search (in-process, same as Celery body). Keep runtime open for compose.
    await run_search(policy_id, goal, revision, dispose=False)

    async with AsyncSessionLocal() as db:
        status = await policy_search_service.read_search_status(
            db, policy_id=policy_id
        )
        candidates = await policy_search_service.load_market_candidates(
            db, policy_id=policy_id
        )
    _dump(
        out,
        "search.json",
        {
            "status": status,
            "count": len(candidates),
            "sample": [c.question for c in candidates[:8]],
        },
    )
    if status != "searched" or not candidates:
        raise AssertionError(f"search did not succeed: status={status}")

    answers = _answers_from_questionnaire(questionnaire)
    async with AsyncSessionLocal() as db:
        policy = await db.get(Policy, policy_id)
        assert policy is not None
        intake = dict(policy.intake_json or {})
        intake["answers"] = answers
        policy.intake_json = intake
        policy.status = "composing"
        await db.commit()
    _dump(out, "answers.json", answers)

    outcome = await run_compose(policy_id, dispose=False)
    async with AsyncSessionLocal() as db:
        policy = await db.get(Policy, policy_id)
        events = await agent_event_service.list_events_after(
            db, task_id=task_id, after_sequence=0, limit=500
        )
        detail = await agent_task_service.load_task_detail(
            db, user_id=user.id, task_id=task_id
        )
    _dump(
        out,
        "compose.json",
        {
            "outcome": outcome,
            "policyStatus": policy.status if policy else None,
            "eventTypes": [e.event_type for e in events],
            "promptVersions": {
                "intake": prompt_version(AIUseCase.POLICY_INTAKE),
                "market_search": prompt_version(AIUseCase.MARKET_SEARCH),
                "compose": prompt_version(AIUseCase.PORTFOLIO_COMPOSE),
            },
            "taskStatus": detail.status if detail else None,
        },
    )
    assert outcome == "done", outcome
    assert policy is not None and policy.status == "proposed", policy.status if policy else None
    return {"taskId": str(task_id), "policyId": str(policy_id), "events": len(events)}


async def scenario_interrupt(out: Path, user: CurrentUser, goal: str) -> dict:
    async with AsyncSessionLocal() as db:
        task, policy = await policy_agent_adapter.start_policy_task(
            db, user, goal_text=goal, title="live-interrupt"
        )
        await db.commit()
        task_id, policy_id = task.id, policy.id
        rev0 = task.input_revision

    search_task = asyncio.create_task(
        run_search(policy_id, goal, rev0, dispose=False)
    )
    await asyncio.sleep(2.0)

    async with AsyncSessionLocal() as db:
        queued = await agent_task_service.queue_user_input(
            db,
            user_id=user.id,
            task_id=task_id,
            input_type="free_text",
            text="补充：更关注近端利率路径，忽略长期选举噪音",
        )
        assert queued is not None
        task2, item, run, _event, is_new = queued
        plan = None
        if is_new:
            plan, _ = await policy_agent_adapter.apply_user_input(
                db, user, task=task2, item=item, run=run
            )
        await db.commit()
        rev1 = task2.input_revision

    await search_task
    need_text = goal + "；近端利率"
    async with AsyncSessionLocal() as db:
        pol = await db.get(Policy, policy_id)
        if pol and pol.need_text:
            need_text = pol.need_text
    await run_search(policy_id, need_text, rev1, dispose=False)

    async with AsyncSessionLocal() as db:
        status = await policy_search_service.read_search_status(
            db, policy_id=policy_id
        )
        task_row = await agent_task_service.get_owned_task(
            db, user_id=user.id, task_id=task_id
        )
        intake = {}
        pol = await db.get(Policy, policy_id)
        if pol and isinstance(pol.intake_json, dict):
            intake = pol.intake_json
    _dump(
        out,
        "interrupt.json",
        {
            "rev0": rev0,
            "rev1": rev1,
            "searchStatus": status,
            "stageHints": intake.get("stageHints"),
            "plan": plan.restart_boundary if plan else None,
            "taskRevision": task_row.input_revision if task_row else None,
        },
    )
    assert rev1 > rev0
    assert status in ("searched", "failed", "searching")
    return {"revision": rev1, "status": status}


async def main() -> int:
    if not _enabled():
        print("Set RUN_LIVE_AGENT=1 to run live agent flow.", file=sys.stderr)
        return 2

    out = _artifact_dir()
    goal = os.environ.get("LIVE_GOAL") or "担心美联储降息次数不及预期，想对冲利率路径风险"
    print(f"artifacts -> {out}")
    print(f"goal -> {goal}")

    init_ai_runtime()
    try:
        user = await _pick_user()
        results: dict = {"goal": goal, "userId": str(user.id)}
        try:
            results["happy"] = await scenario_happy(out, user, goal)
            print("OK happy:", results["happy"])
        except Exception as exc:  # noqa: BLE001
            results["happy_error"] = f"{exc}\n{traceback.format_exc()}"
            print("FAIL happy:", exc, file=sys.stderr)

        try:
            results["interrupt"] = await scenario_interrupt(out, user, goal)
            print("OK interrupt:", results["interrupt"])
        except Exception as exc:  # noqa: BLE001
            results["interrupt_error"] = f"{exc}\n{traceback.format_exc()}"
            print("FAIL interrupt:", exc, file=sys.stderr)

        _dump(out, "summary.json", results)
        ok = "happy" in results and "interrupt" in results
        return 0 if ok else 1
    finally:
        await shutdown_ai_runtime()
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
