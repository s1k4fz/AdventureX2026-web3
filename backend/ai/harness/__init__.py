"""Agent harness: proactive context assembly for chat / policy stage agents.

Keeps prompt ownership in templates while injecting live analysis factors
(WorldMonitor + optional notes) via `$analysis_context` placeholders.
All policy stages share the same workspace contract and variable set.
"""

from __future__ import annotations

import logging
from typing import Any

from ai.worldmonitor import fetch_world_context
from core.config import settings

logger = logging.getLogger("lemma.ai.harness")

_ANALYSIS_FACTORS = [
    "用户明确的风险事件与时间窗口",
    "风险偏好 / 保费预算 / 赔付弹性",
    "相关公开新闻与政策动态（优先 web_search）",
    "全球宏观与区域风险信号（WorldMonitor）",
    "预测市场流动性、价差与到期结构",
    "可否拆成可验证、可结算的市场假设",
]

_WORKSPACE_CONTRACT = (
    "产品布局：Agent Task 工作台 = 左侧阶段轨（Rail）+ 中央产物画布（Canvas）"
    "+ 底部指令栏（Command Dock）。问卷、市场检索、方案、出资确认都在画布中操作；"
    "活动与决策状态出现在阶段轨。用户可随时在 Dock 补充约束或改写目标；"
    "不要假设存在左侧独立对话主栏，也不要把长问卷/大表格堆进聊天气泡。"
)


def _format_analysis_factors() -> str:
    lines = ["【分析因素清单】"]
    for index, factor in enumerate(_ANALYSIS_FACTORS, start=1):
        lines.append(f"{index}. {factor}")
    return "\n".join(lines)


async def build_prompt_vars(
    *,
    include_world: bool = True,
    extra_notes: str | None = None,
    stage_hints: str | None = None,
    plan_summary: str | None = None,
    budget_note: str | None = None,
) -> dict[str, str]:
    """Assemble prompt variables for system templates."""
    blocks: list[str] = [_format_analysis_factors()]

    if include_world:
        try:
            ctx = await fetch_world_context()
            blocks.append(ctx.as_prompt_block())
            # as_prompt_block already carries served_by / health / error
            # attribution; when nothing served, nudge toward web_search so the
            # stage still has a timely-info path instead of a silent blind spot.
            if ctx.source == "unavailable":
                blocks.append(
                    "（WorldMonitor 全球情报当前不可用；如需时效信息，请在本阶段允许时"
                    "主动调用 web_search。）"
                )
        except Exception:
            logger.warning("harness: worldmonitor unavailable", exc_info=True)
            blocks.append(
                "【全球情报上下文 · WorldMonitor】\n"
                "当前不可用（拉取异常）。请在需要时效信息时主动调用 web_search（若本阶段允许）。"
            )

    if extra_notes and extra_notes.strip():
        blocks.append(extra_notes.strip())

    return {
        "analysis_context": "\n\n".join(blocks),
        "workspace_contract": _WORKSPACE_CONTRACT,
        "stage_hints": (stage_hints or "").strip() or "（无额外阶段提示）",
        "plan_summary": (plan_summary or "").strip() or "（计划摘要未提供）",
        "budget_note": (budget_note or "").strip() or "（预算未声明）",
    }


def coerce_web_search_args(args: dict[str, Any]) -> dict[str, Any]:
    """Loose FC args -> validated kwargs for WebSearchQuery."""
    query = str(args.get("query") or "").strip()
    freshness = str(args.get("freshness") or "noLimit").strip() or "noLimit"
    summary_raw = args.get("summary", True)
    if isinstance(summary_raw, str):
        summary = summary_raw.strip().lower() not in {"false", "0", "no"}
    else:
        summary = bool(summary_raw)
    default_count = int(getattr(settings, "bocha_default_count", 8) or 8)
    try:
        count = int(args.get("count") or default_count)
    except (TypeError, ValueError):
        count = default_count
    count = max(1, min(50, count))
    include = args.get("include")
    exclude = args.get("exclude")
    return {
        "query": query,
        "freshness": freshness,
        "summary": summary,
        "count": count,
        "include": str(include).strip() if include else None,
        "exclude": str(exclude).strip() if exclude else None,
    }
