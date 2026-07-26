"""Agent definitions: one tool-less Agent per use case (终稿第七章).

Models are never bound at construction — routing.resolve() supplies them per
run, so "change model = edit config" stays true. The system prompt arrives via
LemmaDeps + dynamic instructions (rendered by prompts/registry in client.py),
keeping prompt ownership out of the framework.

Text agents output str (chat); structured agents bind a pydantic output_type
for policy generation (client.generate).
"""

from dataclasses import dataclass
from typing import Any

from pydantic_ai import Agent, RunContext

from ai.errors import UnsupportedCapabilityError
from ai.policygen.types import MarketQueries, PortfolioSet, RiskQuestionnaire
from ai.runtime.subagents.types import SynthesizerOutput
from ai.types import AIUseCase


@dataclass
class LemmaDeps:
    system_prompt: str
    user_id: str | None = None
    # Phase 3: profile lookups / db handles land here.


def _inject_system_prompt(ctx: RunContext[LemmaDeps]) -> str:
    return ctx.deps.system_prompt


def _build_agent() -> Agent[LemmaDeps, str]:
    agent: Agent[LemmaDeps, str] = Agent(deps_type=LemmaDeps)
    agent.instructions(_inject_system_prompt)
    return agent


def _build_structured_agent(output_type: type[Any]) -> Agent[LemmaDeps, Any]:
    """Agent that returns our pydantic output_type instead of str. The framework
    type stays inside ai/; client.generate hands back the validated instance."""
    agent: Agent[LemmaDeps, Any] = Agent(deps_type=LemmaDeps, output_type=output_type)
    agent.instructions(_inject_system_prompt)
    return agent


text_chat_agent = _build_agent()
# 差分机 policy-planning intro: plain streaming-text turn (own prompt only).
policy_plan_intro_agent = _build_agent()

_AGENTS: dict[AIUseCase, Agent[LemmaDeps, str]] = {
    AIUseCase.TEXT_CHAT: text_chat_agent,
    AIUseCase.POLICY_PLAN_INTRO: policy_plan_intro_agent,
}

# 差分机 (Difference Engine): policy intake + market search + portfolio compose.
policy_intake_agent = _build_structured_agent(RiskQuestionnaire)
market_search_agent = _build_structured_agent(MarketQueries)
market_search_refined_agent = _build_structured_agent(MarketQueries)
portfolio_compose_agent = _build_structured_agent(PortfolioSet)
source_brief_agent = _build_structured_agent(SynthesizerOutput)

_STRUCTURED_AGENTS: dict[AIUseCase, Agent[LemmaDeps, Any]] = {
    AIUseCase.POLICY_INTAKE: policy_intake_agent,
    AIUseCase.MARKET_SEARCH: market_search_agent,
    AIUseCase.MARKET_SEARCH_REFINED: market_search_refined_agent,
    AIUseCase.PORTFOLIO_COMPOSE: portfolio_compose_agent,
    AIUseCase.SOURCE_BRIEF: source_brief_agent,
}


def agent_for(use_case: AIUseCase) -> Agent[LemmaDeps, str]:
    agent = _AGENTS.get(use_case)
    if agent is None:
        raise UnsupportedCapabilityError(
            f"use case '{use_case}' is not implemented yet"
        )
    return agent


def structured_agent_for(use_case: AIUseCase) -> Agent[LemmaDeps, Any]:
    agent = _STRUCTURED_AGENTS.get(use_case)
    if agent is None:
        raise UnsupportedCapabilityError(
            f"use case '{use_case}' has no structured agent"
        )
    return agent
