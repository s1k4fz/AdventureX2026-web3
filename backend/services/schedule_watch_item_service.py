"""Persistence and ownership for user schedule watch items."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.schedule_watch_item import ScheduleWatchItem

TITLE_MAX_CHARS = 120
NOTES_MAX_CHARS = 2000
HREF_MAX_CHARS = 500


async def create_watch_item(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    notes: str | None = None,
    due_on: date | None = None,
    href: str | None = None,
    policy_id: uuid.UUID | None = None,
    color: str = "blue",
) -> ScheduleWatchItem:
    item = ScheduleWatchItem(
        user_id=user_id,
        title=title,
        notes=notes,
        due_on=due_on,
        href=href,
        policy_id=policy_id,
        color=color,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def get_owned_watch_item(
    db: AsyncSession, *, user_id: uuid.UUID, item_id: uuid.UUID
) -> ScheduleWatchItem | None:
    result = await db.execute(
        select(ScheduleWatchItem).where(
            ScheduleWatchItem.id == item_id,
            ScheduleWatchItem.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def list_watch_items(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    include_archived: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[ScheduleWatchItem]:
    stmt = select(ScheduleWatchItem).where(ScheduleWatchItem.user_id == user_id)
    if not include_archived:
        stmt = stmt.where(ScheduleWatchItem.archived_at.is_(None))
    result = await db.execute(
        stmt.order_by(
            ScheduleWatchItem.sort_order.asc(),
            ScheduleWatchItem.due_on.asc().nulls_last(),
            ScheduleWatchItem.updated_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars())


async def update_watch_item(
    db: AsyncSession,
    item: ScheduleWatchItem,
    *,
    title: str | None = None,
    notes: str | None = None,
    set_notes: bool = False,
    due_on: date | None = None,
    clear_due_on: bool = False,
    href: str | None = None,
    clear_href: bool = False,
    policy_id: uuid.UUID | None = None,
    clear_policy_id: bool = False,
    color: str | None = None,
    archived: bool | None = None,
) -> ScheduleWatchItem:
    if title is not None:
        item.title = title
    if set_notes:
        item.notes = notes
    if clear_due_on:
        item.due_on = None
    elif due_on is not None:
        item.due_on = due_on
    if clear_href:
        item.href = None
    elif href is not None:
        item.href = href
    if clear_policy_id:
        item.policy_id = None
    elif policy_id is not None:
        item.policy_id = policy_id
    if color is not None:
        item.color = color
    if archived is True and item.archived_at is None:
        item.archived_at = datetime.now(timezone.utc)
    elif archived is False:
        item.archived_at = None

    await db.commit()
    await db.refresh(item)
    return item


async def delete_watch_item(db: AsyncSession, item: ScheduleWatchItem) -> None:
    await db.delete(item)
    await db.commit()
