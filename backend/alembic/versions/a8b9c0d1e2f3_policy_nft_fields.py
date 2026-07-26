"""Add deterministic Policy NFT confirmation fields.

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-25 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a8b9c0d1e2f3"
down_revision: str | Sequence[str] | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "policies", sa.Column("nft_token_id", sa.String(length=39), nullable=True)
    )
    op.add_column(
        "policies", sa.Column("nft_mint_tx", sa.String(length=66), nullable=True)
    )
    op.add_column(
        "policies",
        sa.Column("nft_minted_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_policies_nft_token_id_uint128",
        "policies",
        "nft_token_id IS NULL OR ("
        "nft_token_id ~ '^(0|[1-9][0-9]{0,38})$' AND ("
        "length(nft_token_id) < 39 OR "
        "nft_token_id <= '340282366920938463463374607431768211455'))",
    )
    op.create_check_constraint(
        "ck_policies_nft_mint_tx_hash",
        "policies",
        "nft_mint_tx IS NULL OR nft_mint_tx ~ '^0x[0-9a-fA-F]{64}$'",
    )
    op.create_index(
        "uq_policies_nft_token_id",
        "policies",
        ["nft_token_id"],
        unique=True,
        postgresql_where=sa.text("nft_token_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_policies_nft_token_id", table_name="policies")
    op.drop_constraint("ck_policies_nft_mint_tx_hash", "policies", type_="check")
    op.drop_constraint("ck_policies_nft_token_id_uint128", "policies", type_="check")
    op.drop_column("policies", "nft_minted_at")
    op.drop_column("policies", "nft_mint_tx")
    op.drop_column("policies", "nft_token_id")
