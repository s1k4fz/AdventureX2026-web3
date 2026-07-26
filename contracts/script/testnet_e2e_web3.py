"""差分机 PolicyVault — Injective EVM testnet full on-chain E2E driver.

Broadcasts EVERY step as a real testnet transaction (deploy MockUSDC + PolicyVault,
mint, approve, fundPool, openPolicy, settlePolicy) and confirms each by COMMITTED
STATE (nonce advance + deterministic CREATE address + storage reads via eth_call),
NOT by receipt-hash — the k8s-load-balanced RPC serves receipt lookups from pods
whose tx index lags, so forge --slow spuriously gives up even though txs mine.

Run:
  DEPLOYER_PRIVATE_KEY=... RPC=... \
    /home/mirahikari/lemma-ai/backend/.venv/bin/python script/testnet_e2e_web3.py

Reads ABIs+bytecode from forge output (contracts/out/*). Legacy tx, gasPrice 160e6,
chainId 1439. owner = relayer = treasury = deployer (MVP single hot key).
"""

import json
import os
import time
from pathlib import Path

import rlp
from eth_account import Account
from eth_utils import to_checksum_address
from web3 import Web3

CHAIN_ID = 1439
GAS_PRICE = 160_000_000  # 160e6 wei, legacy (no EIP-1559 on Injective EVM testnet)
CONTRACTS = Path(__file__).resolve().parents[1]
OUT = CONTRACTS / "out"

USDC_1 = 10**6  # 6 decimals


def load_artifact(sol: str, name: str) -> tuple[list, str]:
    data = json.loads((OUT / f"{sol}" / f"{name}.json").read_text())
    return data["abi"], data["bytecode"]["object"]


