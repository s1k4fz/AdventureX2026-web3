"""Boundary types for the market-data layer (差分机 / Difference Engine).

These are the ONLY shapes allowed to leave ai/markets/. Polymarket Gamma raw
items, httpx internals, and the routing/cost machinery all stay inside this
package. The opaque ``raw`` field is a deliberate passthrough (stores the full
Gamma item for audit / downstream enrichment); it is never interpreted outside
the provider that produced it.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class MarketPlatform(StrEnum):
    POLYMARKET = "polymarket"


class MarketSearchQuery(BaseModel):
    keyword: str
    # Optional coverage window: when set the provider drops markets resolving
    # AFTER this date (only markets ending within the window are useful for the
    # policy time-horizon).
    coverage_end: datetime | None = None


class MarketCandidate(BaseModel):
    platform: MarketPlatform
    # The on-chain conditionId — the STABLE identifier (analog of
    # platform_video_id in VideoCandidate).
    condition_id: str
    question: str
    slug: str | None = None
    url: str
    outcomes: list[str] = Field(default_factory=list)
    outcome_prices: list[float] = Field(default_factory=list)
    clob_token_ids: list[str] = Field(default_factory=list)
    volume: float | None = None
    liquidity: float | None = None
    volume24hr: float | None = None
    best_bid: float | None = None
    best_ask: float | None = None
    spread: float | None = None
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    neg_risk_market_id: str | None = None
    event_id: str | None = None
    end_date: datetime | None = None
    # Provider's untouched item, opaque outside the producing provider.
    raw: dict[str, Any] = Field(default_factory=dict)
