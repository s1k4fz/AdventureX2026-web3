"""Wire schemas for PandaAI financial context."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class PandaSignalOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    kind: str
    label: str
    value: str
    detail: str = ""
    symbol: str = ""
    as_of: str = ""


class PandaContextOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    source: Literal["pandaai", "unavailable", "disabled"] = "unavailable"
    freshness: str = "unknown"
    summary: str = ""
    signals: list[PandaSignalOut] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
    last_trade_date: str | None = None
    error: str | None = None
    latency_ms: int = 0


class PandaModuleInfoOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: str
    label: str
    description: str = ""


class PandaStatusOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    enabled: bool
    configured: bool
    modules: list[str] = Field(default_factory=list)
    available_modules: list[PandaModuleInfoOut] = Field(default_factory=list)

    @classmethod
    def from_status(cls, raw: dict[str, Any]) -> "PandaStatusOut":
        return cls.model_validate(raw)
