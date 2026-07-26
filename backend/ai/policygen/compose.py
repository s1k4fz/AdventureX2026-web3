"""选标的 + 组织（搜索前置的核心 AI 步）：候选池 + 问卷答案 → ResolvedPortfolioSet。"""

import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime

from ai.client import ai_client
from ai.errors import AIError
from ai.markets.types import MarketCandidate
from ai.policygen.ranking import rank
from ai.policygen.types import (
    ComposedPortfolio,
    ComposedPosition,
    PortfolioSet,
    ResolvedPortfolio,
    ResolvedPortfolioSet,
    ResolvedPosition,
    RiskFactorCategory,
)
from ai.types import AIUseCase, StructuredStreamEvent

logger = logging.getLogger("lemma.ai.policygen")

_COMPOSE_TOP_K = 40
_TIER_ORDER = ("conservative", "balanced", "aggressive")
_MAX_EVENT_WEIGHT_BPS = 4000
_EXTREME_LOW_BPS = 300
_EXTREME_HIGH_BPS = 9700
_MIN_FACTOR_CATEGORIES = 2
_MIN_MARKET_CATEGORIES = 2


def candidate_ref(candidate: MarketCandidate) -> str:
    return candidate.condition_id


def _concern_keywords(answers: dict[str, str] | None) -> list[str]:
    """Extract free-text concern signals from questionnaire answers for ranking."""
    if not answers:
        return []
    keys = ("concern-dimension", "concern_dimension", "risk-dimension", "focus")
    out: list[str] = []
    for key, value in answers.items():
        slug = key.lower().replace("_", "-")
        if slug in keys or "concern" in slug or "dimension" in slug:
            for part in str(value).replace("，", ",").replace("/", ",").split(","):
                token = part.strip()
                if token:
                    out.append(token)
    return out


def _compose_prompt(
    need: str,
    answers: dict[str, str] | None,
    coverage_end: datetime | None,
    ranked: list[MarketCandidate],
    *,
    world_context_block: str | None = None,
    stage_hints_block: str | None = None,
    plan_summary: str | None = None,
) -> str:
    listing = "\n".join(_format_candidate(candidate) for candidate in ranked)
    coverage = coverage_end.isoformat() if coverage_end else "未指定"
    world_block = (
        f"{world_context_block.strip()}\n\n" if world_context_block else ""
    )
    hints_block = (
        f"{stage_hints_block.strip()}\n\n" if stage_hints_block else ""
    )
    plan_block = f"{plan_summary.strip()}\n\n" if plan_summary else ""
    return (
        f"【Constraints】\n"
        f"风险诉求：{need}\n"
        f"问卷画像：{_format_profile(answers)}\n"
        f"保障期限截止：{coverage}\n\n"
        f"{plan_block}"
        f"{hints_block}"
        f"{world_block}"
        f"【Candidates】\n"
        f"候选市场清单（每条以 ref=<conditionId> 开头，绑定头寸时 market_ref 必须用该 ref）：\n"
        f"{listing}\n\n"
        f"硬性要求：factor_categories 至少 {_MIN_FACTOR_CATEGORIES} 种；"
        f"每档尽量覆盖至少 {_MIN_MARKET_CATEGORIES} 个不同 Polymarket 类目。"
        f"请在 thesis / ai_reason 中体现与全球情报信号及 StageHints 的关联（若有）。"
    )


def _normalize_factor_categories(
    categories: list[RiskFactorCategory] | None,
) -> list[RiskFactorCategory]:
    if not categories:
        return []
    seen: set[str] = set()
    out: list[RiskFactorCategory] = []
    for cat in categories:
        cid = (cat.id or "").strip().lower()
        label = (cat.label or "").strip()
        if not cid or not label or cid in seen:
            continue
        seen.add(cid)
        out.append(
            RiskFactorCategory(
                id=cid,
                label=label,
                rationale=(cat.rationale or "").strip(),
            )
        )
    return out


def _market_category_count(positions: list[ResolvedPosition]) -> int:
    cats: set[str] = set()
    for pos in positions:
        cat = (pos.candidate.category or "").strip()
        if cat:
            cats.add(cat.lower())
    return len(cats)


