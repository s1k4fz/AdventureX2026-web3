"""News/web intel collectors with provider degradation (no Apify).

Web:  Bocha (博查) → DuckDuckGo HTML
News: Google News RSS → Bocha (freshness window)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ai.intel.free_intel import fetch_free_news, fetch_free_web
from ai.intel.types import IntelItem
from ai.websearch import WebSearchError, WebSearchQuery, web_search
from core.config import settings

logger = logging.getLogger("lemma.ai.intel.collect")

ProgressFn = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class IntelFetchResult:
    items: list[IntelItem]
    provider: str
    query: str
    latency_ms: int = 0
    fallback_from: str | None = None
    attempts: list[dict[str, Any]] = field(default_factory=list)

    def as_meta(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "fallbackFrom": self.fallback_from,
            "query": self.query[:160],
            "latencyMs": self.latency_ms,
            "resultCount": len(self.items),
            "attempts": self.attempts,
        }


def _bocha_configured() -> bool:
    return bool((settings.bocha_api_key or "").strip())


async def _emit(on_progress: ProgressFn | None, payload: dict[str, Any]) -> None:
    if on_progress is None:
        return
    try:
        await on_progress(payload)
    except Exception:  # noqa: BLE001
        logger.debug("intel progress emit failed", exc_info=True)


async def _fetch_bocha(
    query: str,
    *,
    max_items: int,
    freshness: str,
) -> list[IntelItem]:
    response = await web_search(
        WebSearchQuery(
            query=query[:200],
            count=max_items,
            summary=True,
            freshness=freshness,
        )
    )
    items: list[IntelItem] = []
    for row in response.results[:max_items]:
        snippet = (row.summary or row.snippet or "").strip()
        items.append(
            IntelItem(
                title=(row.title or "")[:200] or "untitled",
                url=row.url,
                snippet=snippet[:400],
                published_at=row.published_at,
                source_domain=row.site_name,
            )
        )
    return items


async def collect_web(
    query: str,
    *,
    max_items: int = 10,
    on_progress: ProgressFn | None = None,
) -> IntelFetchResult:
    q = (query or "").strip()
    started = time.perf_counter()
    attempts: list[dict[str, Any]] = []
    limit = max(1, min(30, int(max_items)))

    if not q:
        return IntelFetchResult(items=[], provider="none", query="", attempts=[])

    if _bocha_configured():
        await _emit(
            on_progress,
            {"phase": "bocha", "summary": "正在通过博查检索网页"},
        )
        try:
            items = await _fetch_bocha(q, max_items=limit, freshness="noLimit")
            attempts.append(
                {"provider": "bocha", "ok": True, "count": len(items)}
            )
            if items:
                return IntelFetchResult(
                    items=items,
                    provider="bocha",
                    query=q,
                    latency_ms=int((time.perf_counter() - started) * 1000),
                    attempts=attempts,
                )
            attempts[-1]["ok"] = False
            attempts[-1]["error"] = "empty"
        except WebSearchError as exc:
            attempts.append(
                {"provider": "bocha", "ok": False, "error": str(exc)[:160]}
            )
            logger.warning("bocha web intel failed: %s", exc)
        except Exception as exc:  # noqa: BLE001
            attempts.append(
                {"provider": "bocha", "ok": False, "error": str(exc)[:160]}
            )
            logger.warning("bocha web intel crashed: %s", exc)
    else:
        attempts.append(
            {
                "provider": "bocha",
                "ok": False,
                "error": "BOCHA_API_KEY unset",
                "skipped": True,
            }
        )

    await _emit(
        on_progress,
        {"phase": "fallback", "summary": "博查不可用，降级 DuckDuckGo"},
    )
    try:
        items = await fetch_free_web(q, max_items=limit)
        attempts.append(
            {"provider": "duckduckgo", "ok": bool(items), "count": len(items)}
        )
        if not items:
            attempts[-1]["error"] = "empty"
        return IntelFetchResult(
            items=items,
            provider="duckduckgo",
            query=q,
            latency_ms=int((time.perf_counter() - started) * 1000),
            fallback_from="bocha",
            attempts=attempts,
        )
    except Exception as exc:  # noqa: BLE001
        attempts.append(
            {"provider": "duckduckgo", "ok": False, "error": str(exc)[:160]}
        )
        raise RuntimeError(
            f"web intel exhausted: bocha+duckduckgo failed ({exc})"
        ) from exc


async def collect_news(
    query: str,
    *,
    max_items: int = 10,
    on_progress: ProgressFn | None = None,
) -> IntelFetchResult:
    q = (query or "").strip()
    started = time.perf_counter()
    attempts: list[dict[str, Any]] = []
    limit = max(1, min(30, int(max_items)))

    if not q:
        return IntelFetchResult(items=[], provider="none", query="", attempts=[])

    await _emit(
        on_progress,
        {"phase": "google_news", "summary": "正在拉取 Google News RSS"},
    )
    try:
        items = await fetch_free_news(q, max_items=limit)
        attempts.append(
            {"provider": "google_news_rss", "ok": bool(items), "count": len(items)}
        )
        if items:
            return IntelFetchResult(
                items=items,
                provider="google_news_rss",
                query=q,
                latency_ms=int((time.perf_counter() - started) * 1000),
                attempts=attempts,
            )
        attempts[-1]["error"] = "empty"
    except Exception as exc:  # noqa: BLE001
        attempts.append(
            {
                "provider": "google_news_rss",
                "ok": False,
                "error": str(exc)[:160],
            }
        )
        logger.warning("google news rss failed: %s", exc)

    if _bocha_configured():
        await _emit(
            on_progress,
            {"phase": "fallback", "summary": "新闻 RSS 无结果，降级博查近一周"},
        )
        try:
            items = await _fetch_bocha(q, max_items=limit, freshness="oneWeek")
            attempts.append(
                {"provider": "bocha", "ok": bool(items), "count": len(items)}
            )
            return IntelFetchResult(
                items=items,
                provider="bocha",
                query=q,
                latency_ms=int((time.perf_counter() - started) * 1000),
                fallback_from="google_news_rss",
                attempts=attempts,
            )
        except Exception as exc:  # noqa: BLE001
            attempts.append(
                {"provider": "bocha", "ok": False, "error": str(exc)[:160]}
            )
            logger.warning("bocha news fallback failed: %s", exc)
    else:
        attempts.append(
            {
                "provider": "bocha",
                "ok": False,
                "error": "BOCHA_API_KEY unset",
                "skipped": True,
            }
        )

    # Soft empty rather than hard fail — synthesizer can still run.
    return IntelFetchResult(
        items=[],
        provider="none",
        query=q,
        latency_ms=int((time.perf_counter() - started) * 1000),
        fallback_from="google_news_rss",
        attempts=attempts,
    )
