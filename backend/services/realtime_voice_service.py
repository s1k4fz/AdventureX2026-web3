"""Authenticated, constrained proxy for StepFun's Realtime WebSocket API."""

import asyncio
import base64
import binascii
import json
import re
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any
from urllib.parse import urlencode

from fastapi import WebSocket
from pydantic import ValidationError
from websockets.asyncio.client import ClientConnection, connect

from core.config import settings
from schemas.realtime import RealtimeProxyAuth

_VOICE_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_EVENT_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_INPUT_SAMPLE_RATE_HZ = 24_000
_INPUT_FRAME_DURATION_MS = 30
_NO_PAYLOAD_EVENTS = frozenset(
    {
        "input_audio_buffer.commit",
        "input_audio_buffer.clear",
        "response.create",
        "response.cancel",
    }
)

_active_sessions: defaultdict[uuid.UUID, int] = defaultdict(int)
_active_sessions_lock = asyncio.Lock()


class RealtimeProtocolError(ValueError):
    """A browser frame violates the Lemma realtime proxy contract."""


class RealtimeCapacityError(RuntimeError):
    """The authenticated user has too many live realtime sessions."""


class RealtimeUpstreamClosedError(RuntimeError):
    """The provider socket ended while the browser session was still active."""


def origin_allowed(origin: str | None) -> bool:
    if not settings.realtime_proxy_require_origin:
        return True
    return origin is not None and origin in settings.cors_origins_list


def parse_proxy_auth(raw: str) -> RealtimeProxyAuth:
    if len(raw.encode("utf-8")) > settings.realtime_proxy_max_message_bytes:
        raise RealtimeProtocolError("auth frame is too large")
    try:
        return RealtimeProxyAuth.model_validate_json(raw)
    except ValidationError as exc:
        raise RealtimeProtocolError("first frame must be proxy.auth") from exc


def build_upstream_url() -> str:
    separator = "&" if "?" in settings.stepfun_realtime_base_url else "?"
    return (
        f"{settings.stepfun_realtime_base_url}{separator}"
        f"{urlencode({'model': settings.stepfun_realtime_model})}"
    )


def default_session_update() -> str:
    return _dump(
        {
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": settings.stepfun_realtime_instructions,
                "voice": settings.stepfun_realtime_voice,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "turn_detection": {
                    "type": "server_vad",
                    "prefix_padding_ms": 500,
                },
            },
        }
    )


def sanitize_client_event(raw: str) -> str:
    """Validate a browser event and return the exact safe upstream JSON.

    Realtime tools and arbitrary conversation injection are intentionally not
    proxied. This endpoint is a voice-input boundary, not a generic StepFun API
    tunnel.
    """
    if len(raw.encode("utf-8")) > settings.realtime_proxy_max_message_bytes:
        raise RealtimeProtocolError("event is too large")
    try:
        event = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RealtimeProtocolError("event must be valid JSON") from exc
    if not isinstance(event, dict):
        raise RealtimeProtocolError("event must be a JSON object")

    event_type = event.get("type")
    event_id = _sanitize_event_id(event.get("event_id"))
    if event_type == "session.update":
        safe = _sanitize_session_update(event)
    elif event_type == "input_audio_buffer.append":
        safe = _sanitize_audio_append(event)
    elif event_type in _NO_PAYLOAD_EVENTS:
        _reject_unknown_keys(event, {"type", "event_id"})
        safe = {"type": event_type}
    else:
        raise RealtimeProtocolError(f"unsupported client event: {event_type!r}")

    if event_id is not None:
        safe["event_id"] = event_id
    return _dump(safe)


def proxy_ready_event() -> dict[str, Any]:
    return {
        "type": "proxy.ready",
        "model": settings.stepfun_realtime_model,
        "audioFormat": "pcm16",
        "sampleRateHz": _INPUT_SAMPLE_RATE_HZ,
        "frameDurationMs": _INPUT_FRAME_DURATION_MS,
        "serverVad": True,
        "maxSessionSeconds": settings.realtime_proxy_max_session_seconds,
    }


def proxy_error_event(code: str, message: str) -> dict[str, str]:
    return {"type": "proxy.error", "code": code, "message": message}


@asynccontextmanager
async def reserve_session(user_id: uuid.UUID) -> AsyncIterator[None]:
    async with _active_sessions_lock:
        if _active_sessions[user_id] >= settings.realtime_proxy_max_sessions_per_user:
            raise RealtimeCapacityError
        _active_sessions[user_id] += 1
    try:
        yield
    finally:
        async with _active_sessions_lock:
            _active_sessions[user_id] -= 1
            if _active_sessions[user_id] <= 0:
                _active_sessions.pop(user_id, None)


async def relay_realtime(websocket: WebSocket) -> None:
    """Open the provider socket and relay validated events in both directions."""
    async with connect(
        build_upstream_url(),
        additional_headers={
            "Authorization": f"Bearer {settings.stepfun_api_key}",
        },
        open_timeout=10,
        close_timeout=5,
        ping_interval=20,
        ping_timeout=20,
        max_size=settings.realtime_proxy_max_message_bytes,
        max_queue=16,
    ) as upstream:
        # The backend owns a secure default session. The frontend may update the
        # documented safe subset later, before the first audio response.
        await upstream.send(default_session_update())
        await websocket.send_json(proxy_ready_event())
        await _relay_until_closed(websocket, upstream)


