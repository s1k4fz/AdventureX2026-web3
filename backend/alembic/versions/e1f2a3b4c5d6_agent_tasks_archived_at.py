"""agent_tasks add archived_at

Revision ID: e1f2a3b4c5d6
Revises: d8e9f0a1b2c3
Create Date: 2026-07-24 22:05:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d8e9f0a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "agent_tasks",
        sa.Column("archived_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_agent_tasks_user_id_archived_at",
        "agent_tasks",
        ["user_id", "archived_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_agent_tasks_user_id_archived_at", table_name="agent_tasks")
    op.drop_column("agent_tasks", "archived_at")
