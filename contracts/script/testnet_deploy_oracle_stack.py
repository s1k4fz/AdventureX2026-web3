"""差分机 — provision a FRESH oracle-capable stack on Injective testnet (chainId 1439).

The PolicyVault currently in .env predates settlePolicyFromOracle, so to test the
optimistic-oracle path on-chain we deploy a NEW PolicyVault (current bytecode) plus
an OutcomeOracle, fund the vault, and wire them together. Prints the two addresses
in an env-parseable form so the E2E can run against the fresh stack.

Run (from contracts/):
  set -a; . ../backend/.env; set +a; ../backend/.venv/bin/python script/testnet_deploy_oracle_stack.py
"""

import json
import os
import time
from pathlib import Path

import rlp
from eth_account import Account
from eth_utils import keccak, to_checksum_address
from web3 import Web3

CHAIN_ID = 1439
GAS_PRICE = 160_000_000
USDC_1 = 10**6
OUT = Path(__file__).resolve().parents[1] / "out"

FEE_BPS = 100  # 1%
FUND_USDC = 2000 * USDC_1  # pool liquidity for the demo
ORACLE_BOND = 10 * USDC_1  # 10 USDC bond per assertion
ORACLE_LIVENESS = 300  # seconds (E2E temporarily shrinks this at runtime)


def _create_address(sender: str, nonce: int) -> str:
    """Deterministic CREATE address = keccak(rlp([sender, nonce]))[12:].

    Avoids receipt-by-hash lookups (the k8s LB serves receipts from lagging pods).
    """
    raw = rlp.encode([bytes.fromhex(sender[2:]), nonce])
    return to_checksum_address(keccak(raw)[12:])


def main() -> None:
    rpc = (os.environ.get("INJECTIVE_EVM_RPC_URL") or os.environ["RPC"]).strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    print(f"deployer={dep.address} INJ={w3.from_wei(w3.eth.get_balance(dep.address), 'ether')}")

    def sign_send_wait(tx, label):
        for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
            tx.pop(k, None)
        n = tx["nonce"]
        raw = dep.sign_transaction(tx).raw_transaction
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
            if w3.eth.get_transaction_count(dep.address, "latest") >= n + 1:
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"{label}: nonce stuck at {n}")
        print(f"  [{label}] tx={h.hex() if h else '0x(known)'}")

    def deploy(sol, name, args, gas):
        art = json.loads((OUT / sol / f"{name}.json").read_text())
        c = w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"]["object"])
        nonce = w3.eth.get_transaction_count(dep.address, "latest")
        tx = c.constructor(*args).build_transaction(
            {"gas": gas, "gasPrice": GAS_PRICE, "nonce": nonce, "chainId": CHAIN_ID, "from": dep.address}
        )
        sign_send_wait(tx, f"deploy {name}")
        addr = _create_address(dep.address, nonce)
        # Confirm code landed (retry across lagging pods).
        for _ in range(30):
            if len(w3.eth.get_code(addr)) > 2:
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"{name}: no code at computed addr {addr}")
        print(f"    {name} @ {addr}")
        return addr, art["abi"]

    def call(contract, fn, args, gas, label):
        nonce = w3.eth.get_transaction_count(dep.address, "latest")
        tx = getattr(contract.functions, fn)(*args).build_transaction(
            {"gas": gas, "gasPrice": GAS_PRICE, "nonce": nonce, "chainId": CHAIN_ID, "from": dep.address}
        )
        sign_send_wait(tx, label)

    # 1) Deploy a fresh PolicyVault (current bytecode with settlePolicyFromOracle).
    vault_addr, vault_abi = deploy(
        "PolicyVault.sol", "PolicyVault",
        [usdc_addr, dep.address, dep.address, dep.address, FEE_BPS], 4_000_000,
    )
    vault = w3.eth.contract(address=vault_addr, abi=vault_abi)
    usdc = w3.eth.contract(address=usdc_addr, abi=json.loads((OUT / "MockUSDC.sol" / "MockUSDC.json").read_text())["abi"])

    # 2) Fund the pool: mint -> approve -> fundPool.
    if usdc.functions.balanceOf(dep.address).call() < FUND_USDC:
        call(usdc, "mint", [dep.address, FUND_USDC * 2], 150_000, "mint pool USDC")
    if usdc.functions.allowance(dep.address, vault_addr).call() < FUND_USDC:
        call(usdc, "approve", [vault_addr, FUND_USDC * 4], 120_000, "approve vault")
    call(vault, "fundPool", [FUND_USDC], 200_000, "fundPool")
    print(f"    freeLiquidity={vault.functions.freeLiquidity().call()/USDC_1} USDC")

    # 3) Deploy OutcomeOracle and wire it into the vault.
    oracle_addr, _ = deploy(
        "OutcomeOracle.sol", "OutcomeOracle",
        [usdc_addr, dep.address, ORACLE_BOND, ORACLE_LIVENESS], 2_500_000,
    )
    call(vault, "setOutcomeOracle", [oracle_addr], 120_000, "setOutcomeOracle")
    assert vault.functions.outcomeOracle().call() == oracle_addr, "wiring failed"

    print("\n===== FRESH ORACLE STACK DEPLOYED (testnet 1439) =====")
    print(f"POLICY_VAULT_ADDRESS={vault_addr}")
    print(f"OUTCOME_ORACLE_ADDRESS={oracle_addr}")


if __name__ == "__main__":
    main()
