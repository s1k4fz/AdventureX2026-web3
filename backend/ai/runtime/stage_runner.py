"""StageRunner: controllable execution wrapper for policy stage agents.

Loads Plan/Constraints/Budget, builds harness prompt vars, optionally enriches
with one cached web_search, then runs structured generation with revision
checkpoints owned by the caller.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from ai.harness import build_prompt_vars
from ai.prompts.registry import render_system_prompt_meta
from ai.runtime.control import Budget, Constraints, Plan, StageContext
from ai.types import AIUseCase

logger = logging.getLogger("lemma.ai.runtime.stage_runner")

T = TypeVar("T")

IsCurrentFn = Callable[[], Awaitable[bool]]


@dataclass
class StageResult:
    output: Any
    prompt_version: str
    discarded: bool = False
    enrich_used: bool = False
    meta: dict[str, Any] | None = None


class StageRunner:
    """Thin orchestration helper shared by intake / search / compose stages."""

    def __init__(
        self,
        *,
        plan: Plan,
        constraints: Constraints,
        budget: Budget | None = None,
        policy_id: str | None = None,
        task_id: str | None = None,
    ) -> None:
        self.ctx = StageContext(
            plan=plan,
            constraints=constraints,
            budget=budget or Budget(),
            policy_id=policy_id,
            task_id=task_id,
        )

    async def build_vars(
        self,
        *,
        include_world: bool = True,
        allow_web_enrich: bool = False,
        enrich_query: str | None = None,
    ) -> dict[str, str]:
        extra_notes_parts: list[str] = []
        hints = self.ctx.constraints.hints_block()
        if hints:
            extra_notes_parts.append(hints)

        enrich_block = ""
        if allow_web_enrich and self.ctx.budget.can_web_search():
            query = (enrich_query or self.ctx.constraints.goal or "").strip()
            if query and _wants_timely_context(self.ctx.constraints):
                enrich_block = await _maybe_web_enrich(query, self.ctx.budget)
                if enrich_block:
                    extra_notes_parts.append(enrich_block)

        return await build_prompt_vars(
            include_world=include_world,
            extra_notes="\n\n".join(extra_notes_parts) or None,
            stage_hints=hints or None,
            plan_summary=self.ctx.plan.summary(),
            budget_note=self.ctx.budget.budget_note(),
        )

    def render_prompt(
        self, use_case: AIUseCase, variables: dict[str, str] | None = None
    ) -> tuple[str, str]:
        text, version = render_system_prompt_meta(use_case, variables)
        self.ctx.prompt_version = version
        return text, version

    async def ensure_current(self, is_current: IsCurrentFn | None) -> bool:
        if is_current is None:
            return True
        return await is_current()


def _wants_timely_context(constraints: Constraints) -> bool:
    blob = " ".join(
        [constraints.goal, *(h.text for h in constraints.stage_hints[-4:])]
    ).lower()
    keys = (
        "新闻",
        "最新",
        "今天",
        "本周",
        "政策",
        "公告",
        "美联储",
        "降息",
        "加息",
        "election",
        "fed",
        "breaking",
        "today",
        "news",
    )
    return any(k in blob for k in keys)


async def _maybe_web_enrich(query: str, budget: Budget) -> str:
    try:
        from ai.websearch import WebSearchQuery, web_search

        result = await web_search(
            WebSearchQuery(query=query[:200], count=5, summary=True, freshness="oneWeek")
        )
        budget.record_web_search()
        lines = ["【网页检索摘要 · web_search enrich】"]
        for item in result.results[:5]:
            snippet = (item.summary or item.snippet or "").strip()
            lines.append(f"- {item.title}: {snippet[:180]}")
        return "\n".join(lines) if len(lines) > 1 else ""
    except Exception:  # noqa: BLE001 — enrich is best-effort
        logger.warning("stage web_search enrich failed", exc_info=True)
        return ""
