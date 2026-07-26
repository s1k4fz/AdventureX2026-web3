"""The provider interface for market-data search.

Mirrors the retired video-search provider contract: one method, many
implementations. Any future market-data provider only has to implement
search(); the routing layer treats them all the same and can fall back across
them.
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from ai.markets.types import MarketCandidate, MarketSearchQuery

__all__ = ["MarketSearchProvider", "ProviderRunMeta"]


@dataclass
class ProviderRunMeta:
    """Neutral run metadata routing reads off ``provider.last_run`` to bill a
    call (provider_usage_logs). Free providers set cost_usd=0 / run_id=None.
    """

    run_id: str | None = None
    cost_usd: Decimal | None = None


class MarketSearchProvider(Protocol):
    async def search(
        self, query: MarketSearchQuery, *, limit: int
    ) -> list[MarketCandidate]: ...
