"""Final synthesizer subagent — StepFun Anthropic brief over prior sources."""

from __future__ import annotations

import logging

from ai.client import ai_client
from ai.errors import AIError
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.types import (
    KIND_LABELS,
    Citation,
    SourceBrief,
    SynthesizerOutput,
)
from ai.types import AIUseCase

logger = logging.getLogger("lemma.ai.runtime.subagents.synthesizer")


def _materials_block(briefs: list[SourceBrief]) -> str:
    lines: list[str] = []
    for brief in briefs:
        label = KIND_LABELS.get(brief.kind, brief.kind)  # type: ignore[arg-type]
        lines.append(f"## {label} ({brief.status})")
        if brief.summary:
            lines.append(brief.summary)
        for cite in brief.citations[:5]:
            url = f" {cite.url}" if cite.url else ""
            lines.append(f"- {cite.title}{url}")
            if cite.snippet:
                lines.append(f"  {cite.snippet[:160]}")
    return "\n".join(lines) if lines else "（无可用分源材料）"


class SynthesizerSubagent:
    kind = "synthesizer"

    async def run(self, ctx: SubagentContext) -> SourceBrief:
        await ctx.emit({"phase": "start", "summary": "正在汇总多源情报"})
        priors = list(ctx.prior_briefs)
        citations: list[Citation] = []
        for brief in priors:
            citations.extend(brief.citations[:4])

        prompt = (
            f"风险诉求：{ctx.goal}\n\n"
            f"分源材料：\n{_materials_block(priors)}\n\n"
            "请输出面向保障组合编排的中文情报 brief（5–12 行），"
            "突出时效事件、宏观/地缘信号与可投保市场线索的交叉；"
            "不要编造未出现的 URL。"
        )
        try:
            output = await ai_client.generate(
                AIUseCase.SOURCE_BRIEF,
                prompt,
                SynthesizerOutput,
            )
            text = (output.brief or "").strip()
            if output.highlights:
                extra = "；".join(h.strip() for h in output.highlights[:5] if h.strip())
                if extra:
                    text = f"{text}\n要点：{extra}".strip()
        except AIError as exc:
            logger.warning("synthesizer LLM failed: %s", exc.message)
            return SourceBrief(
                kind="synthesizer",
                status="failed",
                summary="情报汇总失败，将使用分源摘要",
                item_count=len(priors),
                citations=citations[:12],
                error_code=exc.code,
                error_message=exc.message[:240],
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("synthesizer failed", exc_info=True)
            return SourceBrief(
                kind="synthesizer",
                status="failed",
                summary="情报汇总失败，将使用分源摘要",
                item_count=len(priors),
                citations=citations[:12],
                error_code="source_brief_failed",
                error_message=str(exc)[:240],
            )

        if not text:
            # Fallback: concatenate prior summaries.
            text = "\n".join(
                f"- {KIND_LABELS.get(b.kind, b.kind)}：{b.summary}"  # type: ignore[arg-type]
                for b in priors
                if b.summary
            )

        return SourceBrief(
            kind="synthesizer",
            status="succeeded",
            summary=text[:280],
            item_count=len(priors),
            citations=citations[:12],
            meta={"brief": text},
        )
