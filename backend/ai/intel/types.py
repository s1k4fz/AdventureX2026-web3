"""Neutral intel item shape (not video candidates)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class IntelItem:
    title: str
    url: str | None = None
    snippet: str = ""
    published_at: str | None = None
    source_domain: str | None = None
