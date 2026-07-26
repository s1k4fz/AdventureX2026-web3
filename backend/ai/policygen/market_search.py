"""诉求级广搜（搜索前置）：用户风险诉求 → 扩词(宽) → Polymarket 检索 → 去重 → 候选池。

与问卷并发执行，所以扩词只依据用户诉求（此时还没有问卷答案），故意放宽以保证供给；
对用户的收窄留到 compose 阶段（那时才有答案）。LLM 只用于扩词，搜索/去重确定性。
对运营性失败容错：单路关键词检索失败仅记录并跳过，最终返回去重后的全部候选；排序与选标的都在
compose 阶段做（本步不排序、不裁剪）。policy_id 仅用于把搜索花费记到 provider_usage_logs。

问卷提交后可在 compose 前触发第二轮精搜（search_markets_refined），用答案生成更精准
的补充查询并合并进候选池；失败不阻塞 compose。

Controllable Agent: optional StageHints / harness vars / mid-flight cancel callback.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from ai.client import ai_client
from ai.errors import AIError
from ai.markets import MarketCandidate, MarketPlatform, MarketSearchQuery, search_markets
from ai.policygen.types import MarketQueries
from ai.types import AIUseCase

logger = logging.getLogger("lemma.ai.policygen")

_SEARCH_USE_CASE = "policy_market_search"
_REFINED_USE_CASE = "policy_market_search_refined"
_MAX_SEARCH_QUERIES = 6
_MAX_REFINED_QUERIES = 3
_PER_QUERY_LIMIT = 15

CancelCheck = Callable[[], Awaitable[bool]]
ProgressCb = Callable[[dict[str, Any]], Awaitable[None]]


class SearchCancelled(Exception):
    """Raised when input_revision is no longer current mid-search."""


@dataclass
class MarketSearchReport:
    """Broad-search outcome + diagnostics for explicit failure surfacing.

    ``candidates`` is the deduped pool (may be empty). When empty, ``reason``
    classifies WHY so the task layer emits a specific error_code/message instead
    of a silent empty list. ``status`` is "ok" | "empty" | "degraded"
    ("degraded" = expansion failed or every provider keyword search errored;
    "empty" = the search ran cleanly but matched nothing).

    ``keywords`` is the preferred name for the expanded search terms; ``queries``
    remains as a compatibility alias on the dataclass (same list). Wire progress
    dual-writes both. ``search_errors`` replaces the old ``leg_errors`` name.
    """

    candidates: list[MarketCandidate]
    status: Literal["ok", "empty", "degraded"]
    reason: str | None = None
    expansion_ok: bool = True
    translated_ok: bool = True
    search_errors: list[str] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)

    @property
    def queries(self) -> list[str]:
        """Compatibility alias for ``keywords``."""
        return self.keywords

    @property
    def leg_errors(self) -> list[str]:
        """Compatibility alias for ``search_errors``."""
        return self.search_errors


async def search_markets_for_need(
    need: str,
    *,
    coverage_end: datetime | None = None,
    policy_id: uuid.UUID | None = None,
    prompt_vars: dict[str, str] | None = None,
    is_cancelled: CancelCheck | None = None,
    on_progress: ProgressCb | None = None,
) -> list[MarketCandidate]:
    """Broad-search prediction markets for the need and return the deduped pool.

    Backward-compatible thin wrapper over :func:`search_markets_for_need_report`
    (returns just the candidate pool). Callers that need the failure diagnostics
    should call the report variant directly.
    """
    report = await search_markets_for_need_report(
        need,
        coverage_end=coverage_end,
        policy_id=policy_id,
        prompt_vars=prompt_vars,
        is_cancelled=is_cancelled,
        on_progress=on_progress,
    )
    return report.candidates


async def search_markets_for_need_report(
    need: str,
    *,
    coverage_end: datetime | None = None,
    policy_id: uuid.UUID | None = None,
    prompt_vars: dict[str, str] | None = None,
    is_cancelled: CancelCheck | None = None,
    on_progress: ProgressCb | None = None,
) -> MarketSearchReport:
    """Broad-search + diagnostics: classifies WHY the pool is empty."""
    keywords, expansion_ok, translated_ok = await _expand_queries(
        need, prompt_vars=prompt_vars
    )
    if on_progress is not None:
        await on_progress(
            {
                "phase": "keywords",
                "keywords": keywords,
                # Dual-write for older clients.
                "queries": keywords,
            }
        )
    await _raise_if_cancelled(is_cancelled)
    search_errors: list[str] = []
    candidates = await _search_all(
        keywords,
        coverage_end=coverage_end,
        policy_id=policy_id,
        use_case=_SEARCH_USE_CASE,
        is_cancelled=is_cancelled,
        on_progress=on_progress,
        search_errors=search_errors,
    )
    return _build_report(
        candidates,
        keywords=keywords,
        expansion_ok=expansion_ok,
        translated_ok=translated_ok,
        search_errors=search_errors,
    )


def _build_report(
    candidates: list[MarketCandidate],
    *,
    expansion_ok: bool,
    translated_ok: bool,
    keywords: list[str] | None = None,
    search_errors: list[str] | None = None,
    # Compatibility kwargs from older call sites / smokes.
    queries: list[str] | None = None,
    leg_errors: list[str] | None = None,
) -> MarketSearchReport:
    """Classify an (possibly empty) candidate pool into a diagnostic report."""
    resolved_keywords = (
        list(keywords) if keywords is not None else list(queries or [])
    )
    resolved_errors = (
        list(search_errors)
        if search_errors is not None
        else list(leg_errors or [])
    )
    if candidates:
        return MarketSearchReport(
            candidates=candidates,
            status="ok",
            expansion_ok=expansion_ok,
            translated_ok=translated_ok,
            search_errors=resolved_errors,
            keywords=resolved_keywords,
        )
    searches_run = min(len(resolved_keywords), _MAX_SEARCH_QUERIES)
    status: Literal["empty", "degraded"]
    if not expansion_ok:
        reason, status = "expansion_failed", "degraded"
    elif not translated_ok:
        reason, status = "untranslated_query", "empty"
    elif (
        resolved_errors
        and searches_run > 0
        and len(resolved_errors) >= searches_run
    ):
        reason, status = "provider_unavailable", "degraded"
    else:
        reason, status = "empty_result", "empty"
    return MarketSearchReport(
        candidates=[],
        status=status,
        reason=reason,
        expansion_ok=expansion_ok,
        translated_ok=translated_ok,
        search_errors=resolved_errors,
        keywords=resolved_keywords,
    )


async def search_markets_refined(
    need: str,
    answers: dict[str, str],
    *,
    coverage_end: datetime | None = None,
    policy_id: uuid.UUID | None = None,
    prompt_vars: dict[str, str] | None = None,
    is_cancelled: CancelCheck | None = None,
) -> list[MarketCandidate]:
    """Second-round search driven by questionnaire answers.

    Does not raise except SearchCancelled (revision no longer current).
    Other failures are logged and return [].
    """
    try:
        queries = await _expand_refined_queries(
            need, answers, prompt_vars=prompt_vars
        )
        if not queries:
            return []
        await _raise_if_cancelled(is_cancelled)
        return await _search_all(
            queries,
            coverage_end=coverage_end,
            policy_id=policy_id,
            use_case=_REFINED_USE_CASE,
            max_queries=_MAX_REFINED_QUERIES,
            is_cancelled=is_cancelled,
        )
    except SearchCancelled:
        raise
    except Exception:  # noqa: BLE001 — refined search must not block compose
        logger.exception("refined market search failed for policy %s", policy_id)
        return []


async def _expand_queries(
    need: str, *, prompt_vars: dict[str, str] | None = None
) -> tuple[list[str], bool, bool]:
    """Expand a need into English market queries.

    Returns ``(queries, expansion_ok, translated_ok)``: ``expansion_ok`` is
    whether the LLM call succeeded; ``translated_ok`` is whether we ended up with
    a query Gamma can actually match (expanded queries, or an ASCII raw need). A
    non-ASCII (e.g. Chinese) need with no expansion cannot match and is flagged
    so the caller surfaces the reason instead of a silent empty pool.
    """
    prompt = f"风险诉求：{need}"
    expansion_ok = True
    try:
        result = await ai_client.generate(
            AIUseCase.MARKET_SEARCH,
            prompt,
            MarketQueries,
            prompt_vars=prompt_vars,
        )
        queries = _dedup_str(q.strip() for q in result.queries if q and q.strip())
    except AIError as exc:
        logger.warning("market query expansion failed for %r: %s", need, exc)
        queries = []
        expansion_ok = False
    if queries:
        return queries, expansion_ok, True
    if need and need.isascii():
        return [need], expansion_ok, True
    logger.warning(
        "no English market queries for non-ASCII need %r; search pool may be empty",
        need,
    )
    return [need], expansion_ok, False


async def _expand_refined_queries(
    need: str,
    answers: dict[str, str],
    *,
    prompt_vars: dict[str, str] | None = None,
) -> list[str]:
    profile = "；".join(f"{k}:{v}" for k, v in answers.items())
    prompt = (
        f"风险诉求：{need}\n"
        f"问卷画像：{profile}\n"
    )
    try:
        use_case = AIUseCase.MARKET_SEARCH_REFINED
        try:
            from ai.routing import routes_for

            routes_for(use_case)
        except Exception:
            use_case = AIUseCase.MARKET_SEARCH
        result = await ai_client.generate(
            use_case,
            prompt,
            MarketQueries,
            prompt_vars=prompt_vars,
        )
        return _dedup_str(q.strip() for q in result.queries if q and q.strip())
    except AIError as exc:
        logger.warning("refined query expansion failed: %s", exc)
        return []


async def _search_all(
    keywords: list[str],
    *,
    coverage_end: datetime | None,
    policy_id: uuid.UUID | None,
    use_case: str = _SEARCH_USE_CASE,
    max_queries: int = _MAX_SEARCH_QUERIES,
    is_cancelled: CancelCheck | None = None,
    on_progress: ProgressCb | None = None,
    search_errors: list[str] | None = None,
    # Compatibility alias.
    leg_errors: list[str] | None = None,
) -> list[MarketCandidate]:
    """Run Polymarket keyword searches in parallel; cancel + progress are cooperative.

    When ``search_errors`` is provided, each failed keyword search's error code is
    appended so the caller can distinguish 'provider down' from 'genuinely empty'.
    """
    error_sink = search_errors if search_errors is not None else leg_errors
    search_keywords = keywords[:max_queries]
    await _raise_if_cancelled(is_cancelled)

    async def _one_keyword_search(
        index: int, keyword: str
    ) -> tuple[int, str, list[MarketCandidate]]:
        try:
            hits = await search_markets(
                MarketSearchQuery(keyword=keyword, coverage_end=coverage_end),
                platform=MarketPlatform.POLYMARKET,
                limit=_PER_QUERY_LIMIT,
                use_case=use_case,
                policy_id=policy_id,
            )
        except AIError as exc:
            logger.warning("market keyword search failed: %s", exc)
            if error_sink is not None:
                error_sink.append(getattr(exc, "code", None) or type(exc).__name__)
            hits = []
        return index, keyword, hits

    results = await asyncio.gather(
        *(
            _one_keyword_search(index, keyword)
            for index, keyword in enumerate(search_keywords)
        )
    )
    await _raise_if_cancelled(is_cancelled)

    candidates: list[MarketCandidate] = []
    for index, keyword, hits in sorted(results, key=lambda item: item[0]):
        candidates.extend(hits)
        if on_progress is not None:
            hit_count = len(hits)
            await on_progress(
                {
                    "phase": "keyword_search",
                    "index": index,
                    "query": keyword,
                    "hitCount": hit_count,
                    "totalCount": len(_dedup_candidates(candidates)),
                    # Dual-write for older clients.
                    "legCount": hit_count,
                }
            )
            await _raise_if_cancelled(is_cancelled)
    return _dedup_candidates(candidates)


async def _raise_if_cancelled(is_cancelled: CancelCheck | None) -> None:
    if is_cancelled is None:
        return
    if await is_cancelled():
        raise SearchCancelled()


def merge_candidates(
    existing: list[MarketCandidate], new: list[MarketCandidate]
) -> list[MarketCandidate]:
    """Merge two pools, keeping the first occurrence per condition_id."""
    return _dedup_candidates([*existing, *new])


def _dedup_str(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _dedup_candidates(candidates: list[MarketCandidate]) -> list[MarketCandidate]:
    seen: set[str] = set()
    out: list[MarketCandidate] = []
    for candidate in candidates:
        key = candidate.condition_id
        if key in seen:
            continue
        seen.add(key)
        out.append(candidate)
    return out
