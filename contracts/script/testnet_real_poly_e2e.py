"""差分机 PolicyVault — REAL on-chain E2E against the ALREADY-DEPLOYED vault,
using a personalized basket whose legs reference LIVE Polymarket markets.

Flow (all real testnet-1439 txs, confirmed by COMMITTED STATE not receipt-hash):
  1. read pre-state (freeLiquidity / reserved / balances)
  2. fetch live Polymarket Gamma markets -> pick 3 mid-probability -> build a
     personalized 3-leg portfolio (marketRef = real conditionId bytes32,
     entryPriceBps from real odds, weights sum to 10000)
  3. size premium so maxPayout <= 80% of freeLiquidity (never over-expose)
  4. mint (if needed) -> approve -> openPolicy  (注资购买个性化投资)
  5. settlePolicy with market-implied outcomes -> assert payout回流

Confirmation model matches contracts/script/testnet_e2e_web3.py: nonce advance +
eth_call storage reads (k8s LB serves receipts from lagging pods).

Run (from contracts/):
  set -a; . ../backend/.env; set +a; ../backend/.venv/bin/python script/testnet_real_poly_e2e.py
"""

import json
import os
import time
from pathlib import Path

import httpx
from eth_account import Account
from web3 import Web3

CHAIN_ID = 1439
GAS_PRICE = 160_000_000  # legacy, no EIP-1559 on Injective EVM testnet
USDC_1 = 10**6
OUT = Path(__file__).resolve().parents[1] / "out"
GAMMA = "https://gamma-api.polymarket.com/markets?closed=false&limit=60&order=volumeNum&ascending=false"

# Captured fallback (in case Gamma is unreachable mid-run) — real conditionIds.
FALLBACK = [
    ("0x0b4cc3b739e1dfe5d73274740e7308b6fb389c5af040c3a174923d928d134bee", 0.0195, "Jesus return before 2027?"),
    ("0xb6d6f15a1b5d08753653f1867ccd6126badfbe182a75159a330dc7b15336b309", 0.017, "Ethiopia next PM?"),
    ("0x836b850fc838195374862551a36f1c8691d96ff01e58b0a071f0fc1a0e357fb1", 0.30, "LeBron 2028?"),
]


def load_abi(sol: str, name: str) -> list:
    return json.loads((OUT / sol / f"{name}.json").read_text())["abi"]


def pick_real_markets() -> list[tuple[str, float, str]]:
    """Return [(conditionId, yes_price, question)] — 3 mid-probability markets."""
    try:
        raw = httpx.get(GAMMA, timeout=30).json()
        rows = raw if isinstance(raw, list) else raw.get("data", [])
    except Exception as exc:  # noqa: BLE001
        print(f"  ! Gamma fetch failed ({exc}); using captured fallback set")
        return FALLBACK
    picked: list[tuple[str, float, str]] = []
    for m in rows:
        cond = m.get("conditionId") or ""
        prices = m.get("outcomePrices")
        if isinstance(prices, str):
            try:
                prices = json.loads(prices)
            except Exception:  # noqa: BLE001
                continue
        if not (isinstance(cond, str) and cond.startswith("0x") and len(cond) == 66):
            continue
        if not (isinstance(prices, list) and len(prices) >= 1):
            continue
        try:
            yes = float(prices[0])
        except (TypeError, ValueError):
            continue
        # Mid-probability keeps shares (=allocated*1e4/entryBps) sane vs liquidity.
        if 0.10 <= yes <= 0.90:
            picked.append((cond, yes, (m.get("question") or "")[:70]))
        if len(picked) == 3:
            break
    if len(picked) < 3:
        print(f"  ! only {len(picked)} mid-prob markets; topping up from fallback")
        picked += [f for f in FALLBACK if f[0] not in {p[0] for p in picked}]
    return picked[:3]


