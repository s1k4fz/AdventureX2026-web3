"""Deterministic candidate ranking (no LLM).

Cheap, testable, observable: the LLM only makes the final pick among the top of
this ordering. Scores blend volume, liquidity, 24h activity, spread tightness,
time-fit, price-extremity, order-book depth, activity freshness, and optional
tag relevance. Event/negRisk groups are deduped so only the best market per
correlated event survives.
"""

import math
from datetime import UTC, datetime

from ai.markets.types import MarketCandidate

# Weights (additive).
_W_VOLUME = 1.0
_W_LIQUIDITY = 0.8
_W_VOLUME24 = 0.6
_W_TIME_FIT = 1.5
_W_SPREAD = 0.5
_W_EXTREMITY = 0.8
_W_DEPTH = 0.7
_W_FRESHNESS = 0.9
_W_TAG_RELEVANCE = 1.2

# Price extremity: entry YES price < 3% or > 97% is penalized.
_EXTREME_LOW_BPS = 300
_EXTREME_HIGH_BPS = 9700


def rank(
    candidates: list[MarketCandidate],
    *,
    coverage_end: datetime | None = None,
    now: datetime | None = None,
    concern_keywords: list[str] | None = None,
) -> list[MarketCandidate]:
    """Return candidates sorted best-first. Stable (preserves input order on ties)."""
    moment = now or datetime.now(UTC)
    keywords = [k.strip().lower() for k in (concern_keywords or []) if k.strip()]
    scored = [
        (idx, candidate, _score(candidate, moment, coverage_end, keywords))
        for idx, candidate in enumerate(candidates)
    ]
    deduped = _dedup_by_event(scored)
    return [
        candidate
        for _, candidate, _ in sorted(
            deduped,
            key=lambda pair: (-pair[2], pair[0]),
        )
    ]


def _score(
    candidate: MarketCandidate,
    now: datetime,
    coverage_end: datetime | None,
    concern_keywords: list[str],
) -> float:
    volume = math.log10((candidate.volume or 0) + 1)
    liquidity = math.log10((candidate.liquidity or 0) + 1)
    volume24 = math.log10((candidate.volume24hr or 0) + 1)
    spread = _spread_score(candidate)
    extremity = _extremity_penalty(candidate)
    depth = _depth_score(candidate)
    freshness = _freshness_score(candidate)
    tag_rel = _tag_relevance_score(candidate, concern_keywords)
    return (
        _W_VOLUME * volume
        + _W_LIQUIDITY * liquidity
        + _W_VOLUME24 * volume24
        + _W_TIME_FIT * _time_fit_score(candidate.end_date, now, coverage_end)
        + _W_SPREAD * spread
        + _W_EXTREMITY * extremity
        + _W_DEPTH * depth
        + _W_FRESHNESS * freshness
        + _W_TAG_RELEVANCE * tag_rel
    )


def _yes_price_bps(candidate: MarketCandidate) -> int | None:
    prices = candidate.outcome_prices
    if not prices:
        return None
    outcomes = candidate.outcomes
    for i, outcome in enumerate(outcomes):
        if outcome.upper() in ("YES", "是") and i < len(prices):
            return round(prices[i] * 10000)
    if len(prices) >= 1:
        return round(prices[0] * 10000)
    return None


def _extremity_penalty(candidate: MarketCandidate) -> float:
    """1.0 for mid-range prices; lower when YES price is extreme (<3% or >97%)."""
    bps = _yes_price_bps(candidate)
    if bps is None:
        return 0.5
    if bps < _EXTREME_LOW_BPS or bps > _EXTREME_HIGH_BPS:
        return 0.0
    if bps < 500 or bps > 9500:
        return 0.5
    return 1.0


def _spread_score(candidate: MarketCandidate) -> float:
    """Tighter spread -> higher score. Unknown spread gets a neutral 0.5."""
    spread = candidate.spread
    if spread is None:
        return 0.5
    if spread <= 0.02:
        return 1.0
    if spread <= 0.05:
        return 0.7
    if spread <= 0.10:
        return 0.4
    return 0.1


