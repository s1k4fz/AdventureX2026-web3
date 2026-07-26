"""差分机 — redeploy the rebranded PolicyNFT (xEngine Policy / XPOL) on testnet 1439.

The previously deployed PolicyNFT carries the immutable legacy collection name
"Lemma Policy". `name`/`symbol` are constants, so the rebrand requires a fresh
deployment against the SAME PolicyVault and NFT base URI already in .env.

forge is unavailable on this host, so the contract is compiled with py-solc-x
pinned to the exact settings of the original Foundry build (solc 0.8.24,
optimizer 200 runs, evmVersion cancun) and deployed with the project's proven
legacy-tx pattern: deterministic CREATE address + get_code polling instead of
receipt-by-hash lookups (the k8s LB serves receipts from lagging pods).

Run (from contracts/):
  set -a; . ../backend/.env; set +a; ../backend/.venv/bin/python script/testnet_deploy_nft_xengine.py
"""

import os
import time
from pathlib import Path

import rlp
import solcx
from eth_account import Account
from eth_utils import keccak, to_checksum_address
from web3 import Web3

CHAIN_ID = 1439
GAS_PRICE = 160_000_000
SRC = Path(__file__).resolve().parents[1] / "src"


def _create_address(sender: str, nonce: int) -> str:
    """Deterministic CREATE address = keccak(rlp([sender, nonce]))[12:]."""
    raw = rlp.encode([bytes.fromhex(sender[2:]), nonce])
    return to_checksum_address(keccak(raw)[12:])


def compile_policy_nft() -> tuple[list, str]:
    """Compile PolicyNFT.sol with the original Foundry profile settings."""
    solcx.set_solc_version("0.8.24")
    result = solcx.compile_files(
        [SRC / "PolicyNFT.sol"],
        output_values=["abi", "bin"],
        import_remappings=[f"./interfaces/={SRC / 'interfaces'}/"],
        optimize=True,
        optimize_runs=200,
        evm_version="cancun",
        base_path=SRC,
    )
    key = next(k for k in result if k.endswith(":PolicyNFT"))
    return result[key]["abi"], result[key]["bin"]


def main() -> None:
    rpc = os.environ["INJECTIVE_EVM_RPC_URL"].strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    base_uri = os.environ["NFT_METADATA_BASE_URL"].strip()
    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 30}))
    assert w3.eth.chain_id == CHAIN_ID, f"wrong chain {w3.eth.chain_id}"
    print(f"deployer={dep.address} INJ={w3.from_wei(w3.eth.get_balance(dep.address), 'ether')}")
    print(f"vault={vault_addr} baseURI={base_uri}")
    assert len(w3.eth.get_code(vault_addr)) > 2, "vault has no code"

    abi, bytecode = compile_policy_nft()
    contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    nonce = w3.eth.get_transaction_count(dep.address, "latest")
    tx = contract.constructor(vault_addr, base_uri).build_transaction(
        {"gas": 2_500_000, "gasPrice": GAS_PRICE, "nonce": nonce, "chainId": CHAIN_ID, "from": dep.address}
    )
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)
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
    print(f"deploy tx={h.hex() if h else '0x(known)'}")

    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(dep.address, "latest") >= nonce + 1:
            break
        time.sleep(2)
    else:
        raise RuntimeError(f"nonce stuck at {nonce}")

    addr = _create_address(dep.address, nonce)
    for _ in range(30):
        if len(w3.eth.get_code(addr)) > 2:
            break
        time.sleep(2)
    else:
        raise RuntimeError(f"no code at computed addr {addr}")

    nft = w3.eth.contract(address=addr, abi=abi)
    assert nft.functions.name().call() == "xEngine Policy"
    assert nft.functions.symbol().call() == "XPOL"
    assert nft.functions.vault().call() == vault_addr
    uri = nft.functions.baseURI().call()
    print(f"on-chain checks OK: name=xEngine Policy symbol=XPOL baseURI={uri}")

    print("\n===== REBRANDED PolicyNFT DEPLOYED (testnet 1439) =====")
    print(f"POLICY_NFT_ADDRESS={addr}")
    print(f"VITE_POLICY_NFT_ADDRESS={addr}")


if __name__ == "__main__":
    main()
