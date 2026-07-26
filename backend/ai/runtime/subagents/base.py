"""Subagent protocol + shared context."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from ai.runtime.control import Budget, Constraints, Plan
from ai.runtime.subagents.types import SourceBrief, SubagentKind

ProgressEmitter = Callable[[dict[str, Any]], Awaitable[None]]
CancelCheck = Callable[[], Awaitable[bool]]


@dataclass
class SubagentContext:
    kind: SubagentKind
    goal: str
    policy_id: uuid.UUID
    task_id: uuid.UUID | None
    run_id: uuid.UUID | None
    input_revision: int | None
    plan: Plan
    constraints: Constraints
    budget: Budget
    prompt_vars: dict[str, str] = field(default_factory=dict)
    # Filled by orchestrator after parallel sources finish (synthesizer only).
    prior_briefs: list[SourceBrief] = field(default_factory=list)
    # Polymarket report/candidates shared for terminal persist (set by runner).
    shared: dict[str, Any] = field(default_factory=dict)
    on_progress: ProgressEmitter | None = None
    is_cancelled: CancelCheck | None = None

    async def emit(self, data: dict[str, Any]) -> None:
        if self.on_progress is None:
            return
        await self.on_progress({"kind": self.kind, **data})

    async def cancelled(self) -> bool:
        if self.is_cancelled is None:
            return False
        return await self.is_cancelled()


class Subagent(Protocol):
    kind: SubagentKind

    async def run(self, ctx: SubagentContext) -> SourceBrief: ...
