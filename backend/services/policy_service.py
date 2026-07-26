"""Policy persistence, ownership and snapshots (差分机 / Difference Engine). No ai/ calls live here.

Same IDOR red line as courses: every query that touches a policy by id MUST
filter by user_id too — "not yours" and "not there" are both None -> 404. This
module owns the ORM; policy_planning_service / policy_build_service orchestrate
and delegate persistence here.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition
from schemas.policy import (
    PolicyDetailOut,
    PolicyListItemOut,
    PolicyPortfolioOut,
    PolicyPositionOut,
    PolicySettlementOutcomeOut,
    RiskFactorCategoryOut,
    RiskQuestionnaireOut,
)

# Only these statuses appear in the list (proposed and beyond).
_LISTED_STATUSES = ("proposed", "funded", "active", "settled")

_LOW_LIQUIDITY_THRESHOLD = 5_000.0


def _position_profile(raw: dict | None) -> dict[str, int | float | str | bool | None]:
    """Extract optional market profile fields from persisted raw_json."""
    data = raw or {}
    spread = data.get("spread")
    spread_bps: int | None = None
    if spread is not None:
        try:
            spread_bps = int(round(float(spread) * 10_000))
        except (TypeError, ValueError):
            spread_bps = None

    liquidity_raw = data.get("liquidity")
    if liquidity_raw is None:
        liquidity_raw = data.get("liquidityNum")
    liquidity: float | None = None
    if liquidity_raw is not None:
        try:
            liquidity = float(liquidity_raw)
        except (TypeError, ValueError):
            liquidity = None

    category_raw = data.get("category")
    category = str(category_raw).strip() if category_raw else None
    if category == "":
        category = None

    low_liquidity: bool | None = None
    if liquidity is not None:
        low_liquidity = liquidity < _LOW_LIQUIDITY_THRESHOLD

    return {
        "spread_bps": spread_bps,
        "liquidity": liquidity,
        "category": category,
        "low_liquidity": low_liquidity,
    }


def _factor_categories_from_intake(
    intake_json: dict | None,
) -> list[RiskFactorCategoryOut]:
    """Prefer compose-time categories; fall back to intake questionnaire."""
    data = intake_json or {}
    raw = data.get("factorCategories") or data.get("factor_categories")
    if not raw:
        questionnaire = data.get("questionnaire") or {}
        raw = questionnaire.get("factorCategories") or questionnaire.get(
            "factor_categories"
        )
    if not isinstance(raw, list):
        return []
    out: list[RiskFactorCategoryOut] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            out.append(RiskFactorCategoryOut.model_validate(item))
        except Exception:
            continue
    return out


def _position_out(pos: PolicyPosition) -> PolicyPositionOut:
    profile = _position_profile(pos.raw_json)
    return PolicyPositionOut(
        id=pos.id,
        market_ref=pos.market_ref,
        question=pos.question,
        side=pos.side,
        entry_price_bps=pos.entry_price_bps,
        weight=pos.weight_bps,
        resolution_date=pos.resolution_date,
        ai_reason=pos.ai_reason,
        odds=float(pos.odds) if pos.odds is not None else None,
        volume=float(pos.volume) if pos.volume is not None else None,
        spread_bps=profile["spread_bps"],  # type: ignore[arg-type]
        liquidity=profile["liquidity"],  # type: ignore[arg-type]
        category=profile["category"],  # type: ignore[arg-type]
        low_liquidity=profile["low_liquidity"],  # type: ignore[arg-type]
    )


def _normalize_scenarios_for_wire(
    scenarios: list[dict] | None,
    *,
    premium: float,
    total_legs: int,
) -> list[dict]:
    """Ensure scenario rows include hitCount/totalCount/netProfit for the frontend."""
    if not scenarios:
        return []
    out: list[dict] = []
    for row in scenarios:
        item = dict(row)
        legs = item.get("legs") or []
        hit_count = item.get("hitCount")
        if hit_count is None and legs:
            hit_count = sum(1 for leg in legs if leg.get("hit"))
        total_count = item.get("totalCount")
        if total_count is None:
            total_count = len(legs) if legs else total_legs
        payout = item.get("payout")
        if payout is not None and item.get("netProfit") is None:
            try:
                item["netProfit"] = round(float(payout) - premium, 2)
            except (TypeError, ValueError):
                pass
        if hit_count is not None:
            item["hitCount"] = hit_count
        if total_count is not None:
            item["totalCount"] = total_count
        out.append(item)
    return out


def _settlement_outcomes_from_policy(policy: Policy) -> list[PolicySettlementOutcomeOut]:
    raw = (policy.intake_json or {}).get("settlementOutcomes") or []
    outcomes: list[PolicySettlementOutcomeOut] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            outcomes.append(PolicySettlementOutcomeOut.model_validate(item))
        except Exception:
            continue
    return outcomes


def _selected_portfolio(policy: Policy) -> PolicyPortfolio | None:
    if policy.selected_portfolio_id is None:
        return None
    for portfolio in policy.portfolios:
        if portfolio.id == policy.selected_portfolio_id:
            return portfolio
    return None


def _list_item_expected_payout(policy: Policy) -> float | None:
    selected = _selected_portfolio(policy)
    if selected is not None and selected.expected_payout is not None:
        return float(selected.expected_payout)
    return None


def _policy_to_list_item(policy: Policy) -> PolicyListItemOut:
    selected = _selected_portfolio(policy)
    nft_token_id = _policy_nft_token_id(policy)
    return PolicyListItemOut(
        id=policy.id,
        title=policy.title,
        status=policy.status,
        updated_at=policy.updated_at,
        open_tx=policy.open_tx,
        opened_at=policy.opened_at,
        coverage_end=policy.coverage_end,
        premium=float(policy.premium) if policy.premium is not None else None,
        expected_payout=_list_item_expected_payout(policy),
        selected_portfolio_tier=selected.tier if selected is not None else None,
        has_nft=nft_token_id is not None,
        nft_token_id=nft_token_id,
        nft_minted_at=policy.nft_minted_at if nft_token_id is not None else None,
    )


def _nft_metadata_uri(token_id: str | None) -> str | None:
    if token_id is None:
        return None
    base = settings.nft_metadata_base_url.strip().rstrip("/")
    return f"{base}/{token_id}" if base else None


def _policy_nft_token_id(policy: Policy) -> str | None:
    """Expose NFT state only when it matches this policy's deterministic ID."""
    expected = str(policy.id.int)
    return expected if policy.nft_token_id == expected else None


