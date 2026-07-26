"""WorldMonitor global-intelligence boundary types (差分机 Agent 上下文)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Freshness = Literal["fresh", "stale", "degraded", "unavailable"]
SignalKind = Literal[
    "sentiment",
    "risk",
    "macro",
    "prediction",
    "news",
    "health",
]


class WorldSignal(BaseModel):
    """One cross-domain signal suitable for Agent prompts and UI chips."""

    id: str
    kind: SignalKind
    label: str
    value: str
    detail: str = ""
    score: float | None = None
    region: str | None = None
    trend: str | None = None
    source: str = "worldmonitor"


class WorldContext(BaseModel):
    """Normalized global context snapshot for Agent + policy UI."""

    fetched_at: str
    freshness: Freshness
    source: Literal["live", "health_only", "cache", "unavailable"] = "unavailable"
    # Which upstream base actually served this snapshot ("primary"/"cloud"), for
    # attribution when the local→cloud fallback chain kicks in. None when nothing
    # answered.
    served_by: str | None = None
    summary: str = ""
    signals: list[WorldSignal] = Field(default_factory=list)
    fear_greed: int | None = None
    fear_greed_label: str | None = None
    top_risks: list[WorldSignal] = Field(default_factory=list)
    health_status: str | None = None
    error: str | None = None

    def as_prompt_block(self, *, max_signals: int = 12) -> str:
        """Render a compact block for compose / chat prompt injection."""
        lines = [
            "【全球情报上下文 · WorldMonitor】",
            f"新鲜度：{self.freshness} · 来源：{self.source} · 拉取时间：{self.fetched_at}",
        ]
        if self.health_status:
            lines.append(f"数据管道：{self.health_status}")
        if self.served_by:
            lines.append(f"数据源：{self.served_by}")
        if self.summary:
            lines.append(f"摘要：{self.summary}")
        if self.fear_greed is not None:
            label = self.fear_greed_label or ""
            lines.append(f"市场情绪 Fear&Greed：{self.fear_greed}/100 {label}".rstrip())
        if self.top_risks:
            lines.append("高风险区域：")
            for sig in self.top_risks[:5]:
                trend = f" ({sig.trend})" if sig.trend else ""
                lines.append(f"- {sig.label}: {sig.value}{trend}")
        if self.signals:
            lines.append("关键信号：")
            for sig in self.signals[:max_signals]:
                extra = f" — {sig.detail}" if sig.detail else ""
                lines.append(f"- [{sig.kind}] {sig.label}: {sig.value}{extra}")
        if self.error:
            lines.append(f"备注：{self.error}")
        lines.append(
            "编排组合时请参考以上全球信号与候选市场的关联性；"
            "若信号不足，以问卷画像与候选市场为准。"
        )
        return "\n".join(lines)
