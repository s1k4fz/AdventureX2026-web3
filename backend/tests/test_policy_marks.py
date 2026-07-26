"""Focused offline coverage for policy marks service + price fetch helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import httpx
import pytest

from ai.markets.prices import (
    MarketPricesResult,
    _CACHE_TTL_S,
    _STALE_AFTER_S,
    _price_cache,
    clear_market_prices_cache,
    fetch_market_prices_detailed,
    price_bps_for_side,
)
from schemas.policy import PolicyMarksOut
from services.policy_marks_service import get_policy_marks


def _position(
    *,
    market_ref: str = "0xleg1",
    question: str = "Will it rain?",
    side: str = "YES",
    entry_price_bps: int = 4000,
    weight_bps: int = 5000,
):
    return SimpleNamespace(
        market_ref=market_ref,
        question=question,
        side=side,
        entry_price_bps=entry_price_bps,
        weight_bps=weight_bps,
        resolution_date=None,
        ai_reason="",
        raw_json={"outcomes": ["Yes", "No"], "url": "https://example.com"},
    )


def _policy(
    *,
    user_id: uuid.UUID | None = None,
    on_chain_policy_id: str | None = None,
    premium: float | None = 100.0,
    positions: list | None = None,
):
    policy_id = uuid.UUID("12345678-1234-5678-1234-567812345678")
    owner = user_id or uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    portfolio_id = uuid.uuid4()
    legs = positions or [
        _position(market_ref="0xleg1", side="YES", weight_bps=6000),
        _position(market_ref="0xleg2", side="NO", weight_bps=4000),
    ]
    portfolio = SimpleNamespace(
        id=portfolio_id,
        positions=legs,
        premium_estimate=premium,
        expected_payout=250.0,
    )
    return SimpleNamespace(
        id=policy_id,
        user_id=owner,
        status="active",
        premium=premium,
        on_chain_policy_id=on_chain_policy_id,
        selected_portfolio_id=portfolio_id,
        portfolios=[portfolio],
    )


def _db_for(policy):
    result = SimpleNamespace(scalar_one_or_none=lambda: policy)
    db = AsyncMock()
    db.execute.return_value = result
    return db


@pytest.fixture(autouse=True)
def _clear_price_cache():
    clear_market_prices_cache()
    yield
    clear_market_prices_cache()


def test_price_bps_for_side_yes_no():
    assert price_bps_for_side([0.42, 0.58], ["Yes", "No"], "YES") == 4200
    assert price_bps_for_side([0.42, 0.58], ["Yes", "No"], "NO") == 5800


@pytest.mark.asyncio
async def test_fetch_market_prices_uses_repeated_condition_ids() -> None:
    """Gamma rejects comma-joined condition_ids; httpx must repeat the key."""
    ids = [
        "0x" + "a1" * 32,
        "0x" + "b2" * 32,
    ]
    captured: dict[str, list[str]] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["condition_ids"] = request.url.params.get_list("condition_ids")
        return httpx.Response(
            200,
            json=[
                {
                    "conditionId": ids[0],
                    "outcomePrices": '["0.4","0.6"]',
                },
                {
                    "conditionId": ids[1],
                    "outcomePrices": '["0.55","0.45"]',
                },
            ],
        )

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def _client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    with patch("ai.markets.prices.httpx.AsyncClient", side_effect=_client):
        result = await fetch_market_prices_detailed(ids)

    assert captured["condition_ids"] == ids
    assert all("," not in cid for cid in captured["condition_ids"])
    assert result.error is None
    assert result.prices[ids[0]] == [0.4, 0.6]
    assert result.prices[ids[1]] == [0.55, 0.45]


def _patch_gamma_client(handler):
    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient

    def _client(*args, **kwargs):
        kwargs["transport"] = transport
        return real_async_client(*args, **kwargs)

    return patch("ai.markets.prices.httpx.AsyncClient", side_effect=_client)


@pytest.mark.asyncio
async def test_fetch_market_prices_falls_back_after_ttl_on_gamma_failure() -> None:
    """Past fresh TTL, a failed refresh must still return last-good quotes."""
    cid = "0x" + "ab" * 32
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(
                200,
                json=[{"conditionId": cid, "outcomePrices": '["0.4","0.6"]'}],
            )
        return httpx.Response(503, json={"error": "down"})

    with _patch_gamma_client(handler):
        first = await fetch_market_prices_detailed([cid])
        assert first.prices[cid] == [0.4, 0.6]
        assert first.error is None

        # Age the retained entry past fresh TTL but within retain/stale window.
        key = next(iter(_price_cache))
        fetched_mono, stored = _price_cache[key]
        _price_cache[key] = (fetched_mono - (_CACHE_TTL_S + 1.0), stored)

        second = await fetch_market_prices_detailed([cid])

    assert call_count["n"] == 2
    assert second.prices[cid] == [0.4, 0.6]
    assert second.from_cache is True
    assert second.error == "gamma_http_503"
    assert second.cache_age_s is not None
    assert second.cache_age_s >= _CACHE_TTL_S
    assert second.stale is False


@pytest.mark.asyncio
async def test_fetch_market_prices_stale_flag_when_fallback_age_exceeds_threshold() -> None:
    """Retained fallback older than _STALE_AFTER_S must report stale=True."""
    cid = "0x" + "cd" * 32
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(
                200,
                json=[{"conditionId": cid, "outcomePrices": '["0.3","0.7"]'}],
            )
        raise httpx.ConnectError("gamma unreachable")

    with _patch_gamma_client(handler):
        first = await fetch_market_prices_detailed([cid])
        assert first.prices[cid] == [0.3, 0.7]

        key = next(iter(_price_cache))
        fetched_mono, stored = _price_cache[key]
        _price_cache[key] = (fetched_mono - (_STALE_AFTER_S + 5.0), stored)

        second = await fetch_market_prices_detailed([cid])

    assert call_count["n"] == 2
    assert second.prices[cid] == [0.3, 0.7]
    assert second.from_cache is True
    assert second.error is not None
    assert second.cache_age_s is not None
    assert second.cache_age_s >= _STALE_AFTER_S
    assert second.stale is True


@pytest.mark.asyncio
async def test_marks_full_coverage_recomputed_shares(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "services.policy_marks_service.settings.platform_fee_bps", 100
    )
    policy = _policy()
    price_payload = MarketPricesResult(
        prices={
            "0xleg1": [0.5, 0.5],
            "0xleg2": [0.4, 0.6],
        },
        fetched_at=datetime(2026, 7, 25, 12, 0, tzinfo=UTC),
    )

    with patch(
        "services.policy_marks_service.fetch_market_prices_detailed",
        new=AsyncMock(return_value=price_payload),
    ):
        payload = await get_policy_marks(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )

    assert payload is not None
    out = PolicyMarksOut.model_validate(payload)
    assert out.coverage.status == "full"
    assert out.coverage.quoted == 2
    assert out.coverage.total == 2
    assert out.total_mark_value is not None
    assert out.quote_source == "polymarket_gamma"
    assert out.as_of == price_payload.fetched_at
    assert out.unavailable_reason is None
    assert out.shares_recomputed is True
    assert all(p.shares_source == "recomputed" for p in out.positions)
    assert all(p.null_price_reason is None for p in out.positions)
    # Wire format uses camelCase aliases
    wire = out.model_dump(by_alias=True)
    assert "totalMarkValue" in wire
    assert "quoteSource" in wire
    assert wire["coverage"]["status"] == "full"


@pytest.mark.asyncio
async def test_marks_partial_coverage() -> None:
    policy = _policy()
    price_payload = MarketPricesResult(
        prices={"0xleg1": [0.55, 0.45]},
        fetched_at=datetime.now(UTC),
    )
    with patch(
        "services.policy_marks_service.fetch_market_prices_detailed",
        new=AsyncMock(return_value=price_payload),
    ):
        payload = await get_policy_marks(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )

    assert payload is not None
    assert payload.coverage.status == "partial"
    assert payload.coverage.quoted == 1
    assert payload.total_mark_value is not None
    by_ref = {p.market_ref: p for p in payload.positions}
    assert by_ref["0xleg1"].null_price_reason is None
    assert by_ref["0xleg2"].null_price_reason == "gamma_missing"
    assert by_ref["0xleg2"].current_price_bps is None


@pytest.mark.asyncio
async def test_marks_gamma_unreachable_surfaces_reason() -> None:
    policy = _policy()
    price_payload = MarketPricesResult(
        prices={},
        fetched_at=datetime.now(UTC),
        error="gamma_unreachable:ConnectError",
    )
    with patch(
        "services.policy_marks_service.fetch_market_prices_detailed",
        new=AsyncMock(return_value=price_payload),
    ):
        payload = await get_policy_marks(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )

    assert payload is not None
    assert payload.coverage.status == "none"
    assert payload.total_mark_value is None
    assert payload.unavailable_reason == "gamma_unreachable:ConnectError"
    assert payload.stale is True
    assert all(
        p.null_price_reason == "gamma_unreachable:ConnectError"
        for p in payload.positions
    )


@pytest.mark.asyncio
async def test_marks_prefer_on_chain_shares() -> None:
    policy = _policy(on_chain_policy_id="0x" + "ab" * 32)
    # 99 USDC net * 0.6 weight / 0.4 entry = 148.5 shares USD units
    # On-chain stores base units: 148_500_000
    snapshot = {
        "positions": [
            {
                "marketRef": "0xleg1",
                "sideYes": True,
                "entryPriceBps": 4000,
                "weightBps": 6000,
                "shares": 148_500_000,
            },
            {
                "marketRef": "0xleg2",
                "sideYes": False,
                "entryPriceBps": 4000,
                "weightBps": 4000,
                "shares": 99_000_000,
            },
        ]
    }
    price_payload = MarketPricesResult(
        prices={
            "0xleg1": [0.5, 0.5],
            "0xleg2": [0.4, 0.6],
        },
        fetched_at=datetime.now(UTC),
    )
    with (
        patch(
            "services.policy_marks_service.fetch_market_prices_detailed",
            new=AsyncMock(return_value=price_payload),
        ),
        patch(
            "services.chain_service.read_policy_snapshot",
            return_value=snapshot,
        ),
    ):
        payload = await get_policy_marks(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )

    assert payload is not None
    assert payload.shares_recomputed is False
    assert all(p.shares_source == "on_chain" for p in payload.positions)
    # leg1: 148.5 * 0.5 = 74.25
    by_ref = {p.market_ref: p for p in payload.positions}
    assert by_ref["0xleg1"].mark_value == 74.25


@pytest.mark.asyncio
async def test_marks_no_positions() -> None:
    policy = _policy(positions=[])
    policy.portfolios[0].positions = []
    payload = await get_policy_marks(
        _db_for(policy), user_id=policy.user_id, policy_id=policy.id
    )
    assert payload is not None
    assert payload.unavailable_reason == "no_positions"
    assert payload.coverage.status == "none"


@pytest.mark.asyncio
async def test_marks_not_found_wrong_owner() -> None:
    policy = _policy()
    other = uuid.UUID("ffffffff-ffff-ffff-ffff-ffffffffffff")
    # DB returns None when ownership filter fails
    db = AsyncMock()
    db.execute.return_value = SimpleNamespace(scalar_one_or_none=lambda: None)
    payload = await get_policy_marks(
        db, user_id=other, policy_id=policy.id
    )
    assert payload is None
