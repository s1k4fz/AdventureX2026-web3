"""差分机 — REAL settlement test on Injective testnet (chainId 1439).

Verifies the full money path with THREE DISTINCT addresses so every flow is
independently measurable:
  - USER     (fresh)  : pays premium (汇入), receives payout (汇出)
  - TREASURY (fresh)  : receives the platform fee (手续费)
  - DEPLOYER          : owner + relayer (funds user's gas, settles)

Settlement outcomes are pulled FROM POLYMARKET via the *production* M3 reader
ai.markets.resolution.get_market_resolution (real resolved conditionIds), so this
exercises the true "从 Polymarket 进结算" path — not simulated outcomes.

Confirmation = committed state (nonce advance + eth_call), not receipt-hash.

Run (from contracts/):
  set -a; . ../backend/.env; set +a; ../backend/.venv/bin/python script/testnet_settle_resolved.py
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

from eth_account import Account
from web3 import Web3

# --- import the PRODUCTION M3 resolution reader from the backend ------------
BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
# core.database builds the engine at import; give a parseable dummy URL (never
# connects — resolution only does httpx to Gamma). All other env comes from .env.
os.environ["DATABASE_URL"] = os.environ.get("DATABASE_URL") or "postgresql+asyncpg://u:p@localhost:5432/x"
from ai.markets.resolution import get_market_resolution  # noqa: E402

CHAIN_ID = 1439
GAS_PRICE = 160_000_000
USDC_1 = 10**6
OUT = Path(__file__).resolve().parents[1] / "out"
GAMMA = "https://gamma-api.polymarket.com/markets?closed=true&limit=80&order=volumeNum&ascending=false"


def load_abi(sol: str, name: str) -> list:
    return json.loads((OUT / sol / f"{name}.json").read_text())["abi"]


async def pick_resolved_markets(w3) -> list[dict]:
    """Return up to 3 resolved binary markets (mix of YES-won and NO-won) with
    outcomes confirmed by the production reader. Each: {cond, outcome_yes, q}."""
    import httpx
    rows = httpx.get(GAMMA, timeout=30).json()
    rows = rows if isinstance(rows, list) else rows.get("data", [])
    yes_won: list[dict] = []
    no_won: list[dict] = []
    for m in rows:
        cond = m.get("conditionId") or ""
        if not (isinstance(cond, str) and cond.startswith("0x") and len(cond) == 66):
            continue
        res = await get_market_resolution(cond)  # PRODUCTION M3 reader (real Gamma)
        if not res or not res["resolved"] or res["outcome_yes"] is None:
            continue
        rec = {"cond": cond, "outcome_yes": res["outcome_yes"], "q": (m.get("question") or "")[:60]}
        (yes_won if res["outcome_yes"] else no_won).append(rec)
        if len(yes_won) >= 2 and len(no_won) >= 1:
            break
    picked = yes_won[:2] + no_won[:1]
    if len(picked) < 3:  # fallback: whatever resolved we found
        picked = (yes_won + no_won)[:3]
    return picked


def main() -> None:
    rpc = (os.environ.get("INJECTIVE_EVM_RPC_URL") or os.environ["RPC"]).strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    vault = w3.eth.contract(address=vault_addr, abi=load_abi("PolicyVault.sol", "PolicyVault"))
    usdc = w3.eth.contract(address=usdc_addr, abi=load_abi("MockUSDC.sol", "MockUSDC"))

    user = Account.create()
    treasury = Account.create()  # only the address matters (receives fee)
    print(f"deployer={dep.address}  user={user.address}  treasury={treasury.address}")
    assert vault.functions.owner().call() == dep.address, "deployer must be owner"
    assert vault.functions.relayer().call() == dep.address, "deployer must be relayer"
    assert not vault.functions.paused().call(), "vault paused"
    feebps = vault.functions.feeBps().call()

    def send(acct, tx, label):
        n = w3.eth.get_transaction_count(acct.address, "latest")
        tx.setdefault("nonce", n)
        tx.update({"gasPrice": GAS_PRICE, "chainId": CHAIN_ID, "from": acct.address})
        for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
            tx.pop(k, None)
        raw = acct.sign_transaction(tx).raw_transaction
        h = None
        for i in range(8):
            try:
                h = w3.eth.send_raw_transaction(raw); break
            except Exception as exc:  # noqa: BLE001
                if "known" in str(exc).lower(): break
                time.sleep(2)
                if i == 7: raise
        deadline = time.time() + 120
        while time.time() < deadline:
            if w3.eth.get_transaction_count(acct.address, "latest") >= n + 1: break
            time.sleep(2)
        else:
            raise RuntimeError(f"{label}: nonce stuck at {n}")
        txhash = (h.hex() if hasattr(h, "hex") else str(h)) if h else "0x(known)"
        if txhash and not txhash.startswith("0x"): txhash = "0x" + txhash
        print(f"  [{label}] tx={txhash}")
        return txhash

    # --- resolve real Polymarket markets via the production M3 reader ---------
    markets = asyncio.run(pick_resolved_markets(w3))
    assert len(markets) == 3, f"need 3 resolved markets, got {len(markets)}"
    print("\nResolved Polymarket markets (outcome pulled via M3 get_market_resolution):")
    for m in markets:
        print(f"  outcome_yes={m['outcome_yes']!s:5}  {m['cond'][:12]}…  {m['q']}")

    # Personalized basket: bet YES on all three. Entry prices are representative
    # (resolved markets show degenerate 1/0 live prices, not the entry-time odds).
    weights = [4000, 3500, 2500]
    entries = [5000, 4000, 6000]
    sides = [True, True, True]
    positions = [(bytes.fromhex(m["cond"][2:]), s, e, w)
                 for m, s, e, w in zip(markets, sides, entries, weights)]
    outcomes = [m["outcome_yes"] for m in markets]  # REAL Polymarket results

    premium = 100 * USDC_1
    net = premium - premium * feebps // 10000
    exp_fee = premium * feebps // 10000
    exp_shares = [net * w // 10000 * 10000 // e for e, w in zip(entries, weights)]
    exp_maxpayout = sum(exp_shares)
    exp_payout = sum(exp_shares[i] for i in range(3) if sides[i] == outcomes[i])
    print(f"\npremium={premium/USDC_1} fee={exp_fee/USDC_1} net={net/USDC_1} "
          f"maxPayout={exp_maxpayout/USDC_1} expPayout={exp_payout/USDC_1}")
    assert exp_maxpayout <= vault.functions.freeLiquidity().call(), "over-exposure"

    pid = w3.keccak(text=f"settle-resolved-{int(time.time())}")
    coverage_end = int(time.time()) + 7 * 86400
    prev_treasury = vault.functions.treasury().call()

    try:
        # 1) point treasury at the fresh address so the fee is measurable
        send(dep, vault.functions.setTreasury(treasury.address).build_transaction({"gas": 120_000}), "setTreasury→fresh")
        # 2) fund the fresh user with a little INJ for gas
        send(dep, {"to": user.address, "value": w3.to_wei(0.01, "ether"), "gas": 21_000}, "fund user INJ")
        # 3) mint USDC to the user
        send(dep, usdc.functions.mint(user.address, premium * 2).build_transaction({"gas": 150_000}), "mint USDC→user")

        # --- snapshots before open ---
        u0 = usdc.functions.balanceOf(user.address).call()
        t0 = usdc.functions.balanceOf(treasury.address).call()
        v0 = usdc.functions.balanceOf(vault_addr).call()
        r0 = vault.functions.reserved().call()

        # 4) USER approves + opens the policy (汇入: premium leaves user)
        send(user, usdc.functions.approve(vault_addr, premium).build_transaction({"gas": 150_000}), "user approve")
        send(user, vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction({"gas": 1_300_000}), "user openPolicy")

        u1 = usdc.functions.balanceOf(user.address).call()
        t1 = usdc.functions.balanceOf(treasury.address).call()
        v1 = usdc.functions.balanceOf(vault_addr).call()
        r1 = vault.functions.reserved().call()
        print("\n--- AFTER OPEN ---")
        print(f"  user   Δ = {(u1-u0)/USDC_1}  (expect -{premium/USDC_1})   [汇入承保金库]")
        print(f"  treasury Δ = {(t1-t0)/USDC_1}  (expect +{exp_fee/USDC_1})  [手续费]")
        print(f"  vault  Δ = {(v1-v0)/USDC_1}  (expect +{(premium-exp_fee)/USDC_1})")
        print(f"  reserved Δ = {(r1-r0)/USDC_1}  (expect +{exp_maxpayout/USDC_1})")
        assert u1 - u0 == -premium, "user premium debit wrong"
        assert t1 - t0 == exp_fee, "fee to treasury wrong"
        assert v1 - v0 == premium - exp_fee, "vault net-in wrong"
        assert r1 - r0 == exp_maxpayout, "reserved delta wrong"

        # 5) relayer settles with the REAL Polymarket outcomes (汇出: payout to user)
        send(dep, vault.functions.settlePolicy(pid, outcomes).build_transaction({"gas": 600_000}), "relayer settlePolicy")
        u2 = usdc.functions.balanceOf(user.address).call()
        t2 = usdc.functions.balanceOf(treasury.address).call()
        r2 = vault.functions.reserved().call()
        settled = vault.functions.policies(pid).call()[4]
        print("\n--- AFTER SETTLE (outcomes from Polymarket) ---")
        print(f"  user   Δ = +{(u2-u1)/USDC_1}  (expect +{exp_payout/USDC_1})   [赔付汇出到用户]")
        print(f"  treasury Δ = {(t2-t1)/USDC_1}  (expect 0, fee only at open)")
        print(f"  reserved now = {r2/USDC_1}  (expect {r0/USDC_1})  settled={settled}")
        assert u2 - u1 == exp_payout, "payout to user wrong"
        assert t2 == t1, "treasury changed during settle"
        assert r2 == r0, "reserve not released"
        assert settled is True, "not settled"

        net_user = (u2 - u0)
        print("\n===== REAL SETTLEMENT TEST PASSED (testnet 1439) =====")
        print(f"  用户净盈亏 = {net_user/USDC_1} USDC (payout {exp_payout/USDC_1} − premium {premium/USDC_1})")
        print(f"  手续费收取 = {exp_fee/USDC_1} USDC → treasury {treasury.address}")
        print(f"  结算依据   = Polymarket 真实结果 {outcomes}")
        print(f"  policyId   = 0x{pid.hex()}")
    finally:
        # restore the vault's treasury to what it was (leave state as found)
        send(dep, vault.functions.setTreasury(prev_treasury).build_transaction({"gas": 120_000}), "restore treasury")
        assert vault.functions.treasury().call() == prev_treasury, "treasury not restored"
        print(f"  treasury restored → {prev_treasury}")


if __name__ == "__main__":
    main()
