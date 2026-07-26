"""WorldMonitor snapshot subagent."""

from __future__ import annotations

from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.types import Citation, SourceBrief
from ai.worldmonitor import fetch_world_context


class WorldMonitorSubagent:
    kind = "world_monitor"

    async def run(self, ctx: SubagentContext) -> SourceBrief:
        await ctx.emit({"phase": "start", "summary": "正在拉取全球情报"})
        try:
            world = await fetch_world_context()
        except Exception as exc:  # noqa: BLE001
            return SourceBrief(
                kind="world_monitor",
                status="failed",
                summary="WorldMonitor 不可用",
                error_code="worldmonitor_unavailable",
                error_message=str(exc)[:240],
            )

        if world.source == "unavailable":
            return SourceBrief(
                kind="world_monitor",
                status="failed",
                summary="WorldMonitor 无可用快照",
                error_code="worldmonitor_unavailable",
                error_message=world.error or "unavailable",
            )

        citations: list[Citation] = []
        for sig in (world.top_risks or [])[:3]:
            citations.append(
                Citation(
                    title=f"{sig.label}: {sig.value}",
                    kind="world_monitor",
                    snippet=(sig.detail or "")[:160],
                )
            )
        for sig in (world.signals or [])[:5]:
            citations.append(
                Citation(
                    title=f"[{sig.kind}] {sig.label}: {sig.value}",
                    kind="world_monitor",
                    snippet=(sig.detail or "")[:160],
                )
            )

        summary_parts = []
        if world.summary:
            summary_parts.append(world.summary[:180])
        if world.fear_greed is not None:
            label = world.fear_greed_label or ""
            summary_parts.append(f"Fear&Greed {world.fear_greed}/100 {label}".strip())
        summary_parts.append(f"新鲜度 {world.freshness} · {world.source}")
        return SourceBrief(
            kind="world_monitor",
            status="succeeded",
            summary=" · ".join(summary_parts)[:280],
            item_count=len(world.signals or []) + len(world.top_risks or []),
            citations=citations[:8],
            meta={
                "freshness": world.freshness,
                "source": world.source,
                "servedBy": world.served_by,
                "fearGreed": world.fear_greed,
            },
        )
