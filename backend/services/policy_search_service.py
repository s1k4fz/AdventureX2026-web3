"""保单级广搜候选池 + 搜索子状态（差分机 / Difference Engine 搜索前置）。

Owns the market_search_candidates table and Policy.search_status. Maps between
the boundary MarketCandidate and pool rows. The broad-search Celery task persists
the pool and flips search_status; compose reads the pool back as MarketCandidates
and gates on search_status (握手协议 P2).

CAS: persist_search_outcome refuses writes when the linked AgentTask.input_revision
no longer matches expected_input_revision (row-locked recheck before commit).
"""

import uuid
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ai.markets.types import MarketCandidate, MarketPlatform
from ai.policygen.ranking import rank
from models.agent_task import AgentTask
from models.policy import MarketSearchCandidate, Policy, PolicyPortfolio
from schemas.policy import (
    PolicyResearchOut,
    ResearchCandidateOut,
    ResearchPlatformCountOut,
    ResearchSourceOut,
)

# Max candidates returned on the research endpoint (selected legs always included).
_RESEARCH_TOP_N = 60

# search_status values (mirror models/policy.py CheckConstraint).
SEARCHING = "searching"
SEARCHED = "searched"
SEARCH_FAILED = "failed"


async def set_search_status(
    db: AsyncSession, *, policy_id: uuid.UUID, status: str
) -> None:
    await db.execute(
        update(Policy).where(Policy.id == policy_id).values(search_status=status)
    )
    await db.commit()


async def read_search_status(
    db: AsyncSession, *, policy_id: uuid.UUID
) -> str | None:
    """Current search_status, or None when the policy is gone."""
    result = await db.execute(
        select(Policy.search_status).where(Policy.id == policy_id)
    )
    return result.scalar_one_or_none()


async def persist_search_outcome(
    db: AsyncSession,
    *,
    policy_id: uuid.UUID,
    candidates: list[MarketCandidate],
    status: str,
    expected_input_revision: int | None = None,
) -> bool:
    """CAS persist pool + status in one transaction. Returns False when stale."""
    if expected_input_revision is not None:
        if not await _revision_matches(
            db, policy_id=policy_id, expected=expected_input_revision
        ):
            await db.rollback()
            return False

    await db.execute(
        delete(MarketSearchCandidate).where(
            MarketSearchCandidate.policy_id == policy_id
        )
    )
    if status == SEARCHED and candidates:
        for candidate in candidates:
            enriched_raw = {
                **(candidate.raw or {}),
                **(_candidate_profile_raw(candidate)),
            }
            db.add(
                MarketSearchCandidate(
                    policy_id=policy_id,
                    question=candidate.question,
                    condition_id=candidate.condition_id,
                    slug=candidate.slug,
                    url=candidate.url,
                    outcomes=candidate.outcomes or None,
                    outcome_prices=candidate.outcome_prices or None,
                    clob_token_ids=candidate.clob_token_ids or None,
                    volume=(
                        float(candidate.volume)
                        if candidate.volume is not None
                        else None
                    ),
                    liquidity=(
                        float(candidate.liquidity)
                        if candidate.liquidity is not None
                        else None
                    ),
                    end_date=candidate.end_date,
                    raw_json=enriched_raw,
                )
            )
    await db.execute(
        update(Policy).where(Policy.id == policy_id).values(search_status=status)
    )
    # Re-check after staging writes (TOCTOU barrier before commit).
    if expected_input_revision is not None:
        if not await _revision_matches(
            db, policy_id=policy_id, expected=expected_input_revision
        ):
            await db.rollback()
            return False
    await db.commit()
    return True


async def _revision_matches(
    db: AsyncSession, *, policy_id: uuid.UUID, expected: int
) -> bool:
    """Row-lock the AgentTask so a concurrent revision bump cannot commit
    between this check and the caller's subsequent COMMIT (closes TOCTOU).
    """
    result = await db.execute(
        select(AgentTask.input_revision)
        .where(
            AgentTask.primary_ref_type == "policy",
            AgentTask.primary_ref_id == policy_id,
        )
        .with_for_update()
    )
    revision = result.scalar_one_or_none()
    if revision is None:
        return True
    return int(revision) == int(expected)


async def merge_market_candidates(
    db: AsyncSession,
    *,
    policy_id: uuid.UUID,
    new_candidates: list[MarketCandidate],
) -> int:
    """Merge new candidates into the existing pool (dedupe by condition_id)."""
    if not new_candidates:
        result = await db.execute(
            select(MarketSearchCandidate).where(
                MarketSearchCandidate.policy_id == policy_id
            )
        )
        return len(list(result.scalars()))
    existing = await load_market_candidates(db, policy_id=policy_id)
    from ai.policygen.market_search import merge_candidates  # noqa: PLC0415

    merged = merge_candidates(existing, new_candidates)
    return await persist_market_candidates(db, policy_id=policy_id, candidates=merged)


