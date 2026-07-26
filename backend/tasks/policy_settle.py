"""M3 relayer — settlement task for the 差分机 (Difference Engine).

Two settlement paths, selected by whether OUTCOME_ORACLE_ADDRESS is configured:

  1. Oracle path (production): the relayer READS each leg's outcome from Polymarket
     Gamma, ASSERTS it on the on-chain OutcomeOracle (bonded), waits out the
     challenge window, FINALIZES it, then calls settlePolicyFromOracle — which
     recomputes the payout from the on-chain, publicly-challengeable outcomes.
  2. Legacy path (fallback when no oracle wired): the relayer reads Gamma and calls
     settlePolicy(policyId, outcomesYes[]) directly.

Registered in celery_app includes for M3. settle_policy_task wraps run_settle()
which dispatches between the two paths. run_settle is idempotent and safe to
re-run: the oracle path asserts on the first pass and finalizes+settles once the
challenge window has elapsed on a later pass.
"""

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable

from core.config import settings
from tasks.celery_app import celery_app

logger = logging.getLogger("lemma.tasks.policy_settle")


class SettleNotReady(Exception):
    """Settlement cannot finish yet (oracle/Gamma not ready). Celery should retry.

    Historically this path returned silently, so Celery marked the task SUCCESS and
    — without beat re-enqueue — never called settlePolicyFromOracle, leaving USDC
    stuck in the vault after the oracle had already Resolved.
    """


def _compute_payout(positions: list[dict], outcomes_yes: list[bool]) -> int:
    """Pure function: compute payout given positions and outcomes.

    positions: [{sideYes: bool, shares: int, ...}]
    outcomes_yes: [bool] in same order as positions
    payout = sum of shares_i where pos.sideYes == outcomeYes_i (hit leg)
    """
    payout = 0
    for pos, outcome in zip(positions, outcomes_yes):
        if pos["sideYes"] == outcome:
            payout += pos["shares"]
    return payout


def _plan_oracle_actions(legs: list[dict]) -> dict:
    """Pure planner for the oracle-driven settlement state machine.

    Each leg: {
      status: int,            # 0=None, 1=Asserted, 2=Disputed, 3=Resolved
      has_resolution: bool,   # Polymarket (Gamma) reports the market resolved
      liveness_elapsed: bool, # the challenge window has passed
      is_own: bool,           # the on-chain proposer is our relayer
      gamma_agrees: bool,     # asserted value matches our Gamma outcome
    }

    Returns {to_assert, to_finalize, to_dispute, to_resolve, all_resolved}:
      - to_assert : status None + Gamma resolved -> post our assertion
      - to_dispute: status Asserted, not ours, still in window, Gamma disagrees
      - to_finalize: status Asserted + window elapsed, and (ours / agrees / unverifiable)
      - to_resolve: status Disputed + Gamma resolved -> arbitrate to our outcome
    """
    to_assert: list[int] = []
    to_finalize: list[int] = []
    to_dispute: list[int] = []
    to_resolve: list[int] = []
    for i, leg in enumerate(legs):
        status = leg.get("status")
        if status == 0:
            if leg.get("has_resolution"):
                to_assert.append(i)
        elif status == 1:
            if leg.get("liveness_elapsed"):
                # Finalize only if it is ours, agrees with Gamma, or we cannot verify.
                if leg.get("is_own") or leg.get("gamma_agrees") or not leg.get("has_resolution"):
                    to_finalize.append(i)
                # else: window elapsed on a disagreeing 3rd-party assertion -> stuck (alert)
            elif not leg.get("is_own") and leg.get("has_resolution") and not leg.get("gamma_agrees"):
                to_dispute.append(i)
        elif status == 2:
            if leg.get("has_resolution"):
                to_resolve.append(i)
    all_resolved = bool(legs) and all(leg.get("status") == 3 for leg in legs)
    return {
        "to_assert": to_assert,
        "to_finalize": to_finalize,
        "to_dispute": to_dispute,
        "to_resolve": to_resolve,
        "all_resolved": all_resolved,
    }


def _liveness_elapsed(assertion: dict) -> bool:
    """Whether an assertion's on-chain challenge window has elapsed (wall-clock).

    The on-chain finalize() re-checks block.timestamp, so this only gates WHEN we
    attempt a finalize tx to avoid sending doomed transactions.
    """
    assert_time = assertion.get("assertTime") or 0
    liveness = assertion.get("liveness") or 0
    return assert_time > 0 and time.time() >= assert_time + liveness


