"""差分机 — PolicyNFT 全场景真实测试网 E2E (Injective chainId 1439).

覆盖场景:
  1) 验证已部署 PolicyNFT (vault/baseURI/ERC-721/ERC-165)
  2) 开 UUID-namespace policy + mint NFT + 验证 ownerOf/tokenURI
  3) transferFrom 转让给新钱包
  4) approve + 授权方 transferFrom
  5) setApprovalForAll + operator transferFrom
  6) safeTransferFrom 到 EOA
  7) 重复 mint 拒绝 (revert)
  8) 非保单 user mint 拒绝 (revert)
  9) 结算后保单 mint (settle → mint)
  10) DB confirm 投射 + 幂等确认
  11) 公开 metadata 内容验证 (属性/隐私/SVG)

遵守项目规范:
  - 强制 chainId 1439, gasPrice=160_000_000, legacy tx (无 type/1559 字段)
  - nonce 推进确认, 不使用 wait_for_transaction_receipt
  - 全量真实链上断言, 不使用 mock

运行 (from contracts/):
  set -a; . ../backend/.env; set +a
  ../backend/.venv/bin/python script/testnet_nft_e2e_full.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
import traceback
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

# ---------- Results tracker ----------
_results: list[tuple[str, bool, str]] = []


def record(name: str, passed: bool, detail: str = "") -> None:
    _results.append((name, passed, detail))
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"  {status} | {name}" + (f" — {detail}" if detail else ""))


def print_summary() -> None:
    total = len(_results)
    passed = sum(1 for _, p, _ in _results if p)
    failed = total - passed
    print("\n" + "=" * 60)
    print(f"  NFT E2E 测试结果: {passed}/{total} 通过, {failed} 失败")
    print("=" * 60)
    for name, p, detail in _results:
        mark = "✅" if p else "❌"
        print(f"  {mark} {name}" + (f" — {detail}" if detail and not p else ""))
    if failed:
        print("\n  ⚠️  有失败的测试场景，请检查输出")
    else:
        print("\n  🎉 全部 NFT E2E 场景通过 (testnet 1439)")


# ---------- Chain helpers ----------


def load_abi(sol: str, name: str) -> list:
    return json.loads((OUT / sol / f"{name}.json").read_text())["abi"]


def send(w3: Web3, acct, tx, label: str) -> str:
    """Sign, broadcast & confirm via nonce advancement (no receipt wait)."""
    n = w3.eth.get_transaction_count(acct.address, "latest")
    tx.setdefault("nonce", n)
    tx.update({"gasPrice": GAS_PRICE, "chainId": CHAIN_ID, "from": acct.address})
    # Legacy tx: strip EIP-1559 / type fields
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
    # Confirm via nonce push
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
    print(f"    [{label}] tx={txhash}")
    return txhash


def call_reverts(w3: Web3, acct, tx) -> bool:
    """Test if a call would revert (True = reverted as expected)."""
    n = w3.eth.get_transaction_count(acct.address, "latest")
    tx.setdefault("nonce", n)
    tx.update({"gasPrice": GAS_PRICE, "chainId": CHAIN_ID, "from": acct.address})
    for k in ("maxFeePerGas", "maxPriorityFeePerGas", "type"):
        tx.pop(k, None)
    try:
        w3.eth.call({"to": tx["to"], "data": tx.get("data", b""), "from": acct.address})
        return False  # did NOT revert
    except Exception:  # noqa: BLE001
        return True  # reverted


def pick_open_markets() -> list[dict]:
    """Fetch 2 open Polymarket markets for policy positions."""
    url = (
        "https://gamma-api.polymarket.com/markets"
        "?closed=false&limit=40&order=volumeNum&ascending=false"
    )
    rows = httpx.get(url, timeout=30).json()
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
        picked.append({"cond": cond, "entry": entry, "q": (m.get("question") or "")[:60]})
        if len(picked) >= 2:
            break
    if len(picked) < 2:
        raise RuntimeError(f"need 2 open markets, got {len(picked)}")
    return picked


# ---------- DB helpers ----------
# All DB operations run inside _run_db_tests() with a single event loop.


# ---------- Test scenarios ----------


def test_1_deployment_verification(nft, vault, vault_addr: str, nft_addr: str) -> None:
    """场景1: 验证已部署 PolicyNFT (vault/baseURI/ERC-721/ERC-165)."""
    print("\n=== 场景1: 部署验证 ===")
    try:
        # Vault binding
        assert nft.functions.vault().call() == vault_addr
        record("vault 绑定正确", True)
    except Exception as exc:
        record("vault 绑定正确", False, str(exc))

    try:
        base_uri = nft.functions.baseURI().call()
        assert len(base_uri) > 0
        assert base_uri.endswith("/")
        record("baseURI 非空且以 / 结尾", True, base_uri)
    except Exception as exc:
        record("baseURI 非空且以 / 结尾", False, str(exc))

    try:
        # ERC-165
        assert nft.functions.supportsInterface(bytes.fromhex("01ffc9a7")).call()
        record("ERC-165 接口支持", True)
    except Exception as exc:
        record("ERC-165 接口支持", False, str(exc))

    try:
        # ERC-721
        assert nft.functions.supportsInterface(bytes.fromhex("80ac58cd")).call()
        record("ERC-721 接口支持", True)
    except Exception as exc:
        record("ERC-721 接口支持", False, str(exc))

    try:
        # ERC-721 Metadata
        assert nft.functions.supportsInterface(bytes.fromhex("5b5e139f")).call()
        record("ERC-721 Metadata 接口支持", True)
    except Exception as exc:
        record("ERC-721 Metadata 接口支持", False, str(exc))

    try:
        # Invalid interface
        assert not nft.functions.supportsInterface(bytes.fromhex("ffffffff")).call()
        record("无效接口正确拒绝", True)
    except Exception as exc:
        record("无效接口正确拒绝", False, str(exc))

    try:
        assert nft.functions.name().call() == "Lemma Policy"
        assert nft.functions.symbol().call() == "LPOL"
        record("name=Lemma Policy, symbol=LPOL", True)
    except Exception as exc:
        record("name=Lemma Policy, symbol=LPOL", False, str(exc))


def test_2_mint_and_ownership(
    w3: Web3, dep, vault, nft, usdc, vault_addr: str, markets: list[dict]
) -> tuple[uuid.UUID, str, str]:
    """场景2: 开保单 + mint NFT + 验证 ownerOf/tokenURI."""
    print("\n=== 场景2: 开保单 + Mint NFT ===")
    # Build positions
    weights = [6000, 4000]
    positions = [
        (bytes.fromhex(m["cond"][2:]), True, m["entry"], w)
        for m, w in zip(markets, weights)
    ]
    premium = 50 * USDC_1
    feebps = vault.functions.feeBps().call()
    net = premium - premium * feebps // 10000

    policy_uuid = uuid.uuid4()
    on_chain = "0x" + ("00" * 16) + policy_uuid.bytes.hex()
    pid = bytes.fromhex(on_chain[2:])
    token_id = str(policy_uuid.int)
    coverage_end = int(time.time()) + 7 * 86400
    print(f"    policyUuid={policy_uuid}")
    print(f"    tokenId={token_id}")

    # Ensure USDC balance
    if usdc.functions.balanceOf(dep.address).call() < premium:
        send(w3, dep, usdc.functions.mint(dep.address, premium * 5).build_transaction({"gas": 150_000}), "mint USDC")
    send(w3, dep, usdc.functions.approve(vault_addr, premium).build_transaction({"gas": 150_000}), "approve USDC")
    send(w3, dep, vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction({"gas": 1_300_000}), "openPolicy")

    # Verify on-chain
    user_addr, prem, maxp, cend, settled = vault.functions.policies(pid).call()
    try:
        assert user_addr == dep.address and not settled
        record("openPolicy 链上状态正确", True, f"premium={prem} maxPayout={maxp}")
    except Exception as exc:
        record("openPolicy 链上状态正确", False, str(exc))

    # Mint
    mint_tx = send(w3, dep, nft.functions.mint(pid).build_transaction({"gas": 300_000}), "mint NFT")

    try:
        owner = nft.functions.ownerOf(int(token_id)).call()
        assert owner == dep.address
        record("mint 后 ownerOf 正确", True, f"owner={owner}")
    except Exception as exc:
        record("mint 后 ownerOf 正确", False, str(exc))

    try:
        base_uri = nft.functions.baseURI().call()
        token_uri = nft.functions.tokenURI(int(token_id)).call()
        expected = f"{base_uri}{token_id}"
        assert token_uri == expected
        record("tokenURI 格式正确", True, token_uri[:80])
    except Exception as exc:
        record("tokenURI 格式正确", False, str(exc))

    try:
        balance = nft.functions.balanceOf(dep.address).call()
        assert balance >= 1
        record("balanceOf 递增", True, f"balance={balance}")
    except Exception as exc:
        record("balanceOf 递增", False, str(exc))

    return policy_uuid, on_chain, token_id, mint_tx


def test_3_transfer(w3: Web3, dep, nft, token_id: str) -> str:
    """场景3: transferFrom 转让给新钱包."""
    print("\n=== 场景3: transferFrom 转让 ===")
    recipient = Account.create()
    # Fund recipient for gas
    send(w3, dep, {"to": recipient.address, "value": w3.to_wei(0.005, "ether"), "gas": 21_000}, "fund recipient")
    send(w3, dep, nft.functions.transferFrom(dep.address, recipient.address, int(token_id)).build_transaction({"gas": 200_000}), "transferFrom")

    try:
        new_owner = nft.functions.ownerOf(int(token_id)).call()
        assert new_owner == recipient.address
        record("transferFrom 新 owner 正确", True, f"new_owner={recipient.address[:12]}…")
    except Exception as exc:
        record("transferFrom 新 owner 正确", False, str(exc))

    # Transfer back for subsequent tests
    send(w3, recipient, nft.functions.transferFrom(recipient.address, dep.address, int(token_id)).build_transaction({"gas": 200_000}), "transfer back")
    return recipient.address


def test_4_approve_transfer(w3: Web3, dep, nft, token_id: str) -> None:
    """场景4: approve + 授权方 transferFrom."""
    print("\n=== 场景4: approve + delegated transferFrom ===")
    approved_addr = Account.create()
    target = Account.create()
    # Fund for gas
    send(w3, dep, {"to": approved_addr.address, "value": w3.to_wei(0.005, "ether"), "gas": 21_000}, "fund approved")

    # Approve
    send(w3, dep, nft.functions.approve(approved_addr.address, int(token_id)).build_transaction({"gas": 100_000}), "approve")

    try:
        got = nft.functions.getApproved(int(token_id)).call()
        assert got.lower() == approved_addr.address.lower()
        record("getApproved 返回正确地址", True)
    except Exception as exc:
        record("getApproved 返回正确地址", False, str(exc))

    # Delegated transfer
    send(w3, approved_addr, nft.functions.transferFrom(dep.address, target.address, int(token_id)).build_transaction({"gas": 200_000}), "delegated transferFrom")

    try:
        new_owner = nft.functions.ownerOf(int(token_id)).call()
        assert new_owner == target.address
        record("approve 后授权方转让成功", True)
    except Exception as exc:
        record("approve 后授权方转让成功", False, str(exc))

    try:
        # Approval cleared after transfer
        cleared = nft.functions.getApproved(int(token_id)).call()
        assert cleared == "0x0000000000000000000000000000000000000000"
        record("转让后 approval 已清除", True)
    except Exception as exc:
        record("转让后 approval 已清除", False, str(exc))

    # Transfer back to dep for subsequent tests
    send(w3, dep, {"to": target.address, "value": w3.to_wei(0.003, "ether"), "gas": 21_000}, "fund target")
    send(w3, target, nft.functions.transferFrom(target.address, dep.address, int(token_id)).build_transaction({"gas": 200_000}), "return to dep")


def test_5_operator_approval(w3: Web3, dep, nft, token_id: str) -> None:
    """场景5: setApprovalForAll + operator transferFrom."""
    print("\n=== 场景5: operator approval ===")
    operator = Account.create()
    target = Account.create()
    send(w3, dep, {"to": operator.address, "value": w3.to_wei(0.005, "ether"), "gas": 21_000}, "fund operator")

    # Set operator
    send(w3, dep, nft.functions.setApprovalForAll(operator.address, True).build_transaction({"gas": 100_000}), "setApprovalForAll")

    try:
        assert nft.functions.isApprovedForAll(dep.address, operator.address).call()
        record("isApprovedForAll=true", True)
    except Exception as exc:
        record("isApprovedForAll=true", False, str(exc))

    # Operator transfers
    send(w3, operator, nft.functions.transferFrom(dep.address, target.address, int(token_id)).build_transaction({"gas": 200_000}), "operator transferFrom")

    try:
        assert nft.functions.ownerOf(int(token_id)).call() == target.address
        record("operator 转让成功", True)
    except Exception as exc:
        record("operator 转让成功", False, str(exc))

    # Revoke operator
    send(w3, dep, nft.functions.setApprovalForAll(operator.address, False).build_transaction({"gas": 100_000}), "revoke operator")

    try:
        assert not nft.functions.isApprovedForAll(dep.address, operator.address).call()
        record("operator 撤销成功", True)
    except Exception as exc:
        record("operator 撤销成功", False, str(exc))

    # Transfer back
    send(w3, dep, {"to": target.address, "value": w3.to_wei(0.003, "ether"), "gas": 21_000}, "fund target2")
    send(w3, target, nft.functions.transferFrom(target.address, dep.address, int(token_id)).build_transaction({"gas": 200_000}), "return to dep2")


def test_6_safe_transfer(w3: Web3, dep, nft, token_id: str) -> None:
    """场景6: safeTransferFrom to EOA."""
    print("\n=== 场景6: safeTransferFrom ===")
    recipient = Account.create()
    send(w3, dep, {"to": recipient.address, "value": w3.to_wei(0.003, "ether"), "gas": 21_000}, "fund safe-recipient")
    send(w3, dep, nft.functions.safeTransferFrom(dep.address, recipient.address, int(token_id)).build_transaction({"gas": 200_000}), "safeTransferFrom")

    try:
        assert nft.functions.ownerOf(int(token_id)).call() == recipient.address
        record("safeTransferFrom 到 EOA 成功", True)
    except Exception as exc:
        record("safeTransferFrom 到 EOA 成功", False, str(exc))

    # Transfer back
    send(w3, recipient, nft.functions.transferFrom(recipient.address, dep.address, int(token_id)).build_transaction({"gas": 200_000}), "safe return")


def test_7_double_mint_revert(w3: Web3, dep, nft, pid: bytes) -> None:
    """场景7: 重复 mint 拒绝."""
    print("\n=== 场景7: 重复 mint 拒绝 ===")
    reverted = call_reverts(w3, dep, nft.functions.mint(pid).build_transaction({"gas": 300_000}))
    record("重复 mint 正确 revert", reverted, "" if reverted else "未 revert!")


def test_8_non_owner_mint_revert(w3: Web3, dep, vault, nft, usdc, vault_addr: str, markets: list[dict]) -> None:
    """场景8: 非保单 user mint 拒绝."""
    print("\n=== 场景8: 非保单 user mint 拒绝 ===")
    # Open a policy with dep as user
    policy_uuid = uuid.uuid4()
    on_chain = "0x" + ("00" * 16) + policy_uuid.bytes.hex()
    pid = bytes.fromhex(on_chain[2:])
    coverage_end = int(time.time()) + 7 * 86400
    premium = 10 * USDC_1
    positions = [(bytes.fromhex(markets[0]["cond"][2:]), True, markets[0]["entry"], 10000)]

    if usdc.functions.balanceOf(dep.address).call() < premium:
        send(w3, dep, usdc.functions.mint(dep.address, premium * 5).build_transaction({"gas": 150_000}), "mint USDC8")
    send(w3, dep, usdc.functions.approve(vault_addr, premium).build_transaction({"gas": 150_000}), "approve8")
    send(w3, dep, vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction({"gas": 1_300_000}), "openPolicy8")

    # Non-owner tries to mint
    other = Account.create()
    reverted = call_reverts(w3, other, nft.functions.mint(pid).build_transaction({"gas": 300_000}))
    record("非保单 user mint 正确 revert", reverted, "" if reverted else "未 revert!")


def test_9_settled_policy_mint(
    w3: Web3, dep, vault, nft, usdc, vault_addr: str, markets: list[dict]
) -> tuple[uuid.UUID, str, str, str]:
    """场景9: 结算后保单 mint."""
    print("\n=== 场景9: 结算后保单 mint ===")
    policy_uuid = uuid.uuid4()
    on_chain = "0x" + ("00" * 16) + policy_uuid.bytes.hex()
    pid = bytes.fromhex(on_chain[2:])
    token_id = str(policy_uuid.int)
    coverage_end = int(time.time()) + 7 * 86400
    premium = 20 * USDC_1
    positions = [(bytes.fromhex(markets[0]["cond"][2:]), True, markets[0]["entry"], 10000)]

    # Ensure sufficient USDC and vault liquidity
    if usdc.functions.balanceOf(dep.address).call() < premium:
        send(w3, dep, usdc.functions.mint(dep.address, premium * 10).build_transaction({"gas": 150_000}), "mint USDC9")

    # Check vault free liquidity
    free = vault.functions.freeLiquidity().call()
    feebps = vault.functions.feeBps().call()
    net = premium - premium * feebps // 10000
    estimated_max = net * 10000 // markets[0]["entry"]
    print(f"    freeLiquidity={free/USDC_1} estimated_max_payout={estimated_max/USDC_1}")
    if free < estimated_max:
        # Fund the pool so we can open the policy
        fund_amount = estimated_max * 3
        send(w3, dep, usdc.functions.mint(dep.address, fund_amount).build_transaction({"gas": 150_000}), "mint USDC for pool")
        send(w3, dep, usdc.functions.approve(vault_addr, fund_amount).build_transaction({"gas": 150_000}), "approve pool")
        send(w3, dep, vault.functions.fundPool(fund_amount).build_transaction({"gas": 200_000}), "fundPool")

    send(w3, dep, usdc.functions.approve(vault_addr, premium).build_transaction({"gas": 150_000}), "approve9")
    send(w3, dep, vault.functions.openPolicy(pid, positions, premium, coverage_end).build_transaction({"gas": 1_300_000}), "openPolicy9")

    # Verify policy opened before attempting settle
    user_addr, prem9, _, _, settled_before = vault.functions.policies(pid).call()
    if user_addr == "0x0000000000000000000000000000000000000000" or user_addr == "0x" + "00" * 20:
        record("保单已结算", False, "openPolicy9 链上 revert (user=zero)")
        record("结算后 mint 成功", False, "skip (openPolicy failed)")
        return policy_uuid, on_chain, token_id, ""
    print(f"    openPolicy9 confirmed: user={user_addr} premium={prem9}")

    # Settle with outcomes = [false] (no hit)
    outcomes = [False]
    send(w3, dep, vault.functions.settlePolicy(pid, outcomes).build_transaction({"gas": 500_000}), "settlePolicy")

    # Short delay then verify settled state
    time.sleep(3)
    try:
        _, _, _, _, settled = vault.functions.policies(pid).call()
        assert settled
        record("保单已结算", True)
    except Exception as exc:
        record("保单已结算", False, str(exc))
        record("结算后 mint 成功", False, "skip (settle failed)")
        return policy_uuid, on_chain, token_id, ""

    # Mint after settlement
    mint_tx = send(w3, dep, nft.functions.mint(pid).build_transaction({"gas": 300_000}), "mint settled")

    # Short delay then verify
    time.sleep(2)
    try:
        assert nft.functions.ownerOf(int(token_id)).call() == dep.address
        record("结算后 mint 成功", True)
    except Exception as exc:
        record("结算后 mint 成功", False, str(exc))

    return policy_uuid, on_chain, token_id, mint_tx


async def _run_db_tests(
    policy_uuid: uuid.UUID,
    user_id: uuid.UUID,
    on_chain: str,
    token_id: str,
    mint_tx: str,
) -> None:
    """Run all DB-dependent tests in a single event loop."""
    from core.database import AsyncSessionLocal, engine
    from services.policy_nft_service import confirm_policy_nft_mint, get_public_metadata

    # --- 场景10: DB confirm + 幂等 ---
    print("\n=== 场景10: DB confirm + 幂等 ===")

    # Ensure DB row
    await _ensure_db_policy_async(
        policy_uuid=policy_uuid, user_id=user_id, on_chain_policy_id=on_chain
    )

    # First confirm
    try:
        async with AsyncSessionLocal() as db:
            detail = await confirm_policy_nft_mint(
                db, user_id=user_id, policy_id=policy_uuid,
                nft_token_id=token_id, mint_tx=mint_tx,
            )
            assert detail is not None
            assert detail.nft_token_id == token_id
            assert detail.nft_minted_at is not None
        record("首次 confirm 成功", True)
    except Exception as exc:
        record("首次 confirm 成功", False, str(exc))

    # Idempotent second confirm
    try:
        async with AsyncSessionLocal() as db:
            detail = await confirm_policy_nft_mint(
                db, user_id=user_id, policy_id=policy_uuid,
                nft_token_id=token_id, mint_tx=None,
            )
            assert detail is not None
            assert detail.nft_token_id == token_id
        record("幂等二次 confirm 成功", True)
    except Exception as exc:
        record("幂等二次 confirm 成功", False, str(exc))

    # --- 场景11: 公开 metadata 验证 ---
    print("\n=== 场景11: 公开 metadata 验证 ===")

    try:
        async with AsyncSessionLocal() as db:
            metadata = await get_public_metadata(db, token_id=token_id)
        if metadata is None:
            record("metadata 可获取", False, "returned None")
        else:
            body = metadata.model_dump(mode="json", exclude_none=True)
            record("metadata 可获取", True)

            try:
                assert body.get("name") and "Lemma Policy" in body["name"]
                record("metadata.name 包含 Lemma Policy", True, body["name"])
            except Exception as exc:
                record("metadata.name 包含 Lemma Policy", False, str(exc))

            try:
                assert body.get("description") and "privacy-safe" in body["description"].lower()
                record("metadata.description 包含 privacy-safe", True)
            except Exception as exc:
                record("metadata.description 包含 privacy-safe", False, str(exc))

            try:
                image = body.get("image", "")
                assert image.startswith("data:image/svg+xml;base64,")
                svg_bytes = base64.b64decode(image.split(",", 1)[1])
                svg = svg_bytes.decode("utf-8")
                assert len(svg_bytes) < 32_000
                assert "<svg" in svg
                record("metadata.image 是有效 SVG (base64)", True, f"size={len(svg_bytes)}")
            except Exception as exc:
                record("metadata.image 是有效 SVG (base64)", False, str(exc))

            try:
                attrs = body.get("attributes", [])
                trait_types = {a["trait_type"] for a in attrs}
                assert "Tier" in trait_types
                assert "Status" in trait_types
                assert "Positions" in trait_types
                record("metadata.attributes 含必要 traits", True, f"traits={sorted(trait_types)}")
            except Exception as exc:
                record("metadata.attributes 含必要 traits", False, str(exc))

            try:
                encoded = json.dumps(body)
                for secret in ("NFT E2E", "test policy", "private"):
                    assert secret.lower() not in encoded.lower(), f"leaked: {secret}"
                record("metadata 无用户隐私泄露", True)
            except Exception as exc:
                record("metadata 无用户隐私泄露", False, str(exc))

            try:
                ext_url = body.get("external_url", "")
                assert ext_url and token_id in ext_url
                record("metadata.external_url 含 tokenId", True, ext_url[:60])
            except Exception as exc:
                record("metadata.external_url 含 tokenId", False, str(exc))
    except Exception as exc:
        record("metadata 可获取", False, str(exc))

    # Dispose engine to cleanly release connections
    await engine.dispose()


async def _ensure_db_policy_async(
    *,
    policy_uuid: uuid.UUID,
    user_id: uuid.UUID,
    on_chain_policy_id: str,
    premium: float = 50.0,
) -> None:
    """Insert minimal active policy row (async, no separate event loop)."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from core.database import AsyncSessionLocal
    from models.policy import Policy

    async with AsyncSessionLocal() as db:
        existing = await db.execute(select(Policy).where(Policy.id == policy_uuid))
        if existing.scalar_one_or_none() is not None:
            print(f"    [db] policy {policy_uuid} already exists")
            return
        now = datetime.now(timezone.utc)
        policy = Policy(
            id=policy_uuid,
            user_id=user_id,
            status="active",
            search_status="searched",
            need_text="NFT E2E full test policy",
            title="NFT E2E full test policy",
            on_chain_policy_id=on_chain_policy_id,
            premium=premium,
            opened_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(policy)
        await db.commit()
        print(f"    [db] inserted active policy {policy_uuid}")


# ---------- Main ----------


def main() -> None:
    print("=" * 60)
    print("  差分机 PolicyNFT 全场景 E2E (Injective testnet 1439)")
    print("=" * 60)

    # Load env
    rpc = os.environ["INJECTIVE_EVM_RPC_URL"].strip()
    dep = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"].strip())
    vault_addr = Web3.to_checksum_address(os.environ["POLICY_VAULT_ADDRESS"].strip())
    usdc_addr = Web3.to_checksum_address(os.environ["USDC_ADDRESS"].strip())
    nft_addr = Web3.to_checksum_address(os.environ["POLICY_NFT_ADDRESS"].strip())
    user_id = uuid.UUID(os.environ.get("NFT_E2E_USER_ID", "292de9d7-de31-4dcc-b7c6-847aecce4604"))

    w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 45}))
    vault = w3.eth.contract(address=vault_addr, abi=load_abi("PolicyVault.sol", "PolicyVault"))
    usdc = w3.eth.contract(address=usdc_addr, abi=load_abi("MockUSDC.sol", "MockUSDC"))
    nft = w3.eth.contract(address=nft_addr, abi=load_abi("PolicyNFT.sol", "PolicyNFT"))

    print(f"\n  RPC: {rpc}")
    print(f"  deployer: {dep.address}")
    print(f"  PolicyVault: {vault_addr}")
    print(f"  PolicyNFT: {nft_addr}")
    print(f"  USDC: {usdc_addr}")
    print(f"  user_id: {user_id}")

    # Fetch markets
    print("\n  Fetching Polymarket open markets…")
    markets = pick_open_markets()
    for m in markets:
        print(f"    entry={m['entry']} {m['cond'][:12]}… {m['q']}")

    # === Run test scenarios ===
    test_1_deployment_verification(nft, vault, vault_addr, nft_addr)

    policy_uuid, on_chain, token_id, mint_tx = test_2_mint_and_ownership(
        w3, dep, vault, nft, usdc, vault_addr, markets
    )
    pid = bytes.fromhex(on_chain[2:])

    test_3_transfer(w3, dep, nft, token_id)
    test_4_approve_transfer(w3, dep, nft, token_id)
    test_5_operator_approval(w3, dep, nft, token_id)
    test_6_safe_transfer(w3, dep, nft, token_id)
    test_7_double_mint_revert(w3, dep, nft, pid)
    test_8_non_owner_mint_revert(w3, dep, vault, nft, usdc, vault_addr, markets)

    settled_uuid, settled_on_chain, settled_token_id, settled_mint_tx = test_9_settled_policy_mint(
        w3, dep, vault, nft, usdc, vault_addr, markets
    )

    # DB tests (场景 10 + 11) use the first minted policy — single event loop
    asyncio.run(_run_db_tests(policy_uuid, user_id, on_chain, token_id, mint_tx))

    # Summary
    print_summary()


if __name__ == "__main__":
    main()
