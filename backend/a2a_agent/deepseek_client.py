from __future__ import annotations

import asyncio
import logging

from openai import AsyncOpenAI, RateLimitError

from core.config import settings

logger = logging.getLogger("lemma.a2a_agent.deepseek_client")

_client: AsyncOpenAI | None = None

# Bounded 429 retries for light/intent DeepSeek Chat Completions (Spec §5 Ops).
_MAX_429_ATTEMPTS = 3
_429_BACKOFF_S = (0.5, 1.0, 2.0)


def get_deepseek_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.deepseek_api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is not set")
        # Own 429 backoff in create_chat_completion; disable SDK retry stacking.
        _client = AsyncOpenAI(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            max_retries=0,
        )
    return _client


def _is_http_429(exc: BaseException) -> bool:
    if isinstance(exc, RateLimitError):
        return True
    return getattr(exc, "status_code", None) == 429


async def create_chat_completion(**kwargs):
    """Chat Completions create with bounded retry on HTTP 429 only."""
    client = get_deepseek_client()
    # V4 defaults to thinking; small max_tokens then yield empty content.
    extra_body = dict(kwargs.get("extra_body") or {})
    if "thinking" not in extra_body:
        extra_body["thinking"] = {"type": "disabled"}
    kwargs["extra_body"] = extra_body
    last_exc: BaseException | None = None
    for attempt in range(_MAX_429_ATTEMPTS):
        try:
            return await client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001 — inspect then re-raise non-429
            if not _is_http_429(exc):
                raise
            last_exc = exc
            if attempt + 1 >= _MAX_429_ATTEMPTS:
                raise
            delay = _429_BACKOFF_S[min(attempt, len(_429_BACKOFF_S) - 1)]
            logger.warning(
                "DeepSeek chat 429 (attempt %s/%s); sleeping %.1fs",
                attempt + 1,
                _MAX_429_ATTEMPTS,
                delay,
            )
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc


async def chat_text(
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 1024,
) -> str:
    resp = await create_chat_completion(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()
