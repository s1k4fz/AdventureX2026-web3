"""Policy-generation brain (差分机 / Difference Engine): pure AI logic (no DB, no Celery, no SDKs).

Services call these and persist the products. The boundary types are
re-exported eagerly (safe). The pipeline functions live in submodules that
import ai.client; since ai.agents imports ai.policygen.types (running this
__init__), importing those submodules here would cycle
(client -> agents -> policygen -> client). So they load lazily on first access
via PEP 562 __getattr__ — callers still write `from ai.policygen import
generate_risk_questionnaire`.
"""

import importlib
from typing import TYPE_CHECKING, Any

from ai.policygen.types import (
    ComposedPortfolio,
    ComposedPosition,
    MarketQueries,
    PortfolioSet,
    ResolvedPortfolio,
    ResolvedPortfolioSet,
    ResolvedPosition,
    RiskFactorCategory,
    RiskQuestion,
    RiskQuestionnaire,
)

if TYPE_CHECKING:  # import-time names for type checkers, no runtime cycle
    from ai.policygen.compose import compose_portfolios, stream_compose_portfolios
    from ai.policygen.intake import generate_risk_questionnaire
    from ai.policygen.market_search import (
        MarketSearchReport,
        search_markets_for_need,
        search_markets_for_need_report,
    )
    from ai.policygen.ranking import rank

_LAZY_EXPORTS = {
    "generate_risk_questionnaire": "ai.policygen.intake",
    "search_markets_for_need": "ai.policygen.market_search",
    "search_markets_for_need_report": "ai.policygen.market_search",
    "MarketSearchReport": "ai.policygen.market_search",
    "search_markets_refined": "ai.policygen.market_search",
    "merge_candidates": "ai.policygen.market_search",
    "rank": "ai.policygen.ranking",
    "compose_portfolios": "ai.policygen.compose",
    "stream_compose_portfolios": "ai.policygen.compose",
}

__all__ = [
    "ComposedPortfolio",
    "ComposedPosition",
    "MarketQueries",
    "PortfolioSet",
    "ResolvedPortfolio",
    "ResolvedPortfolioSet",
    "ResolvedPosition",
    "RiskFactorCategory",
    "RiskQuestion",
    "RiskQuestionnaire",
    "compose_portfolios",
    "generate_risk_questionnaire",
    "rank",
    "search_markets_for_need",
    "search_markets_for_need_report",
    "MarketSearchReport",
    "search_markets_refined",
    "merge_candidates",
    "stream_compose_portfolios",
]


def __getattr__(name: str) -> Any:
    module_path = _LAZY_EXPORTS.get(name)
    if module_path is None:
        raise AttributeError(f"module 'ai.policygen' has no attribute '{name}'")
    return getattr(importlib.import_module(module_path), name)