def _validate_composed(
    composed: PortfolioSet | None,
    by_ref: dict[str, MarketCandidate],
    *,
    coverage_end: datetime | None = None,
) -> ResolvedPortfolioSet | None:
    if composed is None:
        logger.warning("compose produced no output")
        return None
    factor_categories = _normalize_factor_categories(composed.factor_categories)
    if len(factor_categories) < _MIN_FACTOR_CATEGORIES:
        logger.warning(
            "compose rejected: factor_categories=%d (< %d)",
            len(factor_categories),
            _MIN_FACTOR_CATEGORIES,
        )
        return None
    portfolios = _resolve_portfolios(
        composed, by_ref, coverage_end=coverage_end
    )
    if not portfolios:
        logger.warning("compose produced no valid portfolio")
        return None
    return ResolvedPortfolioSet(
        portfolios=portfolios,
        factor_categories=factor_categories,
    )


async def stream_compose_portfolios(
    need: str,
    answers: dict[str, str] | None,
    candidates: list[MarketCandidate],
    *,
    coverage_end: datetime | None = None,
    prompt_vars: dict[str, str] | None = None,
) -> AsyncIterator[StructuredStreamEvent[ResolvedPortfolioSet]]:
    if not candidates:
        yield StructuredStreamEvent(kind="result", result=None)
        return
    if coverage_end is not None:
        cov = coverage_end if coverage_end.tzinfo else coverage_end.replace(tzinfo=UTC)
        usable = [
            c
            for c in candidates
            if c.end_date is None
            or (
                c.end_date if c.end_date.tzinfo else c.end_date.replace(tzinfo=UTC)
            )
            <= cov
        ]
    else:
        usable = candidates
    if not usable:
        yield StructuredStreamEvent(kind="result", result=None)
        return
    ranked = rank(
        usable,
        coverage_end=coverage_end,
        concern_keywords=_concern_keywords(answers),
    )[:_COMPOSE_TOP_K]
    by_ref = {candidate_ref(candidate): candidate for candidate in ranked}

    vars_ = dict(prompt_vars or {})
    world_block = vars_.get("analysis_context")
    # Prefer EvidencePack from multi-source collect; do not re-fetch WorldMonitor.
    evidence_block = (vars_.get("evidence_pack") or "").strip()
    if evidence_block:
        world_block = (
            f"{evidence_block}\n\n{world_block}" if world_block else evidence_block
        )

    prompt = _compose_prompt(
        need,
        answers,
        coverage_end,
        ranked,
        world_context_block=world_block,
        stage_hints_block=vars_.get("stage_hints"),
        plan_summary=vars_.get("plan_summary"),
    )
    try:
        response = await ai_client.generate_with_response(
            AIUseCase.PORTFOLIO_COMPOSE,
            prompt,
            PortfolioSet,
            prompt_vars=vars_ or None,
        )
    except AIError as exc:
        yield StructuredStreamEvent(
            kind="error",
            error_code=exc.code,
            error_message=exc.message,
        )
        return
    if response.reasoning_text:
        yield StructuredStreamEvent(
            kind="reasoning", reasoning_text=response.reasoning_text
        )
    yield StructuredStreamEvent(
        kind="result",
        result=_validate_composed(
            response.output, by_ref, coverage_end=coverage_end
        ),
    )


async def compose_portfolios(
    need: str,
    answers: dict[str, str] | None,
    candidates: list[MarketCandidate],
    *,
    coverage_end: datetime | None = None,
) -> ResolvedPortfolioSet | None:
    async for event in stream_compose_portfolios(
        need, answers, candidates, coverage_end=coverage_end
    ):
        if event.kind == "error":
            raise AIError(event.error_message or "portfolio compose failed")
        if event.kind == "result":
            return event.result
    return None


