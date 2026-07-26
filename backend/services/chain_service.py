"""M3 — on-chain read/write helpers for the 差分机 (Difference Engine) settlement relayer.

Functions lazily import web3 INSIDE their body so the module can be imported
safely without web3 installed (M1 boots clean). If web3 is missing a clear
RuntimeError is raised at call time.

Read functions:
  - read_pool_snapshot(): vault pool state (reserved, freeLiquidity, feeBps, etc.)
  - read_policy_snapshot(on_chain_policy_id): single policy struct + positions

Write functions:
  - send_settle_tx(on_chain_policy_id, outcomes_yes): sign+broadcast settlePolicy
  - send_assert_tx(market_ref, outcome_yes): assert a Polymarket outcome on the oracle
  - send_dispute_tx(market_ref): dispute a wrong assertion within its challenge window
  - send_resolve_dispute_tx(market_ref, final_yes): owner-arbitrate a disputed assertion
  - send_finalize_tx(market_ref): finalize an undisputed assertion after liveness
  - send_settle_from_oracle_tx(on_chain_policy_id): settlePolicyFromOracle (reads oracle)

Oracle read:
  - read_assertion(market_ref): current OutcomeOracle assertion state for a marketRef
"""

import json
import logging
import re
import time
from pathlib import Path

from core.config import settings

logger = logging.getLogger("lemma.services.chain_service")

# ABI is loaded once per process (lazy, on first call that needs it).
_VAULT_ABI: list | None = None
_ORACLE_ABI: list | None = None

# ownerOf(uint256) selector: keccak256("ownerOf(uint256)")[:4].  Kept literal
# so this read path needs no optional web3/eth-utils dependency.
_OWNER_OF_SELECTOR = "6352211e"
_ERC721_TRANSFER_TOPIC = (
    "0xddf252ad1be2c89b69c2b068fc378daa"
    "952ba7f163c4a11628f55a4df523b3ef"
)
_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_TX_HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
_POLICY_TOKEN_ID_MAX = (1 << 128) - 1

# Zero address constant
_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# OutcomeOracle.Status enum (mirrors src/OutcomeOracle.sol).
ORACLE_STATUS_NONE = 0
ORACLE_STATUS_ASSERTED = 1
ORACLE_STATUS_DISPUTED = 2
ORACLE_STATUS_RESOLVED = 3