async def create_policy(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    need_text: str,
    conversation_id: uuid.UUID | None,
    intake_json: dict | None,
) -> Policy:
    """Create a policy in the `intake` state. title starts as need_text."""
    policy = Policy(
        user_id=user_id,
        need_text=need_text,
        title=need_text[:120] if len(need_text) > 120 else need_text,
        status="intake",
        conversation_id=conversation_id,
        intake_json=intake_json,
    )
    db.add(policy)
    await db.commit()
    await db.refresh(policy)
    return policy


async def get_owned_policy(
    db: AsyncSession, *, user_id: uuid.UUID, policy_id: uuid.UUID
) -> Policy | None:
    result = await db.execute(
        select(Policy).where(Policy.id == policy_id, Policy.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def get_policy_detail(
    db: AsyncSession, *, user_id: uuid.UUID, policy_id: uuid.UUID
) -> PolicyDetailOut | None:
    """Owned full snapshot (portfolios -> positions eager-loaded). None -> 404."""
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id, Policy.user_id == user_id)
        .options(
            selectinload(Policy.portfolios).selectinload(PolicyPortfolio.positions)
        )
    )
    policy = result.scalar_one_or_none()
    if policy is None:
        return None
    questionnaire_ready = bool((policy.intake_json or {}).get("questionnaire"))
    premium_float = float(policy.premium) if policy.premium is not None else 0.0
    portfolios_out = []
    for portfolio in policy.portfolios:
        positions_out = [_position_out(pos) for pos in portfolio.positions]
        total_legs = len(positions_out)
        portfolio_premium = (
            float(portfolio.premium_estimate)
            if portfolio.premium_estimate is not None
            else premium_float
        )
        portfolios_out.append(
            PolicyPortfolioOut(
                id=portfolio.id,
                tier=portfolio.tier,
                title=portfolio.title,
                thesis=portfolio.thesis,
                premium_estimate=(
                    float(portfolio.premium_estimate)
                    if portfolio.premium_estimate is not None
                    else None
                ),
                expected_payout=(
                    float(portfolio.expected_payout)
                    if portfolio.expected_payout is not None
                    else None
                ),
                metrics=portfolio.metrics_json,
                scenarios=_normalize_scenarios_for_wire(
                    portfolio.scenarios_json,
                    premium=portfolio_premium,
                    total_legs=total_legs,
                ),
                positions=positions_out,
            )
        )
    return PolicyDetailOut(
        id=policy.id,
        title=policy.title,
        status=policy.status,
        search_status=policy.search_status,
        questionnaire_ready=questionnaire_ready,
        need_text=policy.need_text,
        coverage_end=policy.coverage_end,
        premium=float(policy.premium) if policy.premium is not None else None,
        portfolios=portfolios_out,
        on_chain_policy_id=policy.on_chain_policy_id,
        open_tx=policy.open_tx,
        opened_at=policy.opened_at,
        settle_tx=policy.settle_tx,
        nft_token_id=(nft_token_id := _policy_nft_token_id(policy)),
        nft_mint_tx=policy.nft_mint_tx if nft_token_id is not None else None,
        nft_minted_at=policy.nft_minted_at if nft_token_id is not None else None,
        nft_metadata_uri=_nft_metadata_uri(nft_token_id),
        payout=float(policy.payout) if policy.payout is not None else None,
        selected_portfolio_id=policy.selected_portfolio_id,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
        settlement_outcomes=_settlement_outcomes_from_policy(policy),
        factor_categories=_factor_categories_from_intake(policy.intake_json),
    )


