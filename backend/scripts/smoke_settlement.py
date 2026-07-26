"""Smoke test for M2/M3 settlement logic (offline + chain read).

Validates:
1. Payout pure function (hit/miss/partial)
2. outcomesYes ordering
3. settle legacy tx object (no type/maxFeePerGas, has gasPrice) — dry, no broadcast
4. on_chain_policy_id derivation
5. maxPayout computation mirrors contract math

Run from backend/:
  SUPABASE_URL=http://x DATABASE_URL=postgresql+asyncpg://u:p@localhost/x \
  DEEPSEEK_API_KEY=dummy \
  INJECTIVE_EVM_RPC_URL=https://k8s.testnet.json-rpc.injective.network/ \
  INJECTIVE_EVM_CHAIN_ID=1439 \
  DEPLOYER_PRIVATE_KEY=0xe925d93aa91fc0e422555bca960ff21e82d4feb46cab5a9f39f023ecd952e93a \
  RELAYER_PRIVATE_KEY=0xe925d93aa91fc0e422555bca960ff21e82d4feb46cab5a9f39f023ecd952e93a \
  POLICY_VAULT_ADDRESS=0xD917958F636bc311Bfe7Da7A2468BDc70D3fb5f1 \
  USDC_ADDRESS=0xf12e9f2376752520859b60fc37ddb5764212DE2D \
  uv run python scripts/smoke_settlement.py
"""

import sys
import uuid

# Ensure backend/ is on the path when run from scripts/
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))


def test_payout_pure_function():
    """Test _compute_payout for hit/miss/partial scenarios."""
    from tasks.policy_settle import _compute_payout

    # All hit: positions side matches outcomes
    positions = [
        {"sideYes": True, "shares": 1_000_000},
        {"sideYes": False, "shares": 500_000},
    ]
    outcomes = [True, False]  # YES won for leg0, NO won for leg1
    # leg0: sideYes==True, outcome==True → hit. leg1: sideYes==False, outcome==False → hit
    assert _compute_payout(positions, outcomes) == 1_500_000, "all hit failed"

    # All miss
    outcomes_miss = [False, True]
    # leg0: True!=False → miss. leg1: False!=True → miss
    assert _compute_payout(positions, outcomes_miss) == 0, "all miss failed"

    # Partial hit (only leg0)
    outcomes_partial = [True, True]
    # leg0: True==True → hit (1M). leg1: False!=True → miss
    assert _compute_payout(positions, outcomes_partial) == 1_000_000, "partial hit failed"

    print("✓ payout pure function: all hit / all miss / partial hit")


def test_outcomes_ordering():
    """Verify outcomes map by index, not by content."""
    from tasks.policy_settle import _compute_payout

    positions = [
        {"sideYes": True, "shares": 100},
        {"sideYes": True, "shares": 200},
        {"sideYes": False, "shares": 300},
    ]
    # Only leg2 hits (sideYes=False, outcome=False)
    outcomes = [False, False, False]
    # leg0: True!=False miss; leg1: True!=False miss; leg2: False==False hit
    assert _compute_payout(positions, outcomes) == 300
    print("✓ outcomes ordering respected")


def test_on_chain_policy_id_derivation():
    """Test deterministic derivation of onChainPolicyId from UUID."""
    from services.policy_chain_service import derive_on_chain_policy_id

    test_uuid = uuid.UUID("12345678-1234-1234-1234-123456789abc")
    result = derive_on_chain_policy_id(test_uuid)
    # Should be 0x + 32 zeros (16 bytes) + uuid hex (16 bytes)
    assert result.startswith("0x")
    assert len(result) == 66  # 0x + 64 hex
    # First 32 hex chars (16 bytes) should be zeros
    assert result[2:34] == "0" * 32
    # Last 32 hex chars should be the uuid bytes
    assert result[34:] == test_uuid.hex
    print(f"✓ derive_on_chain_policy_id: {result}")


