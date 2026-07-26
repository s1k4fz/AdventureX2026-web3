"""PandaAI financial-data intel subagent (switchable via settings)."""

from __future__ import annotations

from ai.pandaai import fetch_panda_context, is_pandaai_enabled
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.types import Citation, SourceBrief


class PandaAISubagent:
    kind = "pandaai"

    async def run(self, ctx: SubagentContext) -> SourceBrief:
        if not is_pandaai_enabled():
            return SourceBrief(
                kind="pandaai",
                status="skipped",
                summary="PandaAI 未启用",
                error_code="pandaai_disabled",
                meta={"provider": "pandaai", "enabled": False},
            )

        await ctx.emit({"phase": "start", "summary": "正在拉取 PandaAI 金融数据"})
        try:
            snap = await fetch_panda_context()
        except Exception as exc:  # noqa: BLE001
            return SourceBrief(
                kind="pandaai",
                status="failed",
                summary="PandaAI 不可用",
                error_code="pandaai_unavailable",
                error_message=str(exc)[:240],
                meta={"provider": "pandaai"},
            )

        if snap.source == "disabled":
            return SourceBrief(
                kind="pandaai",
                status="skipped",
                summary="PandaAI 未启用",
                error_code="pandaai_disabled",
                meta=snap.as_meta(),
            )

        if snap.source != "pandaai":
            return SourceBrief(
                kind="pandaai",
                status="failed",
                summary="PandaAI 无可用快照",
                error_code="pandaai_unavailable",
                error_message=snap.error or "unavailable",
                meta=snap.as_meta(),
            )

        citations: list[Citation] = []
        for sig in snap.signals[:8]:
            citations.append(
                Citation(
                    title=f"{sig.label}: {sig.value}",
                    kind="pandaai",
                    snippet=(sig.detail or sig.as_of or "")[:160],
                )
            )

        return SourceBrief(
            kind="pandaai",
            status="succeeded",
            summary=(snap.summary or f"{len(snap.signals)} 条金融信号")[:280],
            item_count=len(snap.signals),
            citations=citations,
            meta=snap.as_meta(),
        )
