"""Demo accelerator — one-click 待结算保单 on the REAL Injective EVM testnet.

Mirrors scripts/seed_settle_test.py as a service the API can call: pick
already-resolved Polymarket markets (production resolution reader), open a
REAL on-chain policy in the PolicyVault with coverage_end in the past, then
insert the matching DB snapshot for the requesting user. The policy lands in
status=active + expired coverage, so the frontend immediately shows 待结算
and the (demo-)admin can drive the genuine oracle settlement path.

Chain rules follow the project red lines: testnet chainId 1439, legacy txs
only, committed-state confirmation (nonce advance + storage read), no mocks.

To keep the API call short the deployer acts as the policy holder: it mints
itself USDC when short and opens the policy directly (2-3 txs, ~30-60s)
instead of funding a fresh throwaway wallet like the seed script does.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition
from services.policy_chain_service import derive_on_chain_policy_id

logger = logging.getLogger("lemma.services.policy_demo_service")

_USDC_1 = 10**6
_DEMO_PREMIUM_USDC = 50
_GAMMA_CLOSED_URL = (
    "https://gamma-api.polymarket.com/markets"
    "?closed=true&limit=80&order=volumeNum&ascending=false"
)
# Per-leg plan: weights sum to 10000; the last leg deliberately takes the
# LOSING side so the demo settlement shows a partial (not full) payout.
_LEG_WEIGHTS_BPS = (4000, 3500, 2500)
_LEG_ENTRIES_BPS = (5000, 4000, 6000)
_LEG_HITS = (True, True, False)

# One chain open at a time per process: the deployer nonce is a shared
# resource and the demo button is expected to be pressed rarely.
_create_lock = threading.Lock()

_ERC20_MIN_ABI = [
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "mint",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    },
]


class DemoPolicyError(Exception):
    """Structured failure for the demo creation flow."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def _pick_resolved_markets(n: int = 3) -> list[dict]:
    """Pick n resolved Polymarket markets confirmed by the production reader."""
    import httpx  # noqa: PLC0415

    from ai.markets.resolution import get_market_resolution  # noqa: PLC0415

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(_GAMMA_CLOSED_URL)
        response.raise_for_status()
        rows = response.json()
    rows = rows if isinstance(rows, list) else rows.get("data", [])

    picked: list[dict] = []
    for market in rows:
        cond = market.get("conditionId") or ""
        if not (isinstance(cond, str) and cond.startswith("0x") and len(cond) == 66):
            continue
        resolution = await get_market_resolution(cond)
        if (
            resolution is None
            or not resolution["resolved"]
            or resolution["outcome_yes"] is None
        ):
            continue
        end_date_raw = market.get("endDate")
        picked.append(
            {
                "cond": cond,
                "outcome_yes": bool(resolution["outcome_yes"]),
                "question": (market.get("question") or "")[:200],
                "end_date": end_date_raw,
                "raw": {
                    "liquidity": market.get("liquidityNum"),
                    "spread": market.get("spread"),
                    "category": market.get("category"),
                },
                "volume": market.get("volumeNum"),
            }
        )
        if len(picked) >= n:
            break
    if len(picked) < n:
        raise DemoPolicyError(
            "markets_unavailable",
            f"only found {len(picked)}/{n} resolved Polymarket markets",
        )
    return picked


def _send_legacy_tx(w3, acct, tx, label: str) -> str:
    """Sign + broadcast a legacy tx, confirm by nonce advance (red lines ①②)."""
    from services.chain_service import _broadcast_legacy, _wait_nonce_advance  # noqa: PLC0415

    tx_hash, nonce = _broadcast_legacy(w3, acct, tx)
    if not _wait_nonce_advance(w3, acct.address, nonce):
        raise DemoPolicyError("chain_timeout", f"{label} tx {tx_hash} not confirmed")
    logger.info("demo policy: %s tx=%s", label, tx_hash)
    return tx_hash


