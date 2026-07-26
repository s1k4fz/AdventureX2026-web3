import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database import Base


class Policy(Base):
    """A generated insurance policy and its lifecycle.

    状态机 (差分机门禁): intake -> composing -> proposed -> funded -> active ->
    settled, failed on error. The intake phase collects the user's risk
    description and questionnaire answers (intake_json). composing kicks off
    the AI portfolio construction. proposed means a set of candidate
    portfolios has been generated for the user to review. funded means the
    user has committed capital to a selected portfolio. active means on-chain
    positions are open. settled means all positions have resolved and the
    payout is calculated; failed covers any terminal error.

    A parallel `search_status` (searching -> searched | failed) tracks the
    broad market search that runs concurrently with the questionnaire; compose
    gates on its terminal value (握手协议 P2). `selected_portfolio_id` points
    to the chosen portfolio but is deliberately NOT a FK: portfolios already
    cascade from policy, and a reverse FK would form a cycle; the service
    keeps this id valid (说明: 业务层保证).

    A policy is optionally born inside a conversation (conversation_id, SET
    NULL so deleting the chat never deletes the policy).
    """

    __tablename__ = "policies"
    __table_args__ = (
        CheckConstraint(
            "status in ('intake', 'composing', 'proposed', 'funded', "
            "'active', 'settled', 'failed')",
            name="ck_policies_status",
        ),
        CheckConstraint(
            "search_status in ('searching', 'searched', 'failed')",
            name="ck_policies_search_status",
        ),
        CheckConstraint(
            "nft_token_id IS NULL OR ("
            "nft_token_id ~ '^(0|[1-9][0-9]{0,38})$' AND ("
            "length(nft_token_id) < 39 OR "
            "nft_token_id <= '340282366920938463463374607431768211455'))",
            name="ck_policies_nft_token_id_uint128",
        ),
        CheckConstraint(
            "nft_mint_tx IS NULL OR nft_mint_tx ~ '^0x[0-9a-fA-F]{64}$'",
            name="ck_policies_nft_mint_tx_hash",
        ),
        Index(
            "uq_policies_nft_token_id",
            "nft_token_id",
            unique=True,
            postgresql_where=text("nft_token_id IS NOT NULL"),
        ),
        # Policy list is WHERE user_id ORDER BY updated_at DESC; the composite
        # serves filter + order in one pass and (leftmost column) covers plain
        # user_id lookups, so no separate single-column index.
        Index("ix_policies_user_id_updated_at", "user_id", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The conversation the policy was born in (拍板). SET NULL: deleting the
    # chat must never cascade into the policy.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ai_conversations.id", ondelete="SET NULL"),
        nullable=True,
    )
    need_text: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    # Broad-search sub-state, independent of `status` and only meaningful during
    # intake/composing: searching -> searched | failed. compose gates on its
    # terminal value (握手协议 P2). Defaults to searching: a policy is born with
    # its broad market search already kicked off.
    search_status: Mapped[str] = mapped_column(
        String, nullable=False, server_default="searching"
    )
    # Questionnaire + answers + coverage_end, kept together as one JSON blob
    # (阶段一 product data, never queried by column).
    intake_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    coverage_end: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    # The picked portfolio. Deliberately NOT a FK: portfolios already point at
    # policies (CASCADE), and a reverse FK would form a dependency cycle; the
    # service keeps this id valid (说明: 业务层保证).
    selected_portfolio_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # On-chain fields
    on_chain_policy_id: Mapped[str | None] = mapped_column(String, nullable=True)
    open_tx: Mapped[str | None] = mapped_column(String, nullable=True)
    # Authoritative lifecycle timestamp.  Unlike updated_at it never moves
    # when a user adds monitoring instructions or the policy later settles.
    opened_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    settle_tx: Mapped[str | None] = mapped_column(String, nullable=True)
    # ERC-721 tokenId is the unsigned integer value of this policy's UUID.
    # Store its canonical decimal representation so tokenURI can round-trip
    # without relying on database-specific uint256 support.
    nft_token_id: Mapped[str | None] = mapped_column(String(39), nullable=True)
    nft_mint_tx: Mapped[str | None] = mapped_column(String(66), nullable=True)
    nft_minted_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    premium: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    fee: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    payout: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Read-only navigation for the snapshot schema. DB ON DELETE CASCADE is the
    # authoritative delete path; passive_deletes keeps the ORM from loading and
    # NULLing children itself.
    portfolios: Mapped[list["PolicyPortfolio"]] = relationship(
        order_by="PolicyPortfolio.order_index",
        passive_deletes=True,
    )


class MarketSearchCandidate(Base):
    """Policy-level broad-search pool (搜索前置).

    Every prediction market the broad search found, cached BEFORE any
    portfolio construction exists. compose reads this pool (rank + trim) to
    select + organize; the chosen subset is then materialized into
    policy_positions. Kept separate from policy_positions on purpose: that one
    is the per-portfolio structured leg; this is the pre-structure pool keyed
    by policy_id. raw_json keeps the provider's untouched item (boundary stays
    inside the row).
    """

    __tablename__ = "market_search_candidates"
    __table_args__ = (
        # The only read is "the pool for this policy".
        Index("ix_market_search_candidates_policy_id", "policy_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policies.id", ondelete="CASCADE"),
        nullable=False,
    )
    question: Mapped[str] = mapped_column(String, nullable=False)
    condition_id: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str] = mapped_column(String, nullable=False)
    outcomes: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    outcome_prices: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    clob_token_ids: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    volume: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    liquidity: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    raw_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


