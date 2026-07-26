"""Thin PandaAI / pandaData HTTP client (no panda_data SDK).

Auth: POST /pandaData/dataUser/login with MD5(password), Authorization = JWT.
Market series often return Parquet; macro detail / calendar return JSON.

Modules (comma-separated via PANDAAI_MODULES):
  Default: index,futures,macro,calendar
  Optional: index_ext,futures_ext,macro_pi,macro_energy,fx
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pyarrow.parquet as pq

from ai.pandaai.types import PandaContext, PandaSignal
from core.config import settings

logger = logging.getLogger("lemma.ai.pandaai")

_USER_AGENT = "xEngine/1.0 (+pandaai-data)"
_DEFAULT_BASE = "http://pandadata.pandaaiquant.com"

# --- curated series (keep payloads small) ---
_INDEX_CORE: tuple[tuple[str, str], ...] = (
    ("000300.SH", "沪深300"),
    ("000001.SH", "上证综指"),
    ("399006.SZ", "创业板指"),
)
_INDEX_EXT: tuple[tuple[str, str], ...] = (
    ("000016.SH", "上证50"),
    ("399001.SZ", "深证成指"),
    ("000688.SH", "科创50"),
)
_FUTURES_CORE: tuple[tuple[str, str], ...] = (
    ("SC_DOMINANT.INE", "原油主力"),
    ("AU_DOMINANT.SHF", "黄金主力"),
    ("CU_DOMINANT.SHF", "铜主力"),
)
_FUTURES_EXT: tuple[tuple[str, str], ...] = (
    ("AG_DOMINANT.SHF", "白银主力"),
    ("I_DOMINANT.DCE", "铁矿石主力"),
    ("RB_DOMINANT.SHF", "螺纹钢主力"),
    ("M_DOMINANT.DCE", "豆粕主力"),
)
_MACRO_IR: tuple[tuple[str, str], ...] = (
    ("IR0003604", "LPR:1年"),
    ("IR0000023", "美元兑人民币中间价"),
    ("IR0004522", "中债国债到期收益率:10年"),
)
_MACRO_CI: tuple[tuple[str, str], ...] = (
    ("CI0000002", "制造业PMI"),
    ("CI0000001", "综合PMI"),
)
_MACRO_PI: tuple[tuple[str, str], ...] = (
    ("PI0000047", "CPI:当月同比"),
    ("PI0000045", "CPI:食品:当月同比"),
    ("PI0000675", "PPI:全部工业品:当月同比"),
)
_MACRO_ENERGY: tuple[tuple[str, str], ...] = (
    ("EN0002966", "布伦特原油期货收盘价"),
    ("EN0002968", "布伦特原油期货结算价"),
)
_FX: tuple[tuple[str, str], ...] = (
    ("IR0000026", "欧元兑人民币中间价"),
    ("IR0000025", "100日元兑人民币中间价"),
    ("IR0000027", "英镑兑人民币中间价"),
)

_DEFAULT_MODULES = ("index", "futures", "macro", "calendar")
_KNOWN_MODULES = frozenset(
    {
        *_DEFAULT_MODULES,
        "index_ext",
        "futures_ext",
        "macro_pi",
        "macro_energy",
        "fx",
    }
)
# UI / docs labels for optional module toggles.
MODULE_CATALOG: tuple[tuple[str, str, str], ...] = (
    ("index", "A股核心指数", "沪深300 / 上证综指 / 创业板指"),
    ("index_ext", "A股扩展指数", "上证50 / 深证成指 / 科创50"),
    ("futures", "核心期货", "原油 / 黄金 / 铜"),
    ("futures_ext", "扩展期货", "白银 / 铁矿 / 螺纹 / 豆粕"),
    ("macro", "核心宏观", "LPR / 美元兑人民币 / 10Y国债 / PMI"),
    ("macro_pi", "价格指数", "CPI / 食品CPI / PPI"),
    ("macro_energy", "能源宏观", "布伦特原油期货"),
    ("fx", "主要外汇", "欧元 / 日元 / 英镑兑人民币"),
    ("calendar", "交易日历", "A股最新交易日"),
)

_token_lock = asyncio.Lock()
_token: str | None = None
_token_expires_at: float = 0.0
_cache_lock = asyncio.Lock()
_cache: dict[str, tuple[float, PandaContext]] = {}


class PandaAIError(Exception):
    """Upstream or configuration failure."""


def is_pandaai_enabled() -> bool:
    if not settings.pandaai_enabled:
        return False
    return bool(_username() and _password())


def _username() -> str:
    raw = (settings.pandaai_username or "").strip()
    if not raw:
        return ""
    if raw.isdigit() and len(raw) == 11:
        return f"86{raw}"
    return raw


def _password() -> str:
    return (settings.pandaai_password or "").strip()


def _root_base() -> str:
    return (settings.pandaai_base_url or _DEFAULT_BASE).rstrip("/")


def _data_base() -> str:
    root = _root_base()
    if root.endswith("/pandaData"):
        return root
    return f"{root}/pandaData"


def parse_modules(raw: str | None) -> list[str]:
    text = (raw or "").strip()
    if not text:
        return list(_DEFAULT_MODULES)
    out: list[str] = []
    for part in text.split(","):
        key = part.strip().lower()
        if key in _KNOWN_MODULES and key not in out:
            out.append(key)
    return out or list(_DEFAULT_MODULES)


def enabled_modules() -> list[str]:
    return parse_modules(settings.pandaai_modules)


def pandaai_status() -> dict[str, Any]:
    return {
        "enabled": is_pandaai_enabled(),
        "modules": enabled_modules(),
        "availableModules": [
            {"id": mid, "label": label, "description": desc}
            for mid, label, desc in MODULE_CATALOG
        ],
        "configured": bool(_username() and _password()),
    }


def _ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def _pct(close: float | None, pre: float | None) -> float | None:
    if close is None or pre is None or pre == 0:
        return None
    return (close - pre) / pre * 100.0


def _fmt_num(v: Any, *, digits: int = 2) -> str:
    try:
        return f"{float(v):.{digits}f}"
    except (TypeError, ValueError):
        return str(v)


def _parse_parquet_rows(content: bytes) -> list[dict[str, Any]]:
    if not content or content[:4] != b"PAR1":
        return []
    table = pq.read_table(io.BytesIO(content))
    return table.to_pylist()


def _extract_json_data(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    code = payload.get("code")
    if code is not None and code not in (200, "200"):
        msg = payload.get("message") or payload.get("msg") or "error"
        raise PandaAIError(f"PandaAI code {code}: {msg}")
    return payload.get("data", payload)


def _latest_by(
    rows: list[dict[str, Any]], *, symbol_key: str, date_key: str
) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in rows:
        sym = str(row.get(symbol_key) or "")
        if not sym:
            continue
        prev = latest.get(sym)
        if prev is None or str(row.get(date_key) or "") >= str(prev.get(date_key) or ""):
            latest[sym] = row
    return latest


async def _post(
    http: httpx.AsyncClient,
    path: str,
    payload: dict[str, Any],
    *,
    token: str | None = None,
    accept: str = "application/json",
) -> httpx.Response:
    url = f"{_data_base()}{path}"
    headers = {
        "Content-Type": "application/json",
        "Accept": accept,
        "User-Agent": _USER_AGENT,
    }
    if token:
        headers["Authorization"] = token
    try:
        return await http.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise PandaAIError(f"PandaAI request failed: {exc}") from exc


async def _login(http: httpx.AsyncClient) -> str:
    global _token, _token_expires_at
    user = _username()
    pwd = _password()
    if not user or not pwd:
        raise PandaAIError("PandaAI credentials not configured")

    pwd_md5 = hashlib.md5(pwd.encode("utf-8")).hexdigest()
    resp = await _post(
        http,
        "/dataUser/login",
        {"username": user, "password": pwd_md5},
    )
    if resp.status_code >= 400:
        raise PandaAIError(f"PandaAI login HTTP {resp.status_code}")
    try:
        body = resp.json()
    except ValueError as exc:
        raise PandaAIError("PandaAI login returned non-JSON") from exc
    data = _extract_json_data(body)
    token: str | None = None
    expires_in = 14400
    if isinstance(data, str):
        token = data
    elif isinstance(data, dict):
        token = data.get("token") if isinstance(data.get("token"), str) else None
        try:
            expires_in = int(data.get("expires_in") or expires_in)
        except (TypeError, ValueError):
            expires_in = 14400
    if not token:
        raise PandaAIError("PandaAI login missing token")

    try:
        import base64
        import json

        parts = token.split(".")
        if len(parts) == 3:
            pad = "=" * (4 - len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
            exp = int(claims.get("exp") or 0)
            if exp > 0:
                expires_in = max(60, exp - int(time.time()))
    except Exception:  # noqa: BLE001
        pass

    _token = token
    _token_expires_at = time.time() + max(60, expires_in - 60)
    return token


async def _get_token(http: httpx.AsyncClient) -> str:
    global _token
    async with _token_lock:
        if _token and time.time() < _token_expires_at:
            return _token
        return await _login(http)


async def _authed_post(
    http: httpx.AsyncClient,
    path: str,
    payload: dict[str, Any],
    *,
    accept: str = "*/*",
) -> httpx.Response:
    token = await _get_token(http)
    resp = await _post(http, path, payload, token=token, accept=accept)
    if resp.status_code == 401:
        async with _token_lock:
            await _login(http)
            token = _token or ""
        resp = await _post(http, path, payload, token=token, accept=accept)
    if resp.status_code >= 400:
        raise PandaAIError(f"PandaAI {path} HTTP {resp.status_code}")
    return resp


async def _fetch_latest_trade_date(http: httpx.AsyncClient) -> str | None:
    resp = await _authed_post(
        http,
        "/tradeCalendar/getLatestTradingDay",
        {"exchange": "SH"},
        accept="application/json",
    )
    data = _extract_json_data(resp.json())
    if isinstance(data, dict):
        value = data.get("date")
        return str(value) if value else None
    return str(data) if data else None


async def _fetch_ohlc_signals(
    http: httpx.AsyncClient,
    *,
    path: str,
    series: tuple[tuple[str, str], ...],
    kind: str,
    lookback_days: int = 14,
    pre_keys: tuple[str, ...] = ("pre_close",),
) -> list[PandaSignal]:
    end = date.today()
    start = end - timedelta(days=lookback_days)
    symbols = [s for s, _ in series]
    labels = dict(series)
    resp = await _authed_post(
        http,
        path,
        {
            "symbols": symbols,
            "startDate": _ymd(start),
            "endDate": _ymd(end),
        },
    )
    rows = _parse_parquet_rows(resp.content)
    latest = _latest_by(rows, symbol_key="symbol", date_key="date")
    out: list[PandaSignal] = []
    for sym, _label in series:
        row = latest.get(sym)
        if not row:
            continue
        close = row.get("close")
        pre = None
        for key in pre_keys:
            if row.get(key) is not None:
                pre = row.get(key)
                break
        pct = _pct(
            float(close) if close is not None else None,
            float(pre) if pre is not None else None,
        )
        pct_txt = f"{pct:+.2f}%" if pct is not None else "—"
        detail = f"昨收 {_fmt_num(pre)}"
        if kind == "futures":
            dominant = row.get("dominant_id") or row.get("trading_code") or ""
            detail = f"合约 {dominant}".strip() if dominant else detail
        out.append(
            PandaSignal(
                kind=kind,
                label=labels.get(sym, sym),
                value=f"{_fmt_num(close)}（{pct_txt}）",
                detail=detail,
                symbol=sym,
                as_of=str(row.get("date") or ""),
            )
        )
    return out


async def _fetch_macro_latest(
    http: httpx.AsyncClient,
    *,
    path: str,
    series: tuple[tuple[str, str], ...],
    lookback_days: int,
    kind: str = "macro",
    detail: str = "精选宏观指标",
) -> list[PandaSignal]:
    end = date.today()
    start = end - timedelta(days=lookback_days)
    symbols = [s for s, _ in series]
    labels = dict(series)
    resp = await _authed_post(
        http,
        path,
        {
            "symbol": symbols,
            "startDate": _ymd(start),
            "endDate": _ymd(end),
        },
    )
    rows = _parse_parquet_rows(resp.content)
    latest = _latest_by(rows, symbol_key="symbol", date_key="period_date")
    out: list[PandaSignal] = []
    for sym, label in series:
        row = latest.get(sym)
        if not row:
            continue
        out.append(
            PandaSignal(
                kind=kind,
                label=label,
                value=_fmt_num(row.get("data_value"), digits=4),
                detail=detail,
                symbol=sym,
                as_of=str(row.get("period_date") or ""),
            )
        )
    return out


async def _fetch_macro_core(http: httpx.AsyncClient) -> list[PandaSignal]:
    ir, ci = await asyncio.gather(
        _fetch_macro_latest(
            http, path="/macro/getMacroIrData", series=_MACRO_IR, lookback_days=90
        ),
        _fetch_macro_latest(
            http, path="/macro/getMacroCiData", series=_MACRO_CI, lookback_days=400
        ),
    )
    return [*ir, *ci]


def _build_summary(
    signals: list[PandaSignal], *, last_trade_date: str | None
) -> str:
    parts: list[str] = []
    if last_trade_date:
        parts.append(f"A股最新交易日 {last_trade_date}")
    index_bits = [f"{s.label} {s.value}" for s in signals if s.kind == "index"][:2]
    if index_bits:
        parts.append(" · ".join(index_bits))
    fut = next((s for s in signals if s.kind == "futures"), None)
    if fut:
        parts.append(f"{fut.label} {fut.value}")
    for kind in ("macro", "fx", "energy"):
        hit = next((s for s in signals if s.kind == kind), None)
        if hit:
            parts.append(f"{hit.label} {hit.value}")
            break
    return "；".join(parts)[:240]


async def fetch_panda_context(
    *,
    force: bool = False,
    modules: list[str] | None = None,
) -> PandaContext:
    """Fetch a compact PandaAI snapshot for agent intel / UI.

    Disabled / unconfigured → ``source=disabled`` (caller should skip).
    Failures → ``source=unavailable`` with error text.
    ``modules`` overrides the env table for this request (UI toggles).
    """
    if not is_pandaai_enabled():
        return PandaContext(source="disabled", summary="PandaAI 未启用", freshness="n/a")

    if modules is not None:
        resolved: list[str] = []
        for key in modules:
            mid = (key or "").strip().lower()
            if mid in _KNOWN_MODULES and mid not in resolved:
                resolved.append(mid)
    else:
        resolved = enabled_modules()
    cache_key = ",".join(resolved) or "__empty__"
    ttl = max(30, int(settings.pandaai_cache_ttl_seconds))
    async with _cache_lock:
        hit = _cache.get(cache_key)
        if not force and hit is not None and (time.time() - hit[0]) < ttl:
            return hit[1]

    modules = resolved
    started = time.perf_counter()
    if not modules:
        empty = PandaContext(
            source="pandaai",
            freshness="n/a",
            summary="未选择任何数据集",
            modules=[],
            latency_ms=0,
        )
        async with _cache_lock:
            _cache[cache_key] = (time.time(), empty)
        return empty

    timeout = max(5.0, float(settings.pandaai_timeout_seconds))

    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            order: list[str] = []
            coros: list[Any] = []
            if "calendar" in modules:
                order.append("calendar")
                coros.append(_fetch_latest_trade_date(http))
            if "index" in modules:
                order.append("index")
                coros.append(
                    _fetch_ohlc_signals(
                        http,
                        path="/multi/getIndexDaily",
                        series=_INDEX_CORE,
                        kind="index",
                    )
                )
            if "index_ext" in modules:
                order.append("index_ext")
                coros.append(
                    _fetch_ohlc_signals(
                        http,
                        path="/multi/getIndexDaily",
                        series=_INDEX_EXT,
                        kind="index",
                    )
                )
            if "futures" in modules:
                order.append("futures")
                coros.append(
                    _fetch_ohlc_signals(
                        http,
                        path="/multi/getFutureDaily",
                        series=_FUTURES_CORE,
                        kind="futures",
                        pre_keys=("pre_settlement", "pre_close"),
                    )
                )
            if "futures_ext" in modules:
                order.append("futures_ext")
                coros.append(
                    _fetch_ohlc_signals(
                        http,
                        path="/multi/getFutureDaily",
                        series=_FUTURES_EXT,
                        kind="futures",
                        pre_keys=("pre_settlement", "pre_close"),
                    )
                )
            if "macro" in modules:
                order.append("macro")
                coros.append(_fetch_macro_core(http))
            if "macro_pi" in modules:
                order.append("macro_pi")
                coros.append(
                    _fetch_macro_latest(
                        http,
                        path="/macro/getMacroPiData",
                        series=_MACRO_PI,
                        lookback_days=400,
                        kind="macro",
                        detail="价格指数",
                    )
                )
            if "macro_energy" in modules:
                order.append("macro_energy")
                coros.append(
                    _fetch_macro_latest(
                        http,
                        path="/macro/getMacroEnData",
                        series=_MACRO_ENERGY,
                        lookback_days=60,
                        kind="energy",
                        detail="能源宏观",
                    )
                )
            if "fx" in modules:
                order.append("fx")
                coros.append(
                    _fetch_macro_latest(
                        http,
                        path="/macro/getMacroIrData",
                        series=_FX,
                        lookback_days=30,
                        kind="fx",
                        detail="外汇中间价",
                    )
                )

            results = await asyncio.gather(*coros, return_exceptions=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pandaai fetch failed: %s", exc)
        return PandaContext(
            source="unavailable",
            error=str(exc)[:240],
            modules=modules,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    signals: list[PandaSignal] = []
    last_trade: str | None = None
    errors: list[str] = []
    for key, outcome in zip(order, results, strict=False):
        if isinstance(outcome, Exception):
            logger.warning("pandaai module %s failed: %s", key, outcome)
            errors.append(f"{key}:{outcome}"[:120])
            continue
        if key == "calendar":
            last_trade = outcome if isinstance(outcome, str) else None
        elif isinstance(outcome, list):
            signals.extend(outcome)

    latency_ms = int((time.perf_counter() - started) * 1000)
    if not signals and last_trade is None:
        return PandaContext(
            source="unavailable",
            error="; ".join(errors)[:240] or "empty",
            modules=modules,
            latency_ms=latency_ms,
        )

    as_of = last_trade or next((s.as_of for s in signals if s.as_of), None)
    freshness = "fresh"
    if as_of and len(as_of) == 8 and as_of.isdigit():
        try:
            as_date = datetime.strptime(as_of, "%Y%m%d").replace(tzinfo=UTC).date()
            age = (datetime.now(UTC).date() - as_date).days
            freshness = "fresh" if age <= 3 else ("stale" if age <= 14 else "old")
        except ValueError:
            freshness = "unknown"

    ctx = PandaContext(
        source="pandaai",
        freshness=freshness,
        summary=_build_summary(signals, last_trade_date=last_trade),
        signals=signals,
        modules=modules,
        last_trade_date=last_trade,
        error="; ".join(errors)[:240] if errors else None,
        latency_ms=latency_ms,
    )
    async with _cache_lock:
        _cache[cache_key] = (time.time(), ctx)
    return ctx
