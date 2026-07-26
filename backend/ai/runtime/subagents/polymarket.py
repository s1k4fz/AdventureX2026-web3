"""Polymarket market-search subagent (hard gate for the collect stage).

Loop exploration is intentionally bounded. Gamma requests have a multi-second
tail, so an unbounded quality chase quickly turns an empty market into a
minute-long frozen workflow. The questionnaire-driven refined pass can still
add supply before compose when the first pool is small.
"""

from __future__ import annotations

from ai.policygen.market_search import (
    SearchCancelled,
    search_markets_for_need_report,
)
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.types import Citation, KIND_LABELS, SourceBrief

_MAX_EXPLORE_ROUNDS = 2


def _intel_context_block(briefs: list[SourceBrief]) -> str:
    """Build an analysis_context block from prior intel source briefs.

    This text is injected into the market_search prompt template's
    $analysis_context slot so the LLM query-expansion can see news/web/WM
    signals and generate better Polymarket keywords.
    """
    if not briefs:
        return ""
    lines: list[str] = ["【多源情报上下文】"]
    for brief in briefs:
        if brief.status == "failed" and not brief.citations:
            continue
        label = KIND_LABELS.get(brief.kind, brief.kind)  # type: ignore[arg-type]
        lines.append(f"## {label}（{brief.status}）")
        if brief.summary:
            lines.append(brief.summary[:280])
        for cite in brief.citations[:5]:
            url_part = f" {cite.url}" if cite.url else ""
            lines.append(f"- {cite.title[:120]}{url_part}")
            if cite.snippet:
                lines.append(f"  {cite.snippet[:160]}")
    return "\n".join(lines) if len(lines) > 1 else ""


def _retry_context_block(tried_queries: list[list[str]], round_num: int) -> str:
    """Build a retry hint injected into analysis_context on rounds 2+.

    Tells the LLM which keywords already failed so it generates completely
    different angles / synonyms / broader concepts.
    """
    lines = [
        f"\n\n【重试提示 · 第 {round_num} 轮】",
        "以下关键词已在前几轮搜索中尝试过，但在 Polymarket 上找不到任何匹配结果：",
    ]
    for i, queries in enumerate(tried_queries, 1):
        lines.append(f"  第 {i} 轮：{', '.join(queries)}")
    lines.append(
        "请用完全不同的角度、更广泛的上层概念、或更具体的事件名称生成新关键词。"
        "考虑：相关政策议题、相关人物、上游/下游事件、英文同义词/缩写、"
        "或平台上常见的事件别名。绝对不要重复已失败的关键词。"
    )
    return "\n".join(lines)


