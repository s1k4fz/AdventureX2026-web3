"""API contracts for the Rokid Glasses HUD card feed. Wire format is camelCase.

The HUD feed aggregates four read-only sources (world signals, due watch
items, running agent tasks, open policies) into short-text cards sized for
the glasses' monochrome CustomView (title fits one 16sp line, body two).

The body of GET /api/v1/hud/stream is an SSE stream, not JSON:

    event: snapshot   data: {"cards": [<HudCardOut>...], "generatedAt": "..."}
    event: card       data: {<HudCardOut>}          # add/update, keyed by id
    event: heartbeat  data: {"ts": "..."}           # every ~15s, liveness probe
    event: error      data: {"code": "...", "message": "..."}

Cards are transient: there is no Last-Event-ID replay. A reconnecting client
simply consumes the fresh `snapshot` and discards its local card cache.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# Server-side clipping limits — matched to the glasses text view built by
# DisplayCapabilityManager.buildTextViewTree (16sp, 16dp side paddings).
HUD_TITLE_MAX_CHARS = 24
HUD_BODY_MAX_CHARS = 60


class HudCardRef(BaseModel):
    """Optional deep link for the phone app (never rendered on the HUD)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    type: Literal["policy", "agent_task", "watch_item"]
    id: str


class HudCardOut(BaseModel):
    """One glanceable HUD card. `id` doubles as the client-side dedupe key."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    kind: Literal["world_signal", "watch_due", "agent_progress", "policy_status"]
    priority: Literal["urgent", "high", "normal", "low"] = "normal"
    title: str = Field(max_length=HUD_TITLE_MAX_CHARS)
    body: str = Field(default="", max_length=HUD_BODY_MAX_CHARS)
    ts: str
    ttl_seconds: int = 300
    ref: HudCardRef | None = None


class HudSnapshotOut(BaseModel):
    """Full card set sent once per connection (and consumed on reconnect)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    cards: list[HudCardOut] = Field(default_factory=list)
    generated_at: str
