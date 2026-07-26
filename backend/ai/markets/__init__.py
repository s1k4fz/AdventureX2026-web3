"""Market-data search facade (差分机 / Difference Engine).

Services and policy layers call only search_markets(...) and only ever see the
boundary types (MarketCandidate / MarketSearchQuery / MarketPlatform).
Polymarket Gamma, httpx, the routing/cost machinery all stay inside this
package. ``use_case`` / ``policy_id`` are optional accounting context written
to provider_usage_logs.
"""

import uuid

from ai.markets.config import validate_market_routes
from ai.markets.errors import MarketProviderError
from ai.markets.routing import MarketSearchContext, run_market_search_chain
from ai.markets.types import MarketCandidate, MarketPlatform, MarketSearchQuery

__all__ = [
    "MarketCandidate",
    "MarketPlatform",
    "MarketProviderError",
    "MarketSearchQuery",
    "search_markets",
    "validate_market_routes",
]


async def search_markets(
    query: MarketSearchQuery,
    *,
    platform: MarketPlatform = MarketPlatform.POLYMARKET,
    limit: int,
    use_case: str = "market_search",
    policy_id: uuid.UUID | None = None,
) -> list[MarketCandidate]:
    ctx = MarketSearchContext(
        trace_id=uuid.uuid4().hex, use_case=use_case, policy_id=policy_id
    )
    return await run_market_search_chain(platform, query, limit=limit, ctx=ctx)
