"""API contracts for schedule watch items. Wire format is camelCase."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

ALLOWED_COLORS = frozenset(
    {"blue", "lilac", "orange", "green", "yellow", "red"}
)


class ScheduleWatchItemCreateIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    title: str = Field(min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    due_on: date | None = None
    href: str | None = Field(default=None, max_length=500)
    policy_id: uuid.UUID | None = None
    color: str = Field(default="blue", max_length=32)

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("title_required")
        return trimmed

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @field_validator("href")
    @classmethod
    def strip_href(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        color = value.strip().lower()
        if color not in ALLOWED_COLORS:
            raise ValueError("invalid_color")
        return color


class ScheduleWatchItemUpdateIn(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    due_on: date | None = None
    clear_due_on: bool = False
    href: str | None = Field(default=None, max_length=500)
    clear_href: bool = False
    policy_id: uuid.UUID | None = None
    clear_policy_id: bool = False
    color: str | None = Field(default=None, max_length=32)
    archived: bool | None = None

    @field_validator("title")
    @classmethod
    def strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("title_required")
        return trimmed

    @field_validator("notes")
    @classmethod
    def strip_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @field_validator("href")
    @classmethod
    def strip_href(cls, value: str | None) -> str | None:
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        color = value.strip().lower()
        if color not in ALLOWED_COLORS:
            raise ValueError("invalid_color")
        return color


class ScheduleWatchItemOut(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, from_attributes=True
    )

    id: uuid.UUID
    title: str
    notes: str | None
    due_on: date | None
    href: str | None
    policy_id: uuid.UUID | None
    color: str
    sort_order: int
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
