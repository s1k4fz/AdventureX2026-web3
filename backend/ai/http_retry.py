"""Shared bounded-retry wrapper for httpx requests used by data collectors.

Both the WorldMonitor client and the market-data probes make idempotent GETs to
flaky upstreams. This primitive retries only transient failures (transport
errors, timeouts) and retryable status codes with exponential backoff + jitter,
then returns the final response (or raises the last transport exception).

It deliberately does NOT map status codes to business errors — each caller keeps
its own ``status -> error`` semantics, so existing behavior is preserved and this
helper stays reusable across the AI data-collection layer.
"""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Mapping
from typing import Any

import httpx

logger = logging.getLogger("lemma.ai.http_retry")

# 429 (rate limited) + 5xx (upstream/gateway hiccups) are worth a bounded retry;
# other 4xx are terminal verdicts the caller must map itself.
_DEFAULT_RETRY_STATUSES: tuple[int, ...] = (429, 500, 502, 503, 504)


async def request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    params: Mapping[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
    attempts: int = 3,
    backoff_base: float = 0.4,
    retry_statuses: tuple[int, ...] = _DEFAULT_RETRY_STATUSES,
) -> httpx.Response:
    """Issue a request with bounded retry on transient failures.

    Retries ``httpx.TransportError`` / ``httpx.TimeoutException`` and any status
    in ``retry_statuses`` (default 429 + 5xx) with exponential backoff + jitter.
    Non-retryable 4xx and any 2xx/3xx return immediately. After ``attempts``
    tries the last retryable response is returned; if every try raised a
    transport error, the last exception is re-raised.
    """
    attempts = max(1, attempts)
    last_exc: Exception | None = None
    last_response: httpx.Response | None = None

    for attempt in range(attempts):
        try:
            response = await client.request(
                method, url, params=params, headers=headers
            )
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            last_exc = exc
            last_response = None
        else:
            if response.status_code not in retry_statuses:
                return response
            last_response = response
            last_exc = None

        if attempt < attempts - 1:
            delay = backoff_base * (2**attempt) + random.uniform(0, backoff_base)
            logger.debug(
                "retrying %s %s (attempt %d/%d) after %.2fs",
                method,
                url,
                attempt + 1,
                attempts,
                delay,
            )
            await asyncio.sleep(delay)

    if last_response is not None:
        return last_response
    # attempts >= 1 guarantees at least one branch ran; if no response was ever
    # produced then every attempt raised a transport error.
    assert last_exc is not None
    raise last_exc
