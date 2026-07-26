"""Kind → Subagent implementation registry."""

from __future__ import annotations

from ai.runtime.subagents.base import Subagent
from ai.runtime.subagents.news import NewsSubagent
from ai.runtime.subagents.pandaai import PandaAISubagent
from ai.runtime.subagents.polymarket import PolymarketSubagent
from ai.runtime.subagents.synthesizer import SynthesizerSubagent
from ai.runtime.subagents.types import SubagentKind
from ai.runtime.subagents.web import WebSubagent
from ai.runtime.subagents.world_monitor import WorldMonitorSubagent

_REGISTRY: dict[SubagentKind, Subagent] = {
    "polymarket": PolymarketSubagent(),
    "world_monitor": WorldMonitorSubagent(),
    "pandaai": PandaAISubagent(),
    "news": NewsSubagent(),
    "web": WebSubagent(),
    "synthesizer": SynthesizerSubagent(),
}


def get_subagent(kind: SubagentKind) -> Subagent:
    return _REGISTRY[kind]
