"""Generic Agent Task runtime tables (Task / Run / Step / Artifact / Approval / Event).

Domain entities (policies, courses, …) remain authoritative for product state.
These tables project observability, HITL approvals, and recoverable runs so the
UI can treat "task" as the top-level object instead of a chat transcript.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class AgentTask(Base):
    """A user-facing goal that may span multiple runs and domain artifacts."""

    __tablename__ = "agent_tasks"
    __table_args__ = (
        CheckConstraint(
            "kind in ('policy_planning')",
            name="ck_agent_tasks_kind",
        ),
        CheckConstraint(
            "status in ("
            "'draft', 'running', 'waiting_user', 'succeeded', "
            "'failed', 'cancelled', 'monitoring'"
            ")",
            name="ck_agent_tasks_status",
        ),
        Index("ix_agent_tasks_user_id_updated_at", "user_id", "updated_at"),
        Index("ix_agent_tasks_user_id_status", "user_id", "status"),
        UniqueConstraint(
            "user_id",
            "client_request_id",
            name="uq_agent_tasks_user_client_request_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="draft")
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional link back to the chat shell that spawned the task. SET NULL so
    # deleting a conversation never deletes the recoverable task.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_conversations.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Primary domain artifact pointer (policy_id for policy_planning). Not an FK
    # on purpose: domain tables already cascade from user; reverse FKs cycle.
    primary_ref_type: Mapped[str | None] = mapped_column(String, nullable=True)
    primary_ref_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    client_request_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Monotonic cancellation token for user interventions. Workers capture the
    # value at a safe checkpoint and restart if a newer input arrives.
    input_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    # Soft-hide from the default sidebar list; domain artifacts stay intact.
    archived_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    runs: Mapped[list["AgentRun"]] = relationship(
        order_by="AgentRun.created_at",
        passive_deletes=True,
    )
    artifacts: Mapped[list["AgentArtifact"]] = relationship(
        order_by="AgentArtifact.created_at",
        passive_deletes=True,
    )
    approvals: Mapped[list["AgentApproval"]] = relationship(
        order_by="AgentApproval.created_at",
        passive_deletes=True,
    )
    inputs: Mapped[list["AgentTaskInput"]] = relationship(
        order_by="AgentTaskInput.revision",
        passive_deletes=True,
    )
    events: Mapped[list["AgentEvent"]] = relationship(
        order_by="AgentEvent.sequence",
        passive_deletes=True,
    )
    subagents: Mapped[list["AgentSubagent"]] = relationship(
        order_by="AgentSubagent.created_at",
        passive_deletes=True,
    )


class AgentRun(Base):
    """One execution attempt of a task (initial, revise, retry)."""

    __tablename__ = "agent_runs"
    __table_args__ = (
        CheckConstraint(
            "status in ("
            "'pending', 'running', 'waiting_approval', 'succeeded', "
            "'failed', 'cancelled'"
            ")",
            name="ck_agent_runs_status",
        ),
        CheckConstraint(
            "trigger in ('create', 'command', 'approval', 'retry', 'system')",
            name="ck_agent_runs_trigger",
        ),
        Index("ix_agent_runs_task_id_created_at", "task_id", "created_at"),
        UniqueConstraint(
            "task_id",
            "client_request_id",
            name="uq_agent_runs_task_client_request_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="pending"
    )
    trigger: Mapped[str] = mapped_column(String, nullable=False, server_default="create")
    client_request_id: Mapped[str | None] = mapped_column(String, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    steps: Mapped[list["AgentStep"]] = relationship(
        order_by="AgentStep.seq",
        passive_deletes=True,
    )


class AgentStep(Base):
    """Recoverable stage inside a run (questionnaire, search, compose, …)."""

    __tablename__ = "agent_steps"
    __table_args__ = (
        CheckConstraint(
            "status in ('pending', 'running', 'succeeded', 'failed', 'skipped')",
            name="ck_agent_steps_status",
        ),
        UniqueConstraint("run_id", "name", name="uq_agent_steps_run_name"),
        Index("ix_agent_steps_run_id_seq", "run_id", "seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="pending"
    )
    # Compact progress snapshot for reconnect (search hits, activity summary).
    progress_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


class AgentArtifact(Base):
    """Thin pointer to a domain resource rendered in the canvas."""

    __tablename__ = "agent_artifacts"
    __table_args__ = (
        CheckConstraint(
            "role in ('primary', 'side', 'version')",
            name="ck_agent_artifacts_role",
        ),
        Index("ix_agent_artifacts_task_id_created_at", "task_id", "created_at"),
        UniqueConstraint(
            "task_id",
            "ref_type",
            "ref_id",
            name="uq_agent_artifacts_task_ref",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    ref_type: Mapped[str] = mapped_column(String, nullable=False)
    ref_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False, server_default="primary")
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    meta_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


class AgentApproval(Base):
    """Human-in-the-loop decision node (questionnaire, select portfolio, …)."""

    __tablename__ = "agent_approvals"
    __table_args__ = (
        CheckConstraint(
            "kind in ('intake_answers', 'select_portfolio', 'confirm_funding')",
            name="ck_agent_approvals_kind",
        ),
        CheckConstraint(
            "status in ('pending', 'submitted', 'expired', 'cancelled')",
            name="ck_agent_approvals_status",
        ),
        Index("ix_agent_approvals_task_id_status", "task_id", "status"),
        UniqueConstraint(
            "task_id",
            "kind",
            "version",
            name="uq_agent_approvals_task_kind_version",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="pending"
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # Schema hint / draft answers for the UI.
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    response_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    client_request_id: Mapped[str | None] = mapped_column(String, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class AgentTaskInput(Base):
    """Durable user intervention queue for a task.

    Events make interventions visible to reconnecting clients; this table is
    the worker-facing source of truth that gives each input an idempotency key,
    a revision, and an application lifecycle.
    """

    __tablename__ = "agent_task_inputs"
    __table_args__ = (
        CheckConstraint(
            "type in ('free_text', 'revise_goal')",
            name="ck_agent_task_inputs_type",
        ),
        CheckConstraint(
            "status in ('queued', 'applying', 'applied', 'superseded')",
            name="ck_agent_task_inputs_status",
        ),
        Index("ix_agent_task_inputs_task_id_revision", "task_id", "revision"),
        Index("ix_agent_task_inputs_task_id_status", "task_id", "status"),
        UniqueConstraint(
            "task_id",
            "client_request_id",
            name="uq_agent_task_inputs_task_client_request_id",
        ),
        UniqueConstraint(
            "task_id",
            "revision",
            name="uq_agent_task_inputs_task_revision",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="queued"
    )
    client_request_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    applied_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )


class AgentSubagent(Base):
    """Fan-out source collector under a parent run step (e.g. market_search)."""

    __tablename__ = "agent_subagents"
    __table_args__ = (
        CheckConstraint(
            "kind in ("
            "'polymarket', 'world_monitor', 'pandaai', 'news', "
            "'web', 'synthesizer'"
            ")",
            name="ck_agent_subagents_kind",
        ),
        CheckConstraint(
            "status in ("
            "'pending', 'running', 'succeeded', 'failed', 'skipped'"
            ")",
            name="ck_agent_subagents_status",
        ),
        UniqueConstraint("run_id", "kind", name="uq_agent_subagents_run_kind"),
        Index("ix_agent_subagents_task_id_created_at", "task_id", "created_at"),
        Index("ix_agent_subagents_run_id", "run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_step: Mapped[str] = mapped_column(
        String, nullable=False, server_default="market_search"
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="pending"
    )
    query_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    brief_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


class AgentEvent(Base):
    """Durable semantic event log for reconnectable SSE."""

    __tablename__ = "agent_events"
    __table_args__ = (
        UniqueConstraint("task_id", "sequence", name="uq_agent_events_task_sequence"),
        Index("ix_agent_events_task_id_sequence", "task_id", "sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_runs.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Monotonic per-task sequence used as Last-Event-ID.
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    data_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
