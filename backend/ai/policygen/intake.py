"""阶段一·问卷：risk need -> RiskQuestionnaire (one LLM call via the ai/ facade)."""

from __future__ import annotations

from ai.client import ai_client
from ai.policygen.types import RiskQuestionnaire
from ai.runtime import Budget, Plan, StageRunner, load_constraints_from_intake
from ai.types import AIUseCase
from core.config import settings


async def generate_risk_questionnaire(
    need: str,
    known_profile: dict[str, str] | None = None,
    *,
    intake_json: dict | None = None,
) -> RiskQuestionnaire:
    """Profile-discovery questionnaire for a risk/insurance request."""
    from ai.runtime.stage_runner import StageResult  # noqa: PLC0415

    constraints = load_constraints_from_intake(intake_json, goal=need)
    plan = Plan(goal=need, active_stage="questionnaire", input_revision=0)
    budget = Budget(
        web_search_max=int(getattr(settings, "agent_stage_web_search_max", 1) or 1)
    )
    runner = StageRunner(plan=plan, constraints=constraints, budget=budget)
    prompt_vars = await runner.build_vars(
        include_world=True,
        allow_web_enrich=True,
        enrich_query=need,
    )
    _, prompt_version = runner.render_prompt(AIUseCase.POLICY_INTAKE, prompt_vars)

    prompt = f"风险诉求：{need}"
    if known_profile:
        known = "\n".join(f"- {key}: {value}" for key, value in known_profile.items())
        prompt = f"{prompt}\n\n已知画像（无需重复提问）：\n{known}"
    hints = constraints.hints_block()
    if hints:
        prompt = f"{prompt}\n\n{hints}"
    result = await ai_client.generate(
        AIUseCase.POLICY_INTAKE,
        prompt,
        RiskQuestionnaire,
        prompt_vars=prompt_vars,
    )
    _ = StageResult(
        output=result,
        prompt_version=prompt_version,
        enrich_used=budget.web_search_used > 0,
    )
    return result