async def _resolve_via_gamma(market_ref: str):
    """Look up a market's resolution on Polymarket Gamma.

    The on-chain marketRef is a zero-padded bytes32; Gamma conditionIds are the
    unpadded hex. Try the unpadded form first, then the full padded value.
    """
    from ai.markets.resolution import get_market_resolution  # noqa: PLC0415

    condition_id_short = "0x" + market_ref[2:].lstrip("0")
    if not condition_id_short or condition_id_short == "0x":
        condition_id_short = "0x0"
    resolution = await get_market_resolution(condition_id_short)
    if resolution is None:
        resolution = await get_market_resolution(market_ref)
    return resolution


async def _build_leg(pos: dict, relayer_addr: str) -> dict:
    """Read a leg's on-chain oracle state and (unless already Resolved) its Gamma
    truth, producing the input dict for _plan_oracle_actions.
    """
    from services import chain_service  # noqa: PLC0415

    market_ref = pos["marketRef"]
    a = chain_service.read_assertion(market_ref)
    status = a["status"]
    asserted_yes = bool(a["assertedYes"]) if status >= 1 else None
    leg = {
        "market_ref": market_ref,
        "pos": pos,
        "status": status,
        "is_own": status >= 1 and a["proposer"].lower() == relayer_addr.lower(),
        "asserted_yes": asserted_yes,
        "liveness_elapsed": _liveness_elapsed(a),
        "has_resolution": False,
        "our_yes": None,
        "gamma_agrees": False,
    }
    if status != chain_service.ORACLE_STATUS_RESOLVED:
        res = await _resolve_via_gamma(market_ref)
        if res is not None and res["resolved"]:
            leg["has_resolution"] = True
            leg["our_yes"] = res["outcome_yes"] is True
            if asserted_yes is not None:
                leg["gamma_agrees"] = asserted_yes == leg["our_yes"]
    return leg


def _build_settlement_outcomes(
    chain_positions: list[dict],
    outcomes_yes: list[bool],
    db_positions_by_ref: dict[str, tuple[str, str]],
) -> list[dict[str, object]]:
    """Assemble the per-leg settlement record persisted to intake_json."""
    settlement_outcomes: list[dict[str, object]] = []
    for pos, outcome_yes in zip(chain_positions, outcomes_yes):
        market_ref = pos["marketRef"]
        side_yes = bool(pos.get("sideYes"))
        insured_side = "YES" if side_yes else "NO"
        question, side = db_positions_by_ref.get(
            market_ref.lower(),
            (f"Market {market_ref[:10]}…", insured_side),
        )
        if side not in ("YES", "NO"):
            side = insured_side
        hit = (side == "YES" and outcome_yes) or (side == "NO" and not outcome_yes)
        settlement_outcomes.append(
            {
                "marketRef": market_ref,
                "question": question,
                "side": side,
                "outcomeYes": outcome_yes,
                "hit": hit,
            }
        )
    return settlement_outcomes


async def _load_settle_context(policy_id: str) -> tuple[str, dict[str, tuple[str, str]]] | None:
    """Load (on_chain_policy_id, db_positions_by_ref) for an active policy.

    Returns None (with a log line) if the policy is missing, not active, or has no
    on-chain id — the same guards the settlement paths need before touching chain.
    """
    from sqlalchemy import select  # noqa: PLC0415
    from sqlalchemy.orm import selectinload  # noqa: PLC0415

    from core.database import AsyncSessionLocal  # noqa: PLC0415
    from models.policy import Policy, PolicyPortfolio  # noqa: PLC0415

    pid = uuid.UUID(policy_id)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Policy)
            .where(Policy.id == pid)
            .options(selectinload(Policy.portfolios).selectinload(PolicyPortfolio.positions))
        )
        policy = result.scalar_one_or_none()
        if policy is None:
            logger.error("settle: policy %s not found", policy_id)
            return None
        if policy.status != "active":
            logger.warning("settle: policy %s status=%s, not active", policy_id, policy.status)
            return None
        if not policy.on_chain_policy_id:
            logger.error("settle: policy %s has no on_chain_policy_id", policy_id)
            return None

        on_chain_pid = policy.on_chain_policy_id
        db_positions_by_ref: dict[str, tuple[str, str]] = {}
        if policy.selected_portfolio_id is not None:
            for portfolio in policy.portfolios:
                if portfolio.id == policy.selected_portfolio_id:
                    for pos in portfolio.positions:
                        db_positions_by_ref[pos.market_ref.lower()] = (pos.question, pos.side)
                    break
    return on_chain_pid, db_positions_by_ref