def _open_policy_on_chain(
    policy_id: uuid.UUID, markets: list[dict]
) -> tuple[str, str, int, int]:
    """Open the demo policy on the PolicyVault (blocking; run in a thread).

    Returns (on_chain_policy_id, open_tx, fee_base_units, coverage_end_ts).
    """
    from eth_account import Account  # noqa: PLC0415
    from web3 import Web3  # noqa: PLC0415

    from services.chain_service import _get_vault_contract  # noqa: PLC0415

    if not settings.deployer_private_key:
        raise DemoPolicyError("chain_not_configured", "DEPLOYER_PRIVATE_KEY not set")

    w3, vault = _get_vault_contract()
    acct = Account.from_key(settings.deployer_private_key.strip())
    usdc = w3.eth.contract(
        address=Web3.to_checksum_address(settings.usdc_address),
        abi=_ERC20_MIN_ABI,
    )

    fee_bps = vault.functions.feeBps().call()
    premium_base = _DEMO_PREMIUM_USDC * _USDC_1
    fee_base = premium_base * fee_bps // 10_000
    net = premium_base - fee_base
    shares = [
        net * w // 10_000 * 10_000 // e
        for e, w in zip(_LEG_ENTRIES_BPS, _LEG_WEIGHTS_BPS)
    ]
    max_payout = sum(shares)
    if max_payout > vault.functions.freeLiquidity().call():
        raise DemoPolicyError(
            "insufficient_liquidity", "vault freeLiquidity below demo maxPayout"
        )

    def _legacy_fields(gas: int) -> dict:
        return {
            "gas": gas,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": w3.eth.get_transaction_count(acct.address, "latest"),
            "chainId": settings.injective_evm_chain_id,
            "from": acct.address,
        }

    if usdc.functions.balanceOf(acct.address).call() < premium_base:
        _send_legacy_tx(
            w3,
            acct,
            usdc.functions.mint(acct.address, premium_base * 10).build_transaction(
                _legacy_fields(150_000)
            ),
            "mint USDC",
        )
    if usdc.functions.allowance(acct.address, vault.address).call() < premium_base:
        _send_legacy_tx(
            w3,
            acct,
            usdc.functions.approve(
                vault.address, premium_base * 100
            ).build_transaction(_legacy_fields(150_000)),
            "approve vault",
        )

    on_chain_pid_hex = derive_on_chain_policy_id(policy_id)
    pid_bytes = bytes.fromhex(on_chain_pid_hex[2:])
    # side == outcome for hit legs; opposite for the deliberate miss leg.
    positions_chain = [
        (
            bytes.fromhex(m["cond"][2:]),
            m["outcome_yes"] if hit else not m["outcome_yes"],
            entry,
            weight,
        )
        for m, hit, entry, weight in zip(
            markets, _LEG_HITS, _LEG_ENTRIES_BPS, _LEG_WEIGHTS_BPS
        )
    ]
    # Already expired -> the policy is immediately settleable (待结算).
    coverage_end_ts = int(time.time()) - 3600

    open_tx = _send_legacy_tx(
        w3,
        acct,
        vault.functions.openPolicy(
            pid_bytes, positions_chain, premium_base, coverage_end_ts
        ).build_transaction(_legacy_fields(1_300_000)),
        "openPolicy",
    )

    # Committed-state check: the policy must exist in vault storage.
    pol_user = vault.functions.policies(pid_bytes).call()[0]
    if int(pol_user, 16) == 0:
        raise DemoPolicyError("chain_verify_failed", "openPolicy not found in storage")

    return on_chain_pid_hex, open_tx, fee_base, coverage_end_ts


async def create_pending_settlement_policy(
    db: AsyncSession, *, user_id: uuid.UUID
) -> uuid.UUID:
    """One-click demo: real on-chain policy already past coverage (待结算).

    Raises DemoPolicyError (busy / markets_unavailable / chain_*) on failure.
    The DB snapshot is only written after the chain open is confirmed, so a
    failed run leaves no dangling policy row.
    """
    if not _create_lock.acquire(blocking=False):
        raise DemoPolicyError("busy", "another demo policy is being created")
    try:
        markets = await _pick_resolved_markets(3)
        policy_id = uuid.uuid4()
        on_chain_pid, open_tx, fee_base, coverage_end_ts = (
            await anyio.to_thread.run_sync(_open_policy_on_chain, policy_id, markets)
        )
    finally:
        _create_lock.release()

    now = datetime.now(timezone.utc)
    policy = Policy(
        id=policy_id,
        user_id=user_id,
        need_text=(
            "演示保单 — 一键生成的已到期保障方案，标的为真实已结算的 "
            "Polymarket 市场，可直接演示预言机结算全流程。"
        ),
        title="演示 · 待结算保单",
        status="active",
        search_status="searched",
        coverage_end=datetime.fromtimestamp(coverage_end_ts, tz=timezone.utc),
        on_chain_policy_id=on_chain_pid,
        open_tx=open_tx,
        opened_at=now - timedelta(days=7),
        premium=Decimal(str(_DEMO_PREMIUM_USDC)),
        fee=Decimal(str(fee_base / _USDC_1)),
        intake_json={"questionnaire": {"questions": []}, "answers": {}, "demo": True},
    )
    db.add(policy)

    portfolio = PolicyPortfolio(
        id=uuid.uuid4(),
        policy_id=policy_id,
        order_index=0,
        tier="balanced",
        title="演示组合（已到期）",
        thesis=(
            "一键演示组合：三条真实 Polymarket 已结算市场腿，"
            "其中一条故意押在落败侧，结算后可看到部分赔付。"
        ),
        premium_estimate=Decimal(str(_DEMO_PREMIUM_USDC)),
        expected_payout=Decimal(str(_DEMO_PREMIUM_USDC)) * Decimal("1.6"),
        metrics_json={},
        scenarios_json=[],
        status="selected",
    )
    db.add(portfolio)
    policy.selected_portfolio_id = portfolio.id

    for idx, (market, hit, entry, weight) in enumerate(
        zip(markets, _LEG_HITS, _LEG_ENTRIES_BPS, _LEG_WEIGHTS_BPS)
    ):
        side_yes = market["outcome_yes"] if hit else not market["outcome_yes"]
        resolution_date = None
        if market.get("end_date"):
            try:
                resolution_date = datetime.fromisoformat(
                    str(market["end_date"]).replace("Z", "+00:00")
                )
            except ValueError:
                resolution_date = None
        db.add(
            PolicyPosition(
                id=uuid.uuid4(),
                portfolio_id=portfolio.id,
                order_index=idx,
                market_ref=market["cond"],
                question=market["question"],
                side="YES" if side_yes else "NO",
                entry_price_bps=entry,
                weight_bps=weight,
                resolution_date=resolution_date,
                ai_reason="演示腿：真实已结算市场，" + ("预期命中" if hit else "预期落空"),
                odds=Decimal(str(entry / 10_000)),
                volume=(
                    Decimal(str(market["volume"]))
                    if market.get("volume") is not None
                    else None
                ),
                raw_json=market["raw"],
            )
        )

    await db.commit()
    logger.info(
        "demo policy created: id=%s chain_pid=%s open_tx=%s",
        policy_id,
        on_chain_pid,
        open_tx,
    )
    return policy_id
