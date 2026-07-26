"""Offline parsing coverage for free news/web intel providers."""

from ai.intel.free_intel import _parse_ddg_html, _parse_news_rss, _unwrap_ddg_href


def test_parse_news_rss_extracts_items() -> None:
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item>
        <title>Energy prices rise amid conflict</title>
        <link>https://news.google.com/rss/articles/abc</link>
        <description>Markets react to geopolitical risk.</description>
        <pubDate>Fri, 25 Jul 2026 01:00:00 GMT</pubDate>
        <source url="https://example.com">Example News</source>
      </item>
      <item>
        <title></title>
        <link>https://example.com/skip</link>
      </item>
    </channel></rss>
    """
    items = _parse_news_rss(xml, max_items=10)
    assert len(items) == 1
    assert items[0].title.startswith("Energy prices")
    assert items[0].url and "news.google.com" in items[0].url
    assert "geopolitical" in items[0].snippet


def test_parse_ddg_html_and_unwrap() -> None:
    href = _unwrap_ddg_href(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=1"
    )
    assert href == "https://example.com/page"

    html = """
    <div class="result">
      <a class="result__a" href="https://example.com/a">Example Title</a>
      <a class="result__snippet">A short snippet about risk.</a>
    </div>
    """
    items = _parse_ddg_html(html, max_items=5)
    assert len(items) == 1
    assert items[0].title == "Example Title"
    assert items[0].url == "https://example.com/a"
    assert "snippet" in items[0].snippet
