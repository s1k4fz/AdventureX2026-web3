from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends

from core.config import settings
from core.security import CurrentUser, get_current_user

logger = logging.getLogger("lemma.api.health")

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# --- Data-collector health (WorldMonitor + prediction markets) ---
# Auth-gated + short-TTL cached so this observability probe can never become a
# free upstream-DoS lever. Surfaces per-source status for ops / UI dashboards.
_COLLECTORS_TTL_S = 30.0
_collectors_cache: dict[str, Any] = {}


@router.get("/health/collectors")
async def collectors_health(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Probe the two data-collection upstreams (WorldMonitor + Polymarket Gamma)."""
    del current_user  # auth gate only
    now = time.monotonic()
    cached_at = _collectors_cache.get("at")
    if isinstance(cached_at, float) and (now - cached_at) < _COLLECTORS_TTL_S:
        return _collectors_cache["data"]

    worldmonitor = await _probe_worldmonitor()
    markets = await _probe_markets()
    result: dict[str, Any] = {
        "worldmonitor": worldmonitor,
        "markets": markets,
        "ok": bool(worldmonitor["ok"] and markets["ok"]),
    }
    _collectors_cache["at"] = now
    _collectors_cache["data"] = result
    return result


async def _probe_worldmonitor() -> dict[str, Any]:
    from ai.worldmonitor import fetch_world_context  # noqa: PLC0415

    try:
        ctx = await fetch_world_context()
    except Exception:  # noqa: BLE001
        logger.warning("collectors health: worldmonitor probe failed", exc_info=True)
        return {
            "ok": False,
            "source": "unavailable",
            "served_by": None,
            "freshness": "unavailable",
            "health_status": None,
            "signals": 0,
        }
    return {
        "ok": ctx.source in ("live", "cache"),
        "source": ctx.source,
        "served_by": ctx.served_by,
        "freshness": ctx.freshness,
        "health_status": ctx.health_status,
        "signals": len(ctx.signals),
    }


async def _probe_markets() -> dict[str, Any]:
    from ai.http_retry import request_with_retry  # noqa: PLC0415

    base = settings.polymarket_gamma_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as http:
            resp = await request_with_retry(
                http, "GET", f"{base}/public-search", params={"q": "test"}
            )
    except httpx.HTTPError as exc:
        logger.warning("collectors health: gamma probe failed: %s", exc)
        return {
            "ok": False,
            "provider": "polymarket_gamma",
            "reachable": False,
            "status_code": None,
        }
    reachable = resp.status_code == 200
    return {
        "ok": reachable,
        "provider": "polymarket_gamma",
        "reachable": reachable,
        "status_code": resp.status_code,
    }
