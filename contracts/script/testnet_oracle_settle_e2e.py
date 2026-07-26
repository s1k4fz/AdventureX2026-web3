"""差分机 — REAL oracle-settlement E2E on Injective testnet (chainId 1439).

Proves the on-chain optimistic-oracle settlement path end-to-end with THREE
DISTINCT addresses so every money flow is independently measurable:
  - USER     (fresh)  : pays premium (汇入), receives payout (汇出)
  - TREASURY (fresh)  : receives the platform fee (手续费)
  - DEPLOYER          : owner + relayer + oracle proposer/arbiter (funds gas)

Outcomes are pulled FROM POLYMARKET via the *production* M3 reader
ai.markets.resolution.get_market_resolution (real resolved conditionIds), then
ASSERTED on the OutcomeOracle, FINALIZED after the challenge window, and read by
PolicyVault.settlePolicyFromOracle — the true "从 Polymarket 拉结果 + 链上核验"
path. A dispute sub-scenario proves the challenge mechanism corrects bad data.

Confirmation = committed state (nonce advance + eth_call), not receipt-hash.

Run (from contracts/):
  set -a; . ../backend/.env; set +a; ../backend/.venv/bin/python script/testnet_oracle_settle_e2e.py
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
os.environ["DATABASE_URL"] = os.environ.get("DATABASE_URL") or "postgresql+asyncpg://u:p@localhost:5432/x"
from ai.markets.resolution import get_market_resolution  # noqa: E402

CHAIN_ID = 1439
GAS_PRICE = 160_000_000
USDC_1 = 10**6
DEMO_LIVENESS = 20  # short challenge window so the E2E runs fast; restored in finally
OUT = Path(__file__).resolve().parents[1] / "out"
GAMMA = "https://gamma-api.polymarket.com/markets?closed=true&limit=80&order=volumeNum&ascending=false"


def load_abi(sol: str, name: str) -> list:
    return json.loads((OUT / sol / f"{name}.json").read_text())["abi"]


async def pick_resolved_markets(n: int) -> list[dict]:
    """Return up to n resolved binary markets (mixing YES-won and NO-won), each
    confirmed by the production reader. Each: {cond, outcome_yes, q}."""
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
        rec = {"cond": cond, "outcome_yes": res["outcome_yes"], "q": (m.get("question") or "")[:56]}
        (yes_won if res["outcome_yes"] else no_won).append(rec)
        if len(yes_won) >= 2 and len(no_won) >= 2:
            break
    picked = (yes_won[:2] + no_won[:2])
    if len(picked) < n:
        picked = (yes_won + no_won)
    return picked[:n]


def main() -> None:
    rpc = (os.environ.get("INJECTIVE_EVM_RPC_URL") or os.environ["RPC"]).strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    oracle_addr = Web3.to_checksum_address(os.environ["OUTCOME_ORACLE_ADDRESS"].strip())

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    vault = w3.eth.contract(address=vault_addr, abi=load_abi("PolicyVault.sol", "PolicyVault"))
    usdc = w3.eth.contract(address=usdc_addr, abi=load_abi("MockUSDC.sol", "MockUSDC"))
    oracle = w3.eth.contract(address=oracle_addr, abi=load_abi("OutcomeOracle.sol", "OutcomeOracle"))

    user = Account.create()
    treasury = Account.create()
    disputer = Account.create()
    print(f"deployer={dep.address}\nuser={user.address}\ntreasury={treasury.address}\ndisputer={disputer.address}")

    assert vault.functions.owner().call() == dep.address, "deployer must be vault owner"
    assert vault.functions.relayer().call() == dep.address, "deployer must be vault relayer"
    assert oracle.functions.owner().call() == dep.address, "deployer must be oracle owner"
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

    def ref(cond: str) -> bytes:
        return bytes.fromhex(cond[2:])

    # ── resolve real markets via the production reader ───────────────────────
    markets = asyncio.run(pick_resolved_markets(4))
    assert len(markets) >= 4, f"need >=4 resolved markets, got {len(markets)}"
    settle_markets = markets[:3]  # policy legs
    dispute_market = markets[3]  # standalone dispute demo
    print("\nResolved Polymarket markets (via production get_market_resolution):")
    for m in markets:
        print(f"  outcome_yes={m['outcome_yes']!s:5}  {m['cond'][:12]}…  {m['q']}")

    bond = oracle.functions.bondAmount().call()
    orig_liveness = oracle.functions.defaultLiveness().call()
    prev_treasury = vault.functions.treasury().call()

    try:
        # Speed up the demo: shrink the challenge window (restored in finally).
        send(dep, oracle.functions.setDefaultLiveness(DEMO_LIVENESS).build_transaction({"gas": 120_000}), "oracle liveness→demo")

        # Fund the deployer (proposer) with bond USDC and approve the oracle.
        if bond > 0:
            need = bond * (len(settle_markets) + 1) + bond  # legs + dispute assert + disputer match headroom
            if usdc.functions.balanceOf(dep.address).call() < need:
                send(dep, usdc.functions.mint(dep.address, need * 2).build_transaction({"gas": 150_000}), "mint bond USDC→deployer")
            if usdc.functions.allowance(dep.address, oracle_addr).call() < need:
                send(dep, usdc.functions.approve(oracle_addr, need * 4).build_transaction({"gas": 120_000}), "deployer approve oracle")

        # ═══════════════════════════════════════════════════════════════════
        #  DISPUTE DEMO — assert a WRONG outcome, dispute it, owner corrects it
        # ═══════════════════════════════════════════════════════════════════
        real = bool(dispute_market["outcome_yes"])
        wrong = not real
        dcond = ref(dispute_market["cond"])
        print(f"\n[dispute demo] asserting WRONG outcome_yes={wrong} for {dispute_market['cond'][:12]}…")
        send(dep, oracle.functions.assertOutcome(dcond, wrong).build_transaction({"gas": 220_000}), "assert WRONG")

        # Fund a fresh disputer to challenge it (INJ gas + bond USDC).
        send(dep, {"to": disputer.address, "value": w3.to_wei(0.01, "ether"), "gas": 21_000}, "fund disputer INJ")
        if bond > 0:
            send(dep, usdc.functions.mint(disputer.address, bond * 4).build_transaction({"gas": 150_000}), "mint bond USDC→disputer")
            send(disputer, usdc.functions.approve(oracle_addr, bond * 4).build_transaction({"gas": 120_000}), "disputer approve oracle")
        send(disputer, oracle.functions.dispute(dcond).build_transaction({"gas": 200_000}), "dispute WRONG")

        # Owner arbitrates to the REAL outcome.
        send(dep, oracle.functions.resolveDispute(dcond, real).build_transaction({"gas": 200_000}), "owner resolveDispute→real")
        resolved, outcome_yes = oracle.functions.getResolvedOutcome(dcond).call()
        assert resolved and outcome_yes == real, "dispute did not resolve to the real outcome"
        print(f"  ✓ dispute corrected the outcome to real={real}")

        # ═══════════════════════════════════════════════════════════════════
        #  HAPPY PATH — assert 3 legs, finalize, open policy, settle from oracle
        # ═══════════════════════════════════════════════════════════════════
        print("\n[settlement] asserting 3 legs on the oracle:")
        for m in settle_markets:
            send(dep, oracle.functions.assertOutcome(ref(m["cond"]), bool(m["outcome_yes"])).build_transaction({"gas": 220_000}), f"assert {m['cond'][:10]}")

        # Personalized basket: bet YES on all three legs.
        weights = [4000, 3500, 2500]
        entries = [5000, 4000, 6000]
        sides = [True, True, True]
        positions = [(ref(m["cond"]), s, e, w) for m, s, e, w in zip(settle_markets, sides, entries, weights)]
        outcomes = [bool(m["outcome_yes"]) for m in settle_markets]

        premium = 100 * USDC_1
        net = premium - premium * feebps // 10000
        exp_fee = premium * feebps // 10000
        exp_shares = [net * w // 10000 * 10000 // e for e, w in zip(entries, weights)]
        exp_maxpayout = sum(exp_shares)
        exp_payout = sum(exp_shares[i] for i in range(3) if sides[i] == outcomes[i])
        print(
            f"\npremium={premium/USDC_1} fee={exp_fee/USDC_1} net={net/USDC_1} "
            f"maxPayout={exp_maxpayout/USDC_1} expPayout={exp_payout/USDC_1}"
        )
        assert exp_maxpayout <= vault.functions.freeLiquidity().call(), "over-exposure"

        pid = w3.keccak(text=f"oracle-settle-{int(time.time())}")
        coverage_end = int(time.time()) + 7 * 86400

        # Point treasury at the fresh address, fund + mint for the user.
        send(dep, vault.functions.setTreasury(treasury.address).build_transaction({"gas": 120_000}), "setTreasury→fresh")
        send(dep, {"to": user.address, "value": w3.to_wei(0.01, "ether"), "gas": 21_000}, "fund user INJ")
        send(dep, usdc.functions.mint(user.address, premium * 2).build_transaction({"gas": 150_000}), "mint USDC→user")

        u0 = usdc.functions.balanceOf(user.address).call()
        t0 = usdc.functions.balanceOf(treasury.address).call()
        r0 = vault.functions.reserved().call()

        # USER opens the policy (汇入).
        send(user, usdc.functions.approve(vault_addr, premium).build_transaction({"gas": 150_000}), "user approve")
        send(user, vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction({"gas": 1_300_000}), "user openPolicy")

        u1 = usdc.functions.balanceOf(user.address).call()
        t1 = usdc.functions.balanceOf(treasury.address).call()
        r1 = vault.functions.reserved().call()
        print("\n--- AFTER OPEN ---")
        print(f"  user   Δ = {(u1-u0)/USDC_1}  (expect -{premium/USDC_1})  [汇入承保金库]")
        print(f"  treasury Δ = {(t1-t0)/USDC_1}  (expect +{exp_fee/USDC_1})  [手续费]")
        print(f"  reserved Δ = {(r1-r0)/USDC_1}  (expect +{exp_maxpayout/USDC_1})")
        assert u1 - u0 == -premium, "user premium debit wrong"
        assert t1 - t0 == exp_fee, "fee to treasury wrong"
        assert r1 - r0 == exp_maxpayout, "reserved delta wrong"

        # Wait out the challenge window, then finalize each leg.
        print(f"\n[settlement] waiting {DEMO_LIVENESS}s challenge window …")
        time.sleep(DEMO_LIVENESS + 6)
        for m in settle_markets:
            send(dep, oracle.functions.finalize(ref(m["cond"])).build_transaction({"gas": 160_000}), f"finalize {m['cond'][:10]}")
        for m in settle_markets:
            resolved, oy = oracle.functions.getResolvedOutcome(ref(m["cond"])).call()
            assert resolved and oy == bool(m["outcome_yes"]), f"leg {m['cond'][:10]} not finalized to real outcome"

        # Relayer settles by READING the oracle (汇出).
        send(dep, vault.functions.settlePolicyFromOracle(pid).build_transaction({"gas": 700_000}), "relayer settlePolicyFromOracle")
        u2 = usdc.functions.balanceOf(user.address).call()
        t2 = usdc.functions.balanceOf(treasury.address).call()
        r2 = vault.functions.reserved().call()
        settled = vault.functions.policies(pid).call()[4]
        print("\n--- AFTER SETTLE (outcomes read from the on-chain oracle) ---")
        print(f"  user   Δ = +{(u2-u1)/USDC_1}  (expect +{exp_payout/USDC_1})  [赔付汇出到用户]")
        print(f"  treasury Δ = {(t2-t1)/USDC_1}  (expect 0, fee only at open)")
        print(f"  reserved now = {r2/USDC_1}  (expect {r0/USDC_1})  settled={settled}")
        assert u2 - u1 == exp_payout, "payout to user wrong"
        assert t2 == t1, "treasury changed during settle"
        assert r2 == r0, "reserve not released"
        assert settled is True, "not settled"

        print("\n===== REAL ORACLE-SETTLEMENT E2E PASSED (testnet 1439) =====")
        print(f"  用户净盈亏 = {(u2-u0)/USDC_1} USDC (payout {exp_payout/USDC_1} − premium {premium/USDC_1})")
        print(f"  手续费收取 = {exp_fee/USDC_1} USDC → treasury {treasury.address}")
        print(f"  结算依据   = 链上乐观预言机终结的 Polymarket 结果 {outcomes}")
        print(f"  争议纠错   = 已验证 dispute→resolveDispute 可纠正错误断言")
        print(f"  policyId   = 0x{pid.hex()}")
    finally:
        # Leave state as found: restore treasury + oracle liveness.
        send(dep, vault.functions.setTreasury(prev_treasury).build_transaction({"gas": 120_000}), "restore treasury")
        send(dep, oracle.functions.setDefaultLiveness(orig_liveness).build_transaction({"gas": 120_000}), "restore oracle liveness")
        assert vault.functions.treasury().call() == prev_treasury, "treasury not restored"
        print(f"  restored treasury→{prev_treasury} liveness→{orig_liveness}")


if __name__ == "__main__":
    main()
