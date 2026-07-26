"""ModelRoute -> Pydantic AI Model instances (shared httpx client + cache).

HTTP-level retries are set EXPLICITLY on the official SDK clients (终稿裁决 1):
the OpenAI SDK silently defaults to 2 retries and honours Retry-After for up
to 60s, which would stall cross-platform fallback (pydantic-ai issue #3267).
Never stack tenacity or custom transports on top — retries would multiply.
"""

from typing import Any

import httpx
from openai import AsyncOpenAI
from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIChatModelSettings
from pydantic_ai.providers.openai import OpenAIProvider

from ai.errors import AIConfigError
from ai.types import ModelRoute
from core.config import settings

# One retry for transient network blips; anything beyond that is the
# FallbackModel's job (route-level policy), not the HTTP layer's.
_HTTP_MAX_RETRIES = 1

_http_client: httpx.AsyncClient | None = None
_model_cache: dict[str, Model] = {}


def init_http_client() -> None:
    """Create the process-wide HTTP client. Called from the FastAPI lifespan.

    Celery workers must NOT reuse this client across tasks — each task creates
    and closes its own (终稿 5.2 / 9.3).
    """
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.ai_default_timeout_seconds),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )


async def shutdown_http_client() -> None:
    global _http_client
    _model_cache.clear()
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


def _require_http_client() -> httpx.AsyncClient:
    if _http_client is None:
        raise AIConfigError(
            "AI runtime not initialised — init_ai_runtime() must run in the app lifespan"
        )
    return _http_client


def build_model(route: ModelRoute) -> Model:
    """Return the (cached) executable model for a routing-table entry."""
    key = route.model_dump_json()
    cached = _model_cache.get(key)
    if cached is not None:
        return cached

    channel = (route.platform, route.adapter)
    if channel == ("deepseek", "openai_compatible"):
        model = _build_deepseek_openai(route)
    else:
        raise AIConfigError(
            f"no factory branch for {route.platform}/{route.adapter}"
        )
    _model_cache[key] = model
    return model


def _build_openai_chat_model(
    route: ModelRoute,
    *,
    base_url: str,
    api_key: str,
    continuous_usage_stats: bool = False,
) -> Model:
    client = AsyncOpenAI(
        base_url=base_url,
        api_key=api_key,
        max_retries=_HTTP_MAX_RETRIES,
        http_client=_require_http_client(),
    )
    settings_kwargs: dict[str, Any] = {
        "timeout": route.timeout_s,
    }
    if "max_tokens" in route.extra:
        settings_kwargs["max_tokens"] = int(route.extra["max_tokens"])
    if continuous_usage_stats:
        # Some gateways repeat cumulative usage across stream chunks; without
        # this flag the framework sums them and doubles billed token counts.
        settings_kwargs["openai_continuous_usage_stats"] = True
    _apply_openai_thinking_settings(settings_kwargs, route)
    return OpenAIChatModel(
        route.model,
        provider=OpenAIProvider(openai_client=client),
        settings=OpenAIChatModelSettings(**settings_kwargs),
    )


def _build_deepseek_openai(route: ModelRoute) -> Model:
    if not settings.deepseek_api_key:
        raise AIConfigError("DEEPSEEK_API_KEY is required for deepseek routes")
    # V4 defaults to thinking mode, which can consume max_tokens before any
    # visible content. Disable unless the route explicitly opts in.
    extra = dict(route.extra)
    if "thinking" not in extra and "extra_body" not in extra and "reasoning" not in extra:
        extra["extra_body"] = {"thinking": {"type": "disabled"}}
        route = route.model_copy(update={"extra": extra})
    return _build_openai_chat_model(
        route,
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
    )


def _apply_openai_thinking_settings(
    settings_kwargs: dict[str, Any], route: ModelRoute
) -> None:
    if "thinking" in route.extra:
        settings_kwargs["thinking"] = route.extra["thinking"]
    if "openai_reasoning_effort" in route.extra:
        settings_kwargs["openai_reasoning_effort"] = route.extra[
            "openai_reasoning_effort"
        ]
    elif "reasoning_effort" in route.extra:
        settings_kwargs["openai_reasoning_effort"] = route.extra["reasoning_effort"]
    elif "effort" in route.extra:
        settings_kwargs["openai_reasoning_effort"] = route.extra["effort"]
    if "reasoning" in route.extra:
        extra_body = dict(route.extra.get("extra_body") or {})
        extra_body["reasoning"] = route.extra["reasoning"]
        settings_kwargs["extra_body"] = extra_body
    elif "extra_body" in route.extra:
        settings_kwargs["extra_body"] = route.extra["extra_body"]