def _depth_score(candidate: MarketCandidate) -> float:
    """Proxy for order-book depth from best bid/ask presence + liquidity floor.

    Markets with both sides quoted and meaningful liquidity score higher;
    one-sided or thin books are penalized.
    """
    has_bid = candidate.best_bid is not None
    has_ask = candidate.best_ask is not None
    liq = candidate.liquidity or 0.0
    if has_bid and has_ask and liq >= 10_000:
        return 1.0
    if has_bid and has_ask and liq >= 2_000:
        return 0.75
    if has_bid and has_ask:
        return 0.5
    if has_bid or has_ask:
        return 0.3
    if liq >= 5_000:
        return 0.4
    return 0.15


def _freshness_score(candidate: MarketCandidate) -> float:
    """Activity freshness via 24h volume share of total volume.

    High recent share => actively traded; stale markets (volume but no 24h) are
    penalized. Unknowns get a neutral mid score.
    """
    vol = candidate.volume
    vol24 = candidate.volume24hr
    if vol is None and vol24 is None:
        return 0.5
    if vol24 is None or vol24 <= 0:
        return 0.15 if (vol or 0) > 0 else 0.4
    if vol is None or vol <= 0:
        return 0.7 if vol24 > 0 else 0.4
    ratio = min(1.0, vol24 / max(vol, 1.0))
    if ratio >= 0.15:
        return 1.0
    if ratio >= 0.05:
        return 0.75
    if ratio >= 0.01:
        return 0.5
    return 0.25


def _tag_relevance_score(
    candidate: MarketCandidate, concern_keywords: list[str]
) -> float:
    """Soft boost when market question/tags/category overlap concern keywords."""
    if not concern_keywords:
        return 0.5
    haystack_parts = [
        candidate.question or "",
        candidate.category or "",
        " ".join(candidate.tags or []),
    ]
    haystack = " ".join(haystack_parts).lower()
    if not haystack.strip():
        return 0.3
    hits = sum(1 for kw in concern_keywords if kw in haystack)
    if hits == 0:
        return 0.2
    if hits == 1:
        return 0.7
    return 1.0


def _event_group_key(candidate: MarketCandidate) -> str | None:
    if candidate.neg_risk_market_id:
        return f"neg:{candidate.neg_risk_market_id}"
    if candidate.event_id:
        return f"evt:{candidate.event_id}"
    raw = candidate.raw or {}
    neg = raw.get("negRiskMarketID") or raw.get("negRiskMarketId")
    if neg:
        return f"neg:{neg}"
    evt = raw.get("eventId") or raw.get("event_id")
    if evt:
        return f"evt:{evt}"
    return None


def _dedup_by_event(
    scored: list[tuple[int, MarketCandidate, float]],
) -> list[tuple[int, MarketCandidate, float]]:
    """Within each event/negRisk group keep only the highest-scored market."""
    best_by_group: dict[str, tuple[int, MarketCandidate, float]] = {}
    ungrouped: list[tuple[int, MarketCandidate, float]] = []
    for entry in scored:
        key = _event_group_key(entry[1])
        if key is None:
            ungrouped.append(entry)
            continue
        prev = best_by_group.get(key)
        if prev is None or entry[2] > prev[2]:
            best_by_group[key] = entry
    return ungrouped + list(best_by_group.values())


def _time_fit_score(
    end_date: datetime | None, now: datetime, coverage_end: datetime | None
) -> float:
    """Markets resolving within the coverage window are ideal (1.0); markets
    resolving after coverage_end are penalized (near-zero). If no coverage_end
    is specified, any resolving market gets a decent score; no end_date gets 0.5."""
    if end_date is None:
        return 0.5
    moment = end_date if end_date.tzinfo else end_date.replace(tzinfo=UTC)
    if moment <= now:
        return 0.1
    if coverage_end is None:
        days_out = (moment - now).days
        return max(0.2, 1.0 - days_out / 365.0)
    cov = coverage_end if coverage_end.tzinfo else coverage_end.replace(tzinfo=UTC)
    if moment <= cov:
        return 1.0
    days_over = (moment - cov).days
    return max(0.0, 0.3 - days_over / 180.0)
