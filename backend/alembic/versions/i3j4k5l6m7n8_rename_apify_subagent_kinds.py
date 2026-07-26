"""Rename apify_* subagent kinds to news/web; merge alembic heads.

Revision ID: i3j4k5l6m7n8
Revises: g1h2i3j4k5l6, h2i3j4k5l6m7
Create Date: 2026-07-25 18:10:00.000000
"""

from typing import Sequence, Union

from alembic import op

revision: str = "i3j4k5l6m7n8"
down_revision: Union[str, Sequence[str], None] = ("g1h2i3j4k5l6", "h2i3j4k5l6m7")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_KINDS = (
    "kind in ("
    "'polymarket', 'world_monitor', 'pandaai', 'news', "
    "'web', 'synthesizer'"
    ")"
)

# Pre-rename constraint may or may not already include pandaai depending on
# which head was applied; both legacy spellings are rewritten before recreate.
_OLD_KINDS = (
    "kind in ("
    "'polymarket', 'world_monitor', 'pandaai', 'apify_news', "
    "'apify_web', 'synthesizer'"
    ")"
)


def upgrade() -> None:
    # The legacy constraint rejects the new spellings, so it must be removed
    # before rewriting existing rows. DDL and data changes remain in Alembic's
    # transaction, and the replacement constraint validates the final state.
    op.drop_constraint("ck_agent_subagents_kind", "agent_subagents", type_="check")
    op.execute(
        "UPDATE agent_subagents SET kind = 'news' WHERE kind = 'apify_news'"
    )
    op.execute(
        "UPDATE agent_subagents SET kind = 'web' WHERE kind = 'apify_web'"
    )
    op.create_check_constraint(
        "ck_agent_subagents_kind",
        "agent_subagents",
        _NEW_KINDS,
    )


def downgrade() -> None:
    # Symmetric with upgrade: the new constraint rejects the legacy spellings.
    op.drop_constraint("ck_agent_subagents_kind", "agent_subagents", type_="check")
    op.execute(
        "UPDATE agent_subagents SET kind = 'apify_news' WHERE kind = 'news'"
    )
    op.execute(
        "UPDATE agent_subagents SET kind = 'apify_web' WHERE kind = 'web'"
    )
    op.create_check_constraint(
        "ck_agent_subagents_kind",
        "agent_subagents",
        _OLD_KINDS,
    )
