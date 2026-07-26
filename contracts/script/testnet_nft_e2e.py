"""差分机 — PolicyNFT real testnet E2E on Injective (chainId 1439).

Flow:
  1) Verify deployed PolicyNFT (vault / baseURI / ERC-721)
  2) Open a UUID-namespace policy on the current PolicyVault
  3) Mint the NFT, assert ownerOf + tokenURI
  4) Transfer the NFT, assert new owner
  5) Project mint into the app DB via confirm_policy_nft_mint
  6) Hit public metadata HTTP (tokenURI target)

Run (from contracts/):
  set -a; . ../backend/.env; set +a
  ../backend/.venv/bin/python script/testnet_nft_e2e.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx
from eth_account import Account
from web3 import Web3

BACKEND = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))

CHAIN_ID = 1439
GAS_PRICE = 160_000_000
USDC_1 = 10**6
OUT = Path(__file__).resolve().parents[1] / "out"
GAMMA = (
    "https://gamma-api.polymarket.com/markets"
    "?closed=false&limit=40&order=volumeNum&ascending=false"
)


def load_abi(sol: str, name: str) -> list:
    return json.loads((OUT / sol / f"{name}.json").read_text())["abi"]


def send(w3: Web3, acct, tx, label: str) -> str:
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
    deadline = time.time() + 180
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


def pick_open_markets() -> list[dict]:
    rows = httpx.get(GAMMA, timeout=30).json()
    rows = rows if isinstance(rows, list) else rows.get("data", [])
    picked: list[dict] = []
    for m in rows:
        cond = m.get("conditionId") or ""
        if not (isinstance(cond, str) and cond.startswith("0x") and len(cond) == 66):
            continue
        prices = m.get("outcomePrices")
        if isinstance(prices, str):
            try:
                prices = json.loads(prices)
            except json.JSONDecodeError:
                prices = None
        if not prices or len(prices) < 2:
            continue
        try:
            p_yes = float(prices[0])
        except (TypeError, ValueError):
            continue
        if not (0.05 < p_yes < 0.95):
            continue
        entry = max(500, min(9500, int(round(p_yes * 10000))))
        picked.append(
            {
                "cond": cond,
                "entry": entry,
                "q": (m.get("question") or "")[:60],
            }
        )
        if len(picked) >= 2:
            break
    if len(picked) < 2:
        raise RuntimeError(f"need 2 open markets, got {len(picked)}")
    return picked


async def project_and_metadata(
    *,
    policy_uuid: uuid.UUID,
    user_id: uuid.UUID,
    token_id: str,
    mint_tx: str,
    metadata_base: str,
) -> None:
    from core.database import AsyncSessionLocal
    from services.policy_nft_service import confirm_policy_nft_mint

    async with AsyncSessionLocal() as db:
        detail = await confirm_policy_nft_mint(
            db,
            user_id=user_id,
            policy_id=policy_uuid,
            nft_token_id=token_id,
            mint_tx=mint_tx,
        )
        assert detail is not None, "confirm returned None (IDOR?)"
        assert detail.nft_token_id == token_id
        assert detail.nft_minted_at is not None
        print(
            f"  [confirm] nftTokenId={detail.nft_token_id} "
            f"mintTx={detail.nft_mint_tx} mintedAt={detail.nft_minted_at}"
        )

    url = f"{metadata_base.rstrip('/')}/{token_id}"
    r = httpx.get(url, timeout=30)
    print(f"  [metadata] GET {url} -> {r.status_code}")
    r.raise_for_status()
    body = r.json()
    assert body.get("name"), "metadata missing name"
    assert "image" in body
    assert isinstance(body.get("attributes"), list)
    print(f"  [metadata] name={body['name']!r} attrs={len(body['attributes'])}")


async def ensure_db_policy(
    *,
    policy_uuid: uuid.UUID,
    user_id: uuid.UUID,
    on_chain_policy_id: str,
) -> None:
    """Insert a minimal active policy row so confirm/metadata can project."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from core.database import AsyncSessionLocal
    from models.policy import Policy

    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(Policy).where(Policy.id == policy_uuid))
        if existing.scalar_one_or_none() is not None:
            print(f"  [db] policy {policy_uuid} already exists")
            return
        now = datetime.now(timezone.utc)
        policy = Policy(
            id=policy_uuid,
            user_id=user_id,
            status="active",
            search_status="searched",
            need_text="NFT E2E test policy",
            title="NFT E2E test policy",
            on_chain_policy_id=on_chain_policy_id,
            opened_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(policy)
        await db.commit()
        print(f"  [db] inserted active policy {policy_uuid}")


def main() -> None:
    rpc = os.environ["INJECTIVE_EVM_RPC_URL"].strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    nft_addr = Web3.to_checksum_address(os.environ["POLICY_NFT_ADDRESS"].strip())
    metadata_base = os.environ["NFT_METADATA_BASE_URL"].strip()
    # App user that already owns active policies on this vault in local/dev DB.
    user_id = uuid.UUID(
        os.environ.get("NFT_E2E_USER_ID", "292de9d7-de31-4dcc-b7c6-847aecce4604")
    )

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 45}))
    vault = w3.eth.contract(address=vault_addr, abi=load_abi("PolicyVault.sol", "PolicyVault"))
    usdc = w3.eth.contract(address=usdc_addr, abi=load_abi("MockUSDC.sol", "MockUSDC"))
    nft = w3.eth.contract(address=nft_addr, abi=load_abi("PolicyNFT.sol", "PolicyNFT"))

    print("=== 1) Verify PolicyNFT deployment ===")
    assert nft.functions.vault().call() == vault_addr
    base_uri = nft.functions.baseURI().call()
    assert base_uri.rstrip("/") == metadata_base.rstrip("/")
    assert nft.functions.supportsInterface(bytes.fromhex("80ac58cd")).call()
    print(f"  nft={nft_addr}")
    print(f"  vault={nft.functions.vault().call()}")
    print(f"  baseURI={base_uri}")
    print(f"  name={nft.functions.name().call()} symbol={nft.functions.symbol().call()}")

    print("\n=== 2) Open UUID-namespace policy on vault ===")
    markets = pick_open_markets()
    for m in markets:
        print(f"  market entry={m['entry']} {m['cond'][:12]}… {m['q']}")
    weights = [6000, 4000]
    positions = [
        (bytes.fromhex(m["cond"][2:]), True, m["entry"], w)
        for m, w in zip(markets, weights)
    ]
    premium = 50 * USDC_1
    feebps = vault.functions.feeBps().call()
    net = premium - premium * feebps // 10000
    max_payout = sum(net * w // 10000 * 10000 // e for (_, _, e, w) in positions)
    free = vault.functions.freeLiquidity().call()
    print(f"  premium={premium/USDC_1} feeBps={feebps} maxPayout={max_payout/USDC_1} free={free/USDC_1}")
    assert max_payout <= free, "insufficient free liquidity"

    policy_uuid = uuid.uuid4()
    on_chain = "0x" + ("00" * 16) + policy_uuid.bytes.hex()
    pid = bytes.fromhex(on_chain[2:])
    token_id = str(policy_uuid.int)
    coverage_end = int(time.time()) + 7 * 86400
    print(f"  policyUuid={policy_uuid}")
    print(f"  onChainPolicyId={on_chain}")
    print(f"  tokenId={token_id}")

    if usdc.functions.balanceOf(dep.address).call() < premium:
        send(
            w3,
            dep,
            usdc.functions.mint(dep.address, premium * 5).build_transaction({"gas": 150_000}),
            "mint USDC",
        )
    send(
        w3,
        dep,
        usdc.functions.approve(vault_addr, premium).build_transaction({"gas": 150_000}),
        "approve",
    )
    send(
        w3,
        dep,
        vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction(
            {"gas": 1_300_000}
        ),
        "openPolicy",
    )
    user, prem, maxp, cend, settled = vault.functions.policies(pid).call()
    assert user == dep.address and not settled
    print(f"  on-chain policy user={user} premium={prem} maxPayout={maxp} settled={settled}")

    print("\n=== 3) Mint PolicyNFT ===")
    mint_tx = send(
        w3,
        dep,
        nft.functions.mint(pid).build_transaction({"gas": 300_000}),
        "mint",
    )
    owner = nft.functions.ownerOf(int(token_id)).call()
    assert owner == dep.address, f"ownerOf mismatch: {owner}"
    token_uri = nft.functions.tokenURI(int(token_id)).call()
    print(f"  ownerOf={owner}")
    print(f"  tokenURI={token_uri}")
    assert token_uri == f"{base_uri}{token_id}" or token_uri == f"{base_uri.rstrip('/')}/{token_id}"

    print("\n=== 4) Transfer NFT to fresh wallet ===")
    recipient = Account.create()
    send(
        w3,
        dep,
        {"to": recipient.address, "value": w3.to_wei(0.005, "ether"), "gas": 21_000},
        "fund recipient INJ",
    )
    send(
        w3,
        dep,
        nft.functions.transferFrom(dep.address, recipient.address, int(token_id)).build_transaction(
            {"gas": 200_000}
        ),
        "transferFrom",
    )
    assert nft.functions.ownerOf(int(token_id)).call() == recipient.address
    print(f"  new owner={recipient.address}")

    print("\n=== 5+6) DB confirm + public metadata ===")
    asyncio.run(
        ensure_db_policy(
            policy_uuid=policy_uuid,
            user_id=user_id,
            on_chain_policy_id=on_chain,
        )
    )
    asyncio.run(
        project_and_metadata(
            policy_uuid=policy_uuid,
            user_id=user_id,
            token_id=token_id,
            mint_tx=mint_tx,
            metadata_base=metadata_base,
        )
    )

    # Also mint one already-active DB policy that lives on this vault (if unminted).
    existing = os.environ.get(
        "NFT_E2E_EXISTING_POLICY_ID", "41856dba-41c5-46ea-acfc-bcc4e649e388"
    )
    if existing:
        print("\n=== Bonus) Mint existing active DB policy ===")
        existing_uuid = uuid.UUID(existing)
        existing_pid = bytes.fromhex(("00" * 16) + existing_uuid.bytes.hex())
        existing_token = str(existing_uuid.int)
        snap = vault.functions.policies(existing_pid).call()
        print(f"  existing on-chain user={snap[0]} settled={snap[4]}")
        if snap[0] == dep.address:
            try:
                nft.functions.ownerOf(int(existing_token)).call()
                print("  already minted on-chain; skipping mint tx")
                bonus_tx = None
            except Exception:  # noqa: BLE001
                bonus_tx = send(
                    w3,
                    dep,
                    nft.functions.mint(existing_pid).build_transaction({"gas": 300_000}),
                    "mint-existing",
                )
                assert nft.functions.ownerOf(int(existing_token)).call() == dep.address
            asyncio.run(
                project_and_metadata(
                    policy_uuid=existing_uuid,
                    user_id=user_id,
                    token_id=existing_token,
                    mint_tx=bonus_tx,
                    metadata_base=metadata_base,
                )
            )
        else:
            print("  skip: on-chain user is not deployer")

    print("\n===== POLICY NFT E2E PASSED (testnet 1439) =====")
    print(f"  POLICY_NFT_ADDRESS={nft_addr}")
    print(f"  minted tokenId={token_id}")
    print(f"  current owner={recipient.address}")


if __name__ == "__main__":
    main()
