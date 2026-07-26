"""Regression coverage for retaining completed market results on collect timeout."""

from __future__ import annotations

import asyncio
import uuid

import pytest

from ai.policygen.market_search import MarketSearchReport
from ai.runtime import Budget, Constraints, Plan
from ai.runtime.subagents import orchestrator as orchestrator_module
from ai.runtime.subagents.orchestrator import SubagentOrchestrator
from ai.runtime.subagents.types import SourceBrief
from services import policy_search_service
from tasks.policy_search import _classify_search_error, _terminal_search_status


@pytest.mark.asyncio
async def test_market_snapshot_survives_optional_source_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    market_finished = asyncio.Event()
    never_finish = asyncio.Event()
    candidate = object()
    report = MarketSearchReport(candidates=[candidate], status="ok")

    class CompletedMarketAgent:
        async def run(self, ctx):  # noqa: ANN001
            ctx.shared["market_report"] = report
            ctx.shared["candidates"] = report.candidates
            market_finished.set()
            return SourceBrief(
                kind="polymarket",
                status="succeeded",
                summary="候选 1 个",
                item_count=1,
            )

    class BlockedOptionalAgent:
        async def run(self, ctx):  # noqa: ANN001
            await never_finish.wait()
            return SourceBrief(kind=ctx.kind, status="succeeded")

    # Market and optional sources now start together. Keep the optional lanes
    # blocked, then cancel the collect immediately after the market snapshot is
    # available to verify that the hard-gate result survives parent timeout.
    def fake_get_subagent(kind):  # noqa: ANN001, ANN202
        if kind == "polymarket":
            return CompletedMarketAgent()
        return BlockedOptionalAgent()

    monkeypatch.setattr(orchestrator_module, "get_subagent", fake_get_subagent)
    orchestrator = SubagentOrchestrator(
        policy_id=uuid.uuid4(),
        goal="测试风险",
        task_id=None,
        run_id=None,
        input_revision=None,
        plan=Plan(goal="测试风险", active_stage="market_search"),
        constraints=Constraints(goal="测试风险"),
        budget=Budget(),
    )

    run_task = asyncio.create_task(orchestrator.run())
    await asyncio.wait_for(market_finished.wait(), timeout=1)
    run_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await run_task

    candidates, snapshot_report = orchestrator.market_snapshot()
    assert candidates == [candidate]
    assert snapshot_report is report


@pytest.mark.asyncio
async def test_market_fast_path_does_not_wait_for_optional_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidate = object()
    report = MarketSearchReport(candidates=[candidate], status="ok")
    optional_cancelled = 0

    class CompletedMarketAgent:
        async def run(self, ctx):  # noqa: ANN001
            ctx.shared["market_report"] = report
            ctx.shared["candidates"] = report.candidates
            return SourceBrief(
                kind="polymarket",
                status="succeeded",
                summary="候选 1 个",
                item_count=1,
            )

    class BlockedOptionalAgent:
        async def run(self, ctx):  # noqa: ANN001
            nonlocal optional_cancelled
            try:
                await asyncio.Event().wait()
            finally:
                optional_cancelled += 1

    monkeypatch.setattr(
        orchestrator_module,
        "get_subagent",
        lambda kind: (
            CompletedMarketAgent() if kind == "polymarket" else BlockedOptionalAgent()
        ),
    )
    monkeypatch.setattr(
        orchestrator_module.settings, "agent_intel_grace_seconds", 0.01
    )
    orchestrator = SubagentOrchestrator(
        policy_id=uuid.uuid4(),
        goal="测试风险",
        task_id=None,
        run_id=None,
        input_revision=None,
        plan=Plan(goal="测试风险", active_stage="market_search"),
        constraints=Constraints(goal="测试风险"),
        budget=Budget(),
    )

    result = await asyncio.wait_for(orchestrator.run(), timeout=0.5)

    assert result.candidates == [candidate]
    assert result.report is report
    assert optional_cancelled == len(orchestrator_module.PARALLEL_KINDS) - 1
    assert all(
        brief.status == "skipped"
        for brief in result.briefs
        if brief.kind != "polymarket"
    )


@pytest.mark.asyncio
async def test_unexpected_market_task_failure_cancels_optional_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    optional_cancelled = 0

    async def unexpected_run_kind(kind, **_kwargs):  # noqa: ANN001, ANN202
        nonlocal optional_cancelled
        if kind == "polymarket":
            raise RuntimeError("hard gate crashed")
        try:
            await asyncio.Event().wait()
        finally:
            optional_cancelled += 1

    orchestrator = SubagentOrchestrator(
        policy_id=uuid.uuid4(),
        goal="测试风险",
        task_id=None,
        run_id=None,
        input_revision=None,
        plan=Plan(goal="测试风险", active_stage="market_search"),
        constraints=Constraints(goal="测试风险"),
        budget=Budget(),
    )
    monkeypatch.setattr(orchestrator, "_run_kind", unexpected_run_kind)

    result = await asyncio.wait_for(orchestrator.run(), timeout=0.5)

    assert result.candidates == []
    assert optional_cancelled == len(orchestrator_module.PARALLEL_KINDS) - 1
    market_brief = next(
        brief for brief in result.briefs if brief.kind == "polymarket"
    )
    assert market_brief.status == "failed"
    assert market_brief.error_code == "subagent_exception"


@pytest.mark.asyncio
async def test_empty_market_result_skips_optional_grace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    optional_cancelled = 0

    class EmptyMarketAgent:
        async def run(self, ctx):  # noqa: ANN001
            ctx.shared["market_report"] = MarketSearchReport(
                candidates=[], status="empty", reason="empty_result"
            )
            ctx.shared["candidates"] = []
            return SourceBrief(
                kind="polymarket",
                status="failed",
                summary="未找到候选",
                error_code="empty_result",
            )

    class BlockedOptionalAgent:
        async def run(self, ctx):  # noqa: ANN001
            nonlocal optional_cancelled
            try:
                await asyncio.Event().wait()
            finally:
                optional_cancelled += 1

    monkeypatch.setattr(
        orchestrator_module,
        "get_subagent",
        lambda kind: EmptyMarketAgent()
        if kind == "polymarket"
        else BlockedOptionalAgent(),
    )
    monkeypatch.setattr(
        orchestrator_module.settings, "agent_intel_grace_seconds", 6.0
    )
    orchestrator = SubagentOrchestrator(
        policy_id=uuid.uuid4(),
        goal="测试风险",
        task_id=None,
        run_id=None,
        input_revision=None,
        plan=Plan(goal="测试风险", active_stage="market_search"),
        constraints=Constraints(goal="测试风险"),
        budget=Budget(),
    )

    result = await asyncio.wait_for(orchestrator.run(), timeout=0.5)

    assert result.candidates == []
    assert optional_cancelled == len(orchestrator_module.PARALLEL_KINDS) - 1


def test_completed_candidates_win_over_collect_timeout() -> None:
    candidates = [object()]
    assert _terminal_search_status(candidates) == policy_search_service.SEARCHED
    assert _classify_search_error(
        timed_out=True,
        report=MarketSearchReport(candidates=candidates, status="ok"),
        candidates=candidates,
    ) == (None, None)


def test_completed_empty_market_report_is_not_misreported_as_timeout() -> None:
    code, message = _classify_search_error(
        timed_out=True,
        report=MarketSearchReport(
            candidates=[],
            status="empty",
            reason="empty_result",
        ),
        candidates=[],
    )
    assert code == "policy_search_empty"
    assert message == "未找到匹配的预测市场"
