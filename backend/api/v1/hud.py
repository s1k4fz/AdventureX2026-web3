"""Rokid Glasses HUD card feed (SSE). Protocol lives in schemas/hud.py."""

import secrets
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials

from core.config import settings
from core.security import CurrentUser, authenticate_access_token, bearer_scheme
from services import hud_feed_service

router = APIRouter(prefix="/hud", tags=["hud"])


async def get_hud_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    """Supabase Bearer auth, plus an opt-in dev bypass for glasses demos.

    The bypass is scoped to HUD routes only and requires BOTH hud_dev_token
    and hud_dev_user_id in .env; comparison is constant-time. HUD is read-only
    aggregation, so the blast radius of a leaked dev token is bounded.
    """
    if (
        credentials is not None
        and settings.hud_dev_token
        and settings.hud_dev_user_id
        and secrets.compare_digest(credentials.credentials, settings.hud_dev_token)
    ):
        return CurrentUser(id=uuid.UUID(settings.hud_dev_user_id), email=None)
    token = credentials.credentials if credentials else ""
    return await authenticate_access_token(token)


@router.get("/stream")
async def stream_hud_feed(
    current_user: CurrentUser = Depends(get_hud_user),
) -> StreamingResponse:
    """Aggregated short-text card stream for the glasses' monochrome HUD.

    Bearer auth via header (the Android client uses OkHttp, so there is no
    EventSource header restriction and no query-string token fallback).
    """
    return StreamingResponse(
        hud_feed_service.stream_hud_events(current_user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
