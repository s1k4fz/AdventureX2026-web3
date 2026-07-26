"""Multi-source Subagent runtime for policy market_search collect.

Types are safe to import from ai.agents. Orchestrator is lazy-exported so
`from ai.runtime.subagents.types import …` does not pull ai.client.
"""

from ai.runtime.subagents.types import (
    ALL_KINDS,
    EvidencePack,
    SourceBrief,
    pack_from_intake,
)

__all__ = [
    "ALL_KINDS",
    "CollectResult",
    "EvidencePack",
    "SourceBrief",
    "SubagentOrchestrator",
    "pack_from_intake",
]


def __getattr__(name: str):
    if name in {"SubagentOrchestrator", "CollectResult"}:
        from ai.runtime.subagents.orchestrator import (  # noqa: PLC0415
            CollectResult,
            SubagentOrchestrator,
        )

        return {
            "SubagentOrchestrator": SubagentOrchestrator,
            "CollectResult": CollectResult,
        }[name]
    raise AttributeError(name)
