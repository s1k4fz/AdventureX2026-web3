"""agent_subagents table for multi-source collect observability.

Revision ID: a1b2c3d4e5f6
Revises: a8b9c0d1e2f3
Create Date: 2026-07-25 08:40:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "a8b9c0d1e2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_subagents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column(
            "parent_step",
            sa.String(),
            server_default="market_search",
            nullable=False,
        ),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("query_text", sa.Text(), nullable=True),
        sa.Column(
            "progress_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "brief_json",
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
            "kind in ("
            "'polymarket', 'world_monitor', 'apify_news', "
            "'apify_web', 'synthesizer'"
            ")",
            name="ck_agent_subagents_kind",
        ),
        sa.CheckConstraint(
            "status in ("
            "'pending', 'running', 'succeeded', 'failed', 'skipped'"
            ")",
            name="ck_agent_subagents_status",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "kind", name="uq_agent_subagents_run_kind"),
    )
    op.create_index(
        "ix_agent_subagents_task_id_created_at",
        "agent_subagents",
        ["task_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_agent_subagents_run_id",
        "agent_subagents",
        ["run_id"],
        unique=False,
    )
    op.execute("ALTER TABLE agent_subagents ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE agent_subagents FROM anon, authenticated")


def downgrade() -> None:
    op.drop_index("ix_agent_subagents_run_id", table_name="agent_subagents")
    op.drop_index(
        "ix_agent_subagents_task_id_created_at", table_name="agent_subagents"
    )
    op.drop_table("agent_subagents")