async def _persist_settlement(
    policy_id: str,
    settle_tx: str,
    payout_base_units: int,
    settlement_outcomes: list[dict[str, object]],
) -> None:
    """Mark the policy settled and record tx/payout/outcomes."""
    from decimal import Decimal  # noqa: PLC0415

    from sqlalchemy import select  # noqa: PLC0415

    from core.database import AsyncSessionLocal  # noqa: PLC0415
    from models.policy import Policy  # noqa: PLC0415

    pid = uuid.UUID(policy_id)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Policy).where(Policy.id == pid))
        policy = result.scalar_one_or_none()
        if policy is None:
            logger.error("settle: policy %s disappeared during settlement", policy_id)
            return
        policy.settle_tx = settle_tx
        policy.payout = Decimal(str(payout_base_units / 1_000_000))
        policy.status = "settled"
        policy.intake_json = {
            **(policy.intake_json or {}),
            "settlementOutcomes": settlement_outcomes,
        }
        await db.commit()
        logger.info("settle: policy %s settled, payout=%s USDC", policy_id, policy.payout)


# ═══════════════════════════════════════════════════════════════════════════════
#                         ORACLE PATH (production)
# ═══════════════════════════════════════════════════════════════════════════════


async def _async_run_assert(policy_id: str) -> None:
    """Phase 1: assert resolved outcomes, and dispute wrong 3rd-party assertions.

    For every leg: if unasserted and resolved on Gamma, post a bonded assertion; if
    someone else asserted a value that disagrees with our Gamma truth and the
    challenge window is still open, dispute it. Idempotent.
    """
    from services import chain_service  # noqa: PLC0415

    ctx = await _load_settle_context(policy_id)
    if ctx is None:
        return
    on_chain_pid, _ = ctx

    chain_positions = chain_service.read_policy_snapshot(on_chain_pid)["positions"]
    if not chain_positions:
        logger.error("assert: no on-chain positions for %s", on_chain_pid)
        return

    relayer_addr = chain_service.relayer_address()
    legs = [await _build_leg(pos, relayer_addr) for pos in chain_positions]
    plan = _plan_oracle_actions(legs)

    for i in plan["to_assert"]:
        leg = legs[i]
        tx = chain_service.send_assert_tx(leg["market_ref"], leg["our_yes"])
        logger.info("assert: %s outcome_yes=%s tx=%s", leg["market_ref"], leg["our_yes"], tx)

    for i in plan["to_dispute"]:
        leg = legs[i]
        tx = chain_service.send_dispute_tx(leg["market_ref"])
        logger.warning(
            "assert: DISPUTED wrong assertion for %s (theirs=%s ours=%s) tx=%s",
            leg["market_ref"], leg["asserted_yes"], leg["our_yes"], tx,
        )

    # A wrong 3rd-party assertion whose window already closed cannot be fixed
    # on-chain -> surface loudly so an operator can intervene (settlement will stall).
    for leg in legs:
        if (
            leg["status"] == chain_service.ORACLE_STATUS_ASSERTED
            and leg["liveness_elapsed"]
            and not leg["is_own"]
            and leg["has_resolution"]
            and not leg["gamma_agrees"]
        ):
            logger.error(
                "assert: leg %s has a WRONG assertion past its challenge window "
                "(theirs=%s ours=%s); settlement is blocked",
                leg["market_ref"], leg["asserted_yes"], leg["our_yes"],
            )


