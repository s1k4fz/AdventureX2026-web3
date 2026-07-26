"""Free (no API key) news/web intel — Google News RSS + DuckDuckGo HTML.

Replaces paid Apify actors for policy source-collect subagents. Uses only
stdlib + httpx; no token / actor charge.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from html import unescape
from typing import Literal
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx

from ai.http_retry import request_with_retry
from ai.intel.types import IntelItem

logger = logging.getLogger("lemma.ai.intel.free")

IntelKind = Literal["news", "web"]

_USER_AGENT = (
    "Mozilla/5.0 (compatible; xEngine/1.0; +https://github.com/xengine-ai)"
)
_TAG_RE = re.compile(r"<[^>]+>")
_RESULT_BLOCK_RE = re.compile(
    r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
    r'.*?class="result__snippet"[^>]*>(.*?)</(?:a|td|div)>',
    re.S,
)


def _strip_html(raw: str) -> str:
    return unescape(_TAG_RE.sub("", raw or "")).strip()


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _domain(url: str | None) -> str | None:
    if not url:
        return None
    host = urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host or None


def _unwrap_ddg_href(href: str) -> str:
    """DuckDuckGo wraps outbound links as //duckduckgo.com/l/?uddg=..."""
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in (parsed.netloc or "") and parsed.path.startswith("/l"):
        qs = parse_qs(parsed.query)
        uddg = qs.get("uddg") or qs.get("u")
        if uddg and uddg[0]:
            return unquote(uddg[0])
    return href


def _news_rss_url(query: str) -> str:
    q = quote_plus(query.strip()[:200])
    if _has_cjk(query):
        return (
            f"https://news.google.com/rss/search?q={q}"
            f"&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
        )
    return (
        f"https://news.google.com/rss/search?q={q}"
        f"&hl=en-US&gl=US&ceid=US:en"
    )


def _parse_news_rss(xml_text: str, *, max_items: int) -> list[IntelItem]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise RuntimeError(f"google news rss parse failed: {exc}") from exc

    items: list[IntelItem] = []
    for node in root.findall(".//item"):
        title = (node.findtext("title") or "").strip()
        link = (node.findtext("link") or "").strip() or None
        desc = _strip_html(node.findtext("description") or "")
        pub = (node.findtext("pubDate") or "").strip() or None
        source_el = node.find("source")
        domain = None
        if source_el is not None:
            domain = (source_el.get("url") or "").strip() or None
            if not domain:
                domain = (source_el.text or "").strip() or None
            else:
                domain = _domain(domain) or domain
        if not title:
            continue
        items.append(
            IntelItem(
                title=title[:200],
                url=link,
                snippet=(desc or title)[:400],
                published_at=pub,
                source_domain=domain,
            )
        )
        if len(items) >= max_items:
            break
    return items


def _parse_ddg_html(html: str, *, max_items: int) -> list[IntelItem]:
    items: list[IntelItem] = []
    for match in _RESULT_BLOCK_RE.finditer(html):
        href = _unwrap_ddg_href(unescape(match.group(1)))
        title = _strip_html(match.group(2))
        snippet = _strip_html(match.group(3))
        if not title or not href:
            continue
        if href.startswith("/"):
            continue
        items.append(
            IntelItem(
                title=title[:200],
                url=href,
                snippet=snippet[:400],
                source_domain=_domain(href),
            )
        )
        if len(items) >= max_items:
            break
    return items


async def _fetch_news(query: str, *, max_items: int) -> list[IntelItem]:
    url = _news_rss_url(query)
    async with httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=True,
        headers={"User-Agent": _USER_AGENT, "Accept": "application/rss+xml,application/xml,text/xml,*/*"},
    ) as client:
        resp = await request_with_retry(client, "GET", url, attempts=3)
    if resp.status_code >= 400:
        raise RuntimeError(f"google news rss failed ({resp.status_code})")
    return _parse_news_rss(resp.text, max_items=max_items)


async def _fetch_web(query: str, *, max_items: int) -> list[IntelItem]:
    async with httpx.AsyncClient(
        timeout=20.0,
        follow_redirects=True,
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml",
        },
    ) as client:
        last_exc: Exception | None = None
        resp: httpx.Response | None = None
        for attempt in range(3):
            try:
                resp = await client.post(
                    "https://html.duckduckgo.com/html/",
                    data={"q": query.strip()[:200]},
                )
                if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                    continue
                break
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
                if attempt == 2:
                    raise RuntimeError(f"duckduckgo search transport error: {exc}") from exc
        if resp is None:
            raise RuntimeError(f"duckduckgo search transport error: {last_exc}")
    if resp.status_code >= 400:
        raise RuntimeError(f"duckduckgo search failed ({resp.status_code})")
    items = _parse_ddg_html(resp.text, max_items=max_items)
    if not items:
        logger.warning("duckduckgo returned no parseable results for %r", query[:80])
    return items


async def fetch_free_intel(
    kind: IntelKind, query: str, *, max_items: int = 10
) -> list[IntelItem]:
    q = (query or "").strip()
    if not q:
        return []
    limit = max(1, min(30, int(max_items)))
    if kind == "news":
        return await _fetch_news(q, max_items=limit)
    return await _fetch_web(q, max_items=limit)


async def fetch_free_news(query: str, *, max_items: int = 10) -> list[IntelItem]:
    return await fetch_free_intel("news", query, max_items=max_items)


async def fetch_free_web(query: str, *, max_items: int = 10) -> list[IntelItem]:
    return await fetch_free_intel("web", query, max_items=max_items)
