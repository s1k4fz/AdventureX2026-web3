"""Routing-table parsing and startup validation.

Env reading stays in core/config.py (the single Settings truth); this module
only turns AI_ROUTES_JSON into typed ModelRoute lists and checks at startup
that every referenced channel is usable. The routing table is the one truth
for "use case -> model -> platform" (终稿 2.2 配置边界).
"""

import json
import logging
from functools import lru_cache

from pydantic import ValidationError

from ai.errors import AIConfigError
from ai.types import AIUseCase, ModelRoute
from core.config import settings

logger = logging.getLogger(__name__)

_TESTED_CHANNELS = {
    ("deepseek", "openai_compatible"),
}
_UNTESTED_CHANNELS: set[tuple[str, str]] = set()

_PLATFORM_API_KEYS = {
    "deepseek": "DEEPSEEK_API_KEY",
}


@lru_cache(maxsize=1)
def get_routes() -> dict[AIUseCase, tuple[ModelRoute, ...]]:
    """Parse AI_ROUTES_JSON into priority-sorted route chains per use case."""
    try:
        raw = json.loads(settings.ai_routes_json)
    except json.JSONDecodeError as exc:
        raise AIConfigError(f"AI_ROUTES_JSON is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise AIConfigError("AI_ROUTES_JSON must be a JSON object keyed by use case")

    routes: dict[AIUseCase, tuple[ModelRoute, ...]] = {}
    for key, entries in raw.items():
        try:
            use_case = AIUseCase(key)
        except ValueError as exc:
            raise AIConfigError(f"AI_ROUTES_JSON has unknown use case '{key}'") from exc
        if not isinstance(entries, list) or not entries:
            raise AIConfigError(f"AI_ROUTES_JSON['{key}'] must be a non-empty array")
        try:
            parsed = [ModelRoute.model_validate(entry) for entry in entries]
        except ValidationError as exc:
            raise AIConfigError(f"AI_ROUTES_JSON['{key}'] has an invalid route: {exc}") from exc
        routes[use_case] = tuple(sorted(parsed, key=lambda route: route.priority))
    return routes


_SOURCE_BRIEF_FALLBACK = (
    ModelRoute(
        platform="deepseek",
        adapter="openai_compatible",
        model="deepseek-v4-flash",
        priority=0,
        timeout_s=45,
        extra={"max_tokens": 2048},
    ),
)


def routes_for(use_case: AIUseCase) -> tuple[ModelRoute, ...]:
    routes = get_routes().get(use_case)
    if routes:
        return routes
    # Older AI_ROUTES_JSON without source_brief still boots; synthesizer uses flash.
    if use_case == AIUseCase.SOURCE_BRIEF:
        return _SOURCE_BRIEF_FALLBACK
    raise AIConfigError(f"no AI route configured for use case '{use_case}'")


def validate_routes() -> None:
    """Fail fast at startup on unusable channels or missing credentials."""
    for use_case, chain in get_routes().items():
        for route in chain:
            channel = (route.platform, route.adapter)
            if channel in _UNTESTED_CHANNELS:
                logger.warning(
                    "route %s -> %s/%s is an untested channel",
                    use_case,
                    route.platform,
                    route.adapter,
                )
            elif channel not in _TESTED_CHANNELS:
                raise AIConfigError(
                    f"route {use_case} -> {route.platform}/{route.adapter} is not a known channel"
                )

            env_name = _PLATFORM_API_KEYS.get(route.platform)
            if env_name == "DEEPSEEK_API_KEY" and not settings.deepseek_api_key:
                raise AIConfigError(f"route {use_case} needs {env_name} to be set")
