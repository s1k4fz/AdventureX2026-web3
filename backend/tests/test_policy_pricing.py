"""Unit tests for policy pricing scenarios and premium validation."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from ai.markets.types import MarketCandidate, MarketPlatform
from ai.policygen.ranking import rank
from ai.policygen.types import ResolvedPosition
from schemas.policy import PolicySelectIn
from services.policy_build_service import (
    compute_portfolio_metrics,
    compute_portfolio_scenarios,
    notional_premium,
    portfolio_economics,
    scenario_payout,
)


def _candidate(**kwargs) -> MarketCandidate:
    defaults = {
        "platform": MarketPlatform.POLYMARKET,
        "condition_id": "0x" + "a" * 64,
        "question": "Test?",
        "url": "https://polymarket.com/event/test",
    }
    defaults.update(kwargs)
    return MarketCandidate(**defaults)


def _position(
    *,
    price_bps: int = 5000,
    weight_bps: int = 5000,
    side: str = "YES",
    ref: str = "0x" + "b" * 64,
) -> ResolvedPosition:
    return ResolvedPosition(
        market_ref=ref,
        question="Will X happen?",
        side=side,  # type: ignore[arg-type]
        entry_price_bps=price_bps,
        weight_bps=weight_bps,
        ai_reason="test",
        candidate=_candidate(condition_id=ref),
    )


def test_notional_premium_fallback_100():
    assert notional_premium({}) == 100.0


def test_notional_premium_from_budget_answer():
    answers = {"budget-range": "500 USDC"}
    assert notional_premium(answers) == 500.0


def test_portfolio_economics_fee_and_scaling():
    positions = [_position(price_bps=5000, weight_bps=10000)]
    premium, payout = portfolio_economics(positions, premium=100.0, fee_bps=100)
    assert premium == 100.0
    # net = 99; shares = 99 / 0.5 = 198
    assert payout == pytest.approx(198.0)


def test_portfolio_economics_scales_with_premium():
    positions = [_position(price_bps=4000, weight_bps=10000)]
    _, payout_100 = portfolio_economics(positions, premium=100.0, fee_bps=100)
    _, payout_200 = portfolio_economics(positions, premium=200.0, fee_bps=100)
    assert payout_200 == pytest.approx(payout_100 * 2, rel=1e-6)


def test_scenario_payout_all_hit():
    positions = [
        _position(price_bps=5000, weight_bps=6000, ref="0x" + "1" * 64),
        _position(price_bps=2500, weight_bps=4000, ref="0x" + "2" * 64),
    ]
    payout = scenario_payout(
        positions, [True, True], premium=100.0, fee_bps=100
    )
    assert payout > 0


def test_compute_portfolio_scenarios_count_and_shape():
    positions = [
        _position(price_bps=6000, weight_bps=5000, ref="0x" + "3" * 64),
        _position(price_bps=4000, weight_bps=5000, ref="0x" + "4" * 64),
    ]
    scenarios = compute_portfolio_scenarios(
        positions, premium=100.0, fee_bps=100
    )
    assert 1 <= len(scenarios) <= 5
    first = scenarios[0]
    assert "label" in first
    assert "payout" in first
    assert "probability" in first
    assert "legs" in first
    assert "hitCount" in first
    assert "totalCount" in first
    assert "netProfit" in first
    assert len(first["legs"]) == 2


def test_compute_portfolio_metrics_fields():
    positions = [
        _position(
            price_bps=7000,
            weight_bps=10000,
            ref="0x" + "5" * 64,
        )
    ]
    metrics = compute_portfolio_metrics(
        positions,
        premium=100.0,
        fee_bps=100,
        coverage_end=datetime(2026, 12, 31, tzinfo=UTC),
    )
    assert metrics["avgEntryProbability"] == pytest.approx(0.7)
    assert metrics["portfolioHitProbability"] == pytest.approx(0.7)
    assert metrics["expectedPayout"] > 0


def test_compute_portfolio_metrics_survives_annual_odds_overflow():
    """Cheap near-term legs can make ratio**(1/years) overflow float range."""
    pos = _position(price_bps=50, weight_bps=10000, ref="0x" + "6" * 64)
    pos.resolution_date = datetime(2026, 7, 25, tzinfo=UTC)  # ~1 day out
    metrics = compute_portfolio_metrics(
        positions=[pos],
        premium=100.0,
        fee_bps=100,
        coverage_end=datetime(2026, 7, 25, tzinfo=UTC),
    )
    assert metrics["expectedPayout"] > 0
    # Overflow -> omit the field rather than crashing persist.
    assert metrics["impliedAnnualOdds"] is None


def test_policy_select_premium_min_10():
    import uuid

    with pytest.raises(ValidationError):
        PolicySelectIn(portfolio_id=uuid.uuid4(), premium=5.0)


def test_policy_select_premium_optional():
    import uuid

    payload = PolicySelectIn(portfolio_id=uuid.uuid4())
    assert payload.premium is None


def test_ranking_extremity_penalty():
    extreme = _candidate(
        condition_id="0x" + "e1" * 32,
        outcome_prices=[0.01, 0.99],
        outcomes=["Yes", "No"],
        volume=10000,
        liquidity=10000,
    )
    normal = _candidate(
        condition_id="0x" + "e2" * 32,
        outcome_prices=[0.50, 0.50],
        outcomes=["Yes", "No"],
        volume=10000,
        liquidity=10000,
    )
    ranked = rank([extreme, normal], now=datetime(2026, 1, 1, tzinfo=UTC))
    assert ranked[0].condition_id == normal.condition_id


def test_ranking_event_dedup():
    shared_event = "evt-123"
    weaker = _candidate(
        condition_id="0x" + "d1" * 32,
        event_id=shared_event,
        volume=100,
        liquidity=100,
        volume24hr=10,
    )
    stronger = _candidate(
        condition_id="0x" + "d2" * 32,
        event_id=shared_event,
        volume=100000,
        liquidity=100000,
        volume24hr=50000,
    )
    ranked = rank([weaker, stronger], now=datetime(2026, 1, 1, tzinfo=UTC))
    assert len(ranked) == 1
    assert ranked[0].condition_id == stronger.condition_id


def test_ranking_prefers_tight_spread():
    wide = _candidate(
        condition_id="0x" + "s1" * 32,
        spread=0.15,
        volume=5000,
        liquidity=5000,
    )
    tight = _candidate(
        condition_id="0x" + "s2" * 32,
        spread=0.01,
        volume=5000,
        liquidity=5000,
    )
    ranked = rank([wide, tight], now=datetime(2026, 1, 1, tzinfo=UTC))
    assert ranked[0].condition_id == tight.condition_id
