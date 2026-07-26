"""Live mark-to-market for active policy positions."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ai.markets.normalize import maybe_json_list
from ai.markets.prices import fetch_market_prices_detailed, price_bps_for_side
from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition
from schemas.policy import (
    PolicyMarkPositionOut,
    PolicyMarksCoverageOut,
    PolicyMarksOut,
)
from services.policy_build_service import position_shares

logger = logging.getLogger("lemma.services.policy_marks")

_USDC_DECIMALS = 1_000_000
SharesSource = Literal["on_chain", "recomputed"]


async def get_policy_marks(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
) -> PolicyMarksOut | None:
    """Batch-fetch Polymarket prices for the policy's selected portfolio positions."""
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

    positions: list[PolicyPosition] = []
    if policy.selected_portfolio_id is not None:
        for portfolio in policy.portfolios:
            if portfolio.id == policy.selected_portfolio_id:
                positions = list(portfolio.positions)
                break
    elif policy.portfolios:
        # Fallback: first portfolio with positions (proposed review)
        for portfolio in policy.portfolios:
            if portfolio.positions:
                positions = list(portfolio.positions)
                break

    fetched_at = datetime.now(UTC)
    if not positions:
        return PolicyMarksOut(
            policy_id=policy.id,
            positions=[],
            total_mark_value=None,
            full_hit_payout=None,
            premium=float(policy.premium) if policy.premium is not None else None,
            updated_at=fetched_at,
            as_of=None,
            quote_source="polymarket_gamma",
            coverage=PolicyMarksCoverageOut(quoted=0, total=0, status="none"),
            stale=False,
            unavailable_reason="no_positions",
            shares_recomputed=False,
        )

    condition_ids = [p.market_ref for p in positions]
    price_result = await fetch_market_prices_detailed(condition_ids)
    live_prices = price_result.prices
    as_of = price_result.fetched_at

    premium = float(policy.premium) if policy.premium is not None else None
    if premium is None and policy.portfolios:
        for pf in policy.portfolios:
            if pf.premium_estimate is not None:
                premium = float(pf.premium_estimate)
                break
    fee_bps = settings.platform_fee_bps

    on_chain_shares = _try_on_chain_shares(policy)
    shares_recomputed = False

    marks: list[PolicyMarkPositionOut] = []
    total_mark = 0.0
    quoted = 0
    for pos in positions:
        raw = pos.raw_json or {}
        outcomes = raw.get("outcomes") or ["Yes", "No"]
        if isinstance(outcomes, str):
            outcomes = maybe_json_list(outcomes) or ["Yes", "No"]

        prices = live_prices.get(pos.market_ref)
        current_bps: int | None = None
        null_reason: str | None = None

        if prices is None:
            if price_result.error:
                null_reason = price_result.error
            else:
                null_reason = "gamma_missing"
        else:
            current_bps = price_bps_for_side(prices, outcomes, pos.side)
            if current_bps is None:
                null_reason = "side_unmapped"

        mark_value: float | None = None
        shares_source: SharesSource | None = None

        if current_bps is not None:
            shares_usd, shares_source = _resolve_shares_usd(
                pos,
                premium=premium,
                fee_bps=fee_bps,
                on_chain_shares=on_chain_shares,
            )
            if shares_source == "recomputed":
                shares_recomputed = True
            if shares_usd is None:
                null_reason = null_reason or "no_premium"
            else:
                mark_value = round(shares_usd * (current_bps / 10000), 4)
                total_mark += mark_value
                quoted += 1
                null_reason = None

        marks.append(
            PolicyMarkPositionOut(
                market_ref=pos.market_ref,
                question=pos.question,
                side=pos.side,
                entry_price_bps=pos.entry_price_bps,
                current_price_bps=current_bps,
                weight_bps=pos.weight_bps,
                mark_value=mark_value,
                null_price_reason=null_reason,
                shares_source=shares_source,
            )
        )

    total = len(positions)
    if quoted == 0:
        coverage_status = "none"
    elif quoted < total:
        coverage_status = "partial"
    else:
        coverage_status = "full"

    unavailable_reason: str | None = None
    if coverage_status == "none":
        if price_result.error:
            unavailable_reason = price_result.error
        elif premium is None:
            unavailable_reason = "no_premium"
        else:
            unavailable_reason = "all_legs_unquoted"

    full_hit_payout: float | None = None
    selected = None
    if policy.selected_portfolio_id is not None:
        for portfolio in policy.portfolios:
            if portfolio.id == policy.selected_portfolio_id:
                selected = portfolio
                break
    if selected is not None and selected.expected_payout is not None:
        full_hit_payout = float(selected.expected_payout)

    stale = bool(price_result.stale) or (
        coverage_status == "none" and price_result.error is not None
    )

    return PolicyMarksOut(
        policy_id=policy.id,
        positions=marks,
        total_mark_value=round(total_mark, 4) if quoted > 0 else None,
        full_hit_payout=full_hit_payout,
        premium=premium,
        updated_at=fetched_at,
        as_of=as_of,
        quote_source="polymarket_gamma",
        coverage=PolicyMarksCoverageOut(
            quoted=quoted, total=total, status=coverage_status
        ),
        stale=stale,
        unavailable_reason=unavailable_reason,
        shares_recomputed=shares_recomputed,
    )