async def persist_market_candidates(
    db: AsyncSession, *, policy_id: uuid.UUID, candidates: list[MarketCandidate]
) -> int:
    """Replace the policy's candidate pool with `candidates`."""
    await db.execute(
        delete(MarketSearchCandidate).where(
            MarketSearchCandidate.policy_id == policy_id
        )
    )
    for candidate in candidates:
        enriched_raw = {
            **(candidate.raw or {}),
            **(_candidate_profile_raw(candidate)),
        }
        db.add(
            MarketSearchCandidate(
                policy_id=policy_id,
                question=candidate.question,
                condition_id=candidate.condition_id,
                slug=candidate.slug,
                url=candidate.url,
                outcomes=candidate.outcomes or None,
                outcome_prices=candidate.outcome_prices or None,
                clob_token_ids=candidate.clob_token_ids or None,
                volume=float(candidate.volume) if candidate.volume is not None else None,
                liquidity=float(candidate.liquidity)
                if candidate.liquidity is not None
                else None,
                end_date=candidate.end_date,
                raw_json=enriched_raw,
            )
        )
    await db.commit()
    return len(candidates)


def _candidate_profile_raw(candidate: MarketCandidate) -> dict:
    out: dict = {}
    if candidate.volume24hr is not None:
        out["volume24hr"] = candidate.volume24hr
    if candidate.best_bid is not None:
        out["bestBid"] = candidate.best_bid
    if candidate.best_ask is not None:
        out["bestAsk"] = candidate.best_ask
    if candidate.spread is not None:
        out["spread"] = candidate.spread
    if candidate.category:
        out["category"] = candidate.category
    if candidate.tags:
        out["tags"] = candidate.tags
    if candidate.neg_risk_market_id:
        out["negRiskMarketID"] = candidate.neg_risk_market_id
    if candidate.event_id:
        out["eventId"] = candidate.event_id
    return out


async def load_market_candidates(
    db: AsyncSession, *, policy_id: uuid.UUID
) -> list[MarketCandidate]:
    result = await db.execute(
        select(MarketSearchCandidate).where(
            MarketSearchCandidate.policy_id == policy_id
        )
    )
    return [_to_candidate(row) for row in result.scalars()]


async def get_policy_research(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
    limit: int = _RESEARCH_TOP_N,
) -> PolicyResearchOut | None:
    """Owned research snapshot: ranked candidate pool + portfolio selection marks.

    Returns None when the policy is missing or not owned (caller maps to 404).
    Truncates to ``limit`` after ranking, but always includes every candidate
    whose condition_id appears as a portfolio position market_ref.
    """
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id, Policy.user_id == user_id)
        .options(
            selectinload(Policy.portfolios).selectinload(PolicyPortfolio.positions)
        )
    )
    policy = result.scalar_one_or_none()
    if policy is None:
        return None

    rows_result = await db.execute(
        select(MarketSearchCandidate).where(
            MarketSearchCandidate.policy_id == policy_id
        )
    )
    rows = list(rows_result.scalars())
    researched_at: datetime | None = None
    if rows:
        researched_at = max(row.created_at for row in rows if row.created_at)

    candidates = [_to_candidate(row) for row in rows]
    selected_ids = _selected_condition_ids(policy)
    ranked = rank(candidates, coverage_end=policy.coverage_end)

    platform_counts: dict[str, int] = {}
    for candidate in candidates:
        key = candidate.platform.value
        platform_counts[key] = platform_counts.get(key, 0) + 1

    by_id = {c.condition_id: c for c in ranked}
    top = ranked[: max(0, limit)]
    seen = {c.condition_id for c in top}
    for condition_id in selected_ids:
        if condition_id not in seen and condition_id in by_id:
            top.append(by_id[condition_id])
            seen.add(condition_id)

    rank_index = {c.condition_id: idx + 1 for idx, c in enumerate(ranked)}
    out_candidates = [
        _candidate_out(
            candidate,
            rank=rank_index.get(candidate.condition_id, 0),
            selection="selected"
            if candidate.condition_id in selected_ids
            else "pool",
        )
        for candidate in top
    ]

    search_status = policy.search_status
    if search_status not in (SEARCHING, SEARCHED, SEARCH_FAILED):
        search_status = SEARCHING

    intake = dict(getattr(policy, "intake_json", None) or {})
    evidence_pack = intake.get("evidencePack") or intake.get("evidence_pack")
    if not isinstance(evidence_pack, dict):
        evidence_pack = None
    sources_out: list[ResearchSourceOut] = []
    raw_sources = (evidence_pack or {}).get("sources") or []
    if isinstance(raw_sources, list):
        for row in raw_sources:
            if not isinstance(row, dict):
                continue
            citations = row.get("citations") or []
            if not isinstance(citations, list):
                citations = []
            sources_out.append(
                ResearchSourceOut(
                    kind=str(row.get("kind") or ""),
                    status=str(row.get("status") or ""),
                    summary=str(row.get("summary") or ""),
                    item_count=int(row.get("item_count") or row.get("itemCount") or 0),
                    error_code=(
                        str(row["error_code"])
                        if row.get("error_code")
                        else (
                            str(row["errorCode"])
                            if row.get("errorCode")
                            else None
                        )
                    ),
                    error_message=(
                        str(row["error_message"])
                        if row.get("error_message")
                        else (
                            str(row["errorMessage"])
                            if row.get("errorMessage")
                            else None
                        )
                    ),
                    citations=[c for c in citations if isinstance(c, dict)],
                )
            )

    return PolicyResearchOut(
        policy_id=policy.id,
        search_status=search_status,  # type: ignore[arg-type]
        policy_status=policy.status,
        total_count=len(candidates),
        returned_count=len(out_candidates),
        researched_at=researched_at,
        selected_condition_ids=sorted(selected_ids),
        platforms=[
            ResearchPlatformCountOut(platform=platform, count=count)
            for platform, count in sorted(platform_counts.items())
        ],
        candidates=out_candidates,
        sources=sources_out,
        evidence_pack=evidence_pack,
    )