async def get_questionnaire(
    db: AsyncSession, *, user_id: uuid.UUID, policy_id: uuid.UUID
) -> RiskQuestionnaireOut | None:
    """The intake questionnaire for an owned policy (stored in intake_json).

    Returns an EMPTY questionnaire (not None) when the policy is owned but its
    questionnaire is still being generated in the background, so the card can
    poll until it's ready. None means 404 (not owned / gone) only.
    """
    policy = await get_owned_policy(db, user_id=user_id, policy_id=policy_id)
    if policy is None:
        return None
    data = (policy.intake_json or {}).get("questionnaire")
    if not data:
        return RiskQuestionnaireOut(questions=[])
    return RiskQuestionnaireOut.model_validate(data)


async def store_questionnaire(
    db: AsyncSession, *, policy_id: uuid.UUID, questionnaire: dict
) -> None:
    """Fill a freshly generated questionnaire onto an existing intake policy.

    Reassigns intake_json (a new dict) so SQLAlchemy flags the JSONB column dirty.
    No-op if the policy is gone (deleted mid-generation).
    """
    policy = await db.get(Policy, policy_id)
    if policy is not None:
        policy.intake_json = {
            **(policy.intake_json or {}),
            "questionnaire": questionnaire,
        }
        await db.commit()


async def mark_intake_failed(db: AsyncSession, *, policy_id: uuid.UUID) -> None:
    """Questionnaire generation failed -> move the intake policy to failed.

    Guarded on `intake` so it never clobbers a policy that has already advanced.
    """
    policy = await db.get(Policy, policy_id)
    if policy is not None and policy.status == "intake":
        policy.status = "failed"
        await db.commit()


async def list_policies(
    db: AsyncSession, *, user_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> list[PolicyListItemOut]:
    """Only proposed+ policies, newest first (drafts/failed stay hidden)."""
    result = await db.execute(
        select(Policy)
        .where(Policy.user_id == user_id, Policy.status.in_(_LISTED_STATUSES))
        .options(selectinload(Policy.portfolios))
        .order_by(Policy.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [_policy_to_list_item(policy) for policy in result.scalars()]