# Minimal ERC-20 ABI for bond approve/allowance (works for native USDC or MockUSDC).
_ERC20_MIN_ABI = [
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


def _load_vault_abi() -> list:
    """Load PolicyVault ABI from the forge output (read-only access to contracts/out)."""
    global _VAULT_ABI
    if _VAULT_ABI is not None:
        return _VAULT_ABI
    abi_path = (
        Path(__file__).resolve().parents[1].parent
        / "contracts"
        / "out"
        / "PolicyVault.sol"
        / "PolicyVault.json"
    )
    if not abi_path.exists():
        raise RuntimeError(
            f"PolicyVault ABI not found at {abi_path}. Run `forge build` in contracts/."
        )
    data = json.loads(abi_path.read_text())
    _VAULT_ABI = data["abi"]
    return _VAULT_ABI


def _get_w3():
    """Lazy web3 import + instantiation."""
    try:
        from web3 import Web3  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError(
            "web3 is not installed. Run `uv add web3` to enable chain features."
        ) from exc
    return Web3(Web3.HTTPProvider(settings.injective_evm_rpc_url, request_kwargs={"timeout": 30}))


def _get_vault_contract():
    """Return a web3 Contract instance for the PolicyVault."""
    from web3 import Web3  # noqa: PLC0415

    w3 = _get_w3()
    abi = _load_vault_abi()
    vault_addr = settings.policy_vault_address
    if not vault_addr:
        raise RuntimeError("POLICY_VAULT_ADDRESS not configured")
    return w3, w3.eth.contract(
        address=Web3.to_checksum_address(vault_addr), abi=abi
    )


def read_pool_snapshot() -> dict:
    """Read the current PolicyVault pool state from Injective EVM testnet.

    Returns: {reserved, freeLiquidity, feeBps, paused, relayer, usdc, vault, chainId}
    """
    w3, vault = _get_vault_contract()
    return {
        "reserved": vault.functions.reserved().call(),
        "freeLiquidity": vault.functions.freeLiquidity().call(),
        "feeBps": vault.functions.feeBps().call(),
        "paused": vault.functions.paused().call(),
        "relayer": vault.functions.relayer().call(),
        "usdc": vault.functions.usdc().call(),
        "vault": settings.policy_vault_address,
        "chainId": settings.injective_evm_chain_id,
    }


def read_policy_snapshot(on_chain_policy_id: str) -> dict:
    """Read a single policy's on-chain state from the PolicyVault contract.

    Returns: {user, premium, maxPayout, coverageEnd, settled,
              positions: [{marketRef, sideYes, entryPriceBps, weightBps, shares}]}
    """
    from web3 import Web3  # noqa: PLC0415

    w3, vault = _get_vault_contract()
    pid_bytes = bytes.fromhex(on_chain_policy_id.replace("0x", ""))
    if len(pid_bytes) != 32:
        raise ValueError(f"on_chain_policy_id must be 32 bytes, got {len(pid_bytes)}")

    # policies(bytes32) -> (address user, uint256 premium, uint256 maxPayout, uint64 coverageEnd, bool settled)
    user, premium, max_payout, coverage_end, settled = vault.functions.policies(
        pid_bytes
    ).call()

    # getPositions(bytes32) -> Position[]
    raw_positions = vault.functions.getPositions(pid_bytes).call()
    positions = []
    for pos in raw_positions:
        # pos is a tuple: (bytes32 marketRef, bool sideYes, uint16 entryPriceBps, uint16 weightBps, uint256 shares)
        positions.append(
            {
                "marketRef": "0x" + pos[0].hex(),
                "sideYes": pos[1],
                "entryPriceBps": pos[2],
                "weightBps": pos[3],
                "shares": pos[4],
            }
        )

    return {
        "user": user,
        "premium": premium,
        "maxPayout": max_payout,
        "coverageEnd": coverage_end,
        "settled": settled,
        "positions": positions,
    }


def read_policy_nft_owner(token_id: int) -> str:
    """Read PolicyNFT.ownerOf(token_id) through raw JSON-RPC ``eth_call``.

    This deliberately uses the already-declared httpx dependency instead of
    relying on a locally installed but undeclared web3 package.  A nonexistent
    token normally reverts; callers treat that as "not confirmed".
    """
    import httpx  # noqa: PLC0415

    if token_id < 0 or token_id > _POLICY_TOKEN_ID_MAX:
        raise ValueError("token_id must fit the UUID-backed uint128 namespace")
    contract = settings.policy_nft_address
    if not contract:
        raise RuntimeError("POLICY_NFT_ADDRESS not configured")
    if not _EVM_ADDRESS_RE.fullmatch(contract) or int(contract, 16) == 0:
        raise RuntimeError("POLICY_NFT_ADDRESS must be a non-zero EVM address")

    data = "0x" + _OWNER_OF_SELECTOR + token_id.to_bytes(32, "big").hex()
    response = httpx.post(
        settings.injective_evm_rpc_url,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": contract, "data": data}, "latest"],
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("invalid JSON-RPC response")
    error = payload.get("error")
    if error is not None:
        detail = error.get("message") if isinstance(error, dict) else str(error)
        raise ValueError(f"PolicyNFT ownerOf reverted: {detail}")
    result = payload.get("result")
    if not isinstance(result, str) or not re.fullmatch(
        r"0x[0-9a-fA-F]{64}", result
    ):
        raise RuntimeError("invalid PolicyNFT ownerOf result")
    # ABI address values are right-aligned in a 32-byte word.
    if int(result[:26], 16) != 0:
        raise RuntimeError("invalid PolicyNFT ownerOf address padding")
    return "0x" + result[-40:].lower()


def validate_policy_nft_mint_tx(mint_tx: str, token_id: int) -> bool:
    """Best-effort proof that ``mint_tx`` emitted this token's mint Transfer.

    ``ownerOf`` remains the authoritative confirmation signal.  This stricter
    receipt check only decides whether an untrusted client-supplied hash is safe
    to display/persist; every unavailable or malformed response returns False.
    """
    import httpx  # noqa: PLC0415

    try:
        contract = settings.policy_nft_address
        if (
            not _TX_HASH_RE.fullmatch(mint_tx)
            or token_id < 0
            or token_id > _POLICY_TOKEN_ID_MAX
            or not _EVM_ADDRESS_RE.fullmatch(contract)
            or int(contract, 16) == 0
        ):
            return False
        response = httpx.post(
            settings.injective_evm_rpc_url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_getTransactionReceipt",
                "params": [mint_tx],
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("error") is not None:
            return False
        receipt = payload.get("result")
        if not isinstance(receipt, dict):
            return False
        if str(receipt.get("status", "")).lower() not in {"0x1", "0x01"}:
            return False
        if str(receipt.get("to", "")).lower() != contract.lower():
            return False
        if str(receipt.get("transactionHash", "")).lower() != mint_tx.lower():
            return False

        expected_token_topic = "0x" + token_id.to_bytes(32, "big").hex()
        expected_zero_topic = "0x" + "0" * 64
        logs = receipt.get("logs")
        if not isinstance(logs, list):
            return False
        for item in logs:
            if not isinstance(item, dict):
                continue
            topics = item.get("topics")
            if (
                str(item.get("address", "")).lower() == contract.lower()
                and isinstance(topics, list)
                and len(topics) >= 4
                and str(topics[0]).lower() == _ERC721_TRANSFER_TOPIC
                and str(topics[1]).lower() == expected_zero_topic
                and str(topics[3]).lower() == expected_token_topic
            ):
                return True
    except Exception:  # noqa: BLE001 -- hash persistence is deliberately optional
        logger.warning(
            "PolicyNFT mint receipt unavailable; ignoring client hash %s",
            mint_tx,
            exc_info=True,
        )
        return False

    logger.warning("PolicyNFT mint receipt did not validate; ignoring %s", mint_tx)
    return False


def send_settle_tx(on_chain_policy_id: str, outcomes_yes: list[bool]) -> str:
    """Sign and broadcast settlePolicy as the RELAYER. Returns tx hash.

    Uses legacy tx (no EIP-1559) with explicit gasPrice. Confirms via nonce
    advance + storage read (policies(pid).settled == true), NOT receipt-by-hash.
    """
    from eth_account import Account  # noqa: PLC0415
    from web3 import Web3  # noqa: PLC0415

    w3, vault = _get_vault_contract()
    pid_bytes = bytes.fromhex(on_chain_policy_id.replace("0x", ""))

    relayer_key = settings.relayer_private_key
    if not relayer_key:
        raise RuntimeError("RELAYER_PRIVATE_KEY not configured")
    acct = Account.from_key(relayer_key)
    sender = acct.address

    nonce = w3.eth.get_transaction_count(sender, "latest")

    # Build the transaction — LEGACY only (red line ①)
    tx = vault.functions.settlePolicy(pid_bytes, outcomes_yes).build_transaction(
        {
            "gas": 500_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": nonce,
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    # Strip any EIP-1559 fields that web3 might sneak in (red line ①)
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)

    signed = acct.sign_transaction(tx)

    # Submit with retry (LB pods may reject transiently)
    tx_hash = None
    for attempt in range(8):
        try:
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            break
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            if "already known" in msg or "known transaction" in msg:
                tx_hash = signed.hash
                break
            if attempt == 7:
                raise
            time.sleep(2)

    tx_hash_hex = tx_hash.hex() if hasattr(tx_hash, "hex") else str(tx_hash)
    if not tx_hash_hex.startswith("0x"):
        tx_hash_hex = "0x" + tx_hash_hex

    # Confirm by committed state (red line ②): nonce advance + storage read
    deadline = time.time() + 120
    while time.time() < deadline:
        current_nonce = w3.eth.get_transaction_count(sender, "latest")
        if current_nonce >= nonce + 1:
            # Verify settled flag on-chain
            _, _, _, _, settled = vault.functions.policies(pid_bytes).call()
            if settled:
                logger.info("settlePolicy confirmed: tx=%s", tx_hash_hex)
                return tx_hash_hex
        time.sleep(3)

    raise RuntimeError(
        f"settlePolicy tx {tx_hash_hex} not confirmed within 120s (nonce or settled flag not advanced)"
    )


def build_settle_tx_object(on_chain_policy_id: str, outcomes_yes: list[bool]) -> dict:
    """Build (but do NOT broadcast) a settlePolicy legacy tx. For dry-run / testing.

    Returns the raw tx dict that would be signed (no type, no maxFeePerGas, has gasPrice).
    """
    from eth_account import Account  # noqa: PLC0415
    from web3 import Web3  # noqa: PLC0415

    w3, vault = _get_vault_contract()
    pid_bytes = bytes.fromhex(on_chain_policy_id.replace("0x", ""))

    relayer_key = settings.relayer_private_key
    if not relayer_key:
        raise RuntimeError("RELAYER_PRIVATE_KEY not configured")
    acct = Account.from_key(relayer_key)
    sender = acct.address

    tx = vault.functions.settlePolicy(pid_bytes, outcomes_yes).build_transaction(
        {
            "gas": 500_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": 0,  # placeholder
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    # Strip EIP-1559 fields (red line ①)
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)
    return tx


# ═════════════════════════════════════════════════════════════════
#                     OUTCOME ORACLE (optimistic settlement)
# ═════════════════════════════════════════════════════════════════


def _load_oracle_abi() -> list:
    """Load OutcomeOracle ABI from the forge output (read-only access to contracts/out)."""
    global _ORACLE_ABI
    if _ORACLE_ABI is not None:
        return _ORACLE_ABI
    abi_path = (
        Path(__file__).resolve().parents[1].parent
        / "contracts"
        / "out"
        / "OutcomeOracle.sol"
        / "OutcomeOracle.json"
    )
    if not abi_path.exists():
        raise RuntimeError(
            f"OutcomeOracle ABI not found at {abi_path}. Run `forge build` in contracts/."
        )
    _ORACLE_ABI = json.loads(abi_path.read_text())["abi"]
    return _ORACLE_ABI


def _get_oracle_contract():
    """Return (w3, contract) for the OutcomeOracle."""
    from web3 import Web3  # noqa: PLC0415

    w3 = _get_w3()
    abi = _load_oracle_abi()
    addr = settings.outcome_oracle_address
    if not addr:
        raise RuntimeError("OUTCOME_ORACLE_ADDRESS not configured")
    return w3, w3.eth.contract(address=Web3.to_checksum_address(addr), abi=abi)


def _market_ref_bytes(market_ref: str) -> bytes:
    """Convert a 0x-prefixed 32-byte marketRef to bytes; validate length."""
    b = bytes.fromhex(market_ref.replace("0x", ""))
    if len(b) != 32:
        raise ValueError(f"market_ref must be 32 bytes, got {len(b)}")
    return b


def _relayer_account():
    """Return an eth_account for the relayer hot key (raises if unset)."""
    from eth_account import Account  # noqa: PLC0415

    key = settings.relayer_private_key
    if not key:
        raise RuntimeError("RELAYER_PRIVATE_KEY not configured")
    return Account.from_key(key)


def _broadcast_legacy(w3, acct, tx) -> tuple[str, int]:
    """Sign a prepared legacy tx (stripping any 1559 fields), broadcast with retry.

    Returns (tx_hash_hex, sent_nonce). Confirmation is the caller's responsibility
    (committed-state model: nonce advance + eth_call read).
    """
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)
    nonce = tx["nonce"]
    signed = acct.sign_transaction(tx)
    tx_hash = None
    for attempt in range(8):
        try:
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            break
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).lower()
            if "already known" in msg or "known transaction" in msg:
                tx_hash = signed.hash
                break
            if attempt == 7:
                raise
            time.sleep(2)
    tx_hash_hex = tx_hash.hex() if hasattr(tx_hash, "hex") else str(tx_hash)
    if not tx_hash_hex.startswith("0x"):
        tx_hash_hex = "0x" + tx_hash_hex
    return tx_hash_hex, nonce


def _wait_nonce_advance(w3, sender: str, nonce: int, timeout: float = 120) -> bool:
    """Block until the sender's nonce advances past `nonce` (committed) or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if w3.eth.get_transaction_count(sender, "latest") >= nonce + 1:
            return True
        time.sleep(3)
    return False


def read_assertion(market_ref: str) -> dict:
    """Read the current OutcomeOracle assertion state for a marketRef.

    Returns: {proposer, assertedYes, assertTime, liveness, bond, disputer,
              status (int), finalYes}
    """
    w3, oracle = _get_oracle_contract()
    ref = _market_ref_bytes(market_ref)
    proposer, asserted_yes, assert_time, liveness, bond, disputer, status, final_yes = (
        oracle.functions.assertions(ref).call()
    )
    return {
        "proposer": proposer,
        "assertedYes": asserted_yes,
        "assertTime": assert_time,
        "liveness": liveness,
        "bond": bond,
        "disputer": disputer,
        "status": status,
        "finalYes": final_yes,
    }


def send_assert_tx(market_ref: str, outcome_yes: bool) -> str:
    """Assert a market outcome on the OutcomeOracle as the RELAYER (proposer).

    Approves the bond token first if the current allowance is insufficient. Legacy
    tx only; confirms by committed state (nonce advance + status == Asserted).
    Returns the assertOutcome tx hash.
    """
    from web3 import Web3  # noqa: PLC0415

    w3, oracle = _get_oracle_contract()
    acct = _relayer_account()
    sender = acct.address
    ref = _market_ref_bytes(market_ref)

    bond = oracle.functions.bondAmount().call()

    # Ensure bond allowance if a bond is required.
    if bond > 0:
        usdc_addr = settings.usdc_address
        if not usdc_addr:
            raise RuntimeError("USDC_ADDRESS not configured (needed for oracle bond)")
        usdc = w3.eth.contract(
            address=Web3.to_checksum_address(usdc_addr), abi=_ERC20_MIN_ABI
        )
        allowance = usdc.functions.allowance(sender, oracle.address).call()
        if allowance < bond:
            nonce = w3.eth.get_transaction_count(sender, "latest")
            approve_tx = usdc.functions.approve(oracle.address, bond * 100).build_transaction(
                {
                    "gas": 120_000,
                    "gasPrice": settings.injective_evm_gas_price_wei,
                    "nonce": nonce,
                    "chainId": settings.injective_evm_chain_id,
                    "from": sender,
                }
            )
            _, approve_nonce = _broadcast_legacy(w3, acct, approve_tx)
            if not _wait_nonce_advance(w3, sender, approve_nonce):
                raise RuntimeError("oracle bond approve not confirmed within 120s")

    nonce = w3.eth.get_transaction_count(sender, "latest")
    tx = oracle.functions.assertOutcome(ref, bool(outcome_yes)).build_transaction(
        {
            "gas": 200_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": nonce,
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    tx_hash_hex, sent_nonce = _broadcast_legacy(w3, acct, tx)
    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(sender, "latest") >= sent_nonce + 1:
            status = oracle.functions.assertions(ref).call()[6]
            if status == ORACLE_STATUS_ASSERTED:
                logger.info("assertOutcome confirmed: tx=%s ref=%s", tx_hash_hex, market_ref)
                return tx_hash_hex
        time.sleep(3)
    raise RuntimeError(f"assertOutcome tx {tx_hash_hex} not confirmed within 120s")


def send_finalize_tx(market_ref: str) -> str:
    """Finalize an undisputed assertion after its challenge window elapses.

    Sent by the relayer (finalize is permissionless). Confirms by committed state
    (nonce advance + status == Resolved). Returns the finalize tx hash.
    """
    w3, oracle = _get_oracle_contract()
    acct = _relayer_account()
    sender = acct.address
    ref = _market_ref_bytes(market_ref)

    nonce = w3.eth.get_transaction_count(sender, "latest")
    tx = oracle.functions.finalize(ref).build_transaction(
        {
            "gas": 150_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": nonce,
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    tx_hash_hex, sent_nonce = _broadcast_legacy(w3, acct, tx)
    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(sender, "latest") >= sent_nonce + 1:
            status = oracle.functions.assertions(ref).call()[6]
            if status == ORACLE_STATUS_RESOLVED:
                logger.info("finalize confirmed: tx=%s ref=%s", tx_hash_hex, market_ref)
                return tx_hash_hex
        time.sleep(3)
    raise RuntimeError(f"finalize tx {tx_hash_hex} not confirmed within 120s")


def relayer_address() -> str:
    """Return the relayer hot-key address (proposer/settler/arbiter in MVP)."""
    return _relayer_account().address


def send_dispute_tx(market_ref: str) -> str:
    """Dispute an active assertion as the RELAYER, matching the captured bond.

    Approves the bond token first if needed. Legacy tx; confirms by committed
    state (nonce advance + status == Disputed). Returns the dispute tx hash.
    """
    from web3 import Web3  # noqa: PLC0415

    w3, oracle = _get_oracle_contract()
    acct = _relayer_account()
    sender = acct.address
    ref = _market_ref_bytes(market_ref)

    bond = oracle.functions.assertions(ref).call()[4]  # bond captured at assert time
    if bond > 0:
        usdc_addr = settings.usdc_address
        if not usdc_addr:
            raise RuntimeError("USDC_ADDRESS not configured (needed for oracle bond)")
        usdc = w3.eth.contract(address=Web3.to_checksum_address(usdc_addr), abi=_ERC20_MIN_ABI)
        if usdc.functions.allowance(sender, oracle.address).call() < bond:
            nonce = w3.eth.get_transaction_count(sender, "latest")
            approve_tx = usdc.functions.approve(oracle.address, bond * 100).build_transaction(
                {
                    "gas": 120_000,
                    "gasPrice": settings.injective_evm_gas_price_wei,
                    "nonce": nonce,
                    "chainId": settings.injective_evm_chain_id,
                    "from": sender,
                }
            )
            _broadcast_legacy(w3, acct, approve_tx)
            if not _wait_nonce_advance(w3, sender, nonce):
                raise RuntimeError("oracle bond approve not confirmed within 120s")

    nonce = w3.eth.get_transaction_count(sender, "latest")
    tx = oracle.functions.dispute(ref).build_transaction(
        {
            "gas": 200_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": nonce,
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    tx_hash_hex, sent_nonce = _broadcast_legacy(w3, acct, tx)
    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(sender, "latest") >= sent_nonce + 1:
            if oracle.functions.assertions(ref).call()[6] == ORACLE_STATUS_DISPUTED:
                logger.info("dispute confirmed: tx=%s ref=%s", tx_hash_hex, market_ref)
                return tx_hash_hex
        time.sleep(3)
    raise RuntimeError(f"dispute tx {tx_hash_hex} not confirmed within 120s")


def send_resolve_dispute_tx(market_ref: str, final_yes: bool) -> str:
    """Owner-arbitrate a disputed assertion to `final_yes`.

    The RELAYER must be the oracle owner (true in the MVP single-hot-key model),
    else the tx reverts. Legacy tx; confirms by committed state (nonce advance +
    status == Resolved). Returns the resolveDispute tx hash.
    """
    w3, oracle = _get_oracle_contract()
    acct = _relayer_account()
    sender = acct.address
    ref = _market_ref_bytes(market_ref)

    nonce = w3.eth.get_transaction_count(sender, "latest")
    tx = oracle.functions.resolveDispute(ref, bool(final_yes)).build_transaction(
        {
            "gas": 200_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": nonce,
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    tx_hash_hex, sent_nonce = _broadcast_legacy(w3, acct, tx)
    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(sender, "latest") >= sent_nonce + 1:
            if oracle.functions.assertions(ref).call()[6] == ORACLE_STATUS_RESOLVED:
                logger.info(
                    "resolveDispute confirmed: tx=%s ref=%s final_yes=%s",
                    tx_hash_hex,
                    market_ref,
                    final_yes,
                )
                return tx_hash_hex
        time.sleep(3)
    raise RuntimeError(f"resolveDispute tx {tx_hash_hex} not confirmed within 120s")


def send_settle_from_oracle_tx(on_chain_policy_id: str) -> str:
    """Sign and broadcast settlePolicyFromOracle as the RELAYER. Returns tx hash.

    Reads outcomes from the OutcomeOracle on-chain (relayer supplies no outcomes).
    Legacy tx; confirms by committed state (nonce advance + policies(pid).settled).

    Rejects policies that are already settled before broadcast so a reverted
    re-settle tx cannot be mistaken for success (nonce still advances on revert,
    and a prior settled=true would otherwise look like confirmation).
    """
    w3, vault = _get_vault_contract()
    acct = _relayer_account()
    sender = acct.address
    pid_bytes = bytes.fromhex(on_chain_policy_id.replace("0x", ""))

    already_settled = vault.functions.policies(pid_bytes).call()[4]
    if already_settled:
        raise RuntimeError(
            f"settlePolicyFromOracle: policy {on_chain_policy_id} already settled on-chain"
        )

    nonce = w3.eth.get_transaction_count(sender, "latest")
    tx = vault.functions.settlePolicyFromOracle(pid_bytes).build_transaction(
        {
            "gas": 600_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": nonce,
            "chainId": settings.injective_evm_chain_id,
            "from": sender,
        }
    )
    tx_hash_hex, sent_nonce = _broadcast_legacy(w3, acct, tx)
    deadline = time.time() + 120
    while time.time() < deadline:
        if w3.eth.get_transaction_count(sender, "latest") >= sent_nonce + 1:
            settled = vault.functions.policies(pid_bytes).call()[4]
            if settled:
                logger.info("settlePolicyFromOracle confirmed: tx=%s", tx_hash_hex)
                return tx_hash_hex
        time.sleep(3)
    raise RuntimeError(
        f"settlePolicyFromOracle tx {tx_hash_hex} not confirmed within 120s"
    )


def build_settle_from_oracle_tx_object(on_chain_policy_id: str) -> dict:
    """Build (do NOT broadcast) a settlePolicyFromOracle legacy tx. For dry-run/tests."""
    w3, vault = _get_vault_contract()
    acct = _relayer_account()
    pid_bytes = bytes.fromhex(on_chain_policy_id.replace("0x", ""))
    tx = vault.functions.settlePolicyFromOracle(pid_bytes).build_transaction(
        {
            "gas": 600_000,
            "gasPrice": settings.injective_evm_gas_price_wei,
            "nonce": 0,  # placeholder
            "chainId": settings.injective_evm_chain_id,
            "from": acct.address,
        }
    )
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)
    return tx
