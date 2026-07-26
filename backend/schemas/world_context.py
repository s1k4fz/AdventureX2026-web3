"""Wire schemas for WorldMonitor global context."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class WorldSignalOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    kind: Literal["sentiment", "risk", "macro", "prediction", "news", "health"]
    label: str
    value: str
    detail: str = ""
    score: float | None = None
    region: str | None = None
    trend: str | None = None
    source: str = "worldmonitor"


class WorldContextOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    fetched_at: str
    freshness: Literal["fresh", "stale", "degraded", "unavailable"]
    source: Literal["live", "health_only", "cache", "unavailable"] = "unavailable"
    served_by: str | None = None
    summary: str = ""
    signals: list[WorldSignalOut] = Field(default_factory=list)
    fear_greed: int | None = None
    fear_greed_label: str | None = None
    top_risks: list[WorldSignalOut] = Field(default_factory=list)
    health_status: str | None = None
    error: str | None = None