def main() -> None:
    rpc = (os.environ.get("INJECTIVE_EVM_RPC_URL") or os.environ["RPC"]).strip()
    pk = os.environ["DEPLOYER_PRIVATE_KEY"].strip()
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    acct = Account.from_key(pk)
    me = acct.address
    vault = w3.eth.contract(address=vault_addr, abi=load_abi("PolicyVault.sol", "PolicyVault"))
    usdc = w3.eth.contract(address=usdc_addr, abi=load_abi("MockUSDC.sol", "MockUSDC"))

    print(f"deployer={me} chainId={w3.eth.chain_id} INJ={w3.from_wei(w3.eth.get_balance(me),'ether')}")
    print(f"vault={vault_addr}  usdc={usdc_addr}")

    # ---- pre-state ----
    assert not vault.functions.paused().call(), "vault is paused"
    assert vault.functions.relayer().call() == me, "deployer is not the relayer"
    free0 = vault.functions.freeLiquidity().call()
    reserved0 = vault.functions.reserved().call()
    feebps = vault.functions.feeBps().call()
    bal0 = usdc.functions.balanceOf(me).call()
    print(f"PRE  freeLiquidity={free0/USDC_1} reserved={reserved0/USDC_1} feeBps={feebps} deployerUSDC={bal0/USDC_1}")
    assert free0 > 0, "vault has no free liquidity to underwrite"

    # ---- build personalized basket from REAL Polymarket markets ----
    markets = pick_real_markets()
    print("\nPersonalized basket (real Polymarket refs):")
    weights = [4000, 3500, 2500]  # sum 10000
    # Personalized thesis: back the market favorite on the two larger legs, take
    # the underdog on the smallest — so settlement yields a realistic PARTIAL
    # payout (2 legs win, 1 loses) and exercises the on-chain 赔付回流 transfer.
    fav = [yes >= 0.5 for (_, yes, _) in markets]
    sides = fav[:]
    sides[-1] = not fav[-1]
    legs = []
    for (cond, yes, q), w, side in zip(markets, weights, sides):
        entry_bps = max(1, min(10000, round((yes if side else (1 - yes)) * 10000)))
        legs.append((cond, side, entry_bps, w))
        print(f"  {'YES' if side else 'NO'} entry={entry_bps}bps w={w}  {cond[:12]}…  {q}")

    # payout multiple M = maxPayout/net = Σ (w_i/1e4)*(1e4/entry_i)
    mult = sum((w / 10000) * (10000 / e) for (_, _, e, w) in legs)
    # size premium so maxPayout <= 80% freeLiquidity; cap at 100 USDC for a clean demo
    net_cap = free0 * 0.80 / mult
    premium = min(100 * USDC_1, int(net_cap / (1 - feebps / 10000)))
    premium = max(premium, 5 * USDC_1)
    net = premium - premium * feebps // 10000
    exp_shares = [net * w // 10000 * 10000 // e for (_, _, e, w) in legs]
    exp_maxpayout = sum(exp_shares)
    print(f"\npremium={premium/USDC_1} USDC  net={net/USDC_1}  multiple={mult:.2f}x  expMaxPayout={exp_maxpayout/USDC_1} USDC")
    assert exp_maxpayout <= free0, "would over-expose the vault"

    positions = [(bytes.fromhex(c[2:]), s, e, w) for (c, s, e, w) in legs]
    pid = w3.keccak(text=f"real-poly-{int(time.time())}")
    coverage_end = int(time.time()) + 30 * 86400

    nonce = w3.eth.get_transaction_count(me, "latest")

    def txp(n: int, gas: int) -> dict:
        return {"gas": gas, "gasPrice": GAS_PRICE, "nonce": n, "chainId": CHAIN_ID, "from": me}

    def send(label: str, tx: dict, n: int) -> str:
        for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
            tx.pop(k, None)
        raw = acct.sign_transaction(tx).raw_transaction
        h = None
        for attempt in range(8):
            try:
                h = w3.eth.send_raw_transaction(raw)
                break
            except Exception as exc:  # noqa: BLE001
                if "known" in str(exc).lower():
                    break
                time.sleep(2)
                if attempt == 7:
                    raise
        deadline = time.time() + 120
        while time.time() < deadline:
            if w3.eth.get_transaction_count(me, "latest") >= n + 1:
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"{label}: nonce stuck at {n}")
        txhash = (h.hex() if hasattr(h, "hex") else str(h)) if h else "0x(known)"
        if txhash and not txhash.startswith("0x"):
            txhash = "0x" + txhash
        print(f"  [{label}] tx={txhash} nonce={n}")
        return txhash

    txs = {}
    # ---- mint if needed ----
    if bal0 < premium:
        txs["mint"] = send("mint premium USDC", usdc.functions.mint(me, premium * 3).build_transaction(txp(nonce, 150_000)), nonce)
        nonce += 1
    # ---- approve ----
    if usdc.functions.allowance(me, vault_addr).call() < premium:
        txs["approve"] = send("approve vault", usdc.functions.approve(vault_addr, premium).build_transaction(txp(nonce, 150_000)), nonce)
        nonce += 1
    # ---- openPolicy (注资购买个性化投资) ----
    txs["open"] = send("openPolicy", vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction(txp(nonce, 1_200_000)), nonce)
    nonce += 1

    reserved_after_open = vault.functions.reserved().call()
    onchain = vault.functions.policies(pid).call()
    onchain_pos = vault.functions.getPositions(pid).call()
    delta_reserved = reserved_after_open - reserved0
    print(f"\nOPEN  reserved += {delta_reserved/USDC_1} USDC (expect maxPayout={exp_maxpayout/USDC_1})")
    print(f"      policies(pid).user={onchain[0]} premium={onchain[1]/USDC_1} maxPayout={onchain[2]/USDC_1}")
    print(f"      on-chain legs = {len(onchain_pos)} (expect 3)")
    assert onchain[0] == me, "policy.user mismatch"
    assert onchain[2] == exp_maxpayout, f"maxPayout mismatch {onchain[2]} != {exp_maxpayout}"
    assert delta_reserved == exp_maxpayout, "reserved delta != maxPayout"
    assert len(onchain_pos) == 3, "leg count mismatch"

    # ---- settle with market-implied outcomes (relayer-supplied, V1) ----
    outcomes = [(yes >= 0.5) for (_, yes, _) in markets]
    exp_payout = sum(exp_shares[i] for i in range(3) if legs[i][1] == outcomes[i])
    bal_before = usdc.functions.balanceOf(me).call()
    txs["settle"] = send("settlePolicy", vault.functions.settlePolicy(pid, outcomes).build_transaction(txp(nonce, 600_000)), nonce)
    nonce += 1
    bal_after = usdc.functions.balanceOf(me).call()
    payout = bal_after - bal_before
    reserved_after_settle = vault.functions.reserved().call()
    settled = vault.functions.policies(pid).call()[4]
    print(f"\nSETTLE outcomesYes={outcomes}")
    print(f"       payout={payout/USDC_1} USDC (expect {exp_payout/USDC_1})  settled={settled}")
    print(f"       reserved released back to {reserved_after_settle/USDC_1} (expect {reserved0/USDC_1})")
    assert payout == exp_payout, f"payout mismatch {payout} != {exp_payout}"
    assert reserved_after_settle == reserved0, "reserve not released to baseline"
    assert settled is True, "policy not settled"

    print("\n===== REAL ON-CHAIN E2E PASSED (Injective testnet 1439) =====")
    print(f"policyId = 0x{pid.hex()}")
    for k, v in txs.items():
        print(f"  {k:8s} {v}")
    print("Explorer: https://testnet.explorer.injective.network/")


if __name__ == "__main__":
    main()
