"""Field-normalization primitives for market providers.

Tolerant helpers that never raise on bad input — a single odd field must never
sink a whole market search. Gamma returns some list fields (clobTokenIds,
outcomes, outcomePrices) as JSON-encoded strings OR as native lists depending
on the endpoint version; ``maybe_json_list`` handles both transparently.
"""

import json
from datetime import datetime
from typing import Any


def parse_float(value: Any) -> float | None:
    """Tolerant float parse: strings, None, blank -> float | None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def parse_iso_datetime(value: Any) -> datetime | None:
    """ISO 8601 datetime parse (tolerant). Handles "2026-11-05T00:00:00Z"."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def maybe_json_list(value: Any) -> list:
    """Parse a JSON-encoded string list OR pass through a native list.

    Gamma returns fields like clobTokenIds / outcomes / outcomePrices as either
    a real JSON array or a JSON-encoded string (e.g. '["Yes","No"]'). This
    helper normalizes both forms to a Python list. Never raises — returns []
    on any failure.
    """
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
    return []
