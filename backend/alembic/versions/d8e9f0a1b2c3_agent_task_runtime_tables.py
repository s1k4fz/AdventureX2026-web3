"""agent task runtime tables

Revision ID: d8e9f0a1b2c3
Revises: c3d4e5f6a7b8
Create Date: 2026-07-24 21:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "d8e9f0a1b2c3"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_tasks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="draft", nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("goal_text", sa.Text(), nullable=False),
        sa.Column("conversation_id", sa.UUID(), nullable=True),
        sa.Column("primary_ref_type", sa.String(), nullable=True),
        sa.Column("primary_ref_id", sa.UUID(), nullable=True),
        sa.Column("client_request_id", sa.String(), nullable=True),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind in ('policy_planning')",
            name="ck_agent_tasks_kind",
        ),
        sa.CheckConstraint(
            "status in ("
            "'draft', 'running', 'waiting_user', 'succeeded', "
            "'failed', 'cancelled', 'monitoring'"
            ")",
            name="ck_agent_tasks_status",
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["ai_conversations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "client_request_id",
            name="uq_agent_tasks_user_client_request_id",
        ),
    )
    op.create_index(
        "ix_agent_tasks_user_id_updated_at",
        "agent_tasks",
        ["user_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_agent_tasks_user_id_status",
        "agent_tasks",
        ["user_id", "status"],
        unique=False,
    )

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("trigger", sa.String(), server_default="create", nullable=False),
        sa.Column("client_request_id", sa.String(), nullable=True),
        sa.Column("celery_task_id", sa.String(), nullable=True),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status in ("
            "'pending', 'running', 'waiting_approval', 'succeeded', "
            "'failed', 'cancelled'"
            ")",
            name="ck_agent_runs_status",
        ),
        sa.CheckConstraint(
            "trigger in ('create', 'command', 'approval', 'retry', 'system')",
            name="ck_agent_runs_trigger",
        ),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "client_request_id",
            name="uq_agent_runs_task_client_request_id",
        ),
    )
    op.create_index(
        "ix_agent_runs_task_id_created_at",
        "agent_runs",
        ["task_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "agent_steps",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column(
            "progress_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("finished_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status in ('pending', 'running', 'succeeded', 'failed', 'skipped')",
            name="ck_agent_steps_status",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "name", name="uq_agent_steps_run_name"),
    )
    op.create_index(
        "ix_agent_steps_run_id_seq",
        "agent_steps",
        ["run_id", "seq"],
        unique=False,
    )

    op.create_table(
        "agent_artifacts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=True),
        sa.Column("ref_type", sa.String(), nullable=False),
        sa.Column("ref_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(), server_default="primary", nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column(
            "meta_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role in ('primary', 'side', 'version')",
            name="ck_agent_artifacts_role",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "ref_type",
            "ref_id",
            name="uq_agent_artifacts_task_ref",
        ),
    )
    op.create_index(
        "ix_agent_artifacts_task_id_created_at",
        "agent_artifacts",
        ["task_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "agent_approvals",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "payload_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "response_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("client_request_id", sa.String(), nullable=True),
        sa.Column("submitted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind in ('intake_answers', 'select_portfolio', 'confirm_funding')",
            name="ck_agent_approvals_kind",
        ),
        sa.CheckConstraint(
            "status in ('pending', 'submitted', 'expired', 'cancelled')",
            name="ck_agent_approvals_status",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "kind",
            "version",
            name="uq_agent_approvals_task_kind_version",
        ),
    )
    op.create_index(
        "ix_agent_approvals_task_id_status",
        "agent_approvals",
        ["task_id", "status"],
        unique=False,
    )

    op.create_table(
        "agent_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=True),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column(
            "data_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id", "sequence", name="uq_agent_events_task_sequence"
        ),
    )
    op.create_index(
        "ix_agent_events_task_id_sequence",
        "agent_events",
        ["task_id", "sequence"],
        unique=False,
    )

    # Security: enable RLS + revoke Data API exposure for anon/authenticated.
    # Business access goes through FastAPI with service credentials.
    for table in (
        "agent_tasks",
        "agent_runs",
        "agent_steps",
        "agent_artifacts",
        "agent_approvals",
        "agent_events",
    ):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON TABLE {table} FROM anon, authenticated")

    # Idempotent backfill: map existing policies to agent tasks.
    op.execute(
        """
        INSERT INTO agent_tasks (
            id, user_id, kind, status, title, goal_text,
            conversation_id, primary_ref_type, primary_ref_id,
            created_at, updated_at
        )
        SELECT
            gen_random_uuid(),
            p.user_id,
            'policy_planning',
            CASE
                WHEN p.status IN ('intake', 'composing') THEN 'running'
                WHEN p.status = 'proposed' THEN 'waiting_user'
                WHEN p.status IN ('funded', 'active') THEN 'monitoring'
                WHEN p.status = 'settled' THEN 'succeeded'
                WHEN p.status = 'failed' THEN 'failed'
                ELSE 'draft'
            END,
            p.title,
            p.need_text,
            p.conversation_id,
            'policy',
            p.id,
            p.created_at,
            p.updated_at
        FROM policies p
        WHERE NOT EXISTS (
            SELECT 1 FROM agent_tasks t
            WHERE t.primary_ref_type = 'policy' AND t.primary_ref_id = p.id
        )
        """
    )
    op.execute(
        """
        INSERT INTO agent_artifacts (
            id, task_id, ref_type, ref_id, role, label, created_at
        )
        SELECT
            gen_random_uuid(),
            t.id,
            'policy',
            t.primary_ref_id,
            'primary',
            t.title,
            t.created_at
        FROM agent_tasks t
        WHERE t.primary_ref_type = 'policy'
          AND t.primary_ref_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM agent_artifacts a
            WHERE a.task_id = t.id
              AND a.ref_type = 'policy'
              AND a.ref_id = t.primary_ref_id
          )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_agent_events_task_id_sequence", table_name="agent_events")
    op.drop_table("agent_events")
    op.drop_index("ix_agent_approvals_task_id_status", table_name="agent_approvals")
    op.drop_table("agent_approvals")
    op.drop_index(
        "ix_agent_artifacts_task_id_created_at", table_name="agent_artifacts"
    )
    op.drop_table("agent_artifacts")
    op.drop_index("ix_agent_steps_run_id_seq", table_name="agent_steps")
    op.drop_table("agent_steps")
    op.drop_index("ix_agent_runs_task_id_created_at", table_name="agent_runs")
    op.drop_table("agent_runs")
    op.drop_index("ix_agent_tasks_user_id_status", table_name="agent_tasks")
    op.drop_index("ix_agent_tasks_user_id_updated_at", table_name="agent_tasks")
    op.drop_table("agent_tasks")
