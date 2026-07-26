"""Market-provider usage accounting.

Sink: a structured JSON log line + a row in provider_usage_logs. Every call
gets a row, success or failure. A DB hiccup must never break a market search,
so persistence failures are logged and swallowed.

``ProviderUsageLog.course_id`` is a legacy nullable column; markets always
leave it NULL and attribute via ``use_case`` + ``trace_id``.
"""

import asyncio
import json
import logging
from decimal import Decimal

from core.database import AsyncSessionLocal
from models.provider_usage_log import ProviderUsageLog

logger = logging.getLogger("lemma.ai.markets.usage")


async def record_provider_call(
    *,
    trace_id: str,
    provider: str,
    actor_id: str | None = None,
    platform: str,
    use_case: str,
    success: bool,
    latency_ms: int,
    result_count: int | None = None,
    cost_usd: Decimal | None = None,
    run_id: str | None = None,
    error_type: str | None = None,
) -> None:
    record = {
        "provider": provider,
        "actor_id": actor_id,
        "platform": platform,
        "use_case": use_case,
        "run_id": run_id,
        "result_count": result_count,
        "cost_usd": cost_usd,
        "latency_ms": latency_ms,
        "success": success,
        "error_type": error_type,
        "trace_id": trace_id,
    }
    logger.info("provider_usage %s", json.dumps(record, ensure_ascii=False, default=str))
    await _persist(record)


async def _persist(record: dict) -> None:
    try:
        row = ProviderUsageLog(**record, course_id=None)
        async with asyncio.timeout(15):
            async with AsyncSessionLocal() as session:
                session.add(row)
                await session.commit()
    except Exception:  # noqa: BLE001 — the ledger must never break the search
        logger.exception(
            "failed to persist provider_usage_log row (trace_id=%s)",
            record["trace_id"],
        )
