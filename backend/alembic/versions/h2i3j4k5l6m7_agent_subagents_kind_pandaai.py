"""Allow pandaai kind on agent_subagents.

Revision ID: h2i3j4k5l6m7
Revises: c5d6e7f8a9b0
Create Date: 2026-07-25 15:45:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "h2i3j4k5l6m7"
down_revision: Union[str, Sequence[str], None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_agent_subagents_kind", "agent_subagents", type_="check")
    op.create_check_constraint(
        "ck_agent_subagents_kind",
        "agent_subagents",
        "kind in ("
        "'polymarket', 'world_monitor', 'pandaai', 'apify_news', "
        "'apify_web', 'synthesizer'"
        ")",
    )


def downgrade() -> None:
    op.drop_constraint("ck_agent_subagents_kind", "agent_subagents", type_="check")
    op.create_check_constraint(
        "ck_agent_subagents_kind",
        "agent_subagents",
        "kind in ("
        "'polymarket', 'world_monitor', 'apify_news', "
        "'apify_web', 'synthesizer'"
        ")",
    )
