"""Controllable Agent Task control objects (Plan / Constraints / Budget / Revision).

These are first-class inputs to every StageRunner invocation. Domain workers
read them; only the Task adapter mutates Plan/Constraints/Revision. Budget is
enforced by StageRunner / settings.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

PolicyStage = Literal[
    "describe",
    "questionnaire",
    "market_search",
    "compose",
    "select_portfolio",
    "funding",
    "monitor",
]

RestartBoundary = Literal[
    "none",
    "questionnaire",
    "market_search",
    "compose",
    "monitoring_only",
]


@dataclass
class StageHint:
    revision: int
    text: str
    stage: PolicyStage | None = None
    source: Literal["free_text", "revise_goal"] = "free_text"

    def as_dict(self) -> dict[str, Any]:
        return {
            "revision": self.revision,
            "text": self.text,
            "stage": self.stage,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> StageHint:
        return cls(
            revision=int(raw.get("revision") or 0),
            text=str(raw.get("text") or ""),
            stage=raw.get("stage"),  # type: ignore[arg-type]
            source=raw.get("source") or "free_text",  # type: ignore[arg-type]
        )


@dataclass
class Constraints:
    goal: str
    stage_hints: list[StageHint] = field(default_factory=list)
    answers: dict[str, str] = field(default_factory=dict)
    monitoring_instructions: list[str] = field(default_factory=list)

    def hints_block(self, *, limit: int = 8) -> str:
        hints = [h for h in self.stage_hints if h.text.strip()][-limit:]
        if not hints:
            return ""
        lines = ["【用户阶段提示 · StageHints】"]
        for hint in hints:
            stage = hint.stage or "any"
            lines.append(f"- [r{hint.revision}/{stage}/{hint.source}] {hint.text}")
        return "\n".join(lines)

    def as_dict(self) -> dict[str, Any]:
        return {
            "goal": self.goal,
            "stageHints": [h.as_dict() for h in self.stage_hints],
            "answers": self.answers,
            "monitoringInstructions": list(self.monitoring_instructions),
        }


@dataclass
class Plan:
    """Outer control-plane snapshot for one Agent Task run."""

    goal: str
    active_stage: PolicyStage
    restart_boundary: RestartBoundary = "none"
    input_revision: int = 0
    confirmed_constraints: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = [
            f"目标：{self.goal}",
            f"活跃阶段：{self.active_stage}",
            f"revision：{self.input_revision}",
        ]
        if self.restart_boundary != "none":
            parts.append(f"重跑边界：{self.restart_boundary}")
        if self.confirmed_constraints:
            parts.append("已确认约束：" + "；".join(self.confirmed_constraints[-6:]))
        return "\n".join(parts)

    def as_dict(self) -> dict[str, Any]:
        return {
            "goal": self.goal,
            "activeStage": self.active_stage,
            "restartBoundary": self.restart_boundary,
            "inputRevision": self.input_revision,
            "confirmedConstraints": list(self.confirmed_constraints),
        }


@dataclass
class Budget:
    """Hard caps so stages fail controllably instead of hanging."""

    search_timeout_s: float = 120.0
    compose_timeout_s: float = 180.0
    web_search_max: int = 1
    tool_request_limit: int = 5
    web_search_used: int = 0

    def can_web_search(self) -> bool:
        return self.web_search_used < self.web_search_max

    def record_web_search(self) -> None:
        self.web_search_used += 1

    def budget_note(self) -> str:
        return (
            f"【执行预算】广搜墙钟 {self.search_timeout_s:.0f}s；"
            f"编排墙钟 {self.compose_timeout_s:.0f}s；"
            f"本阶段 web_search 剩余 "
            f"{max(0, self.web_search_max - self.web_search_used)} 次。"
        )


@dataclass
class StageContext:
    """Everything a stage agent may read (never mutates Plan/Revision itself)."""

    plan: Plan
    constraints: Constraints
    budget: Budget
    policy_id: str | None = None
    task_id: str | None = None
    prompt_version: str | None = None


def infer_active_stage(
    *,
    policy_status: str | None,
    search_status: str | None,
    step_statuses: dict[str, str] | None = None,
) -> PolicyStage:
    """Best-effort active stage from domain + step projection."""
    steps = step_statuses or {}
    for name in (
        "monitor",
        "funding",
        "select_portfolio",
        "compose",
        "market_search",
        "questionnaire",
        "describe",
    ):
        if steps.get(name) == "running":
            return name  # type: ignore[return-value]

    if policy_status in ("funded", "active", "settled"):
        return "monitor"
    if policy_status == "proposed":
        return "select_portfolio"
    if policy_status == "composing":
        return "compose"
    if policy_status == "intake":
        if search_status == "searching":
            return "market_search"
        return "questionnaire"
    return "describe"


def restart_boundary_for(
    *,
    active_stage: PolicyStage,
    input_type: Literal["free_text", "revise_goal"],
    policy_status: str,
) -> RestartBoundary:
    """Map Dock command + stage → safe restart boundary."""
    if policy_status in ("funded", "active", "settled"):
        return "monitoring_only"
    if active_stage in ("describe", "questionnaire"):
        return "questionnaire"
    if active_stage == "market_search":
        # revise_goal still keeps answered questionnaire when past intake.
        if policy_status == "intake":
            return "questionnaire" if input_type == "revise_goal" else "market_search"
        return "market_search"
    # Before confirm-open, a funding screen only represents a proposed plan:
    # new instructions must be allowed to invalidate it and return to compose.
    # Once funds are confirmed the status gate above makes input monitoring-only.
    if active_stage in ("compose", "select_portfolio", "funding"):
        return "compose"
    return "monitoring_only"


def load_constraints_from_intake(
    intake: dict[str, Any] | None, *, goal: str
) -> Constraints:
    raw = intake or {}
    hints_raw = raw.get("stageHints") or []
    hints: list[StageHint] = []
    if isinstance(hints_raw, list):
        for item in hints_raw:
            if isinstance(item, dict) and item.get("text"):
                hints.append(StageHint.from_dict(item))
    answers_raw = raw.get("answers") or {}
    answers = (
        {str(k): str(v) for k, v in answers_raw.items() if v is not None}
        if isinstance(answers_raw, dict)
        else {}
    )
    monitoring = [
        str(x).strip()
        for x in (raw.get("monitoringInstructions") or [])
        if str(x).strip()
    ]
    return Constraints(
        goal=goal,
        stage_hints=hints,
        answers=answers,
        monitoring_instructions=monitoring,
    )


def dump_stage_hints(hints: list[StageHint], *, limit: int = 12) -> list[dict[str, Any]]:
    return [h.as_dict() for h in hints[-limit:] if h.text.strip()]