def test_max_payout_computation():
    """Test maxPayout mirrors contract math.

    From testnet_e2e_web3.py:
    premium=1000 USDC (1000*1e6 base units), feeBps=100
    positions: [(mktA, True, 4000, 6000), (mktB, False, 6000, 4000)]
    net = 1000e6 * (10000-100)/10000 = 990_000_000
    leg0: allocated = 990e6 * 6000/10000 = 594_000_000; shares = 594e6 * 10000/4000 = 1_485_000_000
    leg1: allocated = 990e6 * 4000/10000 = 396_000_000; shares = 396e6 * 10000/6000 = 660_000_000
    maxPayout = 1_485_000_000 + 660_000_000 = 2_145_000_000
    """
    from services.policy_chain_service import compute_max_payout_base_units

    premium = 1_000_000_000  # 1000 USDC in base units
    fee_bps = 100
    positions = [
        {"entryPriceBps": 4000, "weightBps": 6000},
        {"entryPriceBps": 6000, "weightBps": 4000},
    ]
    result = compute_max_payout_base_units(premium, fee_bps, positions)
    assert result == 2_145_000_000, f"maxPayout mismatch: got {result}, expected 2_145_000_000"
    print(f"✓ maxPayout computation: {result} == 2_145_000_000")


def test_plan_oracle_actions():
    """Pure planner for the oracle-driven settlement state machine."""
    from tasks.policy_settle import _plan_oracle_actions

    # All legs Resolved => ready to settle; nothing to assert/finalize.
    r = _plan_oracle_actions([{"status": 3}, {"status": 3}])
    assert r["all_resolved"] is True and not r["to_assert"] and not r["to_finalize"]

    # None+resolved-on-Gamma => assert; Asserted+elapsed => finalize; Asserted+open => wait.
    r = _plan_oracle_actions(
        [
            {"status": 0, "has_resolution": True},
            {"status": 1, "liveness_elapsed": True},
            {"status": 1, "liveness_elapsed": False},
        ]
    )
    assert r["to_assert"] == [0], f"to_assert={r['to_assert']}"
    assert r["to_finalize"] == [1], f"to_finalize={r['to_finalize']}"
    assert r["all_resolved"] is False

    # None but Gamma not resolved => do not assert yet.
    r = _plan_oracle_actions([{"status": 0, "has_resolution": False}])
    assert not r["to_assert"] and r["all_resolved"] is False

    # A wrong 3rd-party assertion still in window => dispute it.
    r = _plan_oracle_actions(
        [{"status": 1, "liveness_elapsed": False, "is_own": False, "has_resolution": True, "gamma_agrees": False}]
    )
    assert r["to_dispute"] == [0] and not r["to_finalize"], r

    # Our own assertion, still in window => neither dispute nor finalize (wait).
    r = _plan_oracle_actions(
        [{"status": 1, "liveness_elapsed": False, "is_own": True, "has_resolution": True, "gamma_agrees": True}]
    )
    assert not r["to_dispute"] and not r["to_finalize"], r

    # Disputed + Gamma resolved => arbitrate (resolve to our truth).
    r = _plan_oracle_actions([{"status": 2, "has_resolution": True}])
    assert r["to_resolve"] == [0] and r["all_resolved"] is False, r

    # Wrong 3rd-party assertion whose window already closed => NOT finalized (stuck).
    r = _plan_oracle_actions(
        [{"status": 1, "liveness_elapsed": True, "is_own": False, "has_resolution": True, "gamma_agrees": False}]
    )
    assert not r["to_finalize"] and not r["to_dispute"], r

    # A Disputed leg blocks settlement.
    assert _plan_oracle_actions([{"status": 3}, {"status": 2}])["all_resolved"] is False

    # Empty => not resolved.
    assert _plan_oracle_actions([])["all_resolved"] is False
    print("✓ plan oracle actions: settle / assert / finalize / dispute / resolve / stuck / empty")


def test_liveness_elapsed():
    """Wall-clock gate for attempting a finalize tx."""
    import time as _t

    from tasks.policy_settle import _liveness_elapsed

    now = int(_t.time())
    assert _liveness_elapsed({"assertTime": now - 400, "liveness": 300}) is True
    assert _liveness_elapsed({"assertTime": now + 100, "liveness": 300}) is False
    assert _liveness_elapsed({"assertTime": 0, "liveness": 300}) is False
    print("✓ liveness elapsed: past / open / unset")


