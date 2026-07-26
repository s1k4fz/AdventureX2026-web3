"""Live end-to-end verification of the A2A remote agent surface.

Talks to a RUNNING backend (uv run python main.py) exactly like an external
A2A client would:

1. Resolve the public agent card from /.well-known/agent-card.json.
2. Drive a light skill (market_intelligence) over message/stream and assert
   the task reaches TASK_STATE_COMPLETED with a text artifact.
3. Optionally drive full_system_task (requires Celery worker + Redis) and
   assert the policy-planning bridge completes.

Usage:
    uv run python scripts/live_a2a_flow.py                 # card + light
    uv run python scripts/live_a2a_flow.py --full          # card + light + full
    uv run python scripts/live_a2a_flow.py --only full     # card + full
    uv run python scripts/live_a2a_flow.py --only card     # card only

Exit code 0 = every requested stage passed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

BASE_DEFAULT = "http://127.0.0.1:18473"
CARD_PATH = "/.well-known/agent-card.json"

EXPECTED_SKILLS = {
    "factor_analysis",
    "strategy_backtest",
    "full_system_task",
    "market_intelligence",
}

LIGHT_PROMPT = (
    "[skill: market_intelligence] 用一句话总结当前 Polymarket 上关于美联储降息"
    "的市场定价情况。"
)
FULL_PROMPT = (
    "[skill: full_system_task] 我担心下个月国际油价大幅上涨，需要一份对冲保障方案。"
)


@dataclass
class StageResult:
    name: str
    ok: bool
    detail: str = ""
    elapsed_s: float = 0.0
    statuses: list[str] = field(default_factory=list)


def _print_stage(result: StageResult) -> None:
    mark = "PASS" if result.ok else "FAIL"
    print(f"\n=== [{mark}] {result.name} ({result.elapsed_s:.1f}s) ===")
    if result.statuses:
        print("status trail:")
        for s in result.statuses[-12:]:
            print(f"  - {s}")
    if result.detail:
        print(f"detail: {result.detail[:1500]}")


async def verify_card(base: str) -> StageResult:
    start = time.monotonic()
    url = base.rstrip("/") + CARD_PATH
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            card = resp.json()
    except Exception as exc:
        return StageResult(
            "agent-card", False, f"fetch {url} failed: {exc}",
            time.monotonic() - start,
        )
    skills = {s.get("id") for s in card.get("skills", [])}
    missing = EXPECTED_SKILLS - skills
    iface_ok = any(
        i.get("url") for i in card.get("supportedInterfaces", [])
    ) or bool(card.get("url"))
    problems: list[str] = []
    if missing:
        problems.append(f"missing skills: {sorted(missing)}")
    if not iface_ok:
        problems.append("no reachable interface url in card")
    if not card.get("name"):
        problems.append("card has no name")
    detail = "; ".join(problems) if problems else (
        f"name={card.get('name')!r} skills={sorted(skills)}"
    )
    return StageResult(
        "agent-card", not problems, detail, time.monotonic() - start
    )


async def run_skill_stage(
    base: str, *, name: str, prompt: str, timeout_s: float
) -> StageResult:
    """Send one message over message/stream and follow it to a terminal state."""
    from a2a.client import ClientConfig, create_client
    from a2a.types import TaskState
    from a2a.types.a2a_pb2 import Role, SendMessageRequest
    from a2a.helpers import get_message_text, new_text_message

    start = time.monotonic()
    statuses: list[str] = []
    artifact_texts: list[str] = []
    final_state: int | None = None
    task_id = ""

    httpx_client = httpx.AsyncClient(timeout=httpx.Timeout(timeout_s, connect=10.0))
    try:
        client = await create_client(
            base.rstrip("/"),
            ClientConfig(streaming=True, httpx_client=httpx_client),
        )
        try:
            request = SendMessageRequest(
                message=new_text_message(prompt, role=Role.ROLE_USER)
            )
            async for event in client.send_message(request):
                kind = event.WhichOneof("payload")
                if kind == "status_update":
                    upd = event.status_update
                    task_id = upd.task_id or task_id
                    final_state = upd.status.state
                    note = (
                        get_message_text(upd.status.message)
                        if upd.status.HasField("message")
                        else ""
                    )
                    label = TaskState.Name(upd.status.state)
                    statuses.append(f"{label}: {note}" if note else label)
                elif kind == "artifact_update":
                    for part in event.artifact_update.artifact.parts:
                        if part.WhichOneof("content") == "text" and part.text:
                            artifact_texts.append(part.text)
                elif kind == "task":
                    task = event.task
                    task_id = task.id or task_id
                    final_state = task.status.state
                    statuses.append(TaskState.Name(task.status.state))
                    for artifact in task.artifacts:
                        for part in artifact.parts:
                            if part.WhichOneof("content") == "text" and part.text:
                                artifact_texts.append(part.text)
                if final_state in (
                    TaskState.TASK_STATE_COMPLETED,
                    TaskState.TASK_STATE_FAILED,
                    TaskState.TASK_STATE_CANCELED,
                    TaskState.TASK_STATE_REJECTED,
                ):
                    break
        finally:
            await client.close()
    except Exception as exc:
        return StageResult(
            name, False, f"client error: {exc!r}",
            time.monotonic() - start, statuses,
        )
    finally:
        await httpx_client.aclose()

    elapsed = time.monotonic() - start
    from a2a.types import TaskState as TS

    if final_state != TS.TASK_STATE_COMPLETED:
        state_name = TS.Name(final_state) if final_state is not None else "none"
        return StageResult(
            name, False,
            f"task {task_id} ended in {state_name}; last status: "
            f"{statuses[-1] if statuses else '(none)'}",
            elapsed, statuses,
        )
    if not artifact_texts:
        return StageResult(
            name, False, f"task {task_id} completed without text artifact",
            elapsed, statuses,
        )
    return StageResult(
        name, True,
        f"task {task_id} completed; artifact:\n{artifact_texts[-1]}",
        elapsed, statuses,
    )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=BASE_DEFAULT)
    parser.add_argument(
        "--only", choices=["card", "light", "full"], default=None,
        help="run a single stage instead of the default card+light",
    )
    parser.add_argument(
        "--full", action="store_true",
        help="also run full_system_task (needs Celery worker + Redis)",
    )
    parser.add_argument("--light-timeout", type=float, default=240.0)
    parser.add_argument("--full-timeout", type=float, default=720.0)
    args = parser.parse_args()

    stages: list[str]
    if args.only:
        stages = ["card"] if args.only == "card" else ["card", args.only]
    else:
        stages = ["card", "light"] + (["full"] if args.full else [])

    results: list[StageResult] = []
    for stage in stages:
        if stage == "card":
            result = await verify_card(args.base)
        elif stage == "light":
            result = await run_skill_stage(
                args.base,
                name="light:market_intelligence",
                prompt=LIGHT_PROMPT,
                timeout_s=args.light_timeout,
            )
        else:
            result = await run_skill_stage(
                args.base,
                name="full:full_system_task",
                prompt=FULL_PROMPT,
                timeout_s=args.full_timeout,
            )
        results.append(result)
        _print_stage(result)
        if not result.ok and stage == "card":
            break  # later stages cannot work without a card

    print("\n=== summary ===")
    all_ok = all(r.ok for r in results)
    for r in results:
        print(f"{'PASS' if r.ok else 'FAIL'}  {r.name}  {r.elapsed_s:.1f}s")
    print("overall:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
