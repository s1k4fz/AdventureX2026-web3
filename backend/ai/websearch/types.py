"""Bocha (博查) Web Search boundary types.

These shapes leave ai/websearch/ and are safe for tool responses / UI cards.
Provider raw payloads stay in `raw` and are never required by callers.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WebSearchQuery(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    summary: bool = True
    freshness: str = "noLimit"
    count: int = Field(default=10, ge=1, le=50)
    include: str | None = None
    exclude: str | None = None


class WebSearchResult(BaseModel):
    title: str
    url: str
    snippet: str | None = None
    summary: str | None = None
    site_name: str | None = None
    site_icon: str | None = None
    published_at: str | None = None
    image_url: str | None = None


class WebSearchResponse(BaseModel):
    query: str
    freshness: str
    count: int
    results: list[WebSearchResult] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)

    def as_tool_payload(self) -> dict[str, Any]:
        """Compact payload for the model + a camelCase card for the UI."""
        items = [
            {
                "title": item.title,
                "url": item.url,
                "snippet": item.snippet,
                "summary": item.summary,
                "siteName": item.site_name,
                "siteIcon": item.site_icon,
                "publishedAt": item.published_at,
                "imageUrl": item.image_url,
            }
            for item in self.results
        ]
        return {
            "status": "ok",
            "query": self.query,
            "freshness": self.freshness,
            "count": len(items),
            "results": items,
        }

    def as_card(self) -> dict[str, Any]:
        payload = self.as_tool_payload()
        return {
            "type": "web_search",
            "query": payload["query"],
            "freshness": payload["freshness"],
            "count": payload["count"],
            "results": payload["results"],
        }
