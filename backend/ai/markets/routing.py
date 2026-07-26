"""platform -> provider chain, with cost accounting and cross-provider fallback.

Mirrors ai/search/routing.py's policy: only retryable failures (rate limit,
5xx, timeout, transport blips) move to the next provider; terminal ones
(MarketProviderError: bad input / auth / not found) abort immediately —
retrying elsewhere just burns money. Every attempt, success or failure, writes
a provider_usage_logs row BEFORE the chain moves on.
"""

import logging
import time

from ai.errors import AIError, AIProviderError, AIRateLimitError, AITimeoutError
from ai.markets.config import MarketRoute, routes_for
from ai.markets.errors import MarketProviderError
from ai.markets.providers.base import MarketSearchProvider
from ai.markets.providers.polymarket import PolymarketGammaProvider
from ai.markets.types import MarketCandidate, MarketPlatform, MarketSearchQuery
from ai.markets.usage import record_provider_call

logger = logging.getLogger("lemma.ai.markets")

_PROVIDERS: dict[str, type] = {
    "polymarket_gamma": PolymarketGammaProvider,
}


class MarketSearchContext:
    """Per-search-call accounting context (trace id ties a call's ledger rows)."""

    def __init__(
        self, *, trace_id: str, use_case: str, policy_id=None
    ) -> None:
        self.trace_id = trace_id
        self.use_case = use_case
        # Reserved for future attribution; provider usage rows key on use_case.
        self.policy_id = policy_id


def _is_retryable(exc: Exception) -> bool:
    # MarketProviderError subclasses AIProviderError, so it must be checked
    # first to stay terminal (no fallback).
    if isinstance(exc, MarketProviderError):
        return False
    return isinstance(exc, (AIRateLimitError, AITimeoutError, AIProviderError))


def _build_provider(
    route: MarketRoute, ctx: MarketSearchContext
) -> MarketSearchProvider:
    provider_cls = _PROVIDERS.get(route.provider)
    if provider_cls is None:
        # config.get_market_routes() already rejects unknown providers; this is
        # the defensive backstop.
        raise MarketProviderError(f"unknown market provider '{route.provider}'")
    return provider_cls(None, route, ctx)  # type: ignore[return-value]


async def run_market_search_chain(
    platform: MarketPlatform,
    query: MarketSearchQuery,
    *,
    limit: int,
    ctx: MarketSearchContext,
) -> list[MarketCandidate]:
    routes = routes_for(platform)
    last_error: AIError | None = None
    for route in routes:
        provider = _build_provider(route, ctx)
        started = time.monotonic()
        try:
            candidates = await provider.search(query, limit=limit)
        except AIError as exc:
            meta = getattr(provider, "last_run", None)
            await record_provider_call(
                trace_id=ctx.trace_id,
                provider=route.provider,
                actor_id=None,
                platform=platform.value,
                use_case=ctx.use_case,
                success=False,
                latency_ms=int((time.monotonic() - started) * 1000),
                result_count=None,
                cost_usd=meta.cost_usd if meta else None,
                run_id=meta.run_id if meta else None,
                error_type=type(exc).__name__
            )
            last_error = exc
            if _is_retryable(exc):
                logger.warning(
                    "market provider %s failed (retryable), falling back: %s",
                    route.provider,
                    exc,
                )
                continue
            raise
        meta = getattr(provider, "last_run", None)
        await record_provider_call(
            trace_id=ctx.trace_id,
            provider=route.provider,
            actor_id=None,
            platform=platform.value,
            use_case=ctx.use_case,
            success=True,
            latency_ms=int((time.monotonic() - started) * 1000),
            result_count=len(candidates),
            cost_usd=meta.cost_usd if meta else None,
            run_id=meta.run_id if meta else None,
            error_type=None
        )
        return candidates

    if last_error is not None:
        raise last_error
    raise MarketProviderError(f"no market provider available for {platform.value}")