def main() -> None:
    rpc = os.environ["RPC"].strip()
    pk = os.environ["DEPLOYER_PRIVATE_KEY"].strip()
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    acct = Account.from_key(pk)
    me = acct.address
    print(f"deployer={me}  chainId={w3.eth.chain_id}  balance={w3.from_wei(w3.eth.get_balance(me),'ether')} INJ")

    nonce = w3.eth.get_transaction_count(me, "latest")
    print(f"start nonce={nonce}")

    def create_address(sender: str, n: int) -> str:
        return to_checksum_address(w3.keccak(rlp.encode([bytes.fromhex(sender[2:]), n]))[12:])

    def txparams(n: int, gas: int) -> dict:
        # Explicit legacy (type-0) tx: Injective EVM testnet has no EIP-1559, and
        # mixing gasPrice with web3's default type-2 fields makes the signer reject it.
        return {"gas": gas, "gasPrice": GAS_PRICE, "nonce": n, "chainId": CHAIN_ID, "from": me}

    def send(label: str, tx: dict, n: int) -> str:
        # Force a pure legacy tx: no 'type', no EIP-1559 fields (Injective EVM
        # testnet is legacy-only; eth_account rejects type=0 and mixed fields).
        for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
            tx.pop(k, None)
        signed = acct.sign_transaction(tx)
        # Retry submission across transient LB / stale-nonce pods.
        h = None
        for attempt in range(8):
            try:
                h = w3.eth.send_raw_transaction(signed.raw_transaction)
                break
            except Exception as exc:  # noqa: BLE001
                if "already known" in str(exc).lower() or "known transaction" in str(exc).lower():
                    h = signed.hash
                    break
                time.sleep(2)
                if attempt == 7:
                    raise
        txhash = h.hex() if hasattr(h, "hex") else str(h)
        if not txhash.startswith("0x"):
            txhash = "0x" + txhash
        # Confirm by COMMITTED nonce advance (consensus state, robust to LB lag).
        deadline = time.time() + 120
        while time.time() < deadline:
            if w3.eth.get_transaction_count(me, "latest") >= n + 1:
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"{label}: nonce did not advance past {n} within 120s")
        # Best-effort receipt (for block/gas) — tolerate null across lagging pods.
        blk = gas = None
        for _ in range(10):
            try:
                r = w3.eth.get_transaction_receipt(txhash)
                if r is not None:
                    blk, gas = r["blockNumber"], r["gasUsed"]
                    break
            except Exception:  # noqa: BLE001 — receipt index lags on some pods
                pass
            time.sleep(1.5)
        print(f"  [{label}] tx={txhash} nonce={n} block={blk} gasUsed={gas}")
        return txhash

    def wait_for_code(addr: str, label: str, timeout: int = 90) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if len(w3.eth.get_code(addr)) > 0:
                return
            time.sleep(2)
        raise RuntimeError(f"{label}: no code at {addr} after {timeout}s (constructor reverted / out of gas?)")

    musdc_abi, musdc_bin = load_artifact("MockUSDC.sol", "MockUSDC")
    vault_abi, vault_bin = load_artifact("PolicyVault.sol", "PolicyVault")

    # 1) Deploy MockUSDC
    usdc_addr = create_address(me, nonce)
    MockUSDC = w3.eth.contract(abi=musdc_abi, bytecode=musdc_bin)
    send("deploy MockUSDC", MockUSDC.constructor().build_transaction(txparams(nonce, 1_200_000)), nonce)
    wait_for_code(usdc_addr, "MockUSDC")
    nonce += 1
    usdc = w3.eth.contract(address=usdc_addr, abi=musdc_abi)

    # 2) Deploy PolicyVault(usdc, owner=me, relayer=me, treasury=me, feeBps=100)
    vault_addr = create_address(me, nonce)
    PolicyVault = w3.eth.contract(abi=vault_abi, bytecode=vault_bin)
    send(
        "deploy PolicyVault",
        PolicyVault.constructor(usdc_addr, me, me, me, 100).build_transaction(txparams(nonce, 3_500_000)),
        nonce,
    )
    wait_for_code(vault_addr, "PolicyVault")
    nonce += 1
    vault = w3.eth.contract(address=vault_addr, abi=vault_abi)

    # 3) mint 1,000,000 USDC to deployer
    send("mint 1,000,000 USDC", usdc.functions.mint(me, 1_000_000 * USDC_1).build_transaction(txparams(nonce, 150_000)), nonce)
    nonce += 1
    # 4) approve vault (max)
    send("approve vault", usdc.functions.approve(vault_addr, 2**256 - 1).build_transaction(txparams(nonce, 150_000)), nonce)
    nonce += 1
    # 5) fundPool 100,000 USDC
    send("fundPool 100,000 USDC", vault.functions.fundPool(100_000 * USDC_1).build_transaction(txparams(nonce, 300_000)), nonce)
    nonce += 1

    # 6) openPolicy: 2 legs, weights 6000/4000, entry 4000/6000 bps, premium 1000 USDC
    pid = w3.keccak(text="policy-e2e-1")
    positions = [
        (w3.keccak(text="mktA"), True, 4000, 6000),
        (w3.keccak(text="mktB"), False, 6000, 4000),
    ]
    coverage_end = int(time.time()) + 30 * 86400
    send(
        "openPolicy",
        vault.functions.openPolicy(pid, positions, 1000 * USDC_1, coverage_end).build_transaction(txparams(nonce, 1_000_000)),
        nonce,
    )
    nonce += 1
    reserved_after_open = vault.functions.reserved().call()
    print(f"reservedAfterOpen = {reserved_after_open} (expect 2_145_000_000)")

    # 7) settlePolicy: outcomes [YES, YES] -> leg0 (YES) wins, leg1 (NO) loses
    bal_before = usdc.functions.balanceOf(me).call()
    send("settlePolicy", vault.functions.settlePolicy(pid, [True, True]).build_transaction(txparams(nonce, 500_000)), nonce)
    nonce += 1
    bal_after = usdc.functions.balanceOf(me).call()
    payout = bal_after - bal_before
    reserved_after_settle = vault.functions.reserved().call()

    print("\n===== ON-CHAIN RESULTS (Injective testnet, chainId 1439) =====")
    print(f"MockUSDC   : {usdc_addr}")
    print(f"PolicyVault: {vault_addr}")
    print(f"reservedAfterOpen   = {reserved_after_open}")
    print(f"payout (settle)     = {payout}")
    print(f"reservedAfterSettle = {reserved_after_settle}")
    print(f"final balance INJ   = {w3.from_wei(w3.eth.get_balance(me),'ether')}")

    assert reserved_after_open == 2_145_000_000, "maxPayout/reserve mismatch"
    assert payout == 1_485_000_000, "payout mismatch"
    assert reserved_after_settle == 0, "reserve not released"
    print("\nALL ON-CHAIN ASSERTIONS PASSED ✓")
    print(f"USDC_ADDRESS={usdc_addr}")
    print(f"POLICY_VAULT_ADDRESS={vault_addr}")


if __name__ == "__main__":
    main()
