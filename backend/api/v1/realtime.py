"""Browser-safe WebSocket boundary for StepFun Realtime voice."""

import asyncio
import logging
from contextlib import suppress

from fastapi import APIRouter, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

from core.config import settings
from core.security import authenticate_access_token
from services.realtime_voice_service import (
    RealtimeCapacityError,
    RealtimeProtocolError,
    RealtimeUpstreamClosedError,
    origin_allowed,
    parse_proxy_auth,
    proxy_error_event,
    relay_realtime,
    reserve_session,
)

logger = logging.getLogger("lemma.realtime")

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.websocket("/voice")
async def realtime_voice_proxy(websocket: WebSocket) -> None:
    """Authenticate the browser, then proxy a constrained StepFun WS session."""
    await websocket.accept()
    if not origin_allowed(websocket.headers.get("origin")):
        await _send_and_close(
            websocket,
            code="origin_not_allowed",
            message="WebSocket origin is not allowed",
            close_code=4403,
        )
        return

    try:
        async with asyncio.timeout(settings.realtime_proxy_auth_timeout_seconds):
            auth = parse_proxy_auth(await websocket.receive_text())
    except TimeoutError:
        await _send_and_close(
            websocket,
            code="auth_timeout",
            message="Authentication frame timed out",
            close_code=4401,
        )
        return
    except (RealtimeProtocolError, WebSocketDisconnect):
        await _send_and_close(
            websocket,
            code="invalid_auth",
            message="The first frame must authenticate the session",
            close_code=4401,
        )
        return

    try:
        user = await authenticate_access_token(auth.access_token)
    except HTTPException as exc:
        unavailable = exc.status_code == 503
        await _send_and_close(
            websocket,
            code="auth_unavailable" if unavailable else "invalid_auth",
            message=(
                "Authentication service is temporarily unavailable"
                if unavailable
                else "Invalid or expired access token"
            ),
            close_code=1013 if unavailable else 4401,
        )
        return

    # Provider availability is intentionally checked only after the first-frame
    # Supabase token has been verified. Unauthenticated clients must not learn
    # backend provider configuration.
    if not settings.stepfun_api_key:
        await _send_and_close(
            websocket,
            code="provider_not_configured",
            message="Realtime voice is not configured",
            close_code=1011,
        )
        return

    try:
        async with reserve_session(user.id):
            async with asyncio.timeout(settings.realtime_proxy_max_session_seconds):
                await relay_realtime(websocket)
    except RealtimeCapacityError:
        await _send_and_close(
            websocket,
            code="too_many_sessions",
            message="Too many realtime sessions",
            close_code=1013,
        )
    except TimeoutError:
        await _send_and_close(
            websocket,
            code="session_expired",
            message="Realtime session reached its time limit",
            close_code=1000,
        )
    except RealtimeProtocolError:
        await _send_and_close(
            websocket,
            code="invalid_event",
            message="Realtime event violates the proxy contract",
            close_code=1008,
        )
    except WebSocketDisconnect:
        return
    except (ConnectionClosed, RealtimeUpstreamClosedError):
        await _send_and_close(
            websocket,
            code="upstream_unavailable",
            message="Realtime voice service is temporarily unavailable",
            close_code=1011,
        )
    except Exception:
        logger.exception("StepFun realtime proxy failed (user_id=%s)", user.id)
        await _send_and_close(
            websocket,
            code="upstream_unavailable",
            message="Realtime voice service is temporarily unavailable",
            close_code=1011,
        )


async def _send_and_close(
    websocket: WebSocket,
    *,
    code: str,
    message: str,
    close_code: int,
) -> None:
    with suppress(Exception):
        await websocket.send_json(proxy_error_event(code, message))
    with suppress(Exception):
        await websocket.close(code=close_code)
