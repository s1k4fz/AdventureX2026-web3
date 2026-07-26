"""User-defined schedule watch items (custom attention reminders)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import TIMESTAMP, UUID
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


class ScheduleWatchItem(Base):
    """A user-authored reminder shown in the schedule attention rail + calendar."""

    __tablename__ = "schedule_watch_items"
    __table_args__ = (
        Index(
            "ix_schedule_watch_items_user_id_updated_at",
            "user_id",
            "updated_at",
        ),
        Index(
            "ix_schedule_watch_items_user_id_due_on",
            "user_id",
            "due_on",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Calendar day (local product date). Null → left rail only, no calendar pin.
    due_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    href: Mapped[str | None] = mapped_column(String, nullable=True)
    # Optional soft link to a policy (not FK: domain tables already cascade).
    policy_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    color: Mapped[str] = mapped_column(
        String, nullable=False, server_default="blue"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        TIMESTAMP(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
