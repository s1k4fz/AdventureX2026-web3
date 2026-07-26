"""Oracle status service — read-only chain queries for oracle leg visibility.

Provides per-leg OutcomeOracle assertion state to the frontend so users can
observe the full assert → dispute/finalize → resolved lifecycle transparently.
All operations are READ-ONLY (no transactions sent).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.policy import Policy, PolicyPortfolio

logger = logging.getLogger("lemma.services.policy_oracle_status")

# Mirror of chain_service oracle status constants.
_STATUS_NONE = 0
_STATUS_ASSERTED = 1
_STATUS_DISPUTED = 2
_STATUS_RESOLVED = 3

_STATUS_LABELS = {
    _STATUS_NONE: "pending",
    _STATUS_ASSERTED: "asserted",
    _STATUS_DISPUTED: "disputed",
    _STATUS_RESOLVED: "resolved",
}

OracleStatusErrorCode = Literal["not_found", "not_eligible", "chain_error"]


@dataclass(frozen=True, slots=True)
class OracleStatusError(Exception):
    """Structured failure for oracle-status queries."""

    code: OracleStatusErrorCode


def _legacy_payload(*, policy_id: uuid.UUID, on_chain_policy_id: str) -> dict:
    return {
        "policy_id": str(policy_id),
        "on_chain_policy_id": on_chain_policy_id,
        "oracle_address": "",
        "liveness_seconds": settings.outcome_oracle_liveness_seconds,
        "bond_usdc": settings.outcome_oracle_bond_base_units / 1_000_000,
        "legs": [],
        "all_resolved": True,
        "progress_pct": 100,
        "mode": "legacy",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


async def get_oracle_status(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
) -> dict:
    """Return per-leg oracle status for an active or settled on-chain policy.

    Raises OracleStatusError with:
      - not_found: policy missing or not owned by user
      - not_eligible: wrong status or missing on_chain_policy_id / empty positions
      - chain_error: vault snapshot read failed (retryable)

    Returns a legacy payload (mode=legacy) when OutcomeOracle is not configured.
    """
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id, Policy.user_id == user_id)
        .options(
            selectinload(Policy.portfolios).selectinload(PolicyPortfolio.positions)
        )
    )
    policy = result.scalar_one_or_none()
    if policy is None:
        raise OracleStatusError("not_found")
    if policy.status not in ("active", "settled"):
        raise OracleStatusError("not_eligible")
    if not policy.on_chain_policy_id:
        raise OracleStatusError("not_eligible")

    oracle_address = settings.outcome_oracle_address
    if not oracle_address:
        return _legacy_payload(
            policy_id=policy_id,
            on_chain_policy_id=policy.on_chain_policy_id,
        )

    # Build question/side lookup from DB positions.
    db_positions_by_ref: dict[str, tuple[str, str]] = {}
    if policy.selected_portfolio_id is not None:
        for portfolio in policy.portfolios:
            if portfolio.id == policy.selected_portfolio_id:
                for pos in portfolio.positions:
                    db_positions_by_ref[pos.market_ref.lower()] = (
                        pos.question,
                        pos.side,
                    )
                break

    # Read on-chain positions from the vault.
    try:
        from services import chain_service  # noqa: PLC0415

        chain_positions = chain_service.read_policy_snapshot(
            policy.on_chain_policy_id
        )["positions"]
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "oracle-status: failed to read chain positions for %s: %s",
            policy_id,
            exc,
        )
        raise OracleStatusError("chain_error") from exc

    if not chain_positions:
        raise OracleStatusError("not_eligible")

    # Read each leg's oracle assertion state.
    legs: list[dict] = []
    resolved_count = 0

    for pos in chain_positions:
        market_ref: str = pos["marketRef"]
        side_yes: bool = bool(pos.get("sideYes"))

        # DB metadata lookup.
        question, side = db_positions_by_ref.get(
            market_ref.lower(),
            (f"Market {market_ref[:14]}…", "YES" if side_yes else "NO"),
        )

        try:
            from services import chain_service as cs  # noqa: PLC0415

            assertion = cs.read_assertion(market_ref)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "oracle-status: read_assertion failed for %s: %s", market_ref, exc
            )
            # Surface as a pending leg with no chain data.
            legs.append(
                {
                    "market_ref": market_ref,
                    "question": question,
                    "side": side,
                    "status": _STATUS_NONE,
                    "status_label": "pending",
                    "proposer": None,
                    "asserted_yes": None,
                    "assert_time": None,
                    "liveness": None,
                    "challenge_deadline": None,
                    "disputer": None,
                    "final_yes": None,
                    "hit": None,
                }
            )
            continue

        status = assertion["status"]
        if status == _STATUS_RESOLVED:
            resolved_count += 1

        proposer = assertion.get("proposer")
        if proposer and proposer == "0x0000000000000000000000000000000000000000":
            proposer = None

        asserted_yes = bool(assertion["assertedYes"]) if status >= 1 else None
        assert_time = assertion.get("assertTime") or None
        liveness = assertion.get("liveness") or None
        disputer = assertion.get("disputer")
        if disputer and disputer == "0x0000000000000000000000000000000000000000":
            disputer = None
        final_yes = bool(assertion["finalYes"]) if status == _STATUS_RESOLVED else None

        challenge_deadline = None
        if assert_time and liveness and status == _STATUS_ASSERTED:
            challenge_deadline = int(assert_time) + int(liveness)

        # Compute hit: user's side matches the finalized outcome.
        hit: bool | None = None
        if final_yes is not None:
            hit = (side == "YES" and final_yes) or (side == "NO" and not final_yes)

        legs.append(
            {
                "market_ref": market_ref,
                "question": question,
                "side": side,
                "status": status,
                "status_label": _STATUS_LABELS.get(status, "unknown"),
                "proposer": proposer,
                "asserted_yes": asserted_yes,
                "assert_time": int(assert_time) if assert_time else None,
                "liveness": int(liveness) if liveness else None,
                "challenge_deadline": challenge_deadline,
                "disputer": disputer,
                "final_yes": final_yes,
                "hit": hit,
            }
        )

    total = len(legs)
    all_resolved = total > 0 and resolved_count == total
    progress_pct = int((resolved_count / total) * 100) if total > 0 else 0

    return {
        "policy_id": str(policy_id),
        "on_chain_policy_id": policy.on_chain_policy_id,
        "oracle_address": oracle_address,
        "liveness_seconds": settings.outcome_oracle_liveness_seconds,
        "bond_usdc": settings.outcome_oracle_bond_base_units / 1_000_000,
        "legs": legs,
        "all_resolved": all_resolved,
        "progress_pct": progress_pct,
        "mode": "live",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
