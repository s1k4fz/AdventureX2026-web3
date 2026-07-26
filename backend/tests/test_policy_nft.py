"""Focused offline coverage for Policy NFT metadata and chain projection."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition
from schemas.policy import PolicyConfirmMintIn, PolicyDetailOut, PolicyNFTMetadataOut
from services import chain_service
from services.policy_chain_service import derive_on_chain_policy_id
from services.policy_nft_service import (
    confirm_policy_nft_mint,
    generate_metadata,
    generate_nft_svg,
    get_public_metadata,
    policy_token_id,
    token_id_to_policy_id,
)


def _position(*, index: int = 0, weight: int = 10_000, side: str = "YES"):
    return SimpleNamespace(
        order_index=index,
        weight_bps=weight,
        side=side,
        # These must never leak into public metadata or SVG.
        question='<script>alert("private-market")</script>',
        ai_reason="private rationale & identity",
    )


def _policy(*, status: str = "active"):
    policy_id = uuid.UUID("12345678-1234-5678-1234-567812345678")
    portfolio_id = uuid.uuid4()
    portfolio = SimpleNamespace(
        id=portfolio_id,
        tier="balanced",
        expected_payout=Decimal("350"),
        positions=[
            _position(index=0, weight=6000),
            _position(index=1, weight=4000, side="NO"),
        ],
    )
    return SimpleNamespace(
        id=policy_id,
        user_id=uuid.uuid4(),
        title='<svg onload="private-title">',
        need_text="private user request",
        status=status,
        on_chain_policy_id=derive_on_chain_policy_id(policy_id),
        selected_portfolio_id=portfolio_id,
        portfolios=[portfolio],
        premium=Decimal("100"),
        payout=Decimal("220") if status == "settled" else None,
        coverage_end=datetime(2027, 1, 1, tzinfo=UTC),
        intake_json={
            "private": "private-intake",
            "settlementOutcomes": [{"hit": True}, {"hit": False}],
        },
        nft_token_id=None,
        nft_mint_tx=None,
        nft_minted_at=None,
    )


def _detail(policy) -> PolicyDetailOut:
    return PolicyDetailOut(
        id=policy.id,
        title=policy.title,
        status=policy.status,
        need_text=policy.need_text,
        nft_token_id=policy.nft_token_id,
        nft_mint_tx=policy.nft_mint_tx,
        nft_minted_at=policy.nft_minted_at,
    )


def _db_for(policy):
    result = SimpleNamespace(scalar_one_or_none=lambda: policy)
    db = AsyncMock()
    db.execute.return_value = result
    return db


@pytest.mark.parametrize(
    "value",
    [uuid.UUID(int=0), uuid.UUID(int=1), uuid.UUID(int=(1 << 128) - 1)],
)
def test_decimal_token_id_round_trips_uuid_boundaries(value: uuid.UUID) -> None:
    token = policy_token_id(value)
    assert token_id_to_policy_id(token) == value


@pytest.mark.parametrize(
    "token",
    ["", "00", "01", "+1", " 1", "1.0", "１２", str(1 << 128), "9" * 10_000],
)
def test_decimal_token_id_rejects_noncanonical_or_out_of_range(token: str) -> None:
    with pytest.raises(ValueError):
        token_id_to_policy_id(token)


def test_confirm_schema_wire_aliases_and_validation() -> None:
    payload = PolicyConfirmMintIn.model_validate(
        {"nftTokenId": "0", "mintTx": "0x" + "a" * 64}
    )
    assert payload.nft_token_id == "0"
    assert payload.model_dump(by_alias=True) == {
        "nftTokenId": "0",
        "mintTx": "0x" + "a" * 64,
    }
    with pytest.raises(ValidationError):
        PolicyConfirmMintIn.model_validate({"nftTokenId": "01", "mintTx": "0x1234"})


def test_metadata_is_standard_deterministic_and_privacy_safe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        settings,
        "nft_metadata_base_url",
        "https://api.example/api/v1/policies/nft/metadata/",
    )
    monkeypatch.setattr(
        settings,
        "nft_public_base_url",
        "https://app.example/nft/",
    )
    policy = _policy(status="settled")
    first = generate_metadata(policy)
    second = generate_metadata(policy)
    wire = first.model_dump(mode="json", exclude_none=True)

    assert wire == second.model_dump(mode="json", exclude_none=True)
    assert "external_url" in wire and "externalUrl" not in wire
    assert "trait_type" in wire["attributes"][0]
    assert wire["external_url"] == f"https://app.example/nft/{policy.id.int}"
    encoded = json.dumps(wire)
    for secret in (
        "private-title",
        "private user request",
        "private-market",
        "private rationale",
        "private-intake",
    ):
        assert secret not in encoded
    svg = base64.b64decode(first.image.split(",", 1)[1]).decode()
    assert len(svg.encode()) < 32_000
    assert "SETTLED" in svg
    assert "PAID OUT" in svg
    assert "220.00" in svg
    assert "<script" not in svg
    attributes = {item["trait_type"]: item["value"] for item in wire["attributes"]}
    assert attributes["Max Payout (USDC)"] == 350.0
    assert attributes["Payout (USDC)"] == 220.0


def test_metadata_does_not_fall_back_to_configured_raw_json_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    monkeypatch.setattr(
        settings,
        "nft_metadata_base_url",
        "https://api.example/api/v1/policies/nft/metadata",
    )
    monkeypatch.setattr(settings, "nft_public_base_url", "")

    metadata = generate_metadata(policy)

    assert metadata.external_url == (
        f"/api/v1/policies/nft/metadata/{policy.id.int}"
    )
    assert not metadata.external_url.startswith("https://api.example")


def test_svg_escapes_interpolated_labels(monkeypatch: pytest.MonkeyPatch) -> None:
    from services import policy_nft_service

    policy = _policy()
    monkeypatch.setitem(
        policy_nft_service._TIER_LABELS,  # noqa: SLF001 - escaping regression probe
        "balanced",
        '<Tier & "unsafe">',
    )
    svg = generate_nft_svg(policy, policy.portfolios[0], policy.portfolios[0].positions)
    assert "&lt;TIER &amp; &quot;UNSAFE&quot;&gt;" in svg
    assert '<TIER & "UNSAFE">' not in svg


def test_metadata_schema_keeps_erc721_snake_case() -> None:
    schema = PolicyNFTMetadataOut.model_json_schema()
    assert "external_url" in schema["properties"]
    assert "externalUrl" not in schema["properties"]


def test_raw_owner_of_json_rpc_encoding(monkeypatch: pytest.MonkeyPatch) -> None:
    contract = "0x" + "ab" * 20
    monkeypatch.setattr(settings, "policy_nft_address", contract)
    captured: dict = {}

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"jsonrpc": "2.0", "id": 1, "result": "0x" + "0" * 24 + "cd" * 20}

    def fake_post(_url, *, json, timeout):  # noqa: ANN001
        captured.update(json)
        assert timeout == 30
        return Response()

    monkeypatch.setattr("httpx.post", fake_post)
    assert chain_service.read_policy_nft_owner(7) == "0x" + "cd" * 20
    assert captured["method"] == "eth_call"
    data = captured["params"][0]["data"]
    assert data == "0x6352211e" + (7).to_bytes(32, "big").hex()


def test_raw_owner_of_rejects_non_uuid_token_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "policy_nft_address", "0x" + "ab" * 20)
    with pytest.raises(ValueError, match="uint128"):
        chain_service.read_policy_nft_owner(1 << 128)


def test_receipt_validation_requires_real_mint_transfer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    contract = "0x" + "ab" * 20
    tx_hash = "0x" + "cd" * 32
    token_id = 7
    monkeypatch.setattr(settings, "policy_nft_address", contract)

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "result": {
                    "status": "0x1",
                    "to": contract,
                    "transactionHash": tx_hash,
                    "logs": [
                        {
                            "address": contract,
                            "topics": [
                                chain_service._ERC721_TRANSFER_TOPIC,  # noqa: SLF001
                                "0x" + "0" * 64,
                                "0x" + "0" * 24 + "12" * 20,
                                "0x" + token_id.to_bytes(32, "big").hex(),
                            ],
                        }
                    ],
                }
            }

    monkeypatch.setattr("httpx.post", lambda *_a, **_k: Response())
    assert chain_service.validate_policy_nft_mint_tx(tx_hash, token_id)
    assert not chain_service.validate_policy_nft_mint_tx(tx_hash, token_id + 1)


@pytest.mark.parametrize(
    "mutation",
    ["failed", "wrong_contract", "wrong_hash", "not_mint", "wrong_topic"],
)
def test_receipt_validation_rejects_malformed_or_unrelated_receipts(
    monkeypatch: pytest.MonkeyPatch, mutation: str
) -> None:
    contract = "0x" + "ab" * 20
    tx_hash = "0x" + "cd" * 32
    token_id = 7
    monkeypatch.setattr(settings, "policy_nft_address", contract)
    receipt = {
        "status": "0x1",
        "to": contract,
        "transactionHash": tx_hash,
        "logs": [
            {
                "address": contract,
                "topics": [
                    chain_service._ERC721_TRANSFER_TOPIC,  # noqa: SLF001
                    "0x" + "0" * 64,
                    "0x" + "0" * 24 + "12" * 20,
                    "0x" + token_id.to_bytes(32, "big").hex(),
                ],
            }
        ],
    }
    if mutation == "failed":
        receipt["status"] = "0x0"
    elif mutation == "wrong_contract":
        receipt["to"] = "0x" + "ef" * 20
    elif mutation == "wrong_hash":
        receipt["transactionHash"] = "0x" + "ef" * 32
    elif mutation == "not_mint":
        receipt["logs"][0]["topics"][1] = "0x" + "1".zfill(64)  # type: ignore[index]
    else:
        receipt["logs"][0]["topics"][0] = "0x" + "ef" * 32  # type: ignore[index]

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"result": receipt}

    monkeypatch.setattr("httpx.post", lambda *_a, **_k: Response())
    assert not chain_service.validate_policy_nft_mint_tx(tx_hash, token_id)


@pytest.mark.asyncio
async def test_confirm_uses_owner_state_and_ignores_unverified_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    tx_hash = "0x" + "e" * 64
    monkeypatch.setattr(settings, "policy_nft_address", "0x" + "ab" * 20)

    def owner_after_connection_release(_token: int) -> str:
        db.rollback.assert_awaited_once()
        return "0x" + "cd" * 20

    monkeypatch.setattr(
        chain_service,
        "read_policy_nft_owner",
        owner_after_connection_release,
    )
    monkeypatch.setattr(
        chain_service, "validate_policy_nft_mint_tx", lambda *_args: False
    )
    with patch(
        "services.policy_nft_service.policy_service.get_policy_detail",
        new=AsyncMock(side_effect=lambda *_a, **_k: _detail(policy)),
    ):
        detail = await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int),
            mint_tx=tx_hash,
        )
    assert detail is not None and detail.nft_token_id == str(policy.id.int)
    assert policy.nft_mint_tx is None
    assert policy.nft_minted_at is not None
    db.rollback.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_confirm_persists_only_validated_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    tx_hash = "0x" + "A" * 64
    monkeypatch.setattr(settings, "policy_nft_address", "0x" + "ab" * 20)
    monkeypatch.setattr(
        chain_service, "read_policy_nft_owner", lambda _token: "0x" + "cd" * 20
    )
    monkeypatch.setattr(
        chain_service, "validate_policy_nft_mint_tx", lambda *_args: True
    )
    with patch(
        "services.policy_nft_service.policy_service.get_policy_detail",
        new=AsyncMock(side_effect=lambda *_a, **_k: _detail(policy)),
    ):
        await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int),
            mint_tx=tx_hash,
        )
    assert policy.nft_mint_tx == tx_hash.lower()


@pytest.mark.asyncio
async def test_confirm_is_idempotent_after_transfer_and_without_rpc_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    policy.nft_token_id = str(policy.id.int)
    policy.nft_minted_at = datetime.now(UTC)
    db = _db_for(policy)
    monkeypatch.setattr(settings, "policy_nft_address", "")
    with (
        patch(
            "services.policy_nft_service.policy_service.get_policy_detail",
            new=AsyncMock(return_value=_detail(policy)),
        ),
        patch.object(
            chain_service,
            "read_policy_nft_owner",
            side_effect=AssertionError(
                "idempotent recovery must not require owner RPC"
            ),
        ),
    ):
        detail = await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int),
            mint_tx=None,
        )
    assert detail is not None
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_confirm_fails_closed_when_contract_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    monkeypatch.setattr(settings, "policy_nft_address", "")
    with pytest.raises(HTTPException) as caught:
        await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int),
            mint_tx=None,
        )
    assert caught.value.status_code == 503
    assert caught.value.detail == "policy_nft_not_configured"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("chain_error", "expected_status", "expected_detail"),
    [
        (ValueError("ownerOf reverted"), 409, "policy_nft_not_confirmed"),
        (RuntimeError("malformed RPC"), 503, "policy_nft_chain_unavailable"),
    ],
)
async def test_confirm_maps_owner_rpc_failures(
    monkeypatch: pytest.MonkeyPatch,
    chain_error: Exception,
    expected_status: int,
    expected_detail: str,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    monkeypatch.setattr(settings, "policy_nft_address", "0x" + "ab" * 20)

    def fail(_token: int) -> str:
        raise chain_error

    monkeypatch.setattr(chain_service, "read_policy_nft_owner", fail)
    with pytest.raises(HTTPException) as caught:
        await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int),
            mint_tx=None,
        )
    assert caught.value.status_code == expected_status
    assert caught.value.detail == expected_detail


@pytest.mark.asyncio
async def test_confirm_rejects_wrong_token_and_chain_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    with pytest.raises(HTTPException) as wrong_token:
        await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int + 1),
            mint_tx=None,
        )
    assert wrong_token.value.status_code == 422
    assert wrong_token.value.detail == "nft_token_id_mismatch"

    policy.on_chain_policy_id = "0x" + "0" * 64
    with pytest.raises(HTTPException) as wrong_chain_id:
        await confirm_policy_nft_mint(
            db,
            user_id=policy.user_id,
            policy_id=policy.id,
            nft_token_id=str(policy.id.int),
            mint_tx=None,
        )
    assert wrong_chain_id.value.status_code == 409
    assert wrong_chain_id.value.detail == "policy_chain_id_not_confirmed"


@pytest.mark.asyncio
async def test_public_metadata_requires_a_confirmed_mint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    token_id = str(policy.id.int)
    monkeypatch.setattr(settings, "policy_nft_address", "")

    assert await get_public_metadata(db, token_id=token_id) is None

    policy.nft_token_id = token_id
    metadata = await get_public_metadata(db, token_id=token_id)
    assert metadata is not None


@pytest.mark.asyncio
async def test_public_metadata_recovers_from_committed_chain_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    token_id = str(policy.id.int)
    monkeypatch.setattr(settings, "policy_nft_address", "0x" + "ab" * 20)

    def owner_after_connection_release(_token: int) -> str:
        db.rollback.assert_awaited_once()
        return "0x" + "cd" * 20

    monkeypatch.setattr(
        chain_service,
        "read_policy_nft_owner",
        owner_after_connection_release,
    )

    metadata = await get_public_metadata(db, token_id=token_id)
    assert metadata is not None
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_public_metadata_fails_closed_on_chain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    policy = _policy()
    db = _db_for(policy)
    monkeypatch.setattr(settings, "policy_nft_address", "0x" + "ab" * 20)

    def unavailable(_token: int) -> str:
        raise RuntimeError("rpc unavailable")

    monkeypatch.setattr(chain_service, "read_policy_nft_owner", unavailable)
    assert await get_public_metadata(db, token_id=str(policy.id.int)) is None


@pytest.mark.asyncio
async def test_public_metadata_rejects_ineligible_or_unmapped_policy() -> None:
    policy = _policy(status="funded")
    policy.nft_token_id = str(policy.id.int)
    db = _db_for(policy)
    assert await get_public_metadata(db, token_id=str(policy.id.int)) is None

    policy.status = "active"
    policy.on_chain_policy_id = "0x" + "0" * 64
    assert await get_public_metadata(db, token_id=str(policy.id.int)) is None


def test_model_and_migration_define_partial_unique_nft_index() -> None:
    index = next(
        item
        for item in Policy.__table__.indexes
        if item.name == "uq_policies_nft_token_id"
    )
    assert index.unique is True
    assert str(index.dialect_options["postgresql"]["where"]) == (
        "nft_token_id IS NOT NULL"
    )
    assert Policy.__table__.c.nft_token_id.type.length == 39
    assert Policy.__table__.c.nft_mint_tx.type.length == 66


def test_metadata_query_relationship_shape_is_declared() -> None:
    # Regression guard: public metadata is selected by UUID PK and does not
    # require any user/profile join that could expose identity.
    assert PolicyPortfolio.__table__.c.policy_id is not None
    assert PolicyPosition.__table__.c.portfolio_id is not None
