"""HUD card feed: aggregate four read-only sources into short-text cards.

Pure mapping helpers (`*_cards`) are separated from I/O (`collect_cards`,
`stream_hud_events`) so the card wording and clipping stay unit-testable.
Any single source failing only logs a warning and drops that source for the
tick — the stream itself never breaks (same tolerance as api/v1/health.py).

Diffing is per-connection: a fingerprint of each card's rendered content
(everything except `ts`) decides whether an incremental `card` event is
worth pushing, so an idle HUD stays silent between heartbeats.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import shielded_session
from models.agent_task import AgentRun, AgentStep, AgentTask
from models.policy import Policy
from models.schedule_watch_item import ScheduleWatchItem
from schemas.hud import (
    HUD_BODY_MAX_CHARS,
    HUD_TITLE_MAX_CHARS,
    HudCardOut,
    HudCardRef,
    HudSnapshotOut,
)
from services import agent_event_service

logger = logging.getLogger("lemma.services.hud_feed")

_PRIORITY_ORDER = {"urgent": 0, "high": 1, "normal": 2, "low": 3}

# Human wording for the policy lifecycle states a HUD card can meet
# (open-but-unsettled policies are 'active' in practice; keep the map total
# anyway so a card never renders a raw enum).
_POLICY_STATUS_LABELS = {
    "intake": "问卷中",
    "composing": "方案生成中",
    "proposed": "待确认",
    "funded": "已注资",
    "active": "保障中",
    "settled": "已结算",
    "failed": "失败",
}

_TASK_STATUS_LABELS = {
    "running": "研究中",
    "waiting_user": "等待你确认",
}

# --- 眼镜端文案汉化（HUD 只有两行绿色单色文本，英文原串不友好）---

_FEAR_GREED_LABELS = {
    "extreme fear": "极度恐惧",
    "fear": "恐惧",
    "neutral": "中性",
    "greed": "贪婪",
    "extreme greed": "极度贪婪",
}

_RISK_REGION_LABELS = {
    "global": "全球",
    "us": "美国",
    "usa": "美国",
    "united states": "美国",
    "china": "中国",
    "europe": "欧洲",
    "eu": "欧洲",
    "asia": "亚洲",
    "middle east": "中东",
    "russia": "俄罗斯",
    "ukraine": "乌克兰",
    "taiwan": "台湾",
    "korea": "朝鲜半岛",
    "japan": "日本",
    "india": "印度",
    "latam": "拉美",
    "africa": "非洲",
}

_RISK_LEVEL_LABELS = {
    "critical": "危急",
    "severe": "严重",
    "high": "高",
    "elevated": "偏高",
    "medium": "中",
    "moderate": "中",
    "low": "低",
    "watch": "关注",
}

# 预测/要闻/宏观信号的补位卡标题（top_risks 之外的世界信号）
_SIGNAL_KIND_TITLES = {
    "prediction": "预测市场",
    "news": "要闻",
    "macro": "宏观",
}


def _risk_grade(score: float | None) -> str:
    """0-100 风险分 -> 中文档位（无分时返空串，由 level 文案兑底）."""
    if score is None:
        return ""
    if score >= 75:
        return "高"
    if score >= 50:
        return "中高"
    if score >= 25:
        return "中低"
    return "低"


def _trend_arrow(trend: str | None) -> str:
    if not trend:
        return ""
    lowered = trend.lower()
    if "up" in lowered or "ris" in lowered or "worsen" in lowered:
        return " ↑"
    if "down" in lowered or "fall" in lowered or "improv" in lowered:
        return " ↓"
    return ""


def _prediction_pct(value: str | None) -> str:
    """预测市场价 -> 百分比文本（兼容 0-1 与 0-100 两种量纲；非数字原样返回）."""
    raw = (value or "").strip()
    try:
        num = float(raw)
    except ValueError:
        return raw
    if 0 <= num <= 1:
        return f"{num * 100:.0f}%"
    if 1 < num <= 100:
        return f"{num:.0f}%"
    return raw


def _clip(text: str, limit: int) -> str:
    """Single choke point for HUD text: strip, collapse, hard-cap with …."""
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1] + "…"


def card_fingerprint(card: HudCardOut) -> tuple[str, ...]:
    """Rendered-content identity; `ts` excluded so idle polls push nothing."""
    return (card.kind, card.priority, card.title, card.body)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


# --- Pure mappers (one per source) ---


def world_cards(ctx, *, now_iso: str) -> list[HudCardOut]:
    """汉化后的世界情报卡：情绪 1 张 + top_risks 前 3 张 + 预测/要闻/宏观补位 2 张."""
    if ctx is None or ctx.freshness == "unavailable":
        return []
    cards: list[HudCardOut] = []
    if ctx.fear_greed is not None:
        raw_label = (ctx.fear_greed_label or "").strip()
        label = _FEAR_GREED_LABELS.get(raw_label.lower(), raw_label)
        body = f"恐惧贪婪 {ctx.fear_greed}/100"
        if label:
            body += f" · {label}"
        cards.append(
            HudCardOut(
                id="world:fear_greed",
                kind="world_signal",
                priority="normal",
                title=_clip("市场情绪", HUD_TITLE_MAX_CHARS),
                body=_clip(body, HUD_BODY_MAX_CHARS),
                ts=now_iso,
                ttl_seconds=600,
            )
        )
    for signal in list(ctx.top_risks)[:3]:
        region = (getattr(signal, "region", None) or signal.label or "").strip()
        region_cn = _RISK_REGION_LABELS.get(region.lower(), region)
        title = "全球风险" if region.lower() == "global" else f"风险·{region_cn}"
        value = (signal.value or "").strip()
        if "/" in value:
            # “64/100”形态：评分 + 中文档位（分档缺失时用 level 文案兑底）
            body = f"评分 {value}"
            grade = _risk_grade(getattr(signal, "score", None)) or _RISK_LEVEL_LABELS.get(
                (signal.detail or "").strip().lower(), ""
            )
            if grade:
                body += f" · {grade}"
        else:
            # 非评分形态（级别词/描述）：能汉化则汉化，否则原文
            body = _RISK_LEVEL_LABELS.get(value.lower(), value) or (signal.detail or "")
        body += _trend_arrow(getattr(signal, "trend", None))
        cards.append(
            HudCardOut(
                id=f"world:risk:{signal.id}",
                kind="world_signal",
                priority="normal",
                title=_clip(title, HUD_TITLE_MAX_CHARS),
                body=_clip(body, HUD_BODY_MAX_CHARS),
                ts=now_iso,
                ttl_seconds=600,
            )
        )
    # 补位：预测市场/要闻/宏观信号取前 2 条（低优先级，轮播尾部）
    extras = [
        s
        for s in getattr(ctx, "signals", [])
        if s.kind in _SIGNAL_KIND_TITLES
    ][:2]
    for sig in extras:
        label = (sig.label or "").strip()
        if sig.kind == "prediction":
            # 概率放最前：问题再长被截断也不丢关键数字
            pct = _prediction_pct(sig.value)
            body = f"{pct} · {label}" if pct else label
        else:
            body = " ".join(
                part for part in (label, (sig.value or "").strip()) if part
            )
        cards.append(
            HudCardOut(
                id=f"world:sig:{sig.id}",
                kind="world_signal",
                priority="low",
                title=_clip(_SIGNAL_KIND_TITLES[sig.kind], HUD_TITLE_MAX_CHARS),
                body=_clip(body or sig.detail, HUD_BODY_MAX_CHARS),
                ts=now_iso,
                ttl_seconds=600,
            )
        )
    return cards


def watch_cards(
    items: list[ScheduleWatchItem], *, now_iso: str
) -> list[HudCardOut]:
    cards: list[HudCardOut] = []
    for item in items:
        due = item.due_on.strftime("%m-%d") if item.due_on else ""
        cards.append(
            HudCardOut(
                id=f"watch_due:{item.id}",
                kind="watch_due",
                priority="high",
                title=_clip(f"盯盘到期 {due}".strip(), HUD_TITLE_MAX_CHARS),
                body=_clip(item.title, HUD_BODY_MAX_CHARS),
                ts=now_iso,
                ttl_seconds=1800,
                ref=HudCardRef(type="watch_item", id=str(item.id)),
            )
        )
    return cards


def task_cards(
    tasks: list[tuple[AgentTask, int, int]], *, now_iso: str
) -> list[HudCardOut]:
    """tasks: (task, done_steps, total_steps) triples for running tasks."""
    cards: list[HudCardOut] = []
    for task, done, total in tasks:
        waiting = task.status == "waiting_user"
        label = _TASK_STATUS_LABELS.get(task.status, task.status)
        progress = f" {done}/{total} 步" if total > 0 and not waiting else ""
        cards.append(
            HudCardOut(
                id=f"task:{task.id}",
                kind="agent_progress",
                priority="urgent" if waiting else "normal",
                title=_clip(label, HUD_TITLE_MAX_CHARS),
                body=_clip(f"{task.title}{progress}", HUD_BODY_MAX_CHARS),
                ts=now_iso,
                ttl_seconds=120,
                ref=HudCardRef(type="agent_task", id=str(task.id)),
            )
        )
    return cards


def policy_cards(policies: list[Policy], *, now_iso: str) -> list[HudCardOut]:
    cards: list[HudCardOut] = []
    for policy in policies:
        label = _POLICY_STATUS_LABELS.get(policy.status, policy.status)
        end = (
            f" 至 {policy.coverage_end.strftime('%m-%d')}"
            if policy.coverage_end
            else ""
        )
        cards.append(
            HudCardOut(
                id=f"policy:{policy.id}",
                kind="policy_status",
                priority="normal",
                title=_clip(f"保单·{label}", HUD_TITLE_MAX_CHARS),
                body=_clip(f"{policy.title}{end}", HUD_BODY_MAX_CHARS),
                ts=now_iso,
                ttl_seconds=900,
                ref=HudCardRef(type="policy", id=str(policy.id)),
            )
        )
    return cards


# --- I/O collectors ---


async def _fetch_world_cards(now_iso: str) -> list[HudCardOut]:
    from ai.worldmonitor import fetch_world_context  # noqa: PLC0415

    ctx = await fetch_world_context()
    return world_cards(ctx, now_iso=now_iso)


async def _fetch_watch_cards(
    db: AsyncSession, user_id: uuid.UUID, now_iso: str
) -> list[HudCardOut]:
    today = datetime.now(UTC).date()
    result = await db.execute(
        select(ScheduleWatchItem)
        .where(
            ScheduleWatchItem.user_id == user_id,
            ScheduleWatchItem.archived_at.is_(None),
            ScheduleWatchItem.due_on.is_not(None),
            ScheduleWatchItem.due_on <= today,
        )
        .order_by(ScheduleWatchItem.due_on.asc())
        .limit(10)
    )
    return watch_cards(list(result.scalars()), now_iso=now_iso)


async def _fetch_task_cards(
    db: AsyncSession, user_id: uuid.UUID, now_iso: str
) -> list[HudCardOut]:
    result = await db.execute(
        select(AgentTask)
        .where(
            AgentTask.user_id == user_id,
            AgentTask.status.in_(("running", "waiting_user")),
            AgentTask.archived_at.is_(None),
        )
        .order_by(AgentTask.updated_at.desc())
        .limit(5)
    )
    triples: list[tuple[AgentTask, int, int]] = []
    for task in result.scalars():
        run_row = await db.execute(
            select(AgentRun.id)
            .where(AgentRun.task_id == task.id)
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
        run_id = run_row.scalar_one_or_none()
        done = total = 0
        if run_id is not None:
            steps = await db.execute(
                select(AgentStep.status).where(AgentStep.run_id == run_id)
            )
            statuses = [row[0] for row in steps]
            total = len(statuses)
            done = sum(1 for s in statuses if s == "succeeded")
        triples.append((task, done, total))
    return task_cards(triples, now_iso=now_iso)


async def _fetch_policy_cards(
    db: AsyncSession, user_id: uuid.UUID, now_iso: str
) -> list[HudCardOut]:
    result = await db.execute(
        select(Policy)
        .where(
            Policy.user_id == user_id,
            Policy.opened_at.is_not(None),
            Policy.settle_tx.is_(None),
        )
        .order_by(Policy.updated_at.desc())
        .limit(10)
    )
    return policy_cards(list(result.scalars()), now_iso=now_iso)


async def collect_cards(
    db: AsyncSession, user_id: uuid.UUID
) -> list[HudCardOut]:
    """One aggregation tick. Tolerates any single source failing."""
    now_iso = _now_iso()
    cards: list[HudCardOut] = []
    # World context does its own HTTP + caching; DB sources share `db`.
    try:
        cards.extend(await _fetch_world_cards(now_iso))
    except Exception:  # noqa: BLE001
        logger.warning("hud feed: world source failed", exc_info=True)
    for name, fetch in (
        ("watch", _fetch_watch_cards),
        ("tasks", _fetch_task_cards),
        ("policies", _fetch_policy_cards),
    ):
        try:
            cards.extend(await fetch(db, user_id, now_iso))
        except Exception:  # noqa: BLE001
            logger.warning("hud feed: %s source failed", name, exc_info=True)
    cards.sort(key=lambda c: _PRIORITY_ORDER.get(c.priority, 9))
    return cards[: settings.hud_max_cards]


def _to_sse(event: str, payload: dict) -> str:
    return agent_event_service.to_sse(event, payload)


async def stream_hud_events(user_id: uuid.UUID) -> AsyncGenerator[str, None]:
    """SSE generator: snapshot once, then diffed cards + heartbeats forever."""
    seen: dict[str, tuple[str, ...]] = {}

    async with shielded_session() as db:
        cards = await collect_cards(db, user_id)
    snapshot = HudSnapshotOut(cards=cards, generated_at=_now_iso())
    yield _to_sse("snapshot", snapshot.model_dump(by_alias=True, mode="json"))
    seen = {card.id: card_fingerprint(card) for card in cards}

    heartbeat_every = settings.hud_heartbeat_interval_seconds
    poll_every = max(settings.hud_poll_interval_seconds, heartbeat_every)
    last_poll = asyncio.get_running_loop().time()

    while True:
        await asyncio.sleep(heartbeat_every)
        yield _to_sse("heartbeat", {"ts": _now_iso()})

        now = asyncio.get_running_loop().time()
        if now - last_poll < poll_every:
            continue
        last_poll = now
        try:
            async with shielded_session() as db:
                cards = await collect_cards(db, user_id)
        except Exception:  # noqa: BLE001
            logger.warning("hud feed: poll tick failed", exc_info=True)
            continue
        fresh = {card.id: card_fingerprint(card) for card in cards}
        for card in cards:
            if seen.get(card.id) != fresh[card.id]:
                yield _to_sse(
                    "card", card.model_dump(by_alias=True, mode="json")
                )
        seen = fresh
