"""Offline coverage for GET /policies/{id}/research projection."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ai.markets.types import MarketCandidate, MarketPlatform
from services import policy_search_service
from services.policy_compose_events import build_search_payload


def _candidate(
    *,
    condition_id: str,
    question: str | None = None,
    volume: float = 1_000.0,
    liquidity: float = 500.0,
    end_date: datetime | None = None,
) -> MarketCandidate:
    return MarketCandidate(
        platform=MarketPlatform.POLYMARKET,
        condition_id=condition_id,
        question=question or f"Market {condition_id}",
        slug=condition_id,
        url=f"https://polymarket.com/event/{condition_id}",
        outcomes=["Yes", "No"],
        outcome_prices=[0.4, 0.6],
        volume=volume,
        liquidity=liquidity,
        volume24hr=volume / 10,
        end_date=end_date or (datetime.now(UTC) + timedelta(days=30)),
    )


def _row(candidate: MarketCandidate, *, created_at: datetime | None = None):
    return SimpleNamespace(
        condition_id=candidate.condition_id,
        question=candidate.question,
        slug=candidate.slug,
        url=candidate.url,
        outcomes=candidate.outcomes,
        outcome_prices=candidate.outcome_prices,
        clob_token_ids=[],
        volume=candidate.volume,
        liquidity=candidate.liquidity,
        end_date=candidate.end_date,
        raw_json={
            "volume24hr": candidate.volume24hr,
            "category": candidate.category,
            "tags": candidate.tags,
        },
        created_at=created_at or datetime.now(UTC),
    )


def _position(market_ref: str):
    return SimpleNamespace(market_ref=market_ref)


def _policy(
    *,
    user_id: uuid.UUID,
    status: str = "proposed",
    search_status: str = "searched",
    selected_refs: list[str] | None = None,
):
    refs = selected_refs or []
    portfolio = SimpleNamespace(
        id=uuid.uuid4(),
        positions=[_position(ref) for ref in refs],
    )
    return SimpleNamespace(
        id=uuid.UUID("12345678-1234-5678-1234-567812345678"),
        user_id=user_id,
        status=status,
        search_status=search_status,
        coverage_end=datetime.now(UTC) + timedelta(days=60),
        portfolios=[portfolio] if refs else [],
    )


def _db(*, policy, rows: list | None = None):
    """Two execute() calls: owned policy load, then candidate rows."""
    policy_result = SimpleNamespace(scalar_one_or_none=lambda: policy)
    rows_result = SimpleNamespace(scalars=lambda: rows or [])
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[policy_result, rows_result])
    return db


@pytest.mark.asyncio
async def test_research_idor_returns_none() -> None:
    owner = uuid.uuid4()
    # Ownership is enforced in the WHERE clause; a miss yields None.
    db = _db(policy=None, rows=[])
    out = await policy_search_service.get_policy_research(
        db,
        user_id=owner,
        policy_id=uuid.uuid4(),
    )
    assert out is None


@pytest.mark.asyncio
async def test_research_searching_empty_pool() -> None:
    owner = uuid.uuid4()
    policy = _policy(user_id=owner, status="intake", search_status="searching")
    db = _db(policy=policy, rows=[])
    out = await policy_search_service.get_policy_research(
        db, user_id=owner, policy_id=policy.id
    )
    assert out is not None
    assert out.search_status == "searching"
    assert out.total_count == 0
    assert out.returned_count == 0
    assert out.candidates == []
    assert out.researched_at is None
    assert out.selected_condition_ids == []


@pytest.mark.asyncio
async def test_research_failed_empty_pool() -> None:
    owner = uuid.uuid4()
    policy = _policy(user_id=owner, status="failed", search_status="failed")
    db = _db(policy=policy, rows=[])
    out = await policy_search_service.get_policy_research(
        db, user_id=owner, policy_id=policy.id
    )
    assert out is not None
    assert out.search_status == "failed"
    assert out.candidates == []
    assert out.total_count == 0


@pytest.mark.asyncio
async def test_research_marks_selected_and_ranks() -> None:
    owner = uuid.uuid4()
    selected = "0xselected"
    low = _candidate(condition_id="0xlow", volume=10.0, liquidity=5.0)
    high = _candidate(condition_id=selected, volume=1_000_000.0, liquidity=50_000.0)
    mid = _candidate(condition_id="0xmid", volume=5_000.0, liquidity=1_000.0)
    policy = _policy(
        user_id=owner,
        search_status="searched",
        selected_refs=[selected],
    )
    created = datetime(2026, 1, 15, tzinfo=UTC)
    db = _db(
        policy=policy,
        rows=[_row(low, created_at=created), _row(high), _row(mid)],
    )
    out = await policy_search_service.get_policy_research(
        db, user_id=owner, policy_id=policy.id
    )
    assert out is not None
    assert out.total_count == 3
    assert out.returned_count == 3
    assert selected in out.selected_condition_ids
    assert out.platforms[0].platform == "polymarket"
    assert out.platforms[0].count == 3
    assert out.researched_at is not None

    by_id = {c.condition_id: c for c in out.candidates}
    assert by_id[selected].selection == "selected"
    assert by_id["0xlow"].selection == "pool"
    # Highest volume/liquidity should rank first.
    assert out.candidates[0].condition_id == selected
    assert out.candidates[0].rank == 1
    assert by_id[selected].url.startswith("https://polymarket.com/")
    assert by_id[selected].yes_price_bps == 4000


@pytest.mark.asyncio
async def test_research_includes_selected_beyond_top_n() -> None:
    owner = uuid.uuid4()
    # Build many high-volume markets + one low-volume selected leg.
    selected_id = "0xselected-tail"
    pool = [
        _candidate(
            condition_id=f"0xpool{i:03d}",
            volume=1_000_000.0 - i,
            liquidity=50_000.0,
        )
        for i in range(10)
    ]
    selected = _candidate(
        condition_id=selected_id, volume=1.0, liquidity=1.0
    )
    policy = _policy(
        user_id=owner,
        search_status="searched",
        selected_refs=[selected_id],
    )
    rows = [_row(c) for c in [*pool, selected]]
    db = _db(policy=policy, rows=rows)

    out = await policy_search_service.get_policy_research(
        db, user_id=owner, policy_id=policy.id, limit=5
    )
    assert out is not None
    assert out.total_count == 11
    # Top 5 + forced selected = 6
    assert out.returned_count == 6
    ids = {c.condition_id for c in out.candidates}
    assert selected_id in ids
    selected_out = next(c for c in out.candidates if c.condition_id == selected_id)
    assert selected_out.selection == "selected"
    assert selected_out.rank == 11  # worst in ranked list


@pytest.mark.asyncio
async def test_research_without_portfolios_all_pool() -> None:
    owner = uuid.uuid4()
    c1 = _candidate(condition_id="0xa")
    policy = _policy(user_id=owner, selected_refs=[])
    db = _db(policy=policy, rows=[_row(c1)])
    out = await policy_search_service.get_policy_research(
        db, user_id=owner, policy_id=policy.id
    )
    assert out is not None
    assert out.selected_condition_ids == []
    assert out.candidates[0].selection == "pool"


def test_build_search_payload_includes_enriched_fields() -> None:
    c = _candidate(condition_id="0xabc", volume=123.0, liquidity=45.0)
    payload = build_search_payload([c])
    assert payload["platforms"] == [{"platform": "polymarket", "count": 1}]
    assert payload["totalCount"] == 1
    item = payload["items"][0]
    assert item["conditionId"] == "0xabc"
    assert item["url"] == "https://polymarket.com/event/0xabc"
    assert item["liquidity"] == 45.0
    assert item["volume"] == 123.0
    assert item["question"]


def test_build_search_payload_includes_all_candidates() -> None:
    pool = [
        _candidate(condition_id=f"0x{i:02x}", volume=float(100 - i))
        for i in range(12)
    ]
    payload = build_search_payload(pool)
    assert payload["totalCount"] == 12
    assert len(payload["items"]) == 12
    assert payload["platforms"] == [{"platform": "polymarket", "count": 12}]
