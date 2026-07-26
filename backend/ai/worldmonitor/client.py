"""Thin WorldMonitor REST client (bootstrap / health / market / intelligence).

Mirrors the official SDK patterns (User-Agent + X-WorldMonitor-Key) without
pulling the SDK as a hard dependency.

Auth model (important for local self-host):
- ``GET /api/health`` — always public.
- ``GET /api/bootstrap?tier=fast&public=1`` — public CDN/cache tier; **no**
  cloud ``wm_`` Pro key required. Works against cloud *and* a local Docker
  stack after seeders have run.
- Fear/greed + risk-score RPCs require either a cloud Pro key or a **local
  enterprise key** (``WORLDMONITOR_VALID_KEYS`` on the WM side). See LOCAL.md.

Gracefully degrades when upstream rejects or is unreachable.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from ai.http_retry import request_with_retry
from ai.worldmonitor.types import WorldContext, WorldSignal
from core.config import settings

logger = logging.getLogger("lemma.ai.worldmonitor")

_USER_AGENT = "xEngine/1.0 (+https://github.com/xengine-ai; worldmonitor-compatible)"
_CACHE_TTL_S = 120.0
_cache: dict[str, tuple[float, WorldContext]] = {}
_cache_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _headers(*, include_key: bool) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": _USER_AGENT,
    }
    key = (settings.worldmonitor_api_key or "").strip()
    if include_key and key:
        headers["X-WorldMonitor-Key"] = key
        headers["X-Api-Key"] = key
    return headers


def _bases() -> list[tuple[str, bool]]:
    """Ordered (base_url, key_applies) chain: primary first, cloud fallback.

    The optional API key applies to the PRIMARY only; the cloud public bootstrap
    needs no key. Cloud is appended when enabled and distinct from the primary.
    """
    primary = (settings.worldmonitor_api_base_url or "").rstrip("/")
    chain: list[tuple[str, bool]] = []
    if primary:
        chain.append((primary, True))
    if settings.worldmonitor_enable_cloud_fallback:
        cloud = (settings.worldmonitor_cloud_base_url or "").rstrip("/")
        if cloud and cloud != primary:
            chain.append((cloud, False))
    if not chain:
        # Defensive: never hand back an empty chain.
        chain.append(("https://api.worldmonitor.app", False))
    return chain


def _has_api_key() -> bool:
    return bool((settings.worldmonitor_api_key or "").strip())


async def _get_json(
    http: httpx.AsyncClient,
    base: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    include_key: bool = False,
) -> Any | None:
    url = f"{base}{path}"
    try:
        resp = await request_with_retry(
            http,
            "GET",
            url,
            params=params or {},
            headers=_headers(include_key=include_key),
        )
    except httpx.HTTPError as exc:
        logger.warning("worldmonitor GET %s%s failed: %s", base, path, exc)
        return None
    if resp.status_code == 401:
        logger.info("worldmonitor %s%s requires API key", base, path)
        return None
    if resp.status_code != 200:
        logger.warning(
            "worldmonitor GET %s%s returned %s", base, path, resp.status_code
        )
        return None
    try:
        return resp.json()
    except ValueError:
        return None


def _unwrap(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


def _parse_fear_greed(payload: Any) -> tuple[int | None, str | None]:
    data = _unwrap(payload)
    if not data:
        return None, None
    if data.get("unavailable") is True and data.get("compositeScore") in (0, None):
        # Local stack without seed-fear-greed yet.
        if not data.get("compositeLabel"):
            return None, None

    # RPC shape: {compositeScore, compositeLabel, ...}
    raw = data.get("compositeScore")
    if raw is None:
        index = data.get("index") if isinstance(data.get("index"), dict) else data
        if isinstance(index, dict):
            raw = index.get("value")
            if raw is None:
                raw = index.get("score")
            label = (
                index.get("classification")
                or index.get("label")
                or index.get("status")
                or data.get("compositeLabel")
            )
            try:
                value = int(float(raw)) if raw is not None else None
            except (TypeError, ValueError):
                value = None
            return value, str(label) if label else None
        return None, None

    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return None, None
    label = data.get("compositeLabel") or data.get("cnnLabel") or None
    return value, str(label) if label else None


def _risk_item_to_signal(item: dict[str, Any], *, prefix: str) -> WorldSignal | None:
    region = str(
        item.get("region")
        or item.get("country")
        or item.get("name")
        or ""
    ).strip()
    if not region:
        return None

    score_raw = item.get("score")
    if score_raw is None:
        score_raw = item.get("combinedScore")
    if score_raw is None:
        score_raw = item.get("dynamicScore")
    try:
        score = float(score_raw) if score_raw is not None else None
    except (TypeError, ValueError):
        score = None

    level = str(
        item.get("level")
        or item.get("severity")
        or item.get("advisoryLevel")
        or ""
    ).strip()
    trend = str(item.get("trend") or "").strip() or None
    # Proto enums often look like TREND_DIRECTION_RISING — shorten for prompts.
    if trend and trend.startswith("TREND_DIRECTION_"):
        trend = trend.removeprefix("TREND_DIRECTION_").lower()
    if level.startswith("SEVERITY_LEVEL_"):
        level = level.removeprefix("SEVERITY_LEVEL_").lower()

    value = f"{score:.0f}/100" if score is not None else (level or "n/a")
    return WorldSignal(
        id=f"{prefix}:{region.lower()}",
        kind="risk",
        label=region,
        value=value,
        detail=level,
        score=score,
        region=region,
        trend=trend,
        source="worldmonitor.intelligence",
    )


def _parse_risk_scores(payload: Any) -> list[WorldSignal]:
    data = _unwrap(payload)
    if not data:
        return []

    raw_list = (
        data.get("strategicRisks")
        or data.get("ciiScores")
        or data.get("scores")
        or data.get("risks")
        or data.get("items")
        or []
    )
    if not isinstance(raw_list, list):
        return []

    # Prefer strategicRisks when both exist (already ranked).
    if isinstance(data.get("strategicRisks"), list) and data["strategicRisks"]:
        raw_list = data["strategicRisks"]
        prefix = "risk"
    elif isinstance(data.get("ciiScores"), list):
        raw_list = data["ciiScores"]
        prefix = "cii"
    else:
        prefix = "risk"

    out: list[WorldSignal] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        sig = _risk_item_to_signal(item, prefix=prefix)
        if sig:
            out.append(sig)
    out.sort(key=lambda s: -(s.score or 0))
    return out


def _as_quote_list(raw: Any) -> list[dict[str, Any]]:
    """Normalize bootstrap quote envelopes: list | {quotes: list}."""
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if isinstance(raw, dict):
        inner = raw.get("quotes")
        if isinstance(inner, list):
            return [x for x in inner if isinstance(x, dict)]
    return []


def _as_prediction_list(raw: Any) -> list[dict[str, Any]]:
    """Normalize predictions: flat list or {geopolitical|tech|finance: [...]}."""
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if not isinstance(raw, dict):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for cat in ("geopolitical", "tech", "finance"):
        bucket = raw.get(cat)
        if not isinstance(bucket, list):
            continue
        for item in bucket:
            if not isinstance(item, dict):
                continue
            key = str(item.get("title") or item.get("question") or item.get("url") or "")
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            out.append(item)
    return out


def _parse_bootstrap_signals(payload: Any) -> list[WorldSignal]:
    data = _unwrap(payload)
    if not data:
        return []
    signals: list[WorldSignal] = []

    insights = data.get("insights") or data.get("aiInsights")
    if isinstance(insights, list):
        for i, item in enumerate(insights[:5]):
            if isinstance(item, dict):
                title = str(item.get("title") or item.get("headline") or "").strip()
                body = str(item.get("summary") or item.get("text") or "").strip()
            elif isinstance(item, str):
                title, body = item[:80], item
            else:
                continue
            if not title:
                continue
            signals.append(
                WorldSignal(
                    id=f"insight:{i}",
                    kind="news",
                    label=title[:80],
                    value="insight",
                    detail=body[:200],
                    source="worldmonitor.insights",
                )
            )

    predictions = _as_prediction_list(
        data.get("predictions") or data.get("predictionMarkets")
    )
    for i, item in enumerate(predictions[:5]):
        q = str(item.get("question") or item.get("title") or "").strip()
        if not q:
            continue
        price = item.get("price") or item.get("yesPrice") or item.get("probability")
        src = str(item.get("source") or "prediction").strip()
        signals.append(
            WorldSignal(
                id=f"pred:{i}",
                kind="prediction",
                label=q[:100],
                value=str(price) if price is not None else "n/a",
                detail=src,
                source="worldmonitor.predictions",
            )
        )

    # Prefer major indices when present; otherwise first N symbols.
    index_syms = {"^GSPC", "^DJI", "^IXIC", "^HSI", "^NSEI", "^VIX"}
    market_items = _as_quote_list(data.get("marketQuotes") or data.get("markets"))
    preferred = [q for q in market_items if str(q.get("symbol") or "") in index_syms]
    rest = [q for q in market_items if q not in preferred]
    for item in (preferred + rest)[:6]:
        sym = str(
            item.get("display") or item.get("symbol") or item.get("ticker") or ""
        ).strip()
        if not sym:
            continue
        raw_sym = str(item.get("symbol") or sym)
        price = item.get("price")
        change = item.get("change") or item.get("changePct")
        name = str(item.get("name") or "").strip()
        detail = f"Δ {change}" if change is not None else ""
        if name and name != raw_sym:
            detail = f"{name}; {detail}".rstrip("; ")
        signals.append(
            WorldSignal(
                id=f"quote:{raw_sym}",
                kind="macro",
                label=sym,
                value=str(price) if price is not None else "n/a",
                detail=detail,
                source="worldmonitor.markets",
            )
        )

    commodity_items = _as_quote_list(data.get("commodityQuotes"))
    # Keep a short commodity/FX strip relevant to policy (vol, oil, gold, CNY).
    commodity_prefer = {"^VIX", "CL=F", "BZ=F", "GC=F", "NG=F", "USDCNY=X"}
    preferred_c = [
        q for q in commodity_items if str(q.get("symbol") or "") in commodity_prefer
    ]
    rest_c = [q for q in commodity_items if q not in preferred_c]
    for item in (preferred_c + rest_c)[:5]:
        sym = str(
            item.get("display") or item.get("symbol") or item.get("ticker") or ""
        ).strip()
        if not sym:
            continue
        raw_sym = str(item.get("symbol") or sym)
        price = item.get("price")
        change = item.get("change") or item.get("changePct")
        detail = f"Δ {change}" if change is not None else ""
        signals.append(
            WorldSignal(
                id=f"cmdty:{raw_sym}",
                kind="macro",
                label=sym,
                value=str(price) if price is not None else "n/a",
                detail=detail,
                source="worldmonitor.commodities",
            )
        )

    macro = data.get("macroSignals")
    if isinstance(macro, dict) and not macro.get("unavailable"):
        verdict = str(macro.get("verdict") or "").strip()
        bullish = macro.get("bullishCount")
        total = macro.get("totalCount")
        if verdict:
            ratio = (
                f"{bullish}/{total}"
                if bullish is not None and total is not None
                else ""
            )
            signals.append(
                WorldSignal(
                    id="macro:verdict",
                    kind="macro",
                    label="Macro verdict",
                    value=verdict,
                    detail=f"bullish {ratio}".strip() if ratio else "",
                    source="worldmonitor.macro",
                )
            )
        nested = macro.get("signals")
        if isinstance(nested, dict):
            for name, item in list(nested.items())[:4]:
                if not isinstance(item, dict):
                    continue
                status = str(item.get("status") or "").strip()
                if not status:
                    continue
                val = item.get("value")
                detail_parts = [status]
                if val is not None:
                    detail_parts.append(f"value={val}")
                signals.append(
                    WorldSignal(
                        id=f"macro:{name}",
                        kind="macro",
                        label=str(name),
                        value=status,
                        detail="; ".join(detail_parts),
                        source="worldmonitor.macro",
                    )
                )

    return signals


def _build_from_parts(
    *,
    health: Any | None,
    fear_payload: Any | None,
    risk_payload: Any | None,
    bootstrap: Any | None,
    served_by: str | None = None,
) -> WorldContext:
    fear_val, fear_label = _parse_fear_greed(fear_payload)
    risks = _parse_risk_scores(risk_payload)
    # Public bootstrap embeds a stale risk snapshot — use when RPC unavailable.
    if not risks and bootstrap is not None:
        boot_data = _unwrap(bootstrap) or {}
        risks = _parse_risk_scores(boot_data.get("riskScores"))
    boot_signals = _parse_bootstrap_signals(bootstrap)

    signals: list[WorldSignal] = []
    if fear_val is not None:
        signals.append(
            WorldSignal(
                id="fear-greed",
                kind="sentiment",
                label="Fear & Greed",
                value=f"{fear_val}/100",
                detail=fear_label or "",
                score=float(fear_val),
                source="worldmonitor.market",
            )
        )
    signals.extend(boot_signals)
    signals.extend(risks[:8])

    health_status = None
    if isinstance(health, dict):
        health_status = str(health.get("status") or "UNKNOWN")

    has_live = fear_val is not None or bool(risks) or bool(boot_signals)
    if has_live:
        risk_hint = ""
        if risks:
            top = risks[0]
            risk_hint = f"；最高风险区域 {top.label}（{top.value}）"
        fg_hint = ""
        if fear_val is not None:
            fg_hint = f"；Fear&Greed {fear_val}/100 {fear_label or ''}".rstrip()
        return WorldContext(
            fetched_at=_now_iso(),
            freshness="fresh",
            source="live",
            served_by=served_by,
            summary=(
                f"已接入 WorldMonitor 全球情报快照，共 {len(signals)} 条信号"
                f"{fg_hint}{risk_hint}。编排组合时请对齐问卷风险因子与下述暴露。"
            ),
            signals=signals,
            fear_greed=fear_val,
            fear_greed_label=fear_label,
            top_risks=risks[:5],
            health_status=health_status,
        )
    if health_status:
        return WorldContext(
            fetched_at=_now_iso(),
            freshness="degraded",
            source="health_only",
            served_by=served_by,
            summary="已连通 WorldMonitor 健康检查；详细信号需 seed 数据或 API Key",
            signals=signals,
            fear_greed=fear_val,
            fear_greed_label=fear_label,
            top_risks=risks[:5],
            health_status=health_status,
            error=(
                "公开 bootstrap 无数据或上游拒绝详细 RPC；"
                "可本地部署 WorldMonitor（见 ai/worldmonitor/LOCAL.md）"
                "或配置 WORLDMONITOR_API_KEY。"
            ),
        )
    return WorldContext(
        fetched_at=_now_iso(),
        freshness="unavailable",
        source="unavailable",
        summary="WorldMonitor 暂不可用",
        signals=signals,
        health_status=health_status,
        error="无法连接 WorldMonitor API",
    )


def _rank(ctx: WorldContext) -> tuple[int, int]:
    """Rank a snapshot for 'best degraded' selection: source tier, then signals."""
    order = {"live": 3, "health_only": 2, "cache": 1, "unavailable": 0}
    return (order.get(ctx.source, 0), len(ctx.signals))


async def _fetch_one_base(
    http: httpx.AsyncClient, base: str, *, key_applies: bool, label: str
) -> WorldContext:
    """Fetch + normalize one base.

    Health/bootstrap are public; fear/greed + risk RPCs are attempted only when
    the key applies to this base (primary) and is configured.
    """
    started = time.monotonic()
    health_task = _get_json(
        http, base, "/api/health", params={"compact": "1"}, include_key=key_applies
    )
    boot_task = _get_json(
        http,
        base,
        "/api/bootstrap",
        params={"tier": "fast", "public": "1"},
        include_key=key_applies,
    )
    fear = risks = None
    if key_applies and _has_api_key():
        fear_task = _get_json(
            http, base, "/api/market/v1/get-fear-greed-index", include_key=True
        )
        risk_task = _get_json(
            http, base, "/api/intelligence/v1/get-risk-scores", include_key=True
        )
        health, bootstrap, fear, risks = await asyncio.gather(
            health_task, boot_task, fear_task, risk_task
        )
    else:
        health, bootstrap = await asyncio.gather(health_task, boot_task)

    ctx = _build_from_parts(
        health=health,
        fear_payload=fear,
        risk_payload=risks,
        bootstrap=bootstrap,
        served_by=label,
    )
    logger.info(
        "worldmonitor probe base=%s label=%s source=%s freshness=%s "
        "signals=%d latency_ms=%d",
        base,
        label,
        ctx.source,
        ctx.freshness,
        len(ctx.signals),
        int((time.monotonic() - started) * 1000),
    )
    return ctx


async def fetch_world_context(*, force: bool = False) -> WorldContext:
    """Fetch a normalized global context snapshot (cached briefly).

    Walks the local→cloud base chain: the first base that returns live signals
    wins; otherwise the most informative degraded snapshot is kept so callers
    still see health/attribution instead of a bare 'unavailable'.
    """
    cache_key = "default"
    ttl = float(settings.worldmonitor_cache_ttl_seconds or _CACHE_TTL_S)
    async with _cache_lock:
        hit = _cache.get(cache_key)
        if not force and hit and (time.monotonic() - hit[0]) < ttl:
            cached = hit[1].model_copy(update={"source": "cache", "freshness": "stale"})
            return cached

    timeout = httpx.Timeout(float(settings.worldmonitor_timeout_seconds or 8.0))
    best: WorldContext | None = None
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            for base, key_applies in _bases():
                label = "primary" if key_applies else "cloud"
                ctx = await _fetch_one_base(
                    http, base, key_applies=key_applies, label=label
                )
                if ctx.source == "live":
                    best = ctx
                    break
                if best is None or _rank(ctx) > _rank(best):
                    best = ctx
    except Exception:  # noqa: BLE001
        logger.exception("worldmonitor fetch failed")

    if best is None:
        best = _build_from_parts(
            health=None, fear_payload=None, risk_payload=None, bootstrap=None
        )
    async with _cache_lock:
        _cache[cache_key] = (time.monotonic(), best)
    return best
