"""Bocha (博查) Web Search client — server-side only.

API key stays in Settings / env (BOCHA_API_KEY). Never ship to the browser.

Optimizations: shared AsyncClient, bounded TTL response cache, configurable
timeout + one transport retry, optional usage logging.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import OrderedDict
from typing import Any

import httpx

from ai.websearch.types import WebSearchQuery, WebSearchResponse, WebSearchResult
from core.config import settings

logger = logging.getLogger("lemma.ai.websearch")

_DEFAULT_BASE = "https://api.bocha.cn/v1/web-search"
_CACHE_MAXSIZE = 256

_client: httpx.AsyncClient | None = None
# key -> (expires_at_monotonic, response); LRU via OrderedDict move-to-end.
_cache: OrderedDict[str, tuple[float, WebSearchResponse]] = OrderedDict()


class WebSearchError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def _api_key() -> str:
    return (settings.bocha_api_key or "").strip()


def _endpoint() -> str:
    base = (settings.bocha_api_base_url or _DEFAULT_BASE).strip().rstrip("/")
    if base.endswith("/web-search"):
        return base
    return f"{base}/web-search"


def _timeout_s() -> float:
    return float(getattr(settings, "bocha_timeout_seconds", 12.0) or 12.0)


def _cache_ttl_s() -> float:
    return float(getattr(settings, "bocha_cache_ttl_seconds", 90) or 90)


def _default_count() -> int:
    return int(getattr(settings, "bocha_default_count", 8) or 8)


def _cache_maxsize() -> int:
    return int(getattr(settings, "bocha_cache_maxsize", _CACHE_MAXSIZE) or _CACHE_MAXSIZE)


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=_timeout_s())
    return _client


async def close_websearch_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def clear_websearch_cache() -> None:
    _cache.clear()


def _cache_key(query: WebSearchQuery) -> str:
    raw = json.dumps(
        {
            "q": query.query.strip(),
            "freshness": query.freshness or "noLimit",
            "count": query.count,
            "summary": bool(query.summary),
            "include": query.include or "",
            "exclude": query.exclude or "",
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_get(key: str) -> WebSearchResponse | None:
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is None:
        return None
    expires_at, payload = cached
    if expires_at <= now:
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return payload


def _cache_put(key: str, payload: WebSearchResponse, ttl: float) -> None:
    if ttl <= 0:
        return
    _cache[key] = (time.monotonic() + ttl, payload)
    _cache.move_to_end(key)
    maxsize = max(1, _cache_maxsize())
    while len(_cache) > maxsize:
        _cache.popitem(last=False)


def _pick_str(data: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_page(item: dict[str, Any]) -> WebSearchResult | None:
    title = _pick_str(item, "name", "title") or ""
    url = _pick_str(item, "url", "displayUrl") or ""
    if not title or not url:
        return None
    return WebSearchResult(
        title=title,
        url=url,
        snippet=_pick_str(item, "snippet", "description"),
        summary=_pick_str(item, "summary"),
        site_name=_pick_str(item, "siteName", "site_name"),
        site_icon=_pick_str(item, "siteIcon", "site_icon", "favicon"),
        published_at=_pick_str(item, "datePublished", "dateLastCrawled", "publishedAt"),
        image_url=_pick_str(item, "imageUrl", "thumbnailUrl", "image"),
    )


def _extract_pages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if isinstance(data, dict):
        web_pages = data.get("webPages")
        if isinstance(web_pages, dict):
            value = web_pages.get("value")
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        results = data.get("results")
        if isinstance(results, list):
            return [item for item in results if isinstance(item, dict)]
    web_pages = payload.get("webPages")
    if isinstance(web_pages, dict):
        value = web_pages.get("value")
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


async def _post_once(body: dict[str, Any], headers: dict[str, str]) -> httpx.Response:
    client = await _get_client()
    return await client.post(_endpoint(), headers=headers, json=body)


async def web_search(query: WebSearchQuery) -> WebSearchResponse:
    """Call Bocha Web Search and normalize into WebSearchResponse."""
    key = _api_key()
    if not key:
        raise WebSearchError("BOCHA_API_KEY is not configured")

    # Prefer caller count; otherwise apply internal default (schema stays 10).
    count = max(1, min(50, int(query.count if query.count is not None else _default_count())))
    normalized = query.model_copy(update={"count": count})

    cache_key = _cache_key(normalized)
    hit = _cache_get(cache_key)
    if hit is not None:
        return hit

    body: dict[str, Any] = {
        "query": normalized.query.strip(),
        "summary": bool(normalized.summary),
        "freshness": normalized.freshness or "noLimit",
        "count": count,
    }
    if normalized.include:
        body["include"] = normalized.include
    if normalized.exclude:
        body["exclude"] = normalized.exclude

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    last_exc: Exception | None = None
    resp: httpx.Response | None = None
    for attempt in range(2):
        try:
            resp = await _post_once(body, headers)
            break
        except httpx.TimeoutException as exc:
            last_exc = exc
            if attempt == 0:
                continue
            raise WebSearchError("bocha web search timed out") from exc
        except httpx.HTTPError as exc:
            last_exc = exc
            if attempt == 0:
                continue
            raise WebSearchError(f"bocha web search transport error: {exc}") from exc
    if resp is None:
        raise WebSearchError(f"bocha web search transport error: {last_exc}")

    if resp.status_code >= 400:
        logger.warning(
            "bocha web search failed status=%s body=%s",
            resp.status_code,
            resp.text[:400],
        )
        raise WebSearchError(
            f"bocha web search failed ({resp.status_code})",
            status_code=resp.status_code,
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise WebSearchError("bocha web search returned non-JSON") from exc

    if not isinstance(payload, dict):
        raise WebSearchError("bocha web search returned unexpected payload")

    pages = _extract_pages(payload)
    results: list[WebSearchResult] = []
    for page in pages:
        normalized_page = _normalize_page(page)
        if normalized_page is not None:
            results.append(normalized_page)

    response = WebSearchResponse(
        query=normalized.query,
        freshness=normalized.freshness,
        count=len(results),
        results=results,
        raw={"code": payload.get("code"), "msg": payload.get("msg")},
    )
    _cache_put(cache_key, response, _cache_ttl_s())

    try:
        from ai.markets.usage import record_provider_call  # noqa: PLC0415

        await record_provider_call(
            trace_id=cache_key[:16],
            provider="bocha",
            platform="web",
            use_case="web_search",
            success=True,
            latency_ms=0,
            result_count=len(results),
        )
    except Exception:  # noqa: BLE001 — usage is best-effort
        logger.debug("web_search usage log skipped", exc_info=True)

    return response
