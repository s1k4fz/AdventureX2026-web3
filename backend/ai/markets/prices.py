"""Batch Polymarket price lookup for live marks (差分机 / Difference Engine).

Read-only helper: fetches current outcomePrices for a set of conditionIds via
Gamma /markets. Does not go through the full search routing chain.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from ai.markets.normalize import maybe_json_list, parse_float
from core.config import settings

logger = logging.getLogger("lemma.ai.markets.prices")

# Fresh TTL: absorb ~30s frontend polls without hammering Gamma.
# Past TTL we still retain last-good quotes for failure fallback until
# _CACHE_RETAIN_S; soft-stale observability kicks in at _STALE_AFTER_S.
_CACHE_TTL_S = 20.0
_STALE_AFTER_S = 60.0
_CACHE_RETAIN_S = 300.0
_CACHE_MAXSIZE = 256


@dataclass
class MarketPricesResult:
    """Structured Gamma batch lookup result for marks observability."""

    prices: dict[str, list[float]] = field(default_factory=dict)
    fetched_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    error: str | None = None
    from_cache: bool = False
    cache_age_s: float | None = None

    @property
    def stale(self) -> bool:
        if self.cache_age_s is not None:
            return self.cache_age_s >= _STALE_AFTER_S
        return False


# cache_key -> (fetched_at_monotonic, result)
_price_cache: dict[str, tuple[float, MarketPricesResult]] = {}


def clear_market_prices_cache() -> None:
    _price_cache.clear()


def _cache_key(condition_ids: list[str]) -> str:
    return ",".join(sorted(condition_ids))


def _cache_peek(key: str) -> MarketPricesResult | None:
    """Return last-good entry if still within the retain window.

    Entries past ``_CACHE_TTL_S`` are still returned so callers can fall back
    after a failed refresh; only ages beyond ``_CACHE_RETAIN_S`` are dropped.
    """
    entry = _price_cache.get(key)
    if entry is None:
        return None
    fetched_mono, result = entry
    age = time.monotonic() - fetched_mono
    if age > _CACHE_RETAIN_S:
        _price_cache.pop(key, None)
        return None
    return MarketPricesResult(
        prices=dict(result.prices),
        fetched_at=result.fetched_at,
        error=result.error,
        from_cache=True,
        cache_age_s=age,
    )


def _cache_put(key: str, result: MarketPricesResult) -> None:
    if _CACHE_RETAIN_S <= 0:
        return
    now = time.monotonic()
    _price_cache[key] = (now, result)
    while len(_price_cache) > _CACHE_MAXSIZE:
        # Drop an arbitrary oldest-ish entry (insertion order in 3.7+)
        oldest = next(iter(_price_cache))
        _price_cache.pop(oldest, None)


def _fallback_from_cache(
    cached: MarketPricesResult,
    *,
    error: str,
) -> MarketPricesResult:
    """Serve retained last-good quotes when a live Gamma refresh fails."""
    return MarketPricesResult(
        prices=dict(cached.prices),
        fetched_at=cached.fetched_at,
        error=error,
        from_cache=True,
        cache_age_s=cached.cache_age_s,
    )


async def fetch_market_prices(
    condition_ids: list[str],
) -> dict[str, list[float]]:
    """Return {condition_id: outcome_prices} for each id Gamma returns.

    Convenience wrapper; prefer ``fetch_market_prices_detailed`` for marks.
    """
    result = await fetch_market_prices_detailed(condition_ids)
    return result.prices


async def fetch_market_prices_detailed(
    condition_ids: list[str],
) -> MarketPricesResult:
    """Batch-fetch Gamma outcomePrices with cache + structured error metadata."""
    unique = [cid for cid in dict.fromkeys(condition_ids) if cid]
    fetched_at = datetime.now(UTC)
    if not unique:
        return MarketPricesResult(prices={}, fetched_at=fetched_at)

    key = _cache_key(unique)
    cached = _cache_peek(key)
    # Fresh hit: serve without network. Past TTL we refetch but keep `cached`
    # so a failed refresh can still return last-good quotes.
    if (
        cached is not None
        and cached.error is None
        and cached.prices
        and (cached.cache_age_s or 0.0) < _CACHE_TTL_S
    ):
        return cached

    timeout = httpx.Timeout(15.0)
    prices: dict[str, list[float]] = {}
    batch_errors: list[str] = []
    batch_size = 20
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            for start in range(0, len(unique), batch_size):
                batch = unique[start : start + batch_size]
                try:
                    # Gamma expects repeated condition_ids keys, not a
                    # comma-joined string (the latter returns an empty list).
                    resp = await http.get(
                        f"{settings.polymarket_gamma_base_url}/markets",
                        params={
                            "condition_ids": batch,
                            "active": "true",
                            "closed": "false",
                        },
                    )
                except httpx.HTTPError as exc:
                    msg = f"gamma_http_error:{exc.__class__.__name__}"
                    logger.warning("Gamma batch price lookup failed: %s", exc)
                    batch_errors.append(msg)
                    continue
                if resp.status_code != 200:
                    msg = f"gamma_http_{resp.status_code}"
                    logger.warning(
                        "Gamma batch price lookup returned %d", resp.status_code
                    )
                    batch_errors.append(msg)
                    continue
                try:
                    items = resp.json()
                except ValueError:
                    batch_errors.append("gamma_invalid_json")
                    continue
                if not isinstance(items, list):
                    batch_errors.append("gamma_unexpected_shape")
                    continue
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    cid = item.get("conditionId")
                    if not cid:
                        continue
                    parsed = _parse_outcome_prices(item)
                    if parsed:
                        prices[str(cid)] = parsed
    except httpx.HTTPError as exc:
        logger.warning("Gamma batch price lookup failed: %s", exc)
        err = f"gamma_unreachable:{exc.__class__.__name__}"
        if cached is not None and cached.prices:
            return _fallback_from_cache(cached, error=err)
        return MarketPricesResult(
            prices={},
            fetched_at=fetched_at,
            error=err,
        )

    error: str | None = None
    if not prices and batch_errors:
        error = batch_errors[0]
    elif not prices and unique:
        # Request succeeded but Gamma returned no matching markets
        error = "gamma_no_markets"
    elif batch_errors and prices:
        # Partial batch success — keep prices; missing ids signal coverage gaps
        error = None

    if prices:
        result = MarketPricesResult(
            prices=prices,
            fetched_at=fetched_at,
            error=error,
            from_cache=False,
            cache_age_s=0.0,
        )
        _cache_put(key, result)
        return result

    # Empty live result: prefer retained last-good quotes over an empty miss.
    if cached is not None and cached.prices:
        return _fallback_from_cache(
            cached,
            error=error or cached.error or "gamma_refresh_failed",
        )

    return MarketPricesResult(
        prices={},
        fetched_at=fetched_at,
        error=error,
        from_cache=False,
        cache_age_s=0.0,
    )


def _parse_outcome_prices(item: dict[str, Any]) -> list[float]:
    raw_prices = maybe_json_list(item.get("outcomePrices"))
    out: list[float] = []
    for p in raw_prices:
        val = parse_float(p)
        if val is not None:
            out.append(val)
    return out


def price_bps_for_side(
    outcome_prices: list[float], outcomes: list[str], side: str
) -> int | None:
    """Map live outcome prices to bps for YES/NO side (same rules as compose)."""
    if not outcome_prices:
        return None
    side_upper = side.upper()
    idx: int | None = None
    for i, outcome in enumerate(outcomes):
        label = outcome.upper()
        if label in ("YES", "是") and side_upper == "YES":
            idx = i
            break
        if label in ("NO", "否") and side_upper == "NO":
            idx = i
            break
    if idx is None and len(outcomes) == 2 and len(outcome_prices) == 2:
        idx = 0 if side_upper == "YES" else 1
    if idx is None or idx >= len(outcome_prices):
        return None
    bps = round(outcome_prices[idx] * 10000)
    return max(1, min(10000, bps))