class PolicyPortfolio(Base):
    """A candidate portfolio tier within a policy (mirror CourseUnit).

    Each policy generates multiple tier portfolios (conservative / balanced /
    aggressive). The user picks one (policy.selected_portfolio_id); others are
    retained for audit. order_index preserves the presentation ordering.
    """

    __tablename__ = "policy_portfolios"
    __table_args__ = (
        CheckConstraint(
            "tier in ('conservative', 'balanced', 'aggressive')",
            name="ck_policy_portfolios_tier",
        ),
        # Portfolio render reads WHERE policy_id ORDER BY order_index.
        Index("ix_policy_portfolios_policy_id_order_index", "policy_id", "order_index"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policies.id", ondelete="CASCADE"),
        nullable=False,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    tier: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    thesis: Mapped[str | None] = mapped_column(Text, nullable=True)
    premium_estimate: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    expected_payout: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    metrics_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    scenarios_json: Mapped[list[Any] | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )

    # Read-only navigation. DB ON DELETE CASCADE is authoritative.
    positions: Mapped[list["PolicyPosition"]] = relationship(
        order_by="PolicyPosition.order_index",
        passive_deletes=True,
    )


class PolicyPosition(Base):
    """A single prediction-market leg within a portfolio (mirror CourseChapter + candidate).

    Each position binds to a specific on-chain market (market_ref =
    conditionId). weight_bps is the capital weight within the portfolio;
    all positions in one portfolio must sum to 10000 (enforced at the
    service layer, not DB — mirrors how Course never DB-enforces order
    continuity).
    """

    __tablename__ = "policy_positions"
    __table_args__ = (
        CheckConstraint(
            "side in ('YES', 'NO')",
            name="ck_policy_positions_side",
        ),
        # Position render reads WHERE portfolio_id ORDER BY order_index.
        Index(
            "ix_policy_positions_portfolio_id_order_index",
            "portfolio_id",
            "order_index",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    portfolio_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("policy_portfolios.id", ondelete="CASCADE"),
        nullable=False,
    )
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    market_ref: Mapped[str] = mapped_column(String, nullable=False)
    question: Mapped[str] = mapped_column(String, nullable=False)
    side: Mapped[str] = mapped_column(String, nullable=False)
    entry_price_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    # Capital weight within the portfolio; all positions sum to 10000 bps.
    weight_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    resolution_date: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    ai_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    odds: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    volume: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    raw_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
