"""schedule_watch_items table for custom attention reminders

Revision ID: c5d6e7f8a9b0
Revises: a1b2c3d4e5f6
Create Date: 2026-07-25 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "schedule_watch_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("href", sa.String(), nullable=True),
        sa.Column("policy_id", sa.UUID(), nullable=True),
        sa.Column(
            "color", sa.String(), server_default="blue", nullable=False
        ),
        sa.Column(
            "sort_order", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "archived_at",
            postgresql.TIMESTAMP(timezone=True),
            nullable=True,
        ),
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
        sa.ForeignKeyConstraint(
            ["user_id"], ["profiles.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_schedule_watch_items_user_id_updated_at",
        "schedule_watch_items",
        ["user_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_schedule_watch_items_user_id_due_on",
        "schedule_watch_items",
        ["user_id", "due_on"],
        unique=False,
    )

    # Security: enable RLS + revoke Data API exposure for anon/authenticated.
    # Business access goes through FastAPI with service credentials.
    op.execute(
        "ALTER TABLE schedule_watch_items ENABLE ROW LEVEL SECURITY"
    )
    op.execute(
        "REVOKE ALL ON TABLE schedule_watch_items FROM anon, authenticated"
    )


def downgrade() -> None:
    op.execute(
        "GRANT ALL ON TABLE schedule_watch_items TO anon, authenticated"
    )
    op.drop_index(
        "ix_schedule_watch_items_user_id_due_on",
        table_name="schedule_watch_items",
    )
    op.drop_index(
        "ix_schedule_watch_items_user_id_updated_at",
        table_name="schedule_watch_items",
    )
    op.drop_table("schedule_watch_items")