def _resolve_portfolios(
    composed: PortfolioSet,
    by_ref: dict[str, MarketCandidate],
    *,
    coverage_end: datetime | None,
) -> list[ResolvedPortfolio]:
    seen_tiers: dict[str, ResolvedPortfolio] = {}
    for portfolio in composed.portfolios:
        tier = portfolio.tier
        if tier in seen_tiers:
            logger.warning("compose dropped duplicate tier %r", tier)
            continue
        positions = _resolve_positions(portfolio, by_ref, coverage_end=coverage_end)
        if not positions:
            continue
        positions = _enforce_conservative_no_extreme(tier, positions)
        if not positions:
            continue
        positions = _enforce_event_concentration(positions, by_ref)
        if not positions:
            continue
        # Soft preference: prefer portfolios spanning ≥2 market categories when
        # the pool actually has enough categories. Single-category is allowed
        # only when the candidate pool cannot diversify (诚实交付).
        cat_count = _market_category_count(positions)
        pool_cats = {
            (c.category or "").strip().lower()
            for c in by_ref.values()
            if (c.category or "").strip()
        }
        if (
            len(pool_cats) >= _MIN_MARKET_CATEGORIES
            and cat_count < _MIN_MARKET_CATEGORIES
            and len(positions) >= 2
        ):
            logger.warning(
                "compose dropped tier %r: market categories=%d (< %d)",
                tier,
                cat_count,
                _MIN_MARKET_CATEGORIES,
            )
            continue
        positions = _renormalize_weights(positions)
        seen_tiers[tier] = ResolvedPortfolio(
            tier=tier,
            title=(portfolio.title or "").strip() or f"{tier} portfolio",
            thesis=(portfolio.thesis or "").strip() or "",
            positions=positions,
        )
    return [seen_tiers[t] for t in _TIER_ORDER if t in seen_tiers]


def _resolve_positions(
    portfolio: ComposedPortfolio,
    by_ref: dict[str, MarketCandidate],
    *,
    coverage_end: datetime | None,
) -> list[ResolvedPosition]:
    used: set[str] = set()
    resolved: list[ResolvedPosition] = []
    for pos in portfolio.positions:
        ref = (pos.market_ref or "").strip()
        candidate = by_ref.get(ref)
        if candidate is None or ref in used:
            continue
        if coverage_end is not None and candidate.end_date is not None:
            cov = coverage_end if coverage_end.tzinfo else coverage_end.replace(tzinfo=UTC)
            end = (
                candidate.end_date
                if candidate.end_date.tzinfo
                else candidate.end_date.replace(tzinfo=UTC)
            )
            if end > cov:
                continue
        entry_price_bps = _compute_entry_price(candidate, pos.side)
        if entry_price_bps is None:
            continue
        used.add(ref)
        resolved.append(
            ResolvedPosition(
                market_ref=ref,
                question=candidate.question,
                side=pos.side,
                entry_price_bps=entry_price_bps,
                weight_bps=pos.weight_bps,
                resolution_date=candidate.end_date,
                ai_reason=(pos.ai_reason or "").strip(),
                candidate=candidate,
            )
        )
    return resolved


def _event_group(candidate: MarketCandidate) -> str:
    if candidate.neg_risk_market_id:
        return f"neg:{candidate.neg_risk_market_id}"
    if candidate.event_id:
        return f"evt:{candidate.event_id}"
    raw = candidate.raw or {}
    neg = raw.get("negRiskMarketID") or raw.get("negRiskMarketId")
    if neg:
        return f"neg:{neg}"
    evt = raw.get("eventId") or raw.get("event_id")
    if evt:
        return f"evt:{evt}"
    return f"cond:{candidate.condition_id}"


def _enforce_event_concentration(
    positions: list[ResolvedPosition],
    by_ref: dict[str, MarketCandidate],
) -> list[ResolvedPosition]:
    """Cap weight per event group at 40%; scale down and renormalize if exceeded."""
    if not positions:
        return positions
    group_weights: dict[str, int] = {}
    for pos in positions:
        candidate = by_ref.get(pos.market_ref) or pos.candidate
        group = _event_group(candidate)
        group_weights[group] = group_weights.get(group, 0) + pos.weight_bps
    over_groups = {
        g for g, w in group_weights.items() if w > _MAX_EVENT_WEIGHT_BPS
    }
    if not over_groups:
        return positions
    adjusted: list[ResolvedPosition] = []
    for pos in positions:
        candidate = by_ref.get(pos.market_ref) or pos.candidate
        group = _event_group(candidate)
        if group in over_groups:
            scale = _MAX_EVENT_WEIGHT_BPS / group_weights[group]
            new_w = max(1, round(pos.weight_bps * scale))
            adjusted.append(pos.model_copy(update={"weight_bps": new_w}))
        else:
            adjusted.append(pos)
    return _renormalize_weights(adjusted)


