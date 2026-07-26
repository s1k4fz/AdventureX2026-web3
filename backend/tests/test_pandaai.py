"""Offline coverage for PandaAI enablement + subagent skip path."""

from __future__ import annotations

import uuid

import pytest

from ai.pandaai import client as panda_client
from ai.pandaai.types import PandaContext, PandaSignal
from ai.runtime.control import Budget, Constraints, Plan
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.pandaai import PandaAISubagent


def _ctx(goal: str = "原油风险") -> SubagentContext:
    return SubagentContext(
        kind="pandaai",
        goal=goal,
        policy_id=uuid.uuid4(),
        task_id=None,
        run_id=None,
        input_revision=None,
        plan=Plan(goal=goal, active_stage="market_search"),
        constraints=Constraints(goal=goal),
        budget=Budget(),
    )


@pytest.mark.asyncio
async def test_fetch_disabled_when_flag_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(panda_client.settings, "pandaai_enabled", False)
    monkeypatch.setattr(panda_client.settings, "pandaai_username", "8617850811503")
    monkeypatch.setattr(panda_client.settings, "pandaai_password", "x")
    assert panda_client.is_pandaai_enabled() is False
    panda_client._cache.clear()
    ctx = await panda_client.fetch_panda_context(force=True)
    assert ctx.source == "disabled"


@pytest.mark.asyncio
async def test_subagent_skips_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "ai.runtime.subagents.pandaai.is_pandaai_enabled", lambda: False
    )
    brief = await PandaAISubagent().run(_ctx())
    assert brief.status == "skipped"
    assert brief.error_code == "pandaai_disabled"


@pytest.mark.asyncio
async def test_subagent_success_maps_signals(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch() -> PandaContext:
        return PandaContext(
            source="pandaai",
            freshness="fresh",
            summary="沪深300 4649（-1.67%）",
            signals=[
                PandaSignal(
                    kind="index",
                    label="沪深300",
                    value="4649.19（-1.67%）",
                    symbol="000300.SH",
                    as_of="20260724",
                )
            ],
            modules=["index"],
            last_trade_date="20260724",
            latency_ms=12,
        )

    monkeypatch.setattr(
        "ai.runtime.subagents.pandaai.is_pandaai_enabled", lambda: True
    )
    monkeypatch.setattr(
        "ai.runtime.subagents.pandaai.fetch_panda_context", fake_fetch
    )
    brief = await PandaAISubagent().run(_ctx("指数波动"))
    assert brief.status == "succeeded"
    assert brief.item_count == 1
    assert brief.citations and "沪深300" in brief.citations[0].title


def test_username_normalizes_phone(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(panda_client.settings, "pandaai_username", "17850811503")
    assert panda_client._username() == "8617850811503"


def test_modules_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        panda_client.settings, "pandaai_modules", "index, macro ,bogus,futures"
    )
    assert panda_client.enabled_modules() == ["index", "macro", "futures"]


def test_optional_modules_parse(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        panda_client.settings,
        "pandaai_modules",
        "index,index_ext,futures_ext,macro_pi,macro_energy,fx,calendar",
    )
    assert panda_client.enabled_modules() == [
        "index",
        "index_ext",
        "futures_ext",
        "macro_pi",
        "macro_energy",
        "fx",
        "calendar",
    ]
