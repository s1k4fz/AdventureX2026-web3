"""Web intel subagent — Bocha primary, DuckDuckGo fallback."""

from __future__ import annotations

from ai.intel.collect import collect_web
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.types import Citation, SourceBrief

_PROVIDER_LABEL = {
    "bocha": "博查",
    "duckduckgo": "DuckDuckGo",
    "none": "无可用源",
}


class WebSubagent:
    kind = "web"

    async def run(self, ctx: SubagentContext) -> SourceBrief:
        await ctx.emit({"phase": "start", "summary": "正在检索网页（博查）"})

        async def on_progress(data: dict) -> None:
            await ctx.emit(data)

        try:
            result = await collect_web(
                ctx.goal, max_items=10, on_progress=on_progress
            )
        except Exception as exc:  # noqa: BLE001
            return SourceBrief(
                kind="web",
                status="failed",
                summary="网页检索失败（博查与降级均不可用）",
                error_code="web_intel_failed",
                error_message=str(exc)[:240],
                meta={"provider": "none", "query": ctx.goal[:160]},
            )

        provider_label = _PROVIDER_LABEL.get(result.provider, result.provider)
        citations = [
            Citation(
                title=item.title[:160],
                url=item.url,
                kind="web",
                snippet=item.snippet[:200],
            )
            for item in result.items[:8]
        ]
        meta = result.as_meta()
        if not result.items:
            return SourceBrief(
                kind="web",
                status="succeeded",
                summary=f"无相关网页（{provider_label}）",
                item_count=0,
                citations=[],
                meta=meta,
            )
        head = "；".join(i.title[:40] for i in result.items[:3])
        fallback_note = (
            f" · 降级自{_PROVIDER_LABEL.get(result.fallback_from or '', result.fallback_from)}"
            if result.fallback_from
            else ""
        )
        return SourceBrief(
            kind="web",
            status="succeeded",
            summary=(
                f"{len(result.items)} 条网页 · {provider_label}"
                f"{fallback_note} · {head}"
            )[:280],
            item_count=len(result.items),
            citations=citations,
            meta=meta,
        )
