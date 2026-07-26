"""M2/M3 — chain-aware policy orchestration (差分机 / Difference Engine).

Owns the zero-trust validation and funding-plan derivation logic that bridges
the off-chain DB state with on-chain openPolicy confirmation. Separated from
policy_service.py (which is pure persistence) to keep concerns clean and
allow chain_service imports to be lazily deferred.

All amounts are in USDC base units (6 decimals, integer arithmetic).
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition
from schemas.policy import (
    PolicyDetailOut,
    PolicyFundingPlanOut,
    PolicyFundingPositionOut,
)
from services import agent_event_service, policy_service
from services.policy_build_service import portfolio_economics

logger = logging.getLogger("lemma.services.policy_chain_service")

_MIN_PREMIUM = 10.0

# Regex for 0x + 64 hex chars (bytes32)
_BYTES32_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


def derive_on_chain_policy_id(policy_id: uuid.UUID) -> str:
    """Deterministic bytes32 from DB uuid: 16-byte zero prefix + 16-byte uuid.

    Pure function, no DB/chain dependency.
    """
    raw = policy_id.bytes  # 16 bytes
    padded = b"\x00" * 16 + raw  # 32 bytes
    return "0x" + padded.hex()


def compute_max_payout_base_units(
    premium_base_units: int, fee_bps: int, positions: list[dict]
) -> int:
    """Compute maxPayout in base units (mirrors contract math exactly).

    positions: list of {entryPriceBps: int, weightBps: int}
    net = premium * (1 - feeBps/1e4)
    allocated_i = net * weightBps_i / 1e4
    shares_i = allocated_i * 1e4 / entryPriceBps_i
    maxPayout = Σshares_i
    """
    net = premium_base_units * (10000 - fee_bps) // 10000
    total_shares = 0
    for pos in positions:
        allocated = net * pos["weightBps"] // 10000
        shares = allocated * 10000 // pos["entryPriceBps"]
        total_shares += shares
    return total_shares


def compute_payout(positions: list[dict], outcomes_yes: list[bool]) -> int:
    """Compute payout for given positions and outcomes (pure function, testable offline).

    positions: [{sideYes: bool, shares: int, ...}]
    outcomes_yes: [bool] in same order as positions
    payout = sum of shares_i where pos.sideYes == outcomeYes_i
    """
    payout = 0
    for pos, outcome in zip(positions, outcomes_yes):
        if pos["sideYes"] == outcome:
            payout += pos["shares"]
    return payout


async def build_funding_plan(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
    portfolio_id: uuid.UUID,
    premium_override: float | None = None,
    position_overrides: list[dict[str, object]] | None = None,
) -> PolicyFundingPlanOut | None:
    """Task 1: validate selection, compute funding params, return PolicyFundingPlanOut.

    Returns None only for IDOR (not found / not owned) → caller raises 404.
    Raises HTTPException(422/409) for validation failures.

    ``position_overrides`` (optional): list of {market_ref, weight_bps} covering
    every position in the portfolio; Σ weight_bps must be 10000. Applied and
    persisted before economics / chain packing.
    """
    # Load policy with portfolios → positions
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

    # Status gate: must be 'proposed'
    if policy.status != "proposed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_status_not_proposed",
        )

    # Find the selected portfolio (must belong to this policy)
    chosen: PolicyPortfolio | None = None
    for pf in policy.portfolios:
        if pf.id == portfolio_id:
            chosen = pf
            break
    if chosen is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="portfolio_not_found_in_policy",
        )

    # Zero-trust validation of positions (mirrors compose constraints)
    positions = list(chosen.positions)
    if not positions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="portfolio_has_no_positions",
        )

    if position_overrides is not None:
        by_ref = {str(p.market_ref): p for p in positions}
        if len(position_overrides) != len(positions):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="position_overrides_must_cover_all_legs",
            )
        override_map: dict[str, int] = {}
        for item in position_overrides:
            ref = str(item.get("market_ref") or "")
            weight = int(item.get("weight_bps") or 0)  # type: ignore[arg-type]
            if ref not in by_ref:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"unknown_market_ref_in_overrides:{ref}",
                )
            if weight < 1 or weight > 10000:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"weight_bps_out_of_range:{weight}",
                )
            override_map[ref] = weight
        if len(override_map) != len(positions):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="position_overrides_duplicate_or_incomplete",
            )
        if sum(override_map.values()) != 10000:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"权重总和必须为10000，当前为{sum(override_map.values())}",
            )
        for pos in positions:
            pos.weight_bps = override_map[str(pos.market_ref)]

    total_weight = sum(p.weight_bps for p in positions)
    if total_weight != 10000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"权重总和必须为10000，当前为{total_weight}",
        )

    for pos in positions:
        if not _BYTES32_RE.match(pos.market_ref):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"market_ref格式无效：{pos.market_ref}，需为0x+64位十六进制",
            )
        if pos.entry_price_bps <= 0 or pos.entry_price_bps > 10000:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"entry_price_bps超出范围(0,10000]：{pos.entry_price_bps}",
            )

    # Derive premium: user override > portfolio recommendation
    if premium_override is not None:
        if premium_override < _MIN_PREMIUM:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"premium_must_be_at_least_{int(_MIN_PREMIUM)}",
            )
        premium_float = premium_override
    else:
        premium_float = (
            float(chosen.premium_estimate) if chosen.premium_estimate else 0.0
        )
    if premium_float <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="premium_estimate_invalid",
        )

    fee_bps = settings.platform_fee_bps
    premium_base_units = round(premium_float * 1_000_000)
    fee_base_units = premium_base_units * fee_bps // 10000

    # Recompute expected payout at the chosen premium (linear scaling)
    from ai.policygen.types import ResolvedPosition  # noqa: PLC0415

    resolved_positions = [
        ResolvedPosition(
            market_ref=p.market_ref,
            question=p.question,
            side=p.side,  # type: ignore[arg-type]
            entry_price_bps=p.entry_price_bps,
            weight_bps=p.weight_bps,
            resolution_date=p.resolution_date,
            ai_reason=p.ai_reason or "",
            candidate=_position_candidate_stub(p),
        )
        for p in positions
    ]
    _, expected_payout = portfolio_economics(
        resolved_positions, premium_float, fee_bps
    )
    chosen.premium_estimate = Decimal(str(premium_float))
    chosen.expected_payout = Decimal(str(expected_payout))

    # Compute maxPayout
    pos_dicts = [
        {"entryPriceBps": p.entry_price_bps, "weightBps": p.weight_bps}
        for p in positions
    ]
    max_payout_base_units = compute_max_payout_base_units(
        premium_base_units, fee_bps, pos_dicts
    )

    # Coverage end: policy.coverage_end > max resolution_date > now+30d
    coverage_end_dt: datetime | None = policy.coverage_end
    if coverage_end_dt is None:
        # Fallback: latest position resolution_date
        res_dates = [p.resolution_date for p in positions if p.resolution_date]
        if res_dates:
            coverage_end_dt = max(res_dates)
    if coverage_end_dt is None:
        # Final fallback: now + 30 days
        from datetime import timedelta

        coverage_end_dt = datetime.now(timezone.utc) + timedelta(days=30)

    coverage_end_unix = int(coverage_end_dt.timestamp())

    # Persist selection
    policy.selected_portfolio_id = portfolio_id
    policy.premium = Decimal(str(premium_float))
    policy.fee = Decimal(str(fee_base_units / 1_000_000))
    # Status stays 'proposed' (funding hasn't happened yet)
    await db.commit()

    on_chain_policy_id = derive_on_chain_policy_id(policy.id)

    # Build position output (authoritative from DB, not client)
    positions_out = [
        PolicyFundingPositionOut(
            market_ref=p.market_ref,
            side_yes=(p.side == "YES"),
            entry_price_bps=p.entry_price_bps,
            weight_bps=p.weight_bps,
        )
        for p in positions
    ]

    return PolicyFundingPlanOut(
        policy_id=policy.id,
        on_chain_policy_id=on_chain_policy_id,
        chain_id=settings.injective_evm_chain_id,
        vault_address=settings.policy_vault_address,
        usdc_address=settings.usdc_address,
        fee_bps=fee_bps,
        premium_base_units=str(premium_base_units),
        max_payout_base_units=str(max_payout_base_units),
        coverage_end=coverage_end_unix,
        positions=positions_out,
    )


def _position_candidate_stub(pos: PolicyPosition):
    """Minimal MarketCandidate for economics recompute from persisted positions."""
    from ai.markets.types import MarketCandidate, MarketPlatform  # noqa: PLC0415

    raw = pos.raw_json or {}
    return MarketCandidate(
        platform=MarketPlatform.POLYMARKET,
        condition_id=pos.market_ref,
        question=pos.question,
        url=raw.get("url") or "",
        volume=float(pos.volume) if pos.volume is not None else None,
        raw=raw,
    )


async def confirm_policy_open(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
    on_chain_policy_id: str,
    open_tx: str,
) -> PolicyDetailOut | None:
    """Task 2: verify on-chain state, activate policy. Returns None → 404."""
    import anyio  # noqa: PLC0415

    from services import chain_service  # noqa: PLC0415

    # Load policy (IDOR)
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

    # Must be proposed + already selected
    if policy.status != "proposed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_status_not_proposed",
        )
    if policy.selected_portfolio_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="portfolio_not_selected",
        )

    # Validate on_chain_policy_id matches deterministic derivation (anti-tamper)
    expected_pid = derive_on_chain_policy_id(policy.id)
    if on_chain_policy_id != expected_pid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="on_chain_policy_id_mismatch",
        )

    # State-based confirmation: read policies(pid) on-chain
    # (red line ②: no receipt-by-hash)
    snapshot = await anyio.to_thread.run_sync(
        lambda: chain_service.read_policy_snapshot(on_chain_policy_id)
    )

    # Verify: user != zero, maxPayout > 0, premium matches
    zero_addr = "0x0000000000000000000000000000000000000000"
    if snapshot["user"] == zero_addr or snapshot["user"] == "0x" + "0" * 40:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="chain_policy_not_confirmed_user_zero",
        )
    if snapshot["maxPayout"] <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="chain_policy_not_confirmed_max_payout_zero",
        )

    # Verify premium matches local expectation
    local_premium_base_units = round(float(policy.premium) * 1_000_000)
    if snapshot["premium"] != local_premium_base_units:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"chain_premium_mismatch: chain={snapshot['premium']} local={local_premium_base_units}",
        )

    # Activate
    policy.on_chain_policy_id = on_chain_policy_id
    policy.open_tx = open_tx
    policy.status = "active"
    # This is a lifecycle timestamp, not mutable product input.  Persist it
    # separately from intake_json so calendar consumers never mistake a later
    # monitoring update for the opening time.
    policy.opened_at = datetime.now(timezone.utc)
    # ``confirm-open`` is the single trustworthy proof of funding.  Advance
    # the Agent projection in the same transaction so the workbench and policy
    # detail never disagree about whether monitoring has begun.
    from services import policy_agent_adapter  # noqa: PLC0415

    task_projection = await policy_agent_adapter.mark_policy_opened(
        db,
        user_id=user_id,
        policy_id=policy.id,
        open_tx=open_tx,
    )
    await db.commit()
    if task_projection is not None:
        task_id, sequences = task_projection
        for sequence in sequences:
            await agent_event_service.publish_notify(task_id, sequence)
    await db.refresh(policy)

    # Return updated detail
    detail = await policy_service.get_policy_detail(
        db, user_id=user_id, policy_id=policy_id
    )
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="policy_refresh_failed",
        )
    return detail
