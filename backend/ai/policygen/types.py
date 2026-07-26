"""Policy-generation product + AI-IO types (差分机 / Difference Engine).

The first few are the cross-layer products services consume — their fields are
fixed (don't drift). They carry NO DB fields (id / order_index / status /
progress): those are generated at persist time. The rest are internal LLM
input/output shapes (query-expansion / portfolio structures out) — they never
leave the policygen pipeline.

This module imports only pydantic and the ai/markets boundary type; it must never
touch models/, sqlalchemy, celery, tasks/ or ai.client.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from ai.markets.types import MarketCandidate

# --- Products (services consume; field shapes are fixed) ---


class RiskFactorCategory(BaseModel):
    """A risk-factor category the agent proposes for this insurance need.

    Hard requirement: agents must emit at least two distinct categories so
    search / compose can diversify across risk dimensions (not a single theme).
    """

    id: str = Field(description="Stable slug, e.g. 'macro-rates', 'geopolitics'")
    label: str = Field(description="Short Chinese display name")
    rationale: str = Field(
        description="One-sentence rationale tying this category to the user's need"
    )


class RiskQuestion(BaseModel):
    # AI-generated stable slug (e.g. "coverage-window"); unique within a survey.
    id: str
    title: str
    options: list[str]


class RiskQuestionnaire(BaseModel):
    """Same shape as the policy intake questionnaire wire contract.

    ``factor_categories`` is a hard schema constraint (min 2): the intake agent
    must propose at least two risk-factor categories before questions.
    """

    factor_categories: list[RiskFactorCategory] = Field(min_length=2)
    questions: list[RiskQuestion]


class ResolvedPosition(BaseModel):
    """A validated position: bound to a REAL MarketCandidate from the pool."""

    market_ref: str
    question: str
    side: Literal["YES", "NO"]
    entry_price_bps: int
    weight_bps: int
    resolution_date: datetime | None = None
    ai_reason: str
    candidate: MarketCandidate


class ResolvedPortfolio(BaseModel):
    tier: Literal["conservative", "balanced", "aggressive"]
    title: str
    thesis: str
    positions: list[ResolvedPosition]


class ResolvedPortfolioSet(BaseModel):
    """Validated compose output — every position resolved to a real candidate
    (fabricated/duplicate/expired refs already dropped). Empty portfolios means
    nothing valid survived -> policy failed."""

    portfolios: list[ResolvedPortfolio] = Field(default_factory=list)
    factor_categories: list[RiskFactorCategory] = Field(default_factory=list)

    @property
    def position_count(self) -> int:
        return sum(len(p.positions) for p in self.portfolios)


# --- Internal LLM-IO (never cross the policygen boundary) ---


class MarketQueries(BaseModel):
    """LLM query-expansion output: search keywords for the risk need."""

    queries: list[str] = Field(default_factory=list)


class ComposedPosition(BaseModel):
    """One LLM-chosen position: a market_ref into the presented pool.

    market_ref MUST be the stable ref we printed for the candidate
    (condition_id), never a positional index — it is validated against the
    real pool before persistence (零信任 LLM).
    """

    market_ref: str
    side: Literal["YES", "NO"]
    weight_bps: int
    ai_reason: str


class ComposedPortfolio(BaseModel):
    tier: Literal["conservative", "balanced", "aggressive"]
    title: str
    thesis: str
    positions: list[ComposedPosition] = Field(default_factory=list)


class PortfolioSet(BaseModel):
    """Raw LLM output of PORTFOLIO_COMPOSE: three-tier portfolios, each
    bound to candidate_refs. Number of positions decided by the model from
    real supply (诚实交付，宁缺毋滥); validated/resolved into a
    ResolvedPortfolioSet before anything is persisted.

    ``factor_categories`` is a hard schema constraint (min 2): the compose agent
    must declare at least two risk-factor categories covered by the set.
    """

    factor_categories: list[RiskFactorCategory] = Field(min_length=2)
    portfolios: list[ComposedPortfolio] = Field(default_factory=list)
