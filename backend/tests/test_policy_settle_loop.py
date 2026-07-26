"""Regression coverage for the settlement task's event-loop / engine lifecycle.

Guards the two invariants that the "Event loop is closed" settlement failure
violated:

  1. The oracle path runs assert AND settle in a SINGLE asyncio.run loop (it used
     to call asyncio.run twice, and the second loop reused a pooled asyncpg
     connection bound to the first — closed — loop).
  2. Every sync entry point disposes the module engine before its loop closes, so
     no pooled connection outlives the loop that opened it (the per-task dispose
     discipline shared with course_search / course_organize / video_cleanup).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import tasks.policy_settle as ps


def test_oracle_path_runs_assert_then_settle_in_one_loop() -> None:
    loops: dict[str, object] = {}
    order: list[str] = []

    async def _fake_assert(policy_id: str) -> None:
        order.append("assert")
        loops["assert"] = asyncio.get_running_loop()

    async def _fake_settle(policy_id: str) -> None:
        order.append("settle")
        loops["settle"] = asyncio.get_running_loop()

    fake_engine = SimpleNamespace(dispose=AsyncMock())

    with (
        patch.object(ps.settings, "outcome_oracle_address", "0xoracle"),
        patch.object(ps, "_async_run_assert", _fake_assert),
        patch.object(ps, "_async_run_settle_oracle", _fake_settle),
        patch("core.database.engine", fake_engine),
    ):
        ps.run_settle("11111111-1111-1111-1111-111111111111")

    # Assert precedes settle, and both observed the SAME running loop.
    assert order == ["assert", "settle"]
    assert loops["assert"] is loops["settle"]
    # Engine disposed exactly once (before the loop closed).
    fake_engine.dispose.assert_awaited_once()


def test_legacy_path_disposes_engine_once() -> None:
    fake_engine = SimpleNamespace(dispose=AsyncMock())
    ran: list[str] = []

    async def _fake_legacy(policy_id: str) -> None:
        ran.append("legacy")

    with (
        patch.object(ps.settings, "outcome_oracle_address", ""),
        patch.object(ps, "_async_run_settle_legacy", _fake_legacy),
        patch("core.database.engine", fake_engine),
    ):
        ps.run_settle("22222222-2222-2222-2222-222222222222")

    assert ran == ["legacy"]
    fake_engine.dispose.assert_awaited_once()


def test_engine_disposed_even_when_body_raises() -> None:
    """A failing settlement must still dispose the engine, or the poisoned pooled
    connection breaks the next task with 'Event loop is closed'."""
    fake_engine = SimpleNamespace(dispose=AsyncMock())

    async def _boom(policy_id: str) -> None:
        raise RuntimeError("web3 is not installed")

    with (
        patch.object(ps.settings, "outcome_oracle_address", "0xoracle"),
        patch.object(ps, "_async_run_assert", _boom),
        patch("core.database.engine", fake_engine),
    ):
        try:
            ps.run_settle("33333333-3333-3333-3333-333333333333")
        except RuntimeError:
            pass

    fake_engine.dispose.assert_awaited_once()
