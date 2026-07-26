"""搜索前置 build = compose：把 AI 生成的梯度组合落库（差分机 / Difference Engine）。

不再按需现搜（搜索已前移到诉求阶段，候选缓存在 market_search_candidates）。这里只做：
读 compose 输入(need/answers/coverage_end)；把 compose 产出的 ResolvedPortfolioSet **幂等**
落成 policy_portfolios/policy_positions；计算经济参数（premium_estimate / expected_payout）
以及组合 metrics / scenarios（确定性，非 LLM）。
"""

import math
import re
import uuid
from datetime import UTC, datetime
from itertools import product
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ai.policygen.types import ResolvedPortfolioSet, ResolvedPosition
from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition

_FAILED = "failed"
_PROPOSED = "proposed"
_STALE = "stale"
_MIN_PREMIUM = 10.0
_DEFAULT_PREMIUM = 100.0


async def load_compose_inputs(
    db: AsyncSession, *, policy_id: uuid.UUID
) -> tuple[str, dict[str, str], datetime | None] | None:
    policy = await db.get(Policy, policy_id)
    if policy is None:
        return None
    answers: dict[str, str] = {}
    if policy.intake_json:
        answers = policy.intake_json.get("answers") or {}
    return policy.need_text, answers, policy.coverage_end


async def mark_failed(db: AsyncSession, *, policy_id: uuid.UUID) -> None:
    policy = await db.get(Policy, policy_id)
    if policy is not None:
        policy.status = _FAILED
        await db.commit()


def notional_premium(answers: dict[str, str]) -> float:
    """Derive a recommended budget from questionnaire answers. Falls back to 100 USDC."""
    for key, value in answers.items():
        if any(kw in key.lower() for kw in ("保额", "保费", "budget", "premium", "amount")):
            match = re.search(r"[\d,.]+", value.replace(",", ""))
            if match:
                try:
                    return max(_MIN_PREMIUM, float(match.group().replace(",", "")))
                except ValueError:
                    continue
    for value in answers.values():
        cleaned = value.replace(",", "").strip()
        try:
            num = float(cleaned)
            if num > 0:
                return max(_MIN_PREMIUM, num)
        except ValueError:
            continue
    return _DEFAULT_PREMIUM


def portfolio_economics(
    positions: list[ResolvedPosition], premium: float, fee_bps: int
) -> tuple[float, float]:
    """Compute (premium_estimate, expected_payout) for a portfolio."""
    net = premium * (1 - fee_bps / 10000)
    expected_payout = 0.0
    for pos in positions:
        allocated = net * pos.weight_bps / 10000
        price = pos.entry_price_bps / 10000
        if price > 0:
            shares = allocated / price
            expected_payout += shares
    return premium, expected_payout


def position_shares(
    pos: ResolvedPosition, *, premium: float, fee_bps: int
) -> float:
    net = premium * (1 - fee_bps / 10000)
    allocated = net * pos.weight_bps / 10000
    price = pos.entry_price_bps / 10000
    if price <= 0:
        return 0.0
    return allocated / price


def scenario_payout(
    positions: list[ResolvedPosition],
    hits: list[bool],
    *,
    premium: float,
    fee_bps: int,
) -> float:
    total = 0.0
    for pos, hit in zip(positions, hits):
        if not hit:
            continue
        total += position_shares(pos, premium=premium, fee_bps=fee_bps)
    return total


def compute_portfolio_metrics(
    positions: list[ResolvedPosition],
    *,
    premium: float,
    fee_bps: int,
    coverage_end: datetime | None = None,
) -> dict[str, Any]:
    if not positions:
        return {}
    _, expected_payout = portfolio_economics(positions, premium, fee_bps)
    avg_entry_probability = (
        sum(p.entry_price_bps * p.weight_bps for p in positions) / 10000 / 10000
    )
    categories: set[str] = set()
    for pos in positions:
        cat = pos.candidate.category
        if cat:
            categories.add(cat)
        elif pos.candidate.raw.get("category"):
            categories.add(str(pos.candidate.raw["category"]))
    res_dates = [p.resolution_date for p in positions if p.resolution_date]
    nearest = min(res_dates) if res_dates else None
    breakeven = premium / expected_payout if expected_payout > 0 else None
    hit_prob = 1.0
    for pos in positions:
        hit_prob *= pos.entry_price_bps / 10000
    implied_annual_odds: float | None = None
    if breakeven is not None and breakeven > 0 and nearest is not None:
        now = datetime.now(UTC)
        end = nearest if nearest.tzinfo else nearest.replace(tzinfo=UTC)
        days = max(1, (end - now).days)
        years = days / 365.0
        # Near-term resolution + cheap longshot legs -> ratio**(1/years) can
        # overflow float range (errno 34). Treat as "not meaningful" rather
        # than sinking the whole compose persist.
        if years > 0 and premium > 0:
            try:
                value = (expected_payout / premium) ** (1 / years)
            except OverflowError:
                value = None
            if value is not None and math.isfinite(value):
                implied_annual_odds = value
    return {
        "avgEntryProbability": round(avg_entry_probability, 4),
        "marketDiversity": len(categories) if categories else 0,
        "nearestResolutionDate": nearest.isoformat() if nearest else None,
        "breakevenHitRate": round(breakeven, 4) if breakeven is not None else None,
        "portfolioHitProbability": round(hit_prob, 6),
        "impliedAnnualOdds": (
            round(implied_annual_odds, 4) if implied_annual_odds is not None else None
        ),
        "expectedPayout": round(expected_payout, 2),
        "premium": round(premium, 2),
        "coverageEnd": coverage_end.isoformat() if coverage_end else None,
    }


