"""Polymarket Gamma API market-search provider.

Anonymous and free; maps each Gamma /markets item to the boundary
MarketCandidate. Construction signature is (client, route, ctx) to match
routing._build_provider; the ``client`` arg is ignored (this provider builds
and closes its own httpx client within search() — leak-free, no global
cleanup needed). Error mapping mirrors ai/search/providers/bilibili/client.py:
429 → AIRateLimitError; 5xx → AIProviderError; timeouts → AITimeoutError;
other 4xx → MarketProviderError (terminal).

Keyword search uses Gamma ``/public-search`` (the ``/markets`` list endpoint
ignores ``q`` and only returns top volume markets — which made Chinese /
weather needs always return an empty pool).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx

from ai.errors import AIProviderError, AIRateLimitError, AITimeoutError
from ai.markets.errors import MarketProviderError
from ai.markets.normalize import maybe_json_list, parse_float, parse_iso_datetime
from ai.markets.types import MarketCandidate, MarketPlatform, MarketSearchQuery
from ai.markets.providers.base import ProviderRunMeta
from core.config import settings

# Minimum thresholds — drop zero-volume dust, but keep niche weather markets
# which often clear only a few hundred USD.
_MIN_VOLUME = 100.0  # USD
_MIN_LIQUIDITY = 50.0  # USD


def _compute_spread(best_bid: float | None, best_ask: float | None) -> float | None:
    if best_bid is None or best_ask is None:
        return None
    if best_ask <= 0:
        return None
    return max(0.0, (best_ask - best_bid) / best_ask)


def _parse_tags(item: dict[str, Any]) -> list[str]:
    tags = item.get("tags")
    if isinstance(tags, list):
        return [str(t) for t in tags if t]
    if isinstance(tags, str) and tags.strip():
        return [tags.strip()]
    return []


def to_candidate(item: dict[str, Any]) -> MarketCandidate | None:
    """Map one Gamma /markets item to a MarketCandidate (None to skip).

    Field mapping (Gamma real fields → MarketCandidate):
        question       → question
        conditionId    → condition_id
        slug           → slug
        volume (str)   → volume  (parse_float; also try volumeNum)
        liquidity (str)→ liquidity  (parse_float; also try liquidityNum)
        endDate        → end_date  (ISO 8601)
        clobTokenIds   → clob_token_ids (JSON-encoded str list OR real list)
        outcomes       → outcomes (JSON-encoded str list OR real list)
        outcomePrices  → outcome_prices (JSON-encoded str list → list[float])
        slug           → url = https://polymarket.com/event/{slug}

    Items without conditionId or question are skipped (None).
    """
    condition_id = item.get("conditionId")
    question = item.get("question")
    if not condition_id or not question:
        return None

    slug = item.get("slug")
    if slug:
        url = f"https://polymarket.com/event/{slug}"
    else:
        url = item.get("url") or item.get("market_slug") or ""
        if not url:
            url = f"https://polymarket.com/market/{condition_id}"

    # Volume: try volumeNum (numeric) first, fall back to volume (string).
    volume = parse_float(item.get("volumeNum")) or parse_float(item.get("volume"))
    liquidity = parse_float(item.get("liquidityNum")) or parse_float(
        item.get("liquidity")
    )
    volume24hr = parse_float(item.get("volume24hr")) or parse_float(
        item.get("volume24hrClob")
    )
    best_bid = parse_float(item.get("bestBid"))
    best_ask = parse_float(item.get("bestAsk"))
    spread = _compute_spread(best_bid, best_ask)
    category = item.get("category") or item.get("groupItemTitle")
    if category is not None:
        category = str(category).strip() or None
    neg_risk_market_id = item.get("negRiskMarketID") or item.get("negRiskMarketId")
    event_id = item.get("eventId") or item.get("event_id")

    # Outcome prices — JSON-encoded string list of number-strings.
    raw_prices = maybe_json_list(item.get("outcomePrices"))
    outcome_prices: list[float] = []
    for p in raw_prices:
        val = parse_float(p)
        if val is not None:
            outcome_prices.append(val)

    return MarketCandidate(
        platform=MarketPlatform.POLYMARKET,
        condition_id=str(condition_id),
        question=str(question),
        slug=slug,
        url=url,
        outcomes=maybe_json_list(item.get("outcomes")),
        outcome_prices=outcome_prices,
        clob_token_ids=maybe_json_list(item.get("clobTokenIds")),
        volume=volume,
        liquidity=liquidity,
        volume24hr=volume24hr,
        best_bid=best_bid,
        best_ask=best_ask,
        spread=spread,
        category=category,
        tags=_parse_tags(item),
        neg_risk_market_id=str(neg_risk_market_id) if neg_risk_market_id else None,
        event_id=str(event_id) if event_id else None,
        end_date=parse_iso_datetime(item.get("endDate")),
        raw=item,
    )


def _matches_keyword(question: str, keyword: str) -> bool:
    """Permissive keyword relevance: any token of the keyword is a substring."""
    q_lower = question.lower()
    tokens = keyword.lower().split()
    return any(token in q_lower for token in tokens)


def _map_http_error(response: httpx.Response) -> None:
    """Map non-2xx to the AI error family (like bilibili/client.py)."""
    status = response.status_code
    if 200 <= status < 300:
        return
    if status == 429:
        raise AIRateLimitError("polymarket gamma rate limited", raw=status)
    if status >= 500:
        raise AIProviderError(f"polymarket gamma HTTP {status}", raw=status)
    # Other 4xx — terminal (bad request / not found).
    raise MarketProviderError(f"polymarket gamma HTTP {status}")


def _is_tradable(item: dict[str, Any]) -> bool:
    """Keep open, active markets; public-search also returns closed history."""
    if item.get("closed") is True:
        return False
    if item.get("active") is False:
        return False
    return True


def _passes_filters(
    candidate: MarketCandidate, query: MarketSearchQuery, *, require_keyword: bool
) -> bool:
    if (
        query.coverage_end is not None
        and candidate.end_date is not None
        and candidate.end_date > query.coverage_end
    ):
        return False
    if candidate.volume is not None and candidate.volume < _MIN_VOLUME:
        return False
    if candidate.liquidity is not None and candidate.liquidity < _MIN_LIQUIDITY:
        return False
    # public-search is already keyword-scoped; /markets listing still needs this.
    if require_keyword and query.keyword and not _matches_keyword(
        candidate.question, query.keyword
    ):
        return False
    return True


class PolymarketGammaProvider:
    provider_name = "polymarket_gamma"
    platform = MarketPlatform.POLYMARKET

    def __init__(self, client: Any, route: Any, ctx: Any) -> None:
        # ``client`` is ignored — this provider manages its own httpx client
        # (built and closed within each search() call for leak safety).
        self._route = route
        self._ctx = ctx
        # Free provider: cost is always zero.
        self.last_run = ProviderRunMeta(cost_usd=Decimal("0"))

    async def search(
        self, query: MarketSearchQuery, *, limit: int
    ) -> list[MarketCandidate]:
        max_items = max(1, min(limit, self._route.max_items))
        timeout = httpx.Timeout(self._route.timeout_s)
        async with httpx.AsyncClient(timeout=timeout) as http:
            if query.keyword.strip():
                items = await self._search_by_keyword(http, query.keyword, max_items)
                require_keyword = False
            else:
                items = await self._list_top_markets(http, max_items)
                require_keyword = True

        candidates: list[MarketCandidate] = []
        seen: set[str] = set()
        for item in items:
            if not isinstance(item, dict) or not _is_tradable(item):
                continue
            candidate = to_candidate(item)
            if candidate is None:
                continue
            if candidate.condition_id in seen:
                continue
            if not _passes_filters(
                candidate, query, require_keyword=require_keyword
            ):
                continue
            seen.add(candidate.condition_id)
            candidates.append(candidate)
            if len(candidates) >= limit:
                break

        return candidates

    async def _search_by_keyword(
        self, http: httpx.AsyncClient, keyword: str, max_items: int
    ) -> list[dict[str, Any]]:
        """Gamma text search: flatten event markets from /public-search."""
        try:
            response = await http.get(
                f"{settings.polymarket_gamma_base_url}/public-search",
                params={
                    "q": keyword,
                    # Gamma otherwise mixes closed history into the first page.
                    # Asking for active events server-side both cuts transfer /
                    # filtering waste and avoids valid live markets being pushed
                    # beyond the provider's over-fetch cap.
                    "events_status": "active",
                    "limit_per_type": str(max(2, min(max_items, 4))),
                },
            )
        except httpx.TimeoutException as exc:
            raise AITimeoutError(
                "polymarket gamma request timed out", raw=exc
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                "polymarket gamma request failed", raw=exc
            ) from exc

        _map_http_error(response)

        try:
            payload = response.json()
        except ValueError as exc:
            raise AIProviderError(
                "polymarket gamma returned non-JSON", raw=exc
            ) from exc

        if not isinstance(payload, dict):
            raise AIProviderError(
                "polymarket gamma public-search returned unexpected shape"
            )

        items: list[dict[str, Any]] = []
        for event in payload.get("events") or []:
            if not isinstance(event, dict):
                continue
            markets = event.get("markets") or []
            if not isinstance(markets, list):
                continue
            for market in markets:
                if isinstance(market, dict):
                    items.append(market)
                if len(items) >= max_items * 4:
                    # Over-fetch a bit so volume/closed filters still leave enough.
                    return items
        return items

    async def _list_top_markets(
        self, http: httpx.AsyncClient, max_items: int
    ) -> list[dict[str, Any]]:
        """Fallback listing when no keyword is provided."""
        params: dict[str, str] = {
            "active": "true",
            "closed": "false",
            "limit": str(max_items),
            "order": "volumeNum",
            "ascending": "false",
        }
        try:
            response = await http.get(
                f"{settings.polymarket_gamma_base_url}/markets",
                params=params,
            )
        except httpx.TimeoutException as exc:
            raise AITimeoutError(
                "polymarket gamma request timed out", raw=exc
            ) from exc
        except httpx.HTTPError as exc:
            raise AIProviderError(
                "polymarket gamma request failed", raw=exc
            ) from exc

        _map_http_error(response)

        try:
            items = response.json()
        except ValueError as exc:
            raise AIProviderError(
                "polymarket gamma returned non-JSON", raw=exc
            ) from exc

        if not isinstance(items, list):
            raise AIProviderError(
                "polymarket gamma returned unexpected shape (not a list)"
            )
        return [item for item in items if isinstance(item, dict)]
