"""API contracts for the policy domain (差分机 / Difference Engine). Wire format is camelCase."""

import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

_MIN_PREMIUM = 10.0
_TX_HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")


class RiskFactorCategoryOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: str
    label: str
    rationale: str = ""


class RiskQuestionnaireQuestionOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: str
    title: str
    options: list[str]


class RiskQuestionnaireOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    factor_categories: list[RiskFactorCategoryOut] = Field(default_factory=list)
    questions: list[RiskQuestionnaireQuestionOut]


class PolicyIntakeAnswerIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    question_id: str
    answer: str


class PolicyIntakeAnswersIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    answers: list[PolicyIntakeAnswerIn] = Field(min_length=1)


class PolicyPositionOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    market_ref: str
    question: str
    side: str
    entry_price_bps: int
    weight: int
    resolution_date: datetime | None = None
    ai_reason: str | None = None
    odds: float | None = None
    volume: float | None = None
    spread_bps: int | None = None
    liquidity: float | None = None
    category: str | None = None
    low_liquidity: bool | None = None


class PolicySettlementOutcomeOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    market_ref: str
    question: str
    side: str
    outcome_yes: bool
    hit: bool


class PolicyPortfolioOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    tier: str
    title: str
    thesis: str | None = None
    premium_estimate: float | None = None
    expected_payout: float | None = None
    metrics: dict[str, Any] | None = None
    scenarios: list[dict[str, Any]] = Field(default_factory=list)
    positions: list[PolicyPositionOut] = Field(default_factory=list)


class PolicyDetailOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    title: str
    status: str
    search_status: str = "searching"
    questionnaire_ready: bool = False
    need_text: str
    coverage_end: datetime | None = None
    premium: float | None = None
    portfolios: list[PolicyPortfolioOut] = Field(default_factory=list)
    on_chain_policy_id: str | None = None
    open_tx: str | None = None
    opened_at: datetime | None = None
    settle_tx: str | None = None
    nft_token_id: str | None = None
    nft_mint_tx: str | None = None
    nft_minted_at: datetime | None = None
    nft_metadata_uri: str | None = None
    payout: float | None = None
    selected_portfolio_id: uuid.UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    settlement_outcomes: list[PolicySettlementOutcomeOut] = Field(default_factory=list)
    factor_categories: list[RiskFactorCategoryOut] = Field(default_factory=list)


class ResearchPlatformCountOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    platform: str
    count: int


class ResearchCandidateOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    condition_id: str
    platform: str
    question: str
    url: str
    slug: str | None = None
    volume: float | None = None
    liquidity: float | None = None
    volume24hr: float | None = None
    spread: float | None = None
    yes_price_bps: int | None = None
    end_date: datetime | None = None
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    rank: int
    selection: Literal["selected", "pool"]


class ResearchSourceOut(BaseModel):
    """One collected intel source from the multi-subagent gather stage."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    kind: str
    status: str
    summary: str = ""
    item_count: int = 0
    error_code: str | None = None
    error_message: str | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)


class PolicyResearchOut(BaseModel):
    """Auditable market-research snapshot for a policy (candidate pool + selection)."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    policy_id: uuid.UUID
    search_status: Literal["searching", "searched", "failed"]
    policy_status: str
    total_count: int
    returned_count: int
    researched_at: datetime | None = None
    selected_condition_ids: list[str] = Field(default_factory=list)
    platforms: list[ResearchPlatformCountOut] = Field(default_factory=list)
    candidates: list[ResearchCandidateOut] = Field(default_factory=list)
    sources: list[ResearchSourceOut] = Field(default_factory=list)
    evidence_pack: dict[str, Any] | None = None


class PolicyListItemOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    title: str
    status: str
    updated_at: datetime
    open_tx: str | None = None
    opened_at: datetime | None = None
    coverage_end: datetime | None = None
    premium: float | None = None
    expected_payout: float | None = None
    selected_portfolio_tier: str | None = None
    has_nft: bool = False
    nft_token_id: str | None = None
    nft_minted_at: datetime | None = None


class PolicyNFTAttributeOut(BaseModel):
    """OpenSea-compatible attribute without exposing policy source data."""

    # ERC-721 metadata has a standardized snake_case JSON shape.  Do not apply
    # the application's camelCase wire convention to this public document.
    model_config = ConfigDict(populate_by_name=True)

    trait_type: str
    value: str | int | float
    display_type: str | None = None


class PolicyNFTMetadataOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    description: str
    image: str
    external_url: str
    attributes: list[PolicyNFTAttributeOut] = Field(default_factory=list)


class PolicyConfirmMintIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    nft_token_id: str
    mint_tx: str | None = None

    @field_validator("nft_token_id")
    @classmethod
    def validate_token_id(cls, value: str) -> str:
        if not value or not value.isascii() or not value.isdecimal():
            raise ValueError("nft_token_id must be a canonical decimal integer")
        if len(value) > 39:
            raise ValueError("nft_token_id must fit a UUID")
        if value != str(int(value)):
            raise ValueError("nft_token_id must not have leading zeroes")
        if int(value) > (1 << 128) - 1:
            raise ValueError("nft_token_id must fit a UUID")
        return value

    @field_validator("mint_tx")
    @classmethod
    def validate_mint_tx(cls, value: str | None) -> str | None:
        if value is not None and not _TX_HASH_RE.fullmatch(value):
            raise ValueError("mint_tx must be a 0x-prefixed 32-byte transaction hash")
        return value


class PolicySelectPositionOverride(BaseModel):
    """Optional per-leg weight override on select (Σ weightBps must be 10000)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    market_ref: str
    weight_bps: int = Field(ge=1, le=10000)


class PolicySelectIn(BaseModel):
    """POST /policies/{policyId}/select request body."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    portfolio_id: uuid.UUID
    premium: float | None = Field(default=None, ge=_MIN_PREMIUM)
    position_overrides: list[PolicySelectPositionOverride] | None = None

    @field_validator("premium")
    @classmethod
    def validate_premium(cls, value: float | None) -> float | None:
        if value is not None and value < _MIN_PREMIUM:
            raise ValueError(f"premium must be at least {_MIN_PREMIUM}")
        return value

    @field_validator("position_overrides")
    @classmethod
    def validate_overrides(
        cls, value: list[PolicySelectPositionOverride] | None
    ) -> list[PolicySelectPositionOverride] | None:
        if value is None:
            return None
        if not value:
            raise ValueError("position_overrides must be non-empty when provided")
        total = sum(item.weight_bps for item in value)
        if total != 10000:
            raise ValueError(f"position_overrides weight sum must be 10000, got {total}")
        refs = [item.market_ref for item in value]
        if len(set(refs)) != len(refs):
            raise ValueError("position_overrides contains duplicate market_ref")
        return value


class PolicyFundingPositionOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    market_ref: str
    side_yes: bool
    entry_price_bps: int
    weight_bps: int


class PolicyFundingPlanOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    policy_id: uuid.UUID
    on_chain_policy_id: str
    chain_id: int
    vault_address: str
    usdc_address: str
    fee_bps: int
    premium_base_units: str
    max_payout_base_units: str
    coverage_end: int
    positions: list[PolicyFundingPositionOut]


class PolicyConfirmOpenIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    on_chain_policy_id: str
    open_tx: str


class PolicyMarkPositionOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    market_ref: str
    question: str | None = None
    side: str
    entry_price_bps: int
    current_price_bps: int | None = None
    weight_bps: int
    mark_value: float | None = None
    null_price_reason: str | None = None
    shares_source: Literal["on_chain", "recomputed"] | None = None


class PolicyMarksCoverageOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    quoted: int = 0
    total: int = 0
    status: Literal["full", "partial", "none"] = "none"


class PolicyMarksOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    policy_id: uuid.UUID
    positions: list[PolicyMarkPositionOut] = Field(default_factory=list)
    total_mark_value: float | None = None
    full_hit_payout: float | None = None
    premium: float | None = None
    updated_at: datetime
    as_of: datetime | None = None
    quote_source: str = "polymarket_gamma"
    coverage: PolicyMarksCoverageOut = Field(
        default_factory=PolicyMarksCoverageOut
    )
    stale: bool = False
    unavailable_reason: str | None = None
    shares_recomputed: bool = False


# =============================================================================
# M3 — Oracle status (per-leg assertion visibility)
# =============================================================================


class OracleLegStatusOut(BaseModel):
    """Per-leg oracle assertion state exposed to the frontend."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    market_ref: str
    question: str
    side: str
    status: int  # 0=None, 1=Asserted, 2=Disputed, 3=Resolved
    status_label: str  # "pending"/"asserted"/"disputed"/"resolved"
    proposer: str | None = None
    asserted_yes: bool | None = None
    assert_time: int | None = None  # unix timestamp
    liveness: int | None = None  # seconds
    challenge_deadline: int | None = None  # assert_time + liveness
    disputer: str | None = None
    final_yes: bool | None = None
    hit: bool | None = None  # sideYes matches finalYes


class PolicyOracleStatusOut(BaseModel):
    """Aggregate oracle settlement status for a policy."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    policy_id: str
    on_chain_policy_id: str
    oracle_address: str
    liveness_seconds: int
    bond_usdc: float
    legs: list[OracleLegStatusOut] = Field(default_factory=list)
    all_resolved: bool
    progress_pct: int  # 0-100
    mode: Literal["live", "legacy"] = "live"
    fetched_at: str  # ISO8601