def _try_on_chain_shares(policy: Policy) -> dict[str, float] | None:
    """Return {market_ref: shares_usd} from vault getPositions when available."""
    on_chain_id = getattr(policy, "on_chain_policy_id", None)
    if not on_chain_id:
        return None
    try:
        from services.chain_service import read_policy_snapshot  # noqa: PLC0415

        snapshot = read_policy_snapshot(on_chain_id)
    except Exception as exc:  # noqa: BLE001 — chain read is best-effort for marks
        logger.info(
            "marks on-chain shares unavailable for %s: %s", on_chain_id, exc
        )
        return None

    out: dict[str, float] = {}
    for raw_pos in snapshot.get("positions") or []:
        if not isinstance(raw_pos, dict):
            continue
        ref = raw_pos.get("marketRef")
        shares = raw_pos.get("shares")
        if not ref or shares is None:
            continue
        try:
            shares_int = int(shares)
        except (TypeError, ValueError):
            continue
        out[str(ref).lower()] = shares_int / _USDC_DECIMALS

    return out or None


def _resolve_shares_usd(
    pos: PolicyPosition,
    *,
    premium: float | None,
    fee_bps: int,
    on_chain_shares: dict[str, float] | None,
) -> tuple[float | None, SharesSource | None]:
    if on_chain_shares:
        key = pos.market_ref.lower()
        if key in on_chain_shares:
            return on_chain_shares[key], "on_chain"
        # Some chain encodings may omit 0x prefix casing — already lowercased.
        for ref, shares in on_chain_shares.items():
            if ref.endswith(key.removeprefix("0x")) or key.endswith(
                ref.removeprefix("0x")
            ):
                return shares, "on_chain"

    if premium is None:
        return None, None
    shares = position_shares(
        _pos_stub(pos), premium=premium, fee_bps=fee_bps
    )
    return shares, "recomputed"


def _pos_stub(pos: PolicyPosition):
    from ai.policygen.types import ResolvedPosition  # noqa: PLC0415
    from ai.markets.types import MarketCandidate, MarketPlatform  # noqa: PLC0415

    raw = pos.raw_json or {}
    return ResolvedPosition(
        market_ref=pos.market_ref,
        question=pos.question,
        side=pos.side,  # type: ignore[arg-type]
        entry_price_bps=pos.entry_price_bps,
        weight_bps=pos.weight_bps,
        resolution_date=pos.resolution_date,
        ai_reason=pos.ai_reason or "",
        candidate=MarketCandidate(
            platform=MarketPlatform.POLYMARKET,
            condition_id=pos.market_ref,
            question=pos.question,
            url=raw.get("url") or "",
            raw=raw,
        ),
    )
