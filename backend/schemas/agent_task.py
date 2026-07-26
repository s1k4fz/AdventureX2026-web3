"""API contracts for the generic Agent Task runtime. Wire format is camelCase."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

AgentTaskKind = Literal["policy_planning"]
AgentTaskStatus = Literal[
    "draft",
    "running",
    "waiting_user",
    "succeeded",
    "failed",
    "cancelled",
    "monitoring",
]
AgentRunStatus = Literal[
    "pending",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "cancelled",
]
AgentStepStatus = Literal["pending", "running", "succeeded", "failed", "skipped"]
AgentApprovalKind = Literal[
    "intake_answers", "select_portfolio", "confirm_funding"
]
AgentApprovalStatus = Literal["pending", "submitted", "expired", "cancelled"]
AgentCommandType = Literal[
    "free_text",
    "revise_goal",
    "retry",
    "cancel",
]
AgentTaskInputStatus = Literal["queued", "applying", "applied", "superseded"]
AgentSubagentKind = Literal[
    "polymarket",
    "world_monitor",
    "pandaai",
    "news",
    "web",
    "synthesizer",
]
AgentSubagentStatus = Literal[
    "pending", "running", "succeeded", "failed", "skipped"
]


class AgentTaskCreateIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    kind: AgentTaskKind = "policy_planning"
    goal_text: str = Field(min_length=1, max_length=32_000)
    title: str | None = Field(default=None, max_length=200)
    client_request_id: str | None = Field(default=None, max_length=128)
    conversation_id: uuid.UUID | None = None


class AgentTaskUpdateIn(BaseModel):
    """PATCH payload: rename and/or archive / unarchive.

    archived has explicit null semantics — absent vs false vs true:
    - field absent → leave archived_at alone
    - archived: true → set archived_at = now (if not already)
    - archived: false → clear archived_at
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None

    @property
    def sets_archived(self) -> bool:
        return "archived" in self.model_fields_set

    @model_validator(mode="after")
    def at_least_one_field(self) -> "AgentTaskUpdateIn":
        if self.title is None and not self.sets_archived:
            raise ValueError("provide title and/or archived")
        return self


class AgentCommandIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    type: AgentCommandType = "free_text"
    text: str | None = Field(default=None, max_length=32_000)
    client_request_id: str | None = Field(default=None, max_length=128)
    payload: dict[str, Any] | None = None


class AgentApprovalSubmitIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    version: int = Field(ge=1)
    response: dict[str, Any]
    client_request_id: str | None = Field(default=None, max_length=128)


class AgentStepOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    name: str
    seq: int
    status: AgentStepStatus
    progress: dict[str, Any] | None = Field(
        default=None, validation_alias="progress_json"
    )
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class AgentRunOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    status: AgentRunStatus
    trigger: str
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    steps: list[AgentStepOut] = Field(default_factory=list)


class AgentArtifactOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    ref_type: str
    ref_id: uuid.UUID
    role: str
    label: str | None = None
    meta: dict[str, Any] | None = Field(default=None, validation_alias="meta_json")
    created_at: datetime


class AgentApprovalOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    kind: AgentApprovalKind
    status: AgentApprovalStatus
    version: int
    payload: dict[str, Any] | None = Field(
        default=None, validation_alias="payload_json"
    )
    response: dict[str, Any] | None = Field(
        default=None, validation_alias="response_json"
    )
    submitted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AgentTaskInputOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    type: Literal["free_text", "revise_goal"]
    text: str
    revision: int
    status: AgentTaskInputStatus
    created_at: datetime
    applied_at: datetime | None = None


class AgentEventOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    sequence: int
    event_type: str
    data: dict[str, Any] = Field(validation_alias="data_json")
    run_id: uuid.UUID | None = None
    created_at: datetime


class AgentSubagentOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    kind: AgentSubagentKind
    status: AgentSubagentStatus
    parent_step: str = "market_search"
    query_text: str | None = None
    progress: dict[str, Any] | None = Field(
        default=None, validation_alias="progress_json"
    )
    brief: dict[str, Any] | None = Field(
        default=None, validation_alias="brief_json"
    )
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    run_id: uuid.UUID | None = None


class AgentTaskListItemOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    kind: AgentTaskKind
    status: AgentTaskStatus
    title: str
    description: str | None = None
    goal_text: str
    primary_ref_type: str | None = None
    primary_ref_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None
    archived_at: datetime | None = None
    input_revision: int = 0
    updated_at: datetime
    created_at: datetime


class AgentTaskDetailOut(AgentTaskListItemOut):
    error_code: str | None = None
    error_message: str | None = None
    latest_sequence: int = 0
    runs: list[AgentRunOut] = Field(default_factory=list)
    artifacts: list[AgentArtifactOut] = Field(default_factory=list)
    approvals: list[AgentApprovalOut] = Field(default_factory=list)
    inputs: list[AgentTaskInputOut] = Field(default_factory=list)
    subagents: list[AgentSubagentOut] = Field(default_factory=list)
    recent_events: list[AgentEventOut] = Field(default_factory=list)
