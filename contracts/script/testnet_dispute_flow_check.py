"""差分机 — LIVE check of the backend auto-dispute wrappers on Injective testnet.

Exercises chain_service.send_dispute_tx + send_resolve_dispute_tx against the
deployed OutcomeOracle: a fresh ATTACKER asserts a WRONG outcome, the RELAYER
disputes it (via the backend wrapper), then arbitrates (as oracle owner) to the
correct value. Proves the new automation primitives work end-to-end.

Run (from contracts/):
  set -a; . ../backend/.env; set +a; ../backend/.venv/bin/python script/testnet_dispute_flow_check.py
"""

import json
import os
import sys
import time
from pathlib import Path

from eth_account import Account
from web3 import Web3

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
os.environ["DATABASE_URL"] = os.environ.get("DATABASE_URL") or "postgresql+asyncpg://u:p@localhost:5432/x"

from services import chain_service  # noqa: E402

CHAIN_ID = 1439
GAS_PRICE = 160_000_000
OUT = Path(__file__).resolve().parents[1] / "out"


def main() -> None:
    rpc = (os.environ.get("INJECTIVE_EVM_RPC_URL") or os.environ["RPC"]).strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    oracle_addr = Web3.to_checksum_address(os.environ["OUTCOME_ORACLE_ADDRESS"].strip())
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    oracle = w3.eth.contract(address=oracle_addr, abi=json.loads((OUT / "OutcomeOracle.sol" / "OutcomeOracle.json").read_text())["abi"])
    usdc = w3.eth.contract(address=usdc_addr, abi=json.loads((OUT / "MockUSDC.sol" / "MockUSDC.json").read_text())["abi"])

    relayer = chain_service.relayer_address()
    print(f"relayer={relayer}  oracle.owner={oracle.functions.owner().call()}")
    assert oracle.functions.owner().call() == relayer, "relayer must be oracle owner for resolveDispute"

    bond = oracle.functions.bondAmount().call()
    attacker = Account.create()
    market = w3.keccak(text=f"dispute-check-{int(time.time())}")
    real = True  # the correct outcome we will arbitrate to
    print(f"attacker={attacker.address} market=0x{market.hex()} bond={bond/1e6} real={real}")

    def send(acct, tx, label):
        n = w3.eth.get_transaction_count(acct.address, "latest")
        tx.setdefault("nonce", n)
        tx.update({"gasPrice": GAS_PRICE, "chainId": CHAIN_ID, "from": acct.address})
        for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
            tx.pop(k, None)
        w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
        deadline = time.time() + 120
        while time.time() < deadline:
            if w3.eth.get_transaction_count(acct.address, "latest") >= n + 1:
                break
            time.sleep(2)
        else:
            raise RuntimeError(f"{label}: nonce stuck")
        print(f"  [{label}] ok")

    # Fund attacker with INJ (gas) + USDC (bond) and approve the oracle.
    send(dep, {"to": attacker.address, "value": w3.to_wei(0.01, "ether"), "gas": 21_000}, "fund attacker INJ")
    if bond > 0:
        send(dep, usdc.functions.mint(attacker.address, bond * 4).build_transaction({"gas": 150_000}), "mint attacker USDC")
        send(attacker, usdc.functions.approve(oracle_addr, bond * 4).build_transaction({"gas": 120_000}), "attacker approve")

    # Attacker asserts the WRONG outcome (not real).
    send(attacker, oracle.functions.assertOutcome(market, not real).build_transaction({"gas": 220_000}), "attacker assert WRONG")
    a = chain_service.read_assertion("0x" + market.hex())
    assert a["status"] == chain_service.ORACLE_STATUS_ASSERTED and a["assertedYes"] == (not real)
    print(f"  attacker assertion: assertedYes={a['assertedYes']} proposer={a['proposer']}")

    # Backend wrapper: relayer DISPUTES the wrong assertion.
    tx = chain_service.send_dispute_tx("0x" + market.hex())
    a = chain_service.read_assertion("0x" + market.hex())
    assert a["status"] == chain_service.ORACLE_STATUS_DISPUTED, "not disputed"
    print(f"  send_dispute_tx -> Disputed (disputer={a['disputer']}) tx={tx}")

    # Backend wrapper: relayer (owner) ARBITRATES to the real outcome.
    tx = chain_service.send_resolve_dispute_tx("0x" + market.hex(), real)
    resolved, outcome_yes = oracle.functions.getResolvedOutcome(market).call()
    assert resolved and outcome_yes == real, "did not resolve to real outcome"
    print(f"  send_resolve_dispute_tx -> Resolved outcome_yes={outcome_yes} tx={tx}")

    print("\n===== AUTO-DISPUTE WRAPPERS VERIFIED ON TESTNET 1439 =====")
    print(f"  wrong assertion by {attacker.address} -> disputed by relayer -> arbitrated to real={real}")


if __name__ == "__main__":
    main()
