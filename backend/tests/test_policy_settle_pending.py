"""Settlement must retry when the oracle is not yet ready to pay out.

Regression: `_async_run_settle_oracle` / legacy used to `return` when legs were
unresolved. Celery treated that as success, so without beat re-enqueue the vault
never called settlePolicyFromOracle and no USDC left the pool.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

import tasks.policy_settle as ps


@pytest.mark.asyncio
async def test_oracle_settle_raises_when_legs_unresolved() -> None:
    pos = {"marketRef": "0x" + "11" * 32, "sideYes": True, "shares": 1_000_000}
    with (
        patch.object(
            ps,
            "_load_settle_context",
            AsyncMock(return_value=("0x" + "22" * 32, {})),
        ),
        patch("services.chain_service.read_policy_snapshot", return_value={"positions": [pos]}),
        patch("services.chain_service.relayer_address", return_value="0xRelayer"),
        patch.object(
            ps,
            "_build_leg",
            AsyncMock(
                return_value={
                    "market_ref": pos["marketRef"],
                    "pos": pos,
                    "status": 1,  # Asserted, not Resolved
                    "is_own": True,
                    "asserted_yes": True,
                    "liveness_elapsed": False,
                    "has_resolution": True,
                    "our_yes": True,
                    "gamma_agrees": True,
                }
            ),
        ),
        patch.object(ps, "_plan_oracle_actions", return_value={
            "to_assert": [],
            "to_finalize": [],
            "to_dispute": [],
            "to_resolve": [],
            "all_resolved": False,
        }),
        patch(
            "services.chain_service.read_assertion",
            return_value={"status": 1, "finalYes": False},
        ),
    ):
        with pytest.raises(ps.SettleNotReady):
            await ps._async_run_settle_oracle("11111111-1111-1111-1111-111111111111")


@pytest.mark.asyncio
async def test_legacy_settle_raises_when_markets_unresolved() -> None:
    pos = {"marketRef": "0x" + "33" * 32, "sideYes": True, "shares": 1_000_000}
    with (
        patch.object(
            ps,
            "_load_settle_context",
            AsyncMock(return_value=("0x" + "44" * 32, {})),
        ),
        patch("services.chain_service.read_policy_snapshot", return_value={"positions": [pos]}),
        patch.object(
            ps,
            "_resolve_via_gamma",
            AsyncMock(return_value={"resolved": False, "outcome_yes": None}),
        ),
    ):
        with pytest.raises(ps.SettleNotReady):
            await ps._async_run_settle_legacy("22222222-2222-2222-2222-222222222222")


def test_settle_task_retries_on_not_ready() -> None:
    with patch.object(ps, "run_settle", side_effect=ps.SettleNotReady("waiting")):
        with patch.object(
            ps.settle_policy_task,
            "retry",
            side_effect=RuntimeError("retry-scheduled"),
        ) as retry:
            with pytest.raises(RuntimeError, match="retry-scheduled"):
                ps.settle_policy_task.run("33333333-3333-3333-3333-333333333333")

    retry.assert_called_once()
    exc = retry.call_args.kwargs.get("exc")
    assert isinstance(exc, ps.SettleNotReady)
