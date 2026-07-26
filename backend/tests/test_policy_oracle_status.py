"""Focused offline coverage for oracle-status service and API mapping."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from core.config import settings
from schemas.policy import PolicyOracleStatusOut
from services.policy_oracle_status_service import (
    OracleStatusError,
    get_oracle_status,
)


def _position(
    *,
    market_ref: str = "0xabc123",
    question: str = "Will it rain?",
    side: str = "YES",
):
    return SimpleNamespace(
        market_ref=market_ref,
        question=question,
        side=side,
    )


def _policy(
    *,
    status: str = "active",
    on_chain_policy_id: str | None = "0xpolicy1",
    user_id: uuid.UUID | None = None,
):
    policy_id = uuid.UUID("12345678-1234-5678-1234-567812345678")
    owner = user_id or uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    portfolio_id = uuid.uuid4()
    portfolio = SimpleNamespace(
        id=portfolio_id,
        positions=[
            _position(market_ref="0xleg1", question="Q1", side="YES"),
            _position(market_ref="0xleg2", question="Q2", side="NO"),
        ],
    )
    return SimpleNamespace(
        id=policy_id,
        user_id=owner,
        status=status,
        on_chain_policy_id=on_chain_policy_id,
        selected_portfolio_id=portfolio_id,
        portfolios=[portfolio],
    )


def _db_for(policy):
    result = SimpleNamespace(scalar_one_or_none=lambda: policy)
    db = AsyncMock()
    db.execute.return_value = result
    return db


@pytest.mark.asyncio
async def test_legacy_mode_when_oracle_address_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "outcome_oracle_address", "")
    monkeypatch.setattr(settings, "outcome_oracle_liveness_seconds", 300)
    monkeypatch.setattr(settings, "outcome_oracle_bond_base_units", 10_000_000)
    policy = _policy()
    payload = await get_oracle_status(
        _db_for(policy), user_id=policy.user_id, policy_id=policy.id
    )
    assert payload["mode"] == "legacy"
    assert payload["legs"] == []
    assert payload["all_resolved"] is True
    assert payload["progress_pct"] == 100
    assert payload["oracle_address"] == ""
    # Schema accepts legacy payload
    out = PolicyOracleStatusOut(**payload)
    assert out.mode == "legacy"


@pytest.mark.asyncio
async def test_live_status_progress_hit_and_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "outcome_oracle_address", "0xoracle")
    monkeypatch.setattr(settings, "outcome_oracle_liveness_seconds", 120)
    monkeypatch.setattr(settings, "outcome_oracle_bond_base_units", 10_000_000)
    policy = _policy()

    snapshot = {
        "positions": [
            {"marketRef": "0xleg1", "sideYes": True},
            {"marketRef": "0xleg2", "sideYes": False},
        ]
    }
    assertions = {
        "0xleg1": {
            "status": 1,  # asserted
            "proposer": "0xproposer",
            "assertedYes": True,
            "assertTime": 1_700_000_000,
            "liveness": 300,
            "disputer": "0x0000000000000000000000000000000000000000",
            "finalYes": False,
        },
        "0xleg2": {
            "status": 3,  # resolved
            "proposer": "0xproposer",
            "assertedYes": False,
            "assertTime": 1_700_000_000,
            "liveness": 300,
            "disputer": "0x0000000000000000000000000000000000000000",
            "finalYes": False,
        },
    }

    with (
        patch(
            "services.chain_service.read_policy_snapshot",
            return_value=snapshot,
        ),
        patch(
            "services.chain_service.read_assertion",
            side_effect=lambda ref: assertions[ref],
        ),
    ):
        payload = await get_oracle_status(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )

    assert payload["mode"] == "live"
    assert payload["progress_pct"] == 50
    assert payload["all_resolved"] is False
    assert len(payload["legs"]) == 2

    asserted = payload["legs"][0]
    assert asserted["status_label"] == "asserted"
    assert asserted["challenge_deadline"] == 1_700_000_000 + 300
    assert asserted["hit"] is None

    resolved = payload["legs"][1]
    assert resolved["status_label"] == "resolved"
    # side NO + finalYes False => hit
    assert resolved["hit"] is True


@pytest.mark.asyncio
async def test_chain_error_when_snapshot_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "outcome_oracle_address", "0xoracle")
    policy = _policy()

    with patch(
        "services.chain_service.read_policy_snapshot",
        side_effect=RuntimeError("rpc down"),
    ):
        with pytest.raises(OracleStatusError) as excinfo:
            await get_oracle_status(
                _db_for(policy), user_id=policy.user_id, policy_id=policy.id
            )
    assert excinfo.value.code == "chain_error"


@pytest.mark.asyncio
async def test_not_found_when_policy_missing() -> None:
    db = _db_for(None)
    with pytest.raises(OracleStatusError) as excinfo:
        await get_oracle_status(
            db, user_id=uuid.uuid4(), policy_id=uuid.uuid4()
        )
    assert excinfo.value.code == "not_found"


@pytest.mark.asyncio
async def test_not_eligible_wrong_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "outcome_oracle_address", "0xoracle")
    policy = _policy(status="proposed")
    with pytest.raises(OracleStatusError) as excinfo:
        await get_oracle_status(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )
    assert excinfo.value.code == "not_eligible"


@pytest.mark.asyncio
async def test_not_eligible_missing_on_chain_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "outcome_oracle_address", "0xoracle")
    policy = _policy(on_chain_policy_id=None)
    with pytest.raises(OracleStatusError) as excinfo:
        await get_oracle_status(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )
    assert excinfo.value.code == "not_eligible"


@pytest.mark.asyncio
async def test_assertion_read_failure_degrades_to_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "outcome_oracle_address", "0xoracle")
    policy = _policy()
    snapshot = {"positions": [{"marketRef": "0xleg1", "sideYes": True}]}

    with (
        patch(
            "services.chain_service.read_policy_snapshot",
            return_value=snapshot,
        ),
        patch(
            "services.chain_service.read_assertion",
            side_effect=RuntimeError("leg rpc"),
        ),
    ):
        payload = await get_oracle_status(
            _db_for(policy), user_id=policy.user_id, policy_id=policy.id
        )

    assert payload["mode"] == "live"
    assert payload["legs"][0]["status_label"] == "pending"
    assert payload["progress_pct"] == 0


@pytest.mark.asyncio
async def test_api_maps_oracle_errors_to_http_status() -> None:
    from api.v1 import policies as policies_api

    policy_id = uuid.uuid4()
    user = SimpleNamespace(id=uuid.uuid4())
    db = AsyncMock()

    with patch(
        "services.policy_oracle_status_service.get_oracle_status",
        new=AsyncMock(side_effect=OracleStatusError("not_found")),
    ):
        with pytest.raises(HTTPException) as excinfo:
            await policies_api.get_oracle_status(policy_id, user, db)
        assert excinfo.value.status_code == 404
        assert excinfo.value.detail == "policy_not_found"

    with patch(
        "services.policy_oracle_status_service.get_oracle_status",
        new=AsyncMock(side_effect=OracleStatusError("not_eligible")),
    ):
        with pytest.raises(HTTPException) as excinfo:
            await policies_api.get_oracle_status(policy_id, user, db)
        assert excinfo.value.status_code == 404
        assert excinfo.value.detail == "oracle_status_unavailable"

    with patch(
        "services.policy_oracle_status_service.get_oracle_status",
        new=AsyncMock(side_effect=OracleStatusError("chain_error")),
    ):
        with pytest.raises(HTTPException) as excinfo:
            await policies_api.get_oracle_status(policy_id, user, db)
        assert excinfo.value.status_code == 503
        assert excinfo.value.detail == "oracle_chain_unavailable"
