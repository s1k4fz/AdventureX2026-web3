"""News intel subagent — Google News RSS primary, Bocha freshness fallback."""

from __future__ import annotations

from ai.intel.collect import collect_news
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.types import Citation, SourceBrief

_PROVIDER_LABEL = {
    "google_news_rss": "Google News",
    "bocha": "博查",
    "none": "无可用源",
}


class NewsSubagent:
    kind = "news"

    async def run(self, ctx: SubagentContext) -> SourceBrief:
        await ctx.emit({"phase": "start", "summary": "正在采集新闻（Google News）"})

        async def on_progress(data: dict) -> None:
            await ctx.emit(data)

        try:
            result = await collect_news(
                ctx.goal, max_items=10, on_progress=on_progress
            )
        except Exception as exc:  # noqa: BLE001
            return SourceBrief(
                kind="news",
                status="failed",
                summary="新闻检索失败",
                error_code="news_intel_failed",
                error_message=str(exc)[:240],
                meta={"provider": "none", "query": ctx.goal[:160]},
            )

        provider_label = _PROVIDER_LABEL.get(result.provider, result.provider)
        citations = [
            Citation(
                title=item.title[:160],
                url=item.url,
                kind="news",
                snippet=item.snippet[:200],
            )
            for item in result.items[:8]
        ]
        meta = result.as_meta()
        if not result.items:
            return SourceBrief(
                kind="news",
                status="skipped",
                summary="无相关新闻（已尝试 RSS 与博查降级）",
                item_count=0,
                citations=[],
                error_code="news_empty",
                meta=meta,
            )
        head = "；".join(i.title[:40] for i in result.items[:3])
        fallback_note = (
            f" · 降级自{_PROVIDER_LABEL.get(result.fallback_from or '', result.fallback_from)}"
            if result.fallback_from
            else ""
        )
        return SourceBrief(
            kind="news",
            status="succeeded",
            summary=(
                f"{len(result.items)} 条新闻 · {provider_label}"
                f"{fallback_note} · {head}"
            )[:280],
            item_count=len(result.items),
            citations=citations,
            meta=meta,
        )
