"""Unit tests for controllable Agent revision / CAS / restart boundaries.

No live model calls — safe for CI.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from ai.runtime import (
    Budget,
    Plan,
    StageHint,
    infer_active_stage,
    load_constraints_from_intake,
    restart_boundary_for,
)
from ai.prompts.registry import prompt_version, render_system_prompt_meta
from ai.types import AIUseCase


def test_restart_boundary_matrix() -> None:
    assert (
        restart_boundary_for(
            active_stage="questionnaire",
            input_type="free_text",
            policy_status="intake",
        )
        == "questionnaire"
    )
    assert (
        restart_boundary_for(
            active_stage="market_search",
            input_type="free_text",
            policy_status="intake",
        )
        == "market_search"
    )
    assert (
        restart_boundary_for(
            active_stage="compose",
            input_type="revise_goal",
            policy_status="composing",
        )
        == "compose"
    )
    assert (
        restart_boundary_for(
            active_stage="funding",
            input_type="free_text",
            policy_status="proposed",
        )
        == "compose"
    )
    assert (
        restart_boundary_for(
            active_stage="funding",
            input_type="free_text",
            policy_status="funded",
        )
        == "monitoring_only"
    )


def test_infer_active_stage_from_steps() -> None:
    assert (
        infer_active_stage(
            policy_status="intake",
            search_status="searching",
            step_statuses={"market_search": "running"},
        )
        == "market_search"
    )
    assert (
        infer_active_stage(
            policy_status="proposed",
            search_status="searched",
            step_statuses={},
        )
        == "select_portfolio"
    )


def test_stage_hints_roundtrip() -> None:
    intake = {
        "stageHints": [
            {
                "revision": 1,
                "text": "更偏稳健",
                "stage": "compose",
                "source": "free_text",
            }
        ]
    }
    constraints = load_constraints_from_intake(intake, goal="担心降息")
    assert len(constraints.stage_hints) == 1
    assert "更偏稳健" in constraints.hints_block()
    plan = Plan(goal="担心降息", active_stage="compose", input_revision=1)
    assert "compose" in plan.summary()
    budget = Budget(search_timeout_s=90, web_search_max=1)
    assert budget.can_web_search()
    budget.record_web_search()
    assert not budget.can_web_search()


def test_prompt_version_stable_for_use_case() -> None:
    v1 = prompt_version(AIUseCase.MARKET_SEARCH)
    text, v2 = render_system_prompt_meta(AIUseCase.MARKET_SEARCH, {})
    assert v1 == v2
    assert "广搜" in text or "广泛" in text
    refined, rv = render_system_prompt_meta(AIUseCase.MARKET_SEARCH_REFINED, {})
    assert rv
    assert "精搜" in refined or "精准" in refined


@pytest.mark.asyncio
async def test_persist_search_outcome_cas_rejects_stale_revision() -> None:
    from services import policy_search_service

    db = AsyncMock()
    policy_id = uuid.uuid4()

    with patch.object(
        policy_search_service,
        "_revision_matches",
        new=AsyncMock(return_value=False),
    ):
        wrote = await policy_search_service.persist_search_outcome(
            db,
            policy_id=policy_id,
            candidates=[],
            status=policy_search_service.SEARCH_FAILED,
            expected_input_revision=1,
        )
    assert wrote is False
    db.commit.assert_not_called()


@pytest.mark.asyncio
async def test_websearch_cache_hit(monkeypatch: pytest.MonkeyPatch) -> None:
    from ai.websearch import WebSearchQuery, clear_websearch_cache, web_search
    from ai.websearch import client as ws_client

    clear_websearch_cache()
    monkeypatch.setattr(ws_client.settings, "bocha_api_key", "test-key")
    monkeypatch.setattr(ws_client.settings, "bocha_cache_ttl_seconds", 120)

    calls = {"n": 0}

    class _Resp:
        status_code = 200

        def json(self) -> dict:
            return {
                "data": {
                    "webPages": {
                        "value": [
                            {
                                "name": "Fed cuts",
                                "url": "https://example.com/a",
                                "snippet": "rates",
                            }
                        ]
                    }
                }
            }

    async def fake_post(*_a, **_k):  # noqa: ANN001
        calls["n"] += 1
        return _Resp()

    monkeypatch.setattr(ws_client, "_post_once", fake_post)

    with patch(
        "ai.markets.usage.record_provider_call",
        new=AsyncMock(),
    ):
        q = WebSearchQuery(query="fed rate cut", count=5)
        a = await web_search(q)
        b = await web_search(q)
    assert a.count == 1
    assert b.count == 1
    assert calls["n"] == 1
    clear_websearch_cache()


def test_stage_hint_dataclass() -> None:
    hint = StageHint(revision=2, text="关注能源", stage="market_search")
    assert hint.as_dict()["stage"] == "market_search"
