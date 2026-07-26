"""Durable Agent Task event log + Redis notify for live SSE.

Events are the source of truth for reconnect. Redis only wakes subscribers;
API always reads Postgres by sequence (Last-Event-ID).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import AsyncSessionLocal
from models.agent_task import AgentEvent

logger = logging.getLogger("lemma.services.agent_event")


def channel_for(task_id: uuid.UUID) -> str:
    return f"agent:task:{task_id}"


def to_sse(event: str, data: dict[str, Any], *, event_id: int | None = None) -> str:
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append(f"data: {json.dumps(data, ensure_ascii=False)}")
    return "\n".join(lines) + "\n\n"


async def next_sequence(db: AsyncSession, *, task_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(AgentEvent.sequence), 0)).where(
            AgentEvent.task_id == task_id
        )
    )
    return int(result.scalar_one()) + 1


async def append_event(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    event_type: str,
    data: dict[str, Any],
    run_id: uuid.UUID | None = None,
) -> AgentEvent:
    """Append one durable event with advisory-locked sequence allocation."""
    # Serialize sequence allocation per task (Postgres advisory lock).
    lock_key = int(task_id.int % (2**63 - 1))
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock_key})
    sequence = await next_sequence(db, task_id=task_id)
    event = AgentEvent(
        task_id=task_id,
        run_id=run_id,
        sequence=sequence,
        event_type=event_type,
        data_json=data,
    )
    db.add(event)
    await db.flush()
    return event


async def publish_notify(task_id: uuid.UUID, sequence: int) -> None:
    """Wake SSE subscribers. Never raises — durability is Postgres."""
    client = aioredis.from_url(settings.redis_url)
    try:
        await client.publish(
            channel_for(task_id),
            json.dumps({"sequence": sequence}, ensure_ascii=False),
        )
    except Exception:  # noqa: BLE001
        logger.warning("agent event notify failed for task %s", task_id)
    finally:
        try:
            await client.aclose()
        except Exception:  # noqa: BLE001
            pass


async def append_and_notify(
    *,
    task_id: uuid.UUID,
    event_type: str,
    data: dict[str, Any],
    run_id: uuid.UUID | None = None,
) -> AgentEvent | None:
    """Own-session writer for workers / background tasks."""
    try:
        async with AsyncSessionLocal() as db:
            event = await append_event(
                db,
                task_id=task_id,
                event_type=event_type,
                data=data,
                run_id=run_id,
            )
            await db.commit()
            await db.refresh(event)
            await publish_notify(task_id, event.sequence)
            return event
    except Exception:  # noqa: BLE001 — projection must never break domain work
        logger.exception("failed to append agent event for task %s", task_id)
        return None


async def list_events_after(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    after_sequence: int = 0,
    limit: int = 500,
) -> list[AgentEvent]:
    result = await db.execute(
        select(AgentEvent)
        .where(
            AgentEvent.task_id == task_id,
            AgentEvent.sequence > after_sequence,
        )
        .order_by(AgentEvent.sequence.asc())
        .limit(limit)
    )
    return list(result.scalars())


async def latest_sequence(db: AsyncSession, *, task_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.coalesce(func.max(AgentEvent.sequence), 0)).where(
            AgentEvent.task_id == task_id
        )
    )
    return int(result.scalar_one())


async def subscribe_notify(
    task_id: uuid.UUID, *, poll_timeout: float = 1.0
) -> AsyncIterator[int | None]:
    """Yield notified sequence numbers; None on idle ticks."""
    channel = channel_for(task_id)
    client = aioredis.from_url(settings.redis_url)
    pubsub = client.pubsub()
    await pubsub.subscribe(channel)
    try:
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=poll_timeout
            )
            if message is None:
                yield None
                continue
            if message.get("type") != "message":
                continue
            raw = message.get("data")
            try:
                payload = json.loads(raw)
                seq = int(payload.get("sequence", 0))
            except (TypeError, ValueError, AttributeError):
                continue
            if seq > 0:
                yield seq
    finally:
        try:
            await asyncio.shield(pubsub.aclose())
            await asyncio.shield(client.aclose())
        except Exception:  # noqa: BLE001
            logger.warning("closing agent event subscription failed for %s", channel)


async def lock_next_sequence(db: AsyncSession, *, task_id: uuid.UUID) -> int:
    """Deprecated helper — `append_event` now owns advisory locking."""
    lock_key = int(task_id.int % (2**63 - 1))
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock_key})
    return await next_sequence(db, task_id=task_id)