def _enforce_conservative_no_extreme(
    tier: str, positions: list[ResolvedPosition]
) -> list[ResolvedPosition]:
    if tier != "conservative":
        return positions
    kept = [
        p
        for p in positions
        if _EXTREME_LOW_BPS <= p.entry_price_bps <= _EXTREME_HIGH_BPS
    ]
    if not kept:
        logger.warning("conservative portfolio lost all positions after extreme filter")
    return kept


def _compute_entry_price(candidate: MarketCandidate, side: str) -> int | None:
    outcomes = candidate.outcomes
    prices = candidate.outcome_prices
    if not prices:
        return None
    side_upper = side.upper()
    idx: int | None = None
    for i, outcome in enumerate(outcomes):
        if outcome.upper() in ("YES", "是"):
            if side_upper == "YES":
                idx = i
                break
        elif outcome.upper() in ("NO", "否"):
            if side_upper == "NO":
                idx = i
                break
    if idx is None and len(outcomes) == 2 and len(prices) == 2:
        idx = 0 if side_upper == "YES" else 1
    if idx is None or idx >= len(prices):
        return None
    bps = round(prices[idx] * 10000)
    return max(1, min(10000, bps))


def _renormalize_weights(positions: list[ResolvedPosition]) -> list[ResolvedPosition]:
    total = sum(p.weight_bps for p in positions)
    if total <= 0:
        equal = 10000 // len(positions)
        remainder = 10000 - equal * len(positions)
        new_positions = []
        for i, p in enumerate(positions):
            w = equal + (1 if i >= len(positions) - remainder else 0)
            new_positions.append(p.model_copy(update={"weight_bps": w}))
        return new_positions
    new_positions = []
    running_sum = 0
    for i, p in enumerate(positions):
        if i < len(positions) - 1:
            w = round(p.weight_bps * 10000 / total)
            running_sum += w
            new_positions.append(p.model_copy(update={"weight_bps": w}))
        else:
            w = 10000 - running_sum
            new_positions.append(p.model_copy(update={"weight_bps": w}))
    return new_positions


def _format_profile(answers: dict[str, str] | None) -> str:
    if not answers:
        return "（无）"
    return "；".join(f"{key}:{value}" for key, value in answers.items())


def _format_candidate(candidate: MarketCandidate) -> str:
    spread = (
        f"{candidate.spread:.4f}"
        if candidate.spread is not None
        else "未知"
    )
    parts = [
        f"ref={candidate_ref(candidate)}",
        f"问题:{candidate.question}",
        f"结果选项:{','.join(candidate.outcomes) if candidate.outcomes else '未知'}",
        f"当前价格:{','.join(f'{p:.4f}' for p in candidate.outcome_prices) if candidate.outcome_prices else '未知'}",
        f"类目:{candidate.category or '未知'}",
        f"标签:{','.join(candidate.tags) if candidate.tags else '无'}",
        f"事件组:{_event_group(candidate)}",
        f"成交量:{candidate.volume if candidate.volume is not None else '未知'}",
        f"24h量:{candidate.volume24hr if candidate.volume24hr is not None else '未知'}",
        f"流动性:{candidate.liquidity if candidate.liquidity is not None else '未知'}",
        f"价差:{spread}",
        f"bestBid:{candidate.best_bid if candidate.best_bid is not None else '未知'}",
        f"bestAsk:{candidate.best_ask if candidate.best_ask is not None else '未知'}",
        f"结束日期:{candidate.end_date.isoformat() if candidate.end_date else '未知'}",
    ]
    return " | ".join(parts)