def test_settle_tx_object():
    """Verify the settle tx object has gasPrice, no type/maxFeePerGas/maxPriorityFeePerGas."""
    from services import chain_service

    # Use a dummy policy id (32 bytes of zeros + some data)
    dummy_pid = "0x" + "00" * 16 + "ab" * 16
    outcomes = [True, False]

    tx = chain_service.build_settle_tx_object(dummy_pid, outcomes)

    # Must have gasPrice
    assert "gasPrice" in tx, f"tx missing gasPrice: {list(tx.keys())}"
    assert tx["gasPrice"] == 160_000_000, f"gasPrice wrong: {tx['gasPrice']}"

    # Must NOT have EIP-1559 fields or type
    assert "type" not in tx, f"tx has 'type' field: {tx.get('type')}"
    assert "maxFeePerGas" not in tx, "tx has maxFeePerGas"
    assert "maxPriorityFeePerGas" not in tx, "tx has maxPriorityFeePerGas"

    # Must have chainId
    assert tx.get("chainId") == 1439, f"chainId wrong: {tx.get('chainId')}"

    print(f"✓ settle tx object: gasPrice={tx['gasPrice']}, no type/maxFee fields, chainId={tx['chainId']}")
    print(f"  tx keys: {sorted(tx.keys())}")


def test_settle_from_oracle_tx_object():
    """Verify the settlePolicyFromOracle tx object is legacy (gasPrice, no 1559/type)."""
    from services import chain_service

    dummy_pid = "0x" + "00" * 16 + "cd" * 16
    tx = chain_service.build_settle_from_oracle_tx_object(dummy_pid)

    assert "gasPrice" in tx, f"tx missing gasPrice: {list(tx.keys())}"
    assert tx["gasPrice"] == 160_000_000, f"gasPrice wrong: {tx['gasPrice']}"
    assert "type" not in tx, f"tx has 'type' field: {tx.get('type')}"
    assert "maxFeePerGas" not in tx, "tx has maxFeePerGas"
    assert "maxPriorityFeePerGas" not in tx, "tx has maxPriorityFeePerGas"
    assert tx.get("chainId") == 1439, f"chainId wrong: {tx.get('chainId')}"

    print(f"✓ settleFromOracle tx object: gasPrice={tx['gasPrice']}, legacy, chainId={tx['chainId']}")


def test_chain_read_pool():
    """Live chain read: pool snapshot from deployed PolicyVault."""
    from services import chain_service

    snapshot = chain_service.read_pool_snapshot()
    print(f"✓ read_pool_snapshot:")
    for k, v in snapshot.items():
        print(f"    {k}: {v}")
    assert "reserved" in snapshot
    assert "freeLiquidity" in snapshot
    assert "feeBps" in snapshot
    assert isinstance(snapshot["feeBps"], int)


def test_chain_read_nonexistent_policy():
    """Live chain read: nonexistent policy should return user=zero address."""
    from services import chain_service

    fake_pid = "0x" + "ff" * 32
    snapshot = chain_service.read_policy_snapshot(fake_pid)
    print(f"✓ read_policy_snapshot (nonexistent):")
    print(f"    user: {snapshot['user']}")
    print(f"    premium: {snapshot['premium']}")
    print(f"    maxPayout: {snapshot['maxPayout']}")
    # user should be zero address
    zero = "0x0000000000000000000000000000000000000000"
    assert snapshot["user"] == zero, f"Expected zero address, got {snapshot['user']}"
    assert snapshot["premium"] == 0
    assert snapshot["maxPayout"] == 0


if __name__ == "__main__":
    print("=" * 60)
    print("差分机 M2/M3 Settlement Smoke Tests")
    print("=" * 60)

    # Offline tests (no chain access needed)
    print("\n--- Offline Tests ---")
    test_payout_pure_function()
    test_outcomes_ordering()
    test_on_chain_policy_id_derivation()
    test_max_payout_computation()
    test_plan_oracle_actions()
    test_liveness_elapsed()

    # Chain tests (need real RPC + contract)
    print("\n--- Chain Read Tests (live testnet) ---")
    try:
        test_settle_tx_object()
        test_settle_from_oracle_tx_object()
        test_chain_read_pool()
        test_chain_read_nonexistent_policy()
    except Exception as exc:
        print(f"✗ Chain test failed: {exc}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("ALL SMOKE TESTS PASSED ✓")
    print("=" * 60)
