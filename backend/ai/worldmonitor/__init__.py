"""WorldMonitor global-intelligence facade for Agent context injection.

Local self-host (no cloud Pro key): see LOCAL.md in this package.
"""

from ai.worldmonitor.client import fetch_world_context
from ai.worldmonitor.types import WorldContext, WorldSignal

__all__ = [
    "WorldContext",
    "WorldSignal",
    "fetch_world_context",
]
