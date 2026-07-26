"""Boundary types for PandaAI financial snapshots."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

PandaModule = Literal[
    "index",
    "index_ext",
    "futures",
    "futures_ext",
    "macro",
    "macro_pi",
    "macro_energy",
    "fx",
    "calendar",
]


class PandaSignal(BaseModel):
    kind: str
    label: str
    value: str
    detail: str = ""
    symbol: str = ""
    as_of: str = ""


class PandaContext(BaseModel):
    source: Literal["pandaai", "unavailable", "disabled"] = "unavailable"
    freshness: str = "unknown"
    summary: str = ""
    signals: list[PandaSignal] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
    last_trade_date: str | None = None
    error: str | None = None
    latency_ms: int = 0

    def as_prompt_block(self, *, max_signals: int = 12) -> str:
        if self.source == "disabled":
            return "【PandaAI】已关闭"
        if self.source != "pandaai":
            return f"【PandaAI】不可用：{self.error or 'unavailable'}"
        lines = [
            "【PandaAI 金融数据】",
            f"新鲜度：{self.freshness}",
        ]
        if self.last_trade_date:
            lines.append(f"最新交易日：{self.last_trade_date}")
        if self.summary:
            lines.append(self.summary)
        if self.signals:
            lines.append("要点：")
            for sig in self.signals[:max_signals]:
                bit = f"- [{sig.kind}] {sig.label}: {sig.value}"
                if sig.detail:
                    bit += f"（{sig.detail}）"
                lines.append(bit)
        return "\n".join(lines)

    def as_meta(self) -> dict[str, Any]:
        return {
            "provider": "pandaai",
            "source": self.source,
            "freshness": self.freshness,
            "modules": list(self.modules),
            "lastTradeDate": self.last_trade_date,
            "latencyMs": self.latency_ms,
            "resultCount": len(self.signals),
            "error": self.error,
        }
