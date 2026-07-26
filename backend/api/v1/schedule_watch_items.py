import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import CurrentUser, get_current_user
from models.schedule_watch_item import ScheduleWatchItem
from schemas.schedule_watch_item import (
    ScheduleWatchItemCreateIn,
    ScheduleWatchItemOut,
    ScheduleWatchItemUpdateIn,
)
from services import schedule_watch_item_service

router = APIRouter(prefix="/schedule-watch-items", tags=["schedule-watch-items"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="schedule_watch_item_not_found"
)


async def _owned_or_404(
    db: AsyncSession, user: CurrentUser, item_id: uuid.UUID
) -> ScheduleWatchItem:
    item = await schedule_watch_item_service.get_owned_watch_item(
        db, user_id=user.id, item_id=item_id
    )
    if item is None:
        raise _NOT_FOUND
    return item


@router.post(
    "", response_model=ScheduleWatchItemOut, status_code=status.HTTP_201_CREATED
)
async def create_watch_item(
    payload: ScheduleWatchItemCreateIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScheduleWatchItem:
    return await schedule_watch_item_service.create_watch_item(
        db,
        user_id=current_user.id,
        title=payload.title,
        notes=payload.notes,
        due_on=payload.due_on,
        href=payload.href,
        policy_id=payload.policy_id,
        color=payload.color,
    )


@router.get("", response_model=list[ScheduleWatchItemOut])
async def list_watch_items(
    include_archived: bool = Query(False),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ScheduleWatchItem]:
    return await schedule_watch_item_service.list_watch_items(
        db,
        user_id=current_user.id,
        include_archived=include_archived,
        limit=limit,
        offset=offset,
    )


@router.get("/{item_id}", response_model=ScheduleWatchItemOut)
async def get_watch_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScheduleWatchItem:
    return await _owned_or_404(db, current_user, item_id)


@router.patch("/{item_id}", response_model=ScheduleWatchItemOut)
async def update_watch_item(
    item_id: uuid.UUID,
    payload: ScheduleWatchItemUpdateIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScheduleWatchItem:
    item = await _owned_or_404(db, current_user, item_id)
    fields_set = payload.model_fields_set
    return await schedule_watch_item_service.update_watch_item(
        db,
        item,
        title=payload.title,
        notes=payload.notes,
        set_notes="notes" in fields_set,
        due_on=payload.due_on,
        clear_due_on=payload.clear_due_on,
        href=payload.href,
        clear_href=payload.clear_href,
        policy_id=payload.policy_id,
        clear_policy_id=payload.clear_policy_id,
        color=payload.color,
        archived=payload.archived,
    )


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watch_item(
    item_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    item = await _owned_or_404(db, current_user, item_id)
    await schedule_watch_item_service.delete_watch_item(db, item)
