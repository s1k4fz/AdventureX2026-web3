from __future__ import annotations

import re
from typing import Literal

SkillId = Literal[
    "factor_analysis",
    "strategy_backtest",
    "full_system_task",
    "market_intelligence",
]

_PREFIX = re.compile(
    r"^\s*\[skill:\s*(factor_analysis|strategy_backtest|full_system_task|market_intelligence)\s*\]\s*",
    re.I,
)

_SKILLS: tuple[SkillId, ...] = (
    "factor_analysis",
    "strategy_backtest",
    "full_system_task",
    "market_intelligence",
)


def parse_skill_prefix(text: str) -> tuple[SkillId | None, str]:
    m = _PREFIX.match(text or "")
    if not m:
        return None, (text or "").strip()
    return m.group(1).lower(), text[m.end() :].strip()  # type: ignore[return-value]


def resolve_skill_heuristic(text: str) -> SkillId | None:
    t = (text or "").lower()
    if any(k in t for k in ("回测", "backtest", "策略净值", "sharpe")):
        return "strategy_backtest"
    if any(k in t for k in ("因子", "factor", "ic值", "因子表现")):
        return "factor_analysis"
    if any(
        k in t
        for k in ("投保", "保单", "差分", "polymarket", "对冲组合", "风险问卷")
    ):
        return "full_system_task"
    if any(k in t for k in ("情报", "worldmonitor", "新闻检索", "prediction market")):
        return "market_intelligence"
    return None


async def resolve_skill(text: str) -> tuple[SkillId, str]:
    """Return (skill, cleaned_user_text)."""
    prefixed, rest = parse_skill_prefix(text)
    if prefixed:
        return prefixed, rest
    hit = resolve_skill_heuristic(rest)
    if hit:
        return hit, rest
    # Flash fallback — only when heuristics miss
    from a2a_agent.deepseek_client import chat_text
    from core.config import settings

    raw = await chat_text(
        model=settings.deepseek_model_flash,
        system=(
            "Classify the user request into exactly one skill id: "
            + ", ".join(_SKILLS)
            + ". Reply with only the id."
        ),
        user=rest or text,
        max_tokens=32,
    )
    parts = raw.strip().split()
    skill = parts[0].lower() if parts else "factor_analysis"
    if skill not in _SKILLS:
        skill = "factor_analysis"  # safe default for review surface
    return skill, rest  # type: ignore[return-value]