def _selected_condition_ids(policy: Policy) -> set[str]:
    ids: set[str] = set()
    for portfolio in policy.portfolios or []:
        for position in portfolio.positions or []:
            ref = (position.market_ref or "").strip()
            if ref:
                ids.add(ref)
    return ids


def _candidate_out(
    candidate: MarketCandidate, *, rank: int, selection: str
) -> ResearchCandidateOut:
    return ResearchCandidateOut(
        condition_id=candidate.condition_id,
        platform=candidate.platform.value,
        question=candidate.question,
        url=candidate.url,
        slug=candidate.slug,
        volume=candidate.volume,
        liquidity=candidate.liquidity,
        volume24hr=candidate.volume24hr,
        spread=candidate.spread,
        yes_price_bps=_yes_price_bps(candidate),
        end_date=candidate.end_date,
        category=candidate.category,
        tags=list(candidate.tags or []),
        rank=rank,
        selection=selection,  # type: ignore[arg-type]
    )


def _yes_price_bps(candidate: MarketCandidate) -> int | None:
    prices = candidate.outcome_prices
    if not prices:
        return None
    outcomes = candidate.outcomes or []
    for i, outcome in enumerate(outcomes):
        if str(outcome).upper() in ("YES", "是") and i < len(prices):
            try:
                return round(float(prices[i]) * 10000)
            except (TypeError, ValueError):
                return None
    try:
        return round(float(prices[0]) * 10000)
    except (TypeError, ValueError, IndexError):
        return None


def _to_candidate(row: MarketSearchCandidate) -> MarketCandidate:
    raw = row.raw_json or {}
    return MarketCandidate(
        platform=MarketPlatform.POLYMARKET,
        condition_id=row.condition_id,
        question=row.question,
        slug=row.slug,
        url=row.url,
        outcomes=row.outcomes or [],
        outcome_prices=row.outcome_prices or [],
        clob_token_ids=row.clob_token_ids or [],
        volume=float(row.volume) if row.volume is not None else None,
        liquidity=float(row.liquidity) if row.liquidity is not None else None,
        volume24hr=_raw_float(raw, "volume24hr", "volume24hrClob"),
        best_bid=_raw_float(raw, "bestBid"),
        best_ask=_raw_float(raw, "bestAsk"),
        spread=_raw_float(raw, "spread"),
        category=raw.get("category"),
        tags=_raw_tags(raw),
        neg_risk_market_id=_raw_str(raw, "negRiskMarketID", "negRiskMarketId"),
        event_id=_raw_str(raw, "eventId", "event_id"),
        end_date=row.end_date,
        raw=raw,
    )


def _raw_float(raw: dict, *keys: str) -> float | None:
    from ai.markets.normalize import parse_float  # noqa: PLC0415

    for key in keys:
        val = parse_float(raw.get(key))
        if val is not None:
            return val
    return None


def _raw_str(raw: dict, *keys: str) -> str | None:
    for key in keys:
        val = raw.get(key)
        if val:
            return str(val)
    return None


def _raw_tags(raw: dict) -> list[str]:
    tags = raw.get("tags")
    if isinstance(tags, list):
        return [str(t) for t in tags if t]
    return []