async def _relay_until_closed(websocket: WebSocket, upstream: ClientConnection) -> None:
    browser_to_provider = asyncio.create_task(
        _relay_browser_to_provider(websocket, upstream)
    )
    provider_to_browser = asyncio.create_task(
        _relay_provider_to_browser(websocket, upstream)
    )
    tasks = {browser_to_provider, provider_to_browser}
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in pending:
        with suppress(asyncio.CancelledError):
            await task
    for task in done:
        task.result()
    if provider_to_browser in done:
        # websockets treats a normal upstream 1000/1001 close as clean iterator
        # exhaustion. It is still unexpected while the browser session is live
        # and must become a stable proxy error rather than a silent 1000 close.
        raise RealtimeUpstreamClosedError


async def _relay_browser_to_provider(
    websocket: WebSocket, upstream: ClientConnection
) -> None:
    while True:
        raw = await websocket.receive_text()
        await upstream.send(sanitize_client_event(raw))


async def _relay_provider_to_browser(
    websocket: WebSocket, upstream: ClientConnection
) -> None:
    async for raw in upstream:
        if not isinstance(raw, str):
            raise RealtimeProtocolError("provider returned a binary frame")
        if len(raw.encode("utf-8")) > settings.realtime_proxy_max_message_bytes:
            raise RealtimeProtocolError("provider event is too large")
        # Confirm it is JSON before exposing it. The provider's event object is
        # otherwise relayed unchanged so the frontend follows official names.
        json.loads(raw)
        await websocket.send_text(raw)


def _sanitize_event_id(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not _EVENT_ID_RE.fullmatch(value):
        raise RealtimeProtocolError("invalid event_id")
    return value


def _sanitize_session_update(event: dict[str, Any]) -> dict[str, Any]:
    _reject_unknown_keys(event, {"type", "event_id", "session"})
    session = event.get("session")
    if not isinstance(session, dict):
        raise RealtimeProtocolError("session.update requires session")
    allowed = {
        "modalities",
        "instructions",
        "voice",
        "input_audio_format",
        "output_audio_format",
        "turn_detection",
    }
    _reject_unknown_keys(session, allowed)

    safe: dict[str, Any] = {}
    if "modalities" in session:
        if session["modalities"] != ["text", "audio"]:
            raise RealtimeProtocolError('modalities must be ["text", "audio"]')
        safe["modalities"] = ["text", "audio"]
    if "instructions" in session:
        instructions = session["instructions"]
        if not isinstance(instructions, str) or not 1 <= len(instructions) <= 8_000:
            raise RealtimeProtocolError("instructions must be 1-8000 characters")
        safe["instructions"] = instructions
    if "voice" in session:
        voice = session["voice"]
        if not isinstance(voice, str) or not _VOICE_RE.fullmatch(voice):
            raise RealtimeProtocolError("invalid voice")
        safe["voice"] = voice
    for field in ("input_audio_format", "output_audio_format"):
        if field in session:
            if session[field] != "pcm16":
                raise RealtimeProtocolError(f"{field} must be pcm16")
            safe[field] = "pcm16"
    if "turn_detection" in session:
        safe["turn_detection"] = _sanitize_turn_detection(session["turn_detection"])
    return {"type": "session.update", "session": safe}


def _sanitize_turn_detection(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise RealtimeProtocolError("turn_detection must be an object or null")
    allowed = {
        "type",
        "prefix_padding_ms",
        "silence_duration_ms",
        "energy_awakeness_threshold",
    }
    _reject_unknown_keys(value, allowed)
    if value.get("type") != "server_vad":
        raise RealtimeProtocolError("turn_detection.type must be server_vad")
    safe: dict[str, Any] = {"type": "server_vad"}
    ranges = {
        "prefix_padding_ms": (0, 5_000),
        "silence_duration_ms": (100, 5_000),
        "energy_awakeness_threshold": (0, 5_000),
    }
    for field, (minimum, maximum) in ranges.items():
        if field not in value:
            continue
        number = value[field]
        if (
            not isinstance(number, int)
            or isinstance(number, bool)
            or not minimum <= number <= maximum
        ):
            raise RealtimeProtocolError(
                f"{field} must be an integer in {minimum}..{maximum}"
            )
        safe[field] = number
    return safe


def _sanitize_audio_append(event: dict[str, Any]) -> dict[str, Any]:
    _reject_unknown_keys(event, {"type", "event_id", "audio"})
    audio = event.get("audio")
    if not isinstance(audio, str) or not audio:
        raise RealtimeProtocolError("audio must be non-empty base64")
    try:
        decoded = base64.b64decode(audio, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RealtimeProtocolError("audio must be valid base64") from exc
    if not decoded:
        raise RealtimeProtocolError("audio must not be empty")
    if len(decoded) % 2:
        raise RealtimeProtocolError("pcm16 audio must contain complete samples")
    if len(decoded) > settings.realtime_proxy_max_audio_chunk_bytes:
        raise RealtimeProtocolError("audio chunk is too large")
    return {"type": "input_audio_buffer.append", "audio": audio}


def _reject_unknown_keys(value: dict[str, Any], allowed: set[str]) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise RealtimeProtocolError(f"unsupported fields: {', '.join(sorted(unknown))}")


def _dump(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


__all__ = [
    "RealtimeCapacityError",
    "RealtimeProtocolError",
    "RealtimeUpstreamClosedError",
    "build_upstream_url",
    "default_session_update",
    "origin_allowed",
    "parse_proxy_auth",
    "proxy_error_event",
    "proxy_ready_event",
    "relay_realtime",
    "reserve_session",
    "sanitize_client_event",
]
