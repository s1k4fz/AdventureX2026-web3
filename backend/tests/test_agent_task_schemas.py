"""Unit tests for Agent Task schemas and pure helpers."""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from schemas.agent_task import (
    AgentApprovalSubmitIn,
    AgentCommandIn,
    AgentTaskCreateIn,
    AgentTaskDetailOut,
    AgentTaskListItemOut,
)
from services.agent_task_service import title_from_goal


def test_title_from_goal_trims_and_truncates() -> None:
    assert title_from_goal("  hello   world  ") == "hello world"
    long = "x" * 80
    assert len(title_from_goal(long)) == 50
    assert title_from_goal("   ") == "新保障任务"


def test_create_in_accepts_camel_case() -> None:
    payload = AgentTaskCreateIn.model_validate(
        {
            "kind": "policy_planning",
            "goalText": "担心降息",
            "clientRequestId": "req-1",
        }
    )
    assert payload.goal_text == "担心降息"
    assert payload.client_request_id == "req-1"


def test_create_in_rejects_empty_goal() -> None:
    with pytest.raises(ValidationError):
        AgentTaskCreateIn.model_validate({"goalText": ""})


def test_approval_submit_requires_version() -> None:
    payload = AgentApprovalSubmitIn.model_validate(
        {"version": 1, "response": {"answers": []}}
    )
    assert payload.version == 1
    with pytest.raises(ValidationError):
        AgentApprovalSubmitIn.model_validate(
            {"version": 0, "response": {"answers": []}}
        )


def test_command_in_types() -> None:
    cmd = AgentCommandIn.model_validate(
        {"type": "retry", "clientRequestId": "c1"}
    )
    assert cmd.type == "retry"
    with pytest.raises(ValidationError):
        AgentCommandIn.model_validate({"type": "explode"})


def test_list_item_wire_aliases() -> None:
    now = "2026-07-24T00:00:00Z"
    item = AgentTaskListItemOut.model_validate(
        {
            "id": uuid.uuid4(),
            "kind": "policy_planning",
            "status": "waiting_user",
            "title": "t",
            "goal_text": "g",
            "primary_ref_type": "policy",
            "primary_ref_id": uuid.uuid4(),
            "conversation_id": None,
            "archived_at": None,
            "updated_at": now,
            "created_at": now,
        }
    )
    dumped = item.model_dump(by_alias=True)
    assert dumped["goalText"] == "g"
    assert dumped["archivedAt"] is None
    assert "primaryRefId" in dumped


def test_update_in_requires_field() -> None:
    from schemas.agent_task import AgentTaskUpdateIn

    with pytest.raises(ValidationError):
        AgentTaskUpdateIn.model_validate({})

    payload = AgentTaskUpdateIn.model_validate({"title": "新标题"})
    assert payload.title == "新标题"
    assert not payload.sets_archived

    archived = AgentTaskUpdateIn.model_validate({"archived": True})
    assert archived.sets_archived
    assert archived.archived is True


def test_detail_out_includes_nested_collections() -> None:
    now = "2026-07-24T00:00:00Z"
    detail = AgentTaskDetailOut.model_validate(
        {
            "id": uuid.uuid4(),
            "kind": "policy_planning",
            "status": "running",
            "title": "t",
            "goal_text": "g",
            "updated_at": now,
            "created_at": now,
            "latest_sequence": 3,
            "runs": [],
            "artifacts": [],
            "approvals": [],
            "recent_events": [],
        }
    )
    assert detail.latest_sequence == 3
    wire = detail.model_dump(by_alias=True)
    assert wire["latestSequence"] == 3
    assert wire["recentEvents"] == []
