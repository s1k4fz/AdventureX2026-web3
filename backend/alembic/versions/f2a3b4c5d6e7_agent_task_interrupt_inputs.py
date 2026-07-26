"""agent task interrupt input queue

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-24 23:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_tasks",
        sa.Column(
            "input_revision",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.create_table(
        "agent_task_inputs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("run_id", sa.UUID(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), server_default="queued", nullable=False),
        sa.Column("client_request_id", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("applied_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type in ('free_text', 'revise_goal')",
            name="ck_agent_task_inputs_type",
        ),
        sa.CheckConstraint(
            "status in ('queued', 'applying', 'applied', 'superseded')",
            name="ck_agent_task_inputs_status",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["task_id"], ["agent_tasks.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "task_id",
            "client_request_id",
            name="uq_agent_task_inputs_task_client_request_id",
        ),
        sa.UniqueConstraint(
            "task_id",
            "revision",
            name="uq_agent_task_inputs_task_revision",
        ),
    )
    op.create_index(
        "ix_agent_task_inputs_task_id_revision",
        "agent_task_inputs",
        ["task_id", "revision"],
        unique=False,
    )
    op.create_index(
        "ix_agent_task_inputs_task_id_status",
        "agent_task_inputs",
        ["task_id", "status"],
        unique=False,
    )
    op.execute("ALTER TABLE agent_task_inputs ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE agent_task_inputs FROM anon, authenticated")


def downgrade() -> None:
    op.drop_index(
        "ix_agent_task_inputs_task_id_status", table_name="agent_task_inputs"
    )
    op.drop_index(
        "ix_agent_task_inputs_task_id_revision", table_name="agent_task_inputs"
    )
    op.drop_table("agent_task_inputs")
    op.drop_column("agent_tasks", "input_revision")
