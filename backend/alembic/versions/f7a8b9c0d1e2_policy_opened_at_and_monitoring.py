"""Persist policy opening time and repair active monitoring projections.

Revision ID: f7a8b9c0d1e2
Revises: f2a3b4c5d6e7
Create Date: 2026-07-25 03:05:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, Sequence[str], None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "policies",
        sa.Column("opened_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    # Existing rows stored the timestamp in intake_json only after the first
    # UI fix.  Older on-chain openings fall back to their confirmation update.
    op.execute(
        """
        UPDATE policies
        SET opened_at = CASE
            WHEN COALESCE(intake_json ->> 'openedAt', '')
                ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
            THEN (intake_json ->> 'openedAt')::timestamptz
            ELSE updated_at
        END
        WHERE open_tx IS NOT NULL AND opened_at IS NULL
        """
    )
    # A confirmed active policy is in monitoring, never terminal success.
    # Limit repair to the inconsistent legacy shape: a running monitor step.
    op.execute(
        """
        UPDATE agent_tasks AS task
        SET status = 'monitoring', updated_at = now()
        FROM policies AS policy
        WHERE task.primary_ref_id = policy.id
          AND policy.status = 'active'
          AND task.status = 'succeeded'
          AND EXISTS (
              SELECT 1
              FROM agent_runs AS run
              JOIN agent_steps AS step ON step.run_id = run.id
              WHERE run.task_id = task.id
                AND step.name = 'monitor'
                AND step.status = 'running'
          )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE agent_tasks AS task
        SET status = 'succeeded', updated_at = now()
        FROM policies AS policy
        WHERE task.primary_ref_id = policy.id
          AND policy.status = 'active'
          AND task.status = 'monitoring'
          AND EXISTS (
              SELECT 1
              FROM agent_runs AS run
              JOIN agent_steps AS step ON step.run_id = run.id
              WHERE run.task_id = task.id
                AND step.name = 'monitor'
                AND step.status = 'running'
          )
        """
    )
    op.drop_column("policies", "opened_at")