async def _async_run_settle_oracle(policy_id: str) -> None:
    """Phase 2: arbitrate disputes, finalize elapsed assertions, then settle.

    Resolves any disputed leg to our Gamma truth (owner arbitration; MVP relayer ==
    oracle owner), finalizes elapsed undisputed assertions, and — only if ALL legs
    are Resolved — triggers settlePolicyFromOracle and records the result.
    """
    from services import chain_service  # noqa: PLC0415

    ctx = await _load_settle_context(policy_id)
    if ctx is None:
        return
    on_chain_pid, db_positions_by_ref = ctx

    chain_positions = chain_service.read_policy_snapshot(on_chain_pid)["positions"]
    if not chain_positions:
        logger.error("settle: no on-chain positions for %s", on_chain_pid)
        return

    relayer_addr = chain_service.relayer_address()
    legs = [await _build_leg(pos, relayer_addr) for pos in chain_positions]
    plan = _plan_oracle_actions(legs)

    # Arbitrate disputed legs to our Gamma truth, then finalize elapsed assertions.
    for i in plan["to_resolve"]:
        leg = legs[i]
        tx = chain_service.send_resolve_dispute_tx(leg["market_ref"], leg["our_yes"])
        logger.warning(
            "settle: arbitrated dispute %s final_yes=%s tx=%s", leg["market_ref"], leg["our_yes"], tx
        )
    for i in plan["to_finalize"]:
        leg = legs[i]
        tx = chain_service.send_finalize_tx(leg["market_ref"])
        logger.info("settle: finalized %s tx=%s", leg["market_ref"], tx)

    # Collect finalized outcomes in strict chain-leg order.
    outcomes_yes: list[bool] = []
    all_resolved = True
    for pos in chain_positions:
        assertion = chain_service.read_assertion(pos["marketRef"])
        if assertion["status"] != chain_service.ORACLE_STATUS_RESOLVED:
            logger.info(
                "settle: leg %s not resolved (status=%s) for policy %s, will retry",
                pos["marketRef"],
                assertion["status"],
                policy_id,
            )
            all_resolved = False
            break
        outcomes_yes.append(bool(assertion["finalYes"]))

    if not all_resolved:
        raise SettleNotReady(f"oracle legs not all resolved for policy {policy_id}")

    settlement_outcomes = _build_settlement_outcomes(chain_positions, outcomes_yes, db_positions_by_ref)
    payout_base_units = _compute_payout(chain_positions, outcomes_yes)

    logger.info("settle: settlePolicyFromOracle for %s, outcomes=%s", on_chain_pid, outcomes_yes)
    settle_tx = chain_service.send_settle_from_oracle_tx(on_chain_pid)
    logger.info("settle: confirmed tx=%s for policy %s", settle_tx, policy_id)

    await _persist_settlement(policy_id, settle_tx, payout_base_units, settlement_outcomes)


# ═══════════════════════════════════════════════════════════════════════════════
#                         LEGACY PATH (no oracle wired)
# ═══════════════════════════════════════════════════════════════════════════════


async def _async_run_settle_legacy(policy_id: str) -> None:
    """Fallback: read outcomes from Gamma and call settlePolicy directly.

    Used only when OUTCOME_ORACLE_ADDRESS is unset. Outcomes are relayer-supplied
    (no on-chain verification) — kept for environments where the oracle is not yet
    deployed.
    """
    from services import chain_service  # noqa: PLC0415

    ctx = await _load_settle_context(policy_id)
    if ctx is None:
        return
    on_chain_pid, db_positions_by_ref = ctx

    chain_positions = chain_service.read_policy_snapshot(on_chain_pid)["positions"]
    if not chain_positions:
        logger.error("settle: no on-chain positions for %s", on_chain_pid)
        return

    outcomes_yes: list[bool] = []
    all_resolved = True
    for pos in chain_positions:
        market_ref = pos["marketRef"]
        resolution = await _resolve_via_gamma(market_ref)
        if resolution is None or not resolution["resolved"]:
            logger.info(
                "settle: market %s not yet resolved for policy %s, skipping",
                market_ref,
                policy_id,
            )
            all_resolved = False
            break
        outcomes_yes.append(resolution["outcome_yes"] is True)

    if not all_resolved:
        logger.info("settle: not all markets resolved for policy %s, will retry later", policy_id)
        raise SettleNotReady(f"gamma markets not all resolved for policy {policy_id}")

    settlement_outcomes = _build_settlement_outcomes(chain_positions, outcomes_yes, db_positions_by_ref)
    payout_base_units = _compute_payout(chain_positions, outcomes_yes)

    logger.info("settle: sending settlePolicy for %s, outcomes=%s", on_chain_pid, outcomes_yes)
    settle_tx = chain_service.send_settle_tx(on_chain_pid, outcomes_yes)
    logger.info("settle: confirmed tx=%s for policy %s", settle_tx, policy_id)

    await _persist_settlement(policy_id, settle_tx, payout_base_units, settlement_outcomes)


