"""Offline coverage for Bocha / free intel degradation."""

from __future__ import annotations

import pytest

from ai.intel.collect import collect_news, collect_web
from ai.intel.types import IntelItem
from ai.websearch import WebSearchError, WebSearchResponse, WebSearchResult


@pytest.mark.asyncio
async def test_collect_web_uses_bocha_when_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai.intel import collect as collect_mod

    monkeypatch.setattr(collect_mod.settings, "bocha_api_key", "test-key")

    async def fake_bocha(query, *, max_items, freshness):  # noqa: ANN001
        assert freshness == "noLimit"
        return [
            IntelItem(
                title="Bocha hit",
                url="https://example.com/a",
                snippet="from bocha",
            )
        ]

    async def fail_ddg(*_a, **_k):  # noqa: ANN001
        raise AssertionError("ddg should not run when bocha returns items")

    monkeypatch.setattr(collect_mod, "_fetch_bocha", fake_bocha)
    monkeypatch.setattr(collect_mod, "fetch_free_web", fail_ddg)

    result = await collect_web("energy risk", max_items=5)
    assert result.provider == "bocha"
    assert result.fallback_from is None
    assert len(result.items) == 1
    assert result.as_meta()["resultCount"] == 1


@pytest.mark.asyncio
async def test_collect_web_falls_back_to_duckduckgo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai.intel import collect as collect_mod

    monkeypatch.setattr(collect_mod.settings, "bocha_api_key", "test-key")

    async def boom_bocha(*_a, **_k):  # noqa: ANN001
        raise WebSearchError("bocha down", status_code=503)

    async def fake_ddg(query, *, max_items=10):  # noqa: ANN001
        return [
            IntelItem(
                title="DDG hit",
                url="https://example.com/b",
                snippet="fallback",
            )
        ]

    monkeypatch.setattr(collect_mod, "_fetch_bocha", boom_bocha)
    monkeypatch.setattr(collect_mod, "fetch_free_web", fake_ddg)

    phases: list[str] = []

    async def on_progress(data):  # noqa: ANN001
        phases.append(str(data.get("phase") or ""))

    result = await collect_web("energy risk", on_progress=on_progress)
    assert result.provider == "duckduckgo"
    assert result.fallback_from == "bocha"
    assert any(p == "fallback" for p in phases)


@pytest.mark.asyncio
async def test_collect_news_falls_back_to_bocha(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai.intel import collect as collect_mod

    monkeypatch.setattr(collect_mod.settings, "bocha_api_key", "test-key")

    async def empty_rss(*_a, **_k):  # noqa: ANN001
        return []

    async def fake_bocha(query, *, max_items, freshness):  # noqa: ANN001
        assert freshness == "oneWeek"
        return [
            IntelItem(
                title="News via Bocha",
                url="https://example.com/n",
                snippet="week",
            )
        ]

    monkeypatch.setattr(collect_mod, "fetch_free_news", empty_rss)
    monkeypatch.setattr(collect_mod, "_fetch_bocha", fake_bocha)

    result = await collect_news("oil geopolitics")
    assert result.provider == "bocha"
    assert result.fallback_from == "google_news_rss"
    assert result.items[0].title.startswith("News")


@pytest.mark.asyncio
async def test_fetch_bocha_maps_websearch_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from ai.intel import collect as collect_mod

    async def fake_web_search(query):  # noqa: ANN001
        return WebSearchResponse(
            query=query.query,
            freshness=query.freshness,
            count=1,
            results=[
                WebSearchResult(
                    title="Mapped",
                    url="https://example.com/m",
                    snippet="s",
                    summary="long summary",
                    site_name="Example",
                )
            ],
        )

    monkeypatch.setattr(collect_mod, "web_search", fake_web_search)
    items = await collect_mod._fetch_bocha(
        "q", max_items=3, freshness="oneWeek"
    )
    assert items[0].title == "Mapped"
    assert items[0].snippet == "long summary"
    assert items[0].source_domain == "Example"
