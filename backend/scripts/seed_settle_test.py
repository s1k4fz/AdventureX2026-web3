"""Seed a test policy ready for settlement (frontend E2E demo).

Creates a real on-chain policy using already-resolved Polymarket markets,
then inserts the matching DB record linked to the specified admin user.
The policy ends up in status=active with coverage_end in the past,
so the frontend shows "待结算" and the admin can hit "一键结算".

Usage (from backend/):
  uv run python scripts/seed_settle_test.py

Environment:
  Reads from .env (load with `set -a; . .env; set +a` first if running bare).
  Requires: DATABASE_URL, INJECTIVE_EVM_RPC_URL, DEPLOYER_PRIVATE_KEY,
            RELAYER_PRIVATE_KEY, POLICY_VAULT_ADDRESS, USDC_ADDRESS,
            (optionally OUTCOME_ORACLE_ADDRESS for the oracle path).

  SEED_USER_EMAIL  — defaults to 'mirahikari+admin1@gcxstudio.cn'
  SEED_PREMIUM     — USDC premium amount, defaults to 50
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

# Ensure backend/ is on sys.path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from eth_account import Account  # noqa: E402
from web3 import Web3  # noqa: E402

from ai.markets.resolution import get_market_resolution  # noqa: E402
from core.config import settings  # noqa: E402
from core.database import AsyncSessionLocal, engine  # noqa: E402
from models.policy import Policy, PolicyPortfolio, PolicyPosition  # noqa: E402
from services.policy_chain_service import derive_on_chain_policy_id  # noqa: E402

CHAIN_ID = settings.injective_evm_chain_id
GAS_PRICE = settings.injective_evm_gas_price_wei
USDC_1 = 10**6
OUT = ROOT.parent / "contracts" / "out"
GAMMA = "https://gamma-api.polymarket.com/markets?closed=true&limit=80&order=volumeNum&ascending=false"

SEED_USER_EMAIL = os.environ.get("SEED_USER_EMAIL", "mirahikari+admin1@gcxstudio.cn")
SEED_PREMIUM = int(os.environ.get("SEED_PREMIUM", "50"))


def load_abi(sol: str, name: str) -> list:
    return json.loads((OUT / sol / f"{name}.json").read_text())["abi"]


async def pick_resolved_markets(n: int = 3) -> list[dict]:
    """Pick n resolved Polymarket markets confirmed by the production reader."""
    import httpx  # noqa: PLC0415

    rows = httpx.get(GAMMA, timeout=30).json()
    rows = rows if isinstance(rows, list) else rows.get("data", [])
    yes_won: list[dict] = []
    no_won: list[dict] = []
    for m in rows:
        cond = m.get("conditionId") or ""
        if not (isinstance(cond, str) and cond.startswith("0x") and len(cond) == 66):
            continue
        res = await get_market_resolution(cond)
        if not res or not res["resolved"] or res["outcome_yes"] is None:
            continue
        rec = {
            "cond": cond,
            "outcome_yes": res["outcome_yes"],
            "q": (m.get("question") or "")[:80],
        }
        (yes_won if res["outcome_yes"] else no_won).append(rec)
        if len(yes_won) >= 2 and len(no_won) >= 1:
            break
    picked = (yes_won[:2] + no_won[:1])
    if len(picked) < n:
        picked = (yes_won + no_won)[:n]
    return picked


def send_tx(w3, acct, tx, label: str) -> str:
    """Sign, broadcast, and confirm a legacy tx by nonce advance."""
    n = w3.eth.get_transaction_count(acct.address, "latest")
    tx.setdefault("nonce", n)
    tx.update({"gasPrice": GAS_PRICE, "chainId": CHAIN_ID, "from": acct.address})
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)
    raw = acct.sign_transaction(tx).raw_transaction
    h = None
    for i in range(8):
        try:
            h = w3.eth.send_raw_transaction(raw)
            break
        except Exception as exc:  # noqa: BLE001
            if "known" in str(exc).lower():
                break
            time.sleep(2)
            if i == 7:
                raise
    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(acct.address, "latest") >= n + 1:
            break
        time.sleep(2)
    else:
        raise RuntimeError(f"{label}: nonce stuck at {n}")
    txhash = (h.hex() if hasattr(h, "hex") else str(h)) if h else "0x(known)"
    if txhash and not txhash.startswith("0x"):
        txhash = "0x" + txhash
    print(f"  [{label}] tx={txhash}")
    return txhash


async def find_user_id(email: str) -> uuid.UUID:
    """Look up the profile id for the given email."""
    from sqlalchemy import select  # noqa: PLC0415

    from models.profile import Profile  # noqa: PLC0415

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Profile.id).where(Profile.email == email)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise RuntimeError(
                f"No profile found for email={email}. "
                "Make sure the user exists in Supabase Auth + profiles table."
            )
        return row


async def insert_policy(
    user_id: uuid.UUID,
    *,
    policy_id: uuid.UUID,
    on_chain_policy_id: str,
    open_tx: str,
    markets: list[dict],
    premium: Decimal,
    fee: Decimal,
    coverage_end: datetime,
) -> None:
    """Insert the policy + portfolio + positions into the DB."""
    async with AsyncSessionLocal() as db:
        policy = Policy(
            id=policy_id,
            user_id=user_id,
            need_text="结算测试保单 — 已到期的自动化保障方案（真实 Polymarket 市场结果）",
            title="结算流程测试保单",
            status="active",
            search_status="searched",
            coverage_end=coverage_end,
            on_chain_policy_id=on_chain_policy_id,
            open_tx=open_tx,
            opened_at=datetime.now(timezone.utc) - timedelta(days=7),
            premium=premium,
            fee=fee,
            intake_json={
                "questionnaire": {"questions": []},
                "answers": {},
            },
        )
        db.add(policy)

        portfolio = PolicyPortfolio(
            id=uuid.uuid4(),
            policy_id=policy_id,
            order_index=0,
            tier="balanced",
            title="测试组合（已到期）",
            thesis="用于测试结算流程的自动化保障方案，选取已结算的 Polymarket 市场作为标的。",
            premium_estimate=premium,
            expected_payout=premium * Decimal("1.6"),
            metrics_json={},
            scenarios_json=[],
            status="selected",
        )
        db.add(portfolio)

        # Update policy to point at the selected portfolio
        policy.selected_portfolio_id = portfolio.id

        weights = [4000, 3500, 2500]
        entries = [5000, 4000, 6000]
        for idx, (mkt, weight, entry) in enumerate(
            zip(markets, weights, entries)
        ):
            pos = PolicyPosition(
                id=uuid.uuid4(),
                portfolio_id=portfolio.id,
                order_index=idx,
                market_ref=mkt["cond"],
                question=mkt["q"],
                side="YES",
                entry_price_bps=entry,
                weight_bps=weight,
                odds=Decimal(str(entry / 10000)),
            )
            db.add(pos)

        await db.commit()
        print(f"\n✓ DB policy created: id={policy_id}")
        print(f"  on_chain_policy_id={on_chain_policy_id}")
        print(f"  status=active, coverage_end={coverage_end.isoformat()}")
        print(f"  premium={premium} USDC, fee={fee} USDC")
        print(f"  selected_portfolio_id={portfolio.id}")


async def async_main() -> None:
    print("=" * 60)
    print("差分机 — Seed Settlement Test Policy")
    print("=" * 60)

    # --- Resolve the admin user ---
    user_id = await find_user_id(SEED_USER_EMAIL)
    print(f"\n✓ Found user: email={SEED_USER_EMAIL}, id={user_id}")

    # --- Set up web3 ---
    rpc = (os.environ.get("INJECTIVE_EVM_RPC_URL") or "").strip()
    if not rpc:
        raise RuntimeError("INJECTIVE_EVM_RPC_URL not set")
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    vault = w3.eth.contract(address=vault_addr, abi=load_abi("PolicyVault.sol", "PolicyVault"))
    usdc = w3.eth.contract(address=usdc_addr, abi=load_abi("MockUSDC.sol", "MockUSDC"))

    print(f"\n  deployer={dep.address}")
    print(f"  vault={vault_addr}")
    print(f"  usdc={usdc_addr}")
    assert vault.functions.relayer().call() == dep.address, "deployer must be relayer"
    assert not vault.functions.paused().call(), "vault paused"
    feebps = vault.functions.feeBps().call()
    print(f"  feeBps={feebps}")

    # --- Pick resolved markets ---
    print("\n[1/3] Picking resolved Polymarket markets…")
    markets = await pick_resolved_markets(3)
    assert len(markets) >= 3, f"need >=3 resolved markets, got {len(markets)}"
    print("  Resolved markets:")
    for m in markets:
        print(f"    outcome_yes={m['outcome_yes']!s:5}  {m['cond'][:14]}…  {m['q']}")

    # --- Derive policy ID and on-chain counterpart ---
    policy_id = uuid.uuid4()
    on_chain_pid_hex = derive_on_chain_policy_id(policy_id)
    on_chain_pid_bytes = bytes.fromhex(on_chain_pid_hex[2:])

    # --- Build positions for the on-chain openPolicy call ---
    weights = [4000, 3500, 2500]
    entries = [5000, 4000, 6000]
    sides = [True, True, True]
    positions_chain = [
        (bytes.fromhex(m["cond"][2:]), s, e, w)
        for m, s, e, w in zip(markets, sides, entries, weights)
    ]

    premium_base = SEED_PREMIUM * USDC_1
    net = premium_base - premium_base * feebps // 10000
    fee_base = premium_base * feebps // 10000
    exp_shares = [net * w // 10000 * 10000 // e for e, w in zip(entries, weights)]
    exp_maxpayout = sum(exp_shares)
    print(f"\n  premium={SEED_PREMIUM} USDC, fee={fee_base/USDC_1}, maxPayout={exp_maxpayout/USDC_1}")
    assert exp_maxpayout <= vault.functions.freeLiquidity().call(), "insufficient vault liquidity"

    # coverage_end in the past (1 hour ago) so it immediately qualifies for settlement
    coverage_end_ts = int(time.time()) - 3600

    # --- Open the policy on-chain ---
    print("\n[2/3] Opening policy on-chain (testnet)…")

    # The deployer opens on behalf of the user (as the user's EVM address is just a
    # derived placeholder; fund & open as deployer acting as user for demo purposes).
    # For the settlement to work, the policy must exist on-chain.
    user_chain = Account.create()
    send_tx(w3, dep, {"to": user_chain.address, "value": w3.to_wei(0.01, "ether"), "gas": 21_000}, "fund user INJ")
    send_tx(w3, dep, usdc.functions.mint(user_chain.address, premium_base * 2).build_transaction({"gas": 150_000}), "mint USDC→user")
    send_tx(w3, user_chain, usdc.functions.approve(vault_addr, premium_base).build_transaction({"gas": 150_000}), "user approve vault")
    open_tx = send_tx(
        w3,
        user_chain,
        vault.functions.openPolicy(
            on_chain_pid_bytes, positions_chain, premium_base, coverage_end_ts
        ).build_transaction({"gas": 1_300_000}),
        "user openPolicy",
    )

    # Verify on-chain
    pol_data = vault.functions.policies(on_chain_pid_bytes).call()
    assert pol_data[0] != "0x" + "0" * 40, "policy not found on-chain"
    print(f"  ✓ On-chain policy confirmed: user={pol_data[0]}")

    # --- Insert into DB ---
    print("\n[3/3] Inserting policy into database…")
    coverage_end_dt = datetime.fromtimestamp(coverage_end_ts, tz=timezone.utc)
    await insert_policy(
        user_id,
        policy_id=policy_id,
        on_chain_policy_id=on_chain_pid_hex,
        open_tx=open_tx,
        markets=markets,
        premium=Decimal(str(SEED_PREMIUM)),
        fee=Decimal(str(fee_base / USDC_1)),
        coverage_end=coverage_end_dt,
    )

    print("\n" + "=" * 60)
    print("✓ TEST POLICY READY FOR SETTLEMENT")
    print("=" * 60)
    print(f"\n  Policy ID : {policy_id}")
    print(f"  Frontend  : /policy/{policy_id}")
    print(f"  Chain PID : {on_chain_pid_hex}")
    print(f"  User email: {SEED_USER_EMAIL}")
    print(f"  Open Tx   : {open_tx}")
    print(f"\n  The policy is active with coverage_end in the past.")
    print(f"  Log in as {SEED_USER_EMAIL} and navigate to the policy page.")
    print(f"  Click '一键结算' to trigger settlement.")
    oracle_addr = settings.outcome_oracle_address
    if oracle_addr:
        print(f"\n  Oracle path: assertions will be posted to {oracle_addr}")
        print(f"  Challenge window: {settings.outcome_oracle_liveness_seconds}s")
    else:
        print(f"\n  Legacy path: settlement reads Gamma directly (no oracle configured)")


if __name__ == "__main__":
    asyncio.run(async_main())