# ═══════════════════════════════════════════════════════════════════════════════
#                         ENTRY POINTS + CELERY TASKS
# ═══════════════════════════════════════════════════════════════════════════════


async def _dispose_engine_after(main: Awaitable[None]) -> None:
    """Run ``main`` then dispose the worker's module engine before the loop closes.

    Every Celery task here owns its own ``asyncio.run`` loop, but the module-level
    AsyncEngine pools asyncpg connections bound to the loop they were opened on.
    Left pooled, such a connection is reused by the next task's (or the next
    ``asyncio.run``'s) loop and raises ``RuntimeError: Event loop is closed``.
    Disposing while this loop is still alive drops those connections cleanly; the
    engine lazily rebuilds a fresh pool on the next task. Mirrors the per-task
    ``engine.dispose()`` discipline in course_search / course_organize / video_cleanup.
    """
    from core.database import engine  # noqa: PLC0415

    try:
        await main
    finally:
        await engine.dispose()


async def _async_run_settle_oracle_path(policy_id: str) -> None:
    """Oracle path body: assert (idempotent) then finalize+settle, sharing one loop.

    Assert and settle previously ran in two separate ``asyncio.run`` loops; the
    second reused the first loop's pooled connection and died on "Event loop is
    closed". Running both in one coroutine keeps the connection lifetime inside a
    single loop.
    """
    await _async_run_assert(policy_id)
    await _async_run_settle_oracle(policy_id)


def run_assert(policy_id: str) -> None:
    """Synchronous entry point for the oracle assert phase."""
    asyncio.run(_dispose_engine_after(_async_run_assert(policy_id)))


def run_settle(policy_id: str) -> None:
    """Synchronous entry point. Dispatches between the oracle and legacy paths.

    Oracle path: assert (idempotent) then finalize+settle. On the first run legs
    are asserted and settlement no-ops (challenge window open); a later run
    finalizes and settles once the window has elapsed.
    """
    if settings.outcome_oracle_address:
        asyncio.run(_dispose_engine_after(_async_run_settle_oracle_path(policy_id)))
    else:
        asyncio.run(_dispose_engine_after(_async_run_settle_legacy(policy_id)))


@celery_app.task(name="policy.assert_outcomes", bind=True, max_retries=5, default_retry_delay=120)
def assert_outcomes_task(self, policy_id: str) -> None:
    """Celery task: assert a policy's resolved legs on the oracle (oracle path only)."""
    if not settings.outcome_oracle_address:
        return
    try:
        run_assert(policy_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("assert task failed for %s, retrying", policy_id)
        raise self.retry(exc=exc) from exc


@celery_app.task(name="policy.settle", bind=True, max_retries=5, default_retry_delay=300)
def settle_policy_task(self, policy_id: str) -> None:
    """Celery task: settle a policy. Retries on transient failures."""
    try:
        run_settle(policy_id)
    except SettleNotReady as exc:
        logger.info("settle task not ready for %s: %s", policy_id, exc)
        raise self.retry(exc=exc) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("settle task failed for %s, retrying", policy_id)
        raise self.retry(exc=exc) from exc


@celery_app.task(name="policy.settle_scan")
def settle_scan_task() -> None:
    """Periodic beat task: find active policies past coverageEnd and enqueue settlement."""
    asyncio.run(_dispose_engine_after(_scan_and_enqueue()))


async def _scan_and_enqueue() -> None:
    """Query DB for active policies whose coverage_end <= now, enqueue each.

    Enqueues the assert phase (oracle path) and the settle phase per policy. Both
    tasks are idempotent, so running them each scan safely drives the state machine.
    """
    from datetime import datetime, timezone  # noqa: PLC0415

    from sqlalchemy import select  # noqa: PLC0415

    from core.database import AsyncSessionLocal  # noqa: PLC0415
    from models.policy import Policy  # noqa: PLC0415

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Policy.id).where(
                Policy.status == "active",
                Policy.on_chain_policy_id.isnot(None),
                Policy.coverage_end <= now,
            )
        )
        policy_ids = [row[0] for row in result.all()]

    for pid in policy_ids:
        if settings.outcome_oracle_address:
            assert_outcomes_task.delay(str(pid))
        settle_policy_task.delay(str(pid))
        logger.info("settle_scan: enqueued settlement for policy %s", pid)