class PolymarketSubagent:
    kind = "polymarket"

    async def run(self, ctx: SubagentContext) -> SourceBrief:
        await ctx.emit({"phase": "start", "summary": "正在检索预测市场"})

        async def on_progress(data: dict) -> None:
            await ctx.emit(
                {"phase": data.get("phase") or "keyword_search", **data}
            )

        # Prior briefs are optional: the orchestrator starts this market fast
        # path alongside intel collection. Callers that already have briefs can
        # still provide them, but market discovery never waits on them.
        base_prompt_vars = dict(ctx.prompt_vars or {})
        intel_block = _intel_context_block(ctx.prior_briefs)
        if intel_block:
            existing = (base_prompt_vars.get("analysis_context") or "").strip()
            base_prompt_vars["analysis_context"] = (
                f"{existing}\n\n{intel_block}".strip() if existing else intel_block
            )

        # Loop exploration: retry with accumulated failure context until we
        # find candidates or exhaust _MAX_EXPLORE_ROUNDS.
        tried_queries: list[list[str]] = []
        last_report = None

        for round_num in range(1, _MAX_EXPLORE_ROUNDS + 1):
            if ctx.is_cancelled and await ctx.is_cancelled():
                raise SearchCancelled()

            prompt_vars = dict(base_prompt_vars)
            if round_num > 1:
                retry_block = _retry_context_block(tried_queries, round_num)
                existing_ctx = (prompt_vars.get("analysis_context") or "").strip()
                prompt_vars["analysis_context"] = (
                    f"{existing_ctx}{retry_block}" if existing_ctx else retry_block.strip()
                )
                await ctx.emit({
                    "phase": "retry",
                    "round": round_num,
                    "summary": f"第 {round_num} 轮探索，正在尝试不同角度的关键词",
                    "triedQueries": tried_queries,
                })

            try:
                report = await search_markets_for_need_report(
                    ctx.goal,
                    coverage_end=None,
                    policy_id=ctx.policy_id,
                    prompt_vars=prompt_vars or None,
                    is_cancelled=ctx.is_cancelled,
                    on_progress=on_progress,
                )
            except SearchCancelled:
                raise
            except Exception as exc:  # noqa: BLE001
                # Infrastructure failure — no point retrying with different keywords.
                return SourceBrief(
                    kind="polymarket",
                    status="failed",
                    summary="预测市场检索失败",
                    error_code="market_provider_unavailable",
                    error_message=str(exc)[:240],
                )

            last_report = report
            if report.candidates:
                # Found matches — exit loop.
                break

            # Record which keywords were tried for the next round's context.
            tried_queries.append(list(report.keywords))
            await ctx.emit({
                "phase": "explore_miss",
                "round": round_num,
                "summary": (
                    f"第 {round_num} 轮未命中"
                    + (
                        f"，尝试了 {len(report.keywords)} 个关键词"
                        if report.keywords
                        else ""
                    )
                ),
                "keywords": report.keywords,
                # Dual-write for older clients.
                "queries": report.keywords,
            })

        # Use the final report (either with candidates or the last failed one).
        report = last_report
        if report is None:
            return SourceBrief(
                kind="polymarket",
                status="failed",
                summary="预测市场检索失败",
                error_code="market_provider_unavailable",
                error_message="搜索未产出报告",
            )

        ctx.shared["market_report"] = report
        ctx.shared["candidates"] = report.candidates
        count = len(report.candidates)
        citations = [
            Citation(
                title=c.question[:160],
                url=c.url,
                kind="polymarket",
                snippet=(c.category or "")[:120],
            )
            for c in report.candidates[:8]
        ]
        if count == 0:
            # Exhausted all rounds — ask user for more specific input.
            all_tried = [q for batch in tried_queries for q in batch]
            return SourceBrief(
                kind="polymarket",
                status="failed",
                summary=(
                    f"连续 {_MAX_EXPLORE_ROUNDS} 轮探索未找到匹配的预测市场，"
                    "请尝试提供更具体的风险描述或关键词"
                ),
                item_count=0,
                citations=citations,
                meta={
                    "reason": report.reason,
                    "status": report.status,
                    "keywords": report.keywords,
                    "queries": report.keywords,
                    "allTriedKeywords": all_tried,
                    "allTriedQueries": all_tried,
                    "roundsAttempted": _MAX_EXPLORE_ROUNDS,
                },
                error_code="policy_search_empty",
                error_message=(
                    f"已尝试 {_MAX_EXPLORE_ROUNDS} 轮不同角度的关键词均未命中，"
                    "请补充更具体的风险场景或英文关键词"
                ),
            )

        platforms: dict[str, int] = {}
        for c in report.candidates:
            key = (c.platform.value if hasattr(c.platform, "value") else str(c.platform))
            platforms[key] = platforms.get(key, 0) + 1
        plat_label = " · ".join(f"{k} {v}" for k, v in platforms.items())
        rounds_note = f" · 第 {len(tried_queries) + 1} 轮命中" if tried_queries else ""
        return SourceBrief(
            kind="polymarket",
            status="succeeded",
            summary=f"候选 {count} 个（{plat_label}）{rounds_note}",
            item_count=count,
            citations=citations,
            meta={
                "reason": report.reason,
                "status": report.status,
                "keywords": report.keywords,
                "queries": report.keywords,
                "platforms": platforms,
                "roundsAttempted": len(tried_queries) + 1,
            },
        )
