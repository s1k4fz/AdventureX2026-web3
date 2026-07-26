"""Boundary types for multi-source Subagent collection."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

SubagentKind = Literal[
    "polymarket",
    "world_monitor",
    "pandaai",
    "news",
    "web",
    "synthesizer",
]
SubagentStatus = Literal[
    "pending", "running", "succeeded", "failed", "skipped"
]

PARALLEL_KINDS: tuple[SubagentKind, ...] = (
    "polymarket",
    "world_monitor",
    "pandaai",
    "news",
    "web",
)
# Optional context sources. They now run alongside the market fast path so an
# unavailable/slow source never delays the first Polymarket request.
INTEL_KINDS: tuple[SubagentKind, ...] = (
    "world_monitor",
    "pandaai",
    "news",
    "web",
)
# Hard-gate market source (kept as a named group for UI/runtime semantics).
MARKET_KINDS: tuple[SubagentKind, ...] = ("polymarket",)
ALL_KINDS: tuple[SubagentKind, ...] = (*PARALLEL_KINDS, "synthesizer")

# Alias-first 工牌名 — keep in sync with frontend subagentIdentity.ts
KIND_LABELS: dict[SubagentKind, str] = {
    "polymarket": "行情侦察",
    "world_monitor": "全球瞭望",
    "pandaai": "量数观测",
    "news": "新闻猎手",
    "web": "网页探查",
    "synthesizer": "情报官",
}

KIND_ROLES: dict[SubagentKind, str] = {
    "polymarket": "预测市场",
    "world_monitor": "宏观信号",
    "pandaai": "金融数据",
    "news": "新闻检索",
    "web": "网页检索",
    "synthesizer": "多源汇总",
}

MAIN_AGENT_LABEL = "主理人"


class Citation(BaseModel):
    title: str
    url: str | None = None
    kind: SubagentKind | str = "news"
    snippet: str = ""


class SourceBrief(BaseModel):
    kind: SubagentKind
    status: SubagentStatus = "succeeded"
    summary: str = ""
    item_count: int = 0
    citations: list[Citation] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class SynthesizerOutput(BaseModel):
    """Structured LLM output for the synthesizer subagent."""

    brief: str = Field(description="5-12 line Chinese intel brief for compose")
    highlights: list[str] = Field(default_factory=list)


class EvidencePack(BaseModel):
    fetched_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat()
    )
    sources: list[SourceBrief] = Field(default_factory=list)
    brief: str = ""
    citations: list[Citation] = Field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    def as_prompt_block(self, *, max_citations: int = 12) -> str:
        lines = [
            "【多源情报采集 · EvidencePack】",
            f"采集时间：{self.fetched_at}",
        ]
        if self.brief.strip():
            lines.append(f"汇总要点：\n{self.brief.strip()}")
        if self.sources:
            lines.append("分源状态：")
            for src in self.sources:
                label = KIND_LABELS.get(src.kind, src.kind)  # type: ignore[arg-type]
                bit = f"- [{label}] {src.status}"
                if src.summary:
                    bit += f"：{src.summary[:220]}"
                if src.error_message:
                    bit += f"（{src.error_message[:120]}）"
                lines.append(bit)
        if self.citations:
            lines.append("引用：")
            for cite in self.citations[:max_citations]:
                url = f" <{cite.url}>" if cite.url else ""
                lines.append(f"- [{cite.kind}] {cite.title}{url}")
        return "\n".join(lines)

    def sources_wire(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for src in self.sources:
            meta = dict(src.meta or {})
            out.append(
                {
                    "kind": src.kind,
                    "status": src.status,
                    "summary": src.summary,
                    "itemCount": src.item_count,
                    "errorCode": src.error_code,
                    "errorMessage": src.error_message,
                    "provider": meta.get("provider"),
                    "fallbackFrom": meta.get("fallbackFrom"),
                    "latencyMs": meta.get("latencyMs"),
                    "meta": meta,
                    "citations": [
                        c.model_dump(mode="json") for c in src.citations[:8]
                    ],
                }
            )
        return out


def pack_from_intake(raw: dict[str, Any] | None) -> EvidencePack | None:
    if not raw:
        return None
    blob = raw.get("evidencePack") or raw.get("evidence_pack")
    if not isinstance(blob, dict):
        return None
    try:
        return EvidencePack.model_validate(blob)
    except Exception:  # noqa: BLE001
        return None
