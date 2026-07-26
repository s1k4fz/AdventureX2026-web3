"""MARKETS_ROUTES_JSON parsing + startup validation (mirrors ai/search/config.py).

Env reading stays in core/config.py (the single Settings truth); this module
turns MARKETS_ROUTES_JSON into typed, priority-sorted MarketRoute chains per
platform and fails fast on unknown providers / malformed entries. The routing
table is the one truth for "platform -> provider" (配置即真相): swapping or
adding a provider is a config edit, zero code change.
"""

import json
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from ai.errors import AIConfigError
from ai.markets.types import MarketPlatform
from core.config import settings

# Providers with an implementation in ai/markets/providers/.
_KNOWN_PROVIDERS = {"polymarket_gamma"}


class MarketRoute(BaseModel):
    provider: str
    max_items: int = 40
    timeout_s: float = 30
    # Lower number wins; multiple routes for one platform form a fallback chain.
    priority: int = 0
    extra: dict[str, Any] = Field(default_factory=dict)


@lru_cache(maxsize=1)
def get_market_routes() -> dict[MarketPlatform, tuple[MarketRoute, ...]]:
    """Parse MARKETS_ROUTES_JSON into priority-sorted route chains per platform."""
    try:
        raw = json.loads(settings.markets_routes_json)
    except json.JSONDecodeError as exc:
        raise AIConfigError(f"MARKETS_ROUTES_JSON is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise AIConfigError("MARKETS_ROUTES_JSON must be a JSON object keyed by platform")

    routes: dict[MarketPlatform, tuple[MarketRoute, ...]] = {}
    for key, entries in raw.items():
        try:
            platform = MarketPlatform(key)
        except ValueError as exc:
            raise AIConfigError(
                f"MARKETS_ROUTES_JSON has unknown platform '{key}'"
            ) from exc
        if not isinstance(entries, list) or not entries:
            raise AIConfigError(
                f"MARKETS_ROUTES_JSON['{key}'] must be a non-empty array"
            )
        try:
            parsed = [MarketRoute.model_validate(entry) for entry in entries]
        except ValidationError as exc:
            raise AIConfigError(
                f"MARKETS_ROUTES_JSON['{key}'] has an invalid route: {exc}"
            ) from exc
        for route in parsed:
            if route.provider not in _KNOWN_PROVIDERS:
                raise AIConfigError(
                    f"MARKETS_ROUTES_JSON['{key}'] references unknown provider "
                    f"'{route.provider}'"
                )
        routes[platform] = tuple(sorted(parsed, key=lambda r: r.priority))
    return routes


def routes_for(platform: MarketPlatform) -> tuple[MarketRoute, ...]:
    routes = get_market_routes().get(platform)
    if not routes:
        raise AIConfigError(f"no market route configured for platform '{platform}'")
    return routes


def validate_market_routes() -> None:
    """Fail fast on a malformed routing table. Parsing is the validation."""
    get_market_routes()