def compute_portfolio_scenarios(
    positions: list[ResolvedPosition],
    *,
    premium: float,
    fee_bps: int,
) -> list[dict[str, Any]]:
    if not positions:
        return []
    n = len(positions)
    all_patterns = list(product([False, True], repeat=n))
    scored: list[tuple[float, float, list[bool]]] = []
    for pattern in all_patterns:
        hits = list(pattern)
        payout = scenario_payout(positions, hits, premium=premium, fee_bps=fee_bps)
        prob = 1.0
        for pos, hit in zip(positions, hits):
            p = pos.entry_price_bps / 10000
            prob *= p if hit else (1 - p)
        scored.append((payout, prob, hits))
    scored.sort(key=lambda row: (-row[0], -row[1]))

    chosen: list[tuple[float, float, list[bool]]] = []
    seen_payouts: set[float] = set()

    def _add(row: tuple[float, float, list[bool]]) -> None:
        payout_key = round(row[0], 2)
        if payout_key in seen_payouts:
            return
        seen_payouts.add(payout_key)
        chosen.append(row)

    if scored:
        _add(scored[0])  # max payout
        _add(scored[-1])  # min payout
    for row in sorted(scored, key=lambda r: -r[1]):
        if len(chosen) >= 5:
            break
        _add(row)

    labels = ["最大赔付", "零赔付", "高概率情景", "中等情景", "备选情景"]
    out: list[dict[str, Any]] = []
    for i, (payout, prob, hits) in enumerate(chosen[:5]):
        label = labels[i] if i < len(labels) else f"情景{i + 1}"
        if sum(hits) == len(hits):
            label = "全部命中"
        elif not any(hits):
            label = "全部未中"
        hit_count = sum(1 for h in hits if h)
        out.append(
            {
                "label": label,
                "payout": round(payout, 2),
                "probability": round(prob, 6),
                "hitCount": hit_count,
                "totalCount": n,
                "netProfit": round(payout - premium, 2),
                "legs": [
                    {
                        "marketRef": pos.market_ref,
                        "question": pos.question,
                        "side": pos.side,
                        "hit": hit,
                    }
                    for pos, hit in zip(positions, hits)
                ],
            }
        )
    return out


async def persist_portfolio_set(
    db: AsyncSession,
    *,
    policy_id: uuid.UUID,
    result: ResolvedPortfolioSet,
    expected_input_revision: int | None = None,
) -> str:
    if expected_input_revision is not None:
        if not await _revision_matches(
            db, policy_id=policy_id, expected=expected_input_revision
        ):
            await db.rollback()
            return _STALE

    policy = await db.get(Policy, policy_id)
    if policy is None:
        return _FAILED

    await db.execute(
        delete(PolicyPortfolio).where(PolicyPortfolio.policy_id == policy_id)
    )
    await db.flush()

    premium = notional_premium((policy.intake_json or {}).get("answers") or {})
    fee_bps = settings.platform_fee_bps

    portfolio_count = 0
    for order_index, portfolio in enumerate(result.portfolios):
        premium_estimate, expected_payout = portfolio_economics(
            portfolio.positions, premium, fee_bps
        )
        metrics = compute_portfolio_metrics(
            portfolio.positions,
            premium=premium,
            fee_bps=fee_bps,
            coverage_end=policy.coverage_end,
        )
        scenarios = compute_portfolio_scenarios(
            portfolio.positions, premium=premium, fee_bps=fee_bps
        )
        portfolio_row = PolicyPortfolio(
            policy_id=policy_id,
            order_index=order_index,
            tier=portfolio.tier,
            title=portfolio.title,
            thesis=portfolio.thesis,
            premium_estimate=premium_estimate,
            expected_payout=expected_payout,
            metrics_json=metrics or None,
            scenarios_json=scenarios or None,
            status="ready",
        )
        db.add(portfolio_row)
        await db.flush()
        for pos_index, pos in enumerate(portfolio.positions):
            db.add(
                PolicyPosition(
                    portfolio_id=portfolio_row.id,
                    order_index=pos_index,
                    market_ref=pos.market_ref,
                    question=pos.question,
                    side=pos.side,
                    entry_price_bps=pos.entry_price_bps,
                    weight_bps=pos.weight_bps,
                    resolution_date=pos.resolution_date,
                    ai_reason=pos.ai_reason,
                    odds=pos.entry_price_bps / 10000,
                    volume=pos.candidate.volume,
                    raw_json=pos.candidate.raw or None,
                )
            )
        portfolio_count += 1

    if portfolio_count > 0:
        policy.status = _PROPOSED
        policy.premium = premium
        # Persist compose-time factor categories for UI / audit (camelCase wire).
        cats = [
            {
                "id": c.id,
                "label": c.label,
                "rationale": c.rationale,
            }
            for c in result.factor_categories
        ]
        policy.intake_json = {
            **(policy.intake_json or {}),
            "factorCategories": cats,
        }
    else:
        policy.status = _FAILED

    # Re-check after staging writes (TOCTOU barrier before commit).
    if expected_input_revision is not None:
        if not await _revision_matches(
            db, policy_id=policy_id, expected=expected_input_revision
        ):
            await db.rollback()
            return _STALE

    await db.commit()
    return policy.status


async def _revision_matches(
    db: AsyncSession, *, policy_id: uuid.UUID, expected: int
) -> bool:
    """Row-lock AgentTask so concurrent revision bumps cannot sneak past CAS."""
    from sqlalchemy import select  # noqa: PLC0415

    from models.agent_task import AgentTask  # noqa: PLC0415

    result = await db.execute(
        select(AgentTask.input_revision)
        .where(
            AgentTask.primary_ref_type == "policy",
            AgentTask.primary_ref_id == policy_id,
        )
        .with_for_update()
    )
    revision = result.scalar_one_or_none()
    if revision is None:
        return True
    return int(revision) == int(expected)
