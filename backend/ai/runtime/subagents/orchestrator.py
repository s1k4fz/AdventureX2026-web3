"""Fan-out / fan-in orchestrator for market_search multi-source collect."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ai.policygen.market_search import MarketSearchReport, SearchCancelled
from ai.runtime.control import Budget, Constraints, Plan
from ai.runtime.subagents.base import SubagentContext
from ai.runtime.subagents.persist import (
    ensure_subagent_row,
    mark_subagent_finished,
    mark_subagent_running,
    persist_evidence_pack,
)
from ai.runtime.subagents.registry import get_subagent
from ai.runtime.subagents.types import (
    ALL_KINDS,
    KIND_LABELS,
    MAIN_AGENT_LABEL,
    PARALLEL_KINDS,
    EvidencePack,
    SourceBrief,
    SubagentKind,
)
from core import aio
from core.config import settings
from core.database import AsyncSessionLocal

logger = logging.getLogger("lemma.ai.runtime.subagents.orchestrator")

EventSink = Callable[[str, dict[str, Any]], Awaitable[None]]


@dataclass
class CollectResult:
    pack: EvidencePack
    candidates: list[Any] = field(default_factory=list)
    report: MarketSearchReport | None = None
    cancelled: bool = False
    briefs: list[SourceBrief] = field(default_factory=list)


class SubagentOrchestrator:
    def __init__(
        self,
        *,
        policy_id: uuid.UUID,
        goal: str,
        task_id: uuid.UUID | None,
        run_id: uuid.UUID | None,
        input_revision: int | None,
        plan: Plan,
        constraints: Constraints,
        budget: Budget,
        prompt_vars: dict[str, str] | None = None,
        is_cancelled: Callable[[], Awaitable[bool]] | None = None,
        emit_event: EventSink | None = None,
    ) -> None:
        self.policy_id = policy_id
        self.goal = goal
        self.task_id = task_id
        self.run_id = run_id
        self.input_revision = input_revision
        self.plan = plan
        self.constraints = constraints
        self.budget = budget
        self.prompt_vars = prompt_vars or {}
        self.is_cancelled = is_cancelled
        self.emit_event = emit_event
        # Keep the hard-gate market result outside ``run`` so the caller can
        # retain it when the wall-clock budget cancels slower best-effort
        # sources or the synthesizer.
        self._shared: dict[str, Any] = {}
        # Progress frames are cosmetic; persisting/emitting each one costs a
        # full DB session cycle (~1s against the remote pooler) and used to sit
        # ON the search critical path, starving the hard gate out of its
        # wall-clock budget (七月事故: polymarket stuck at keyword 3/6 with a
        # full candidate pool). Coalesce: keep only the latest frame per kind
        # and flush it from a background task; stale frames are dropped.
        self._progress_backlog: dict[SubagentKind, dict[str, Any]] = {}
        self._progress_flush: dict[SubagentKind, asyncio.Task[Any]] = {}

    def market_snapshot(self) -> tuple[list[Any], MarketSearchReport | None]:
        """Return any completed Polymarket result, including during timeout."""
        report = self._shared.get("market_report")
        return (
            list(self._shared.get("candidates") or []),
            report if isinstance(report, MarketSearchReport) else None,
        )

    async def run(self) -> CollectResult:
        if self.task_id and self.run_id:
            await self._ensure_rows()

        shared = self._shared
        briefs: dict[SubagentKind, SourceBrief] = {}

        # ------------------------------------------------------------------
        # Phase 1: start the market fast path and optional intel at the same
        # time.  The old intel -> market waterfall added the full latency of
        # every news/web source before the first Gamma request could start.
        # Questionnaire answers and the conditional refined search still give
        # compose a later quality pass, so broad search does not need to wait.
        # ------------------------------------------------------------------
        source_names = [KIND_LABELS[k] for k in PARALLEL_KINDS]
        await self._emit(
            "subagent.fanout",
            {
                "phase": "parallel_dispatch",
                "kinds": list(PARALLEL_KINDS),
                "query": self.goal[:200],
                "summary": (
                    f"{MAIN_AGENT_LABEL}并行启动行情匹配与"
                    f"{'、'.join(source_names[1:3])}等情报源"
                ),
            },
        )

        async def run_one(kind: SubagentKind) -> SourceBrief:
            return await self._run_kind(kind, shared=shared, prior_briefs=[])

        parallel_tasks = {
            kind: asyncio.create_task(run_one(kind)) for kind in PARALLEL_KINDS
        }

        # Await the hard gate first. Optional intel gets only a short grace
        # window after a market result exists; this keeps time-to-plan bounded
        # even when an external news/web service stalls.
        outcomes: dict[SubagentKind, SourceBrief | Exception] = {}
        try:
            outcomes["polymarket"] = await parallel_tasks["polymarket"]
            optional_tasks = {
                kind: task
                for kind, task in parallel_tasks.items()
                if kind != "polymarket"
            }
            # Empty/failed market supply is terminal for this workflow. There
            # is no reason to spend the optional intel grace budget once the
            # hard gate has produced no candidates.
            has_market_candidates = bool(shared.get("candidates"))
            optional_grace = (
                max(
                    0.0,
                    float(
                        getattr(settings, "agent_intel_grace_seconds", 6.0)
                        or 6.0
                    ),
                )
                if has_market_candidates
                else 0.0
            )
            done, pending = await asyncio.wait(
                optional_tasks.values(),
                timeout=optional_grace,
            )
            for kind, task in optional_tasks.items():
                if task in done:
                    try:
                        outcomes[kind] = task.result()
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # noqa: BLE001
                        outcomes[kind] = exc
                    continue
                task.cancel()
                brief = SourceBrief(
                    kind=kind,
                    status="skipped",
                    summary="未在快速通道预算内完成，不阻塞方案生成",
                    error_code="source_budget_exceeded",
                    meta={
                        "graceSeconds": getattr(
                            settings, "agent_intel_grace_seconds", 6.0
                        )
                    },
                )
                outcomes[kind] = brief
                await self._finish_row(kind, brief)
                await self._emit(
                    "subagent.completed",
                    {
                        "kind": kind,
                        "status": "skipped",
                        "summary": brief.summary,
                        "itemCount": 0,
                        "errorCode": brief.error_code,
                        "brief": brief.as_dict(),
                    },
                )
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
        except asyncio.CancelledError:
            for task in parallel_tasks.values():
                task.cancel()
            await asyncio.gather(*parallel_tasks.values(), return_exceptions=True)
            raise
        except SearchCancelled:
            for task in parallel_tasks.values():
                task.cancel()
            await asyncio.gather(*parallel_tasks.values(), return_exceptions=True)
            return CollectResult(pack=EvidencePack(), cancelled=True)
        except Exception as exc:  # noqa: BLE001
            # A hard-gate failure must also terminate best-effort siblings.
            # Most provider failures are converted into a SourceBrief by
            # ``_run_kind``, but this guard covers unexpected task-level
            # exceptions without leaving orphan HTTP/LLM work behind.
            for kind, task in parallel_tasks.items():
                if kind != "polymarket" and not task.done():
                    task.cancel()
            await asyncio.gather(
                *(
                    task
                    for kind, task in parallel_tasks.items()
                    if kind != "polymarket"
                ),
                return_exceptions=True,
            )
            outcomes["polymarket"] = exc

        for kind in PARALLEL_KINDS:
            outcome = outcomes.get(kind)
            if outcome is None:
                outcome = RuntimeError("source produced no outcome")
            if isinstance(outcome, SearchCancelled):
                for t in parallel_tasks.values():
                    t.cancel()
                await asyncio.gather(
                    *parallel_tasks.values(), return_exceptions=True
                )
                return CollectResult(pack=EvidencePack(), cancelled=True)
            if isinstance(outcome, Exception):
                logger.warning("subagent %s raised: %s", kind, outcome)
                label = KIND_LABELS.get(kind, kind)
                briefs[kind] = SourceBrief(
                    kind=kind,
                    status="failed",
                    summary=f"{label}异常",
                    error_code="subagent_exception",
                    error_message=str(outcome)[:240],
                )
                if self.task_id and self.run_id:
                    await self._finish_row(kind, briefs[kind])
                    await self._emit(
                        "subagent.failed",
                        {
                            "kind": kind,
                            "status": "failed",
                            "summary": briefs[kind].summary,
                            "errorCode": briefs[kind].error_code,
                            "errorMessage": briefs[kind].error_message,
                        },
                    )
            else:
                briefs[kind] = outcome

        if self.is_cancelled and await self.is_cancelled():
            return CollectResult(pack=EvidencePack(), cancelled=True)

        await self._emit(
            "subagent.fanin",
            {
                "phase": "parallel_gathered",
                "kinds": list(PARALLEL_KINDS),
                "summary": "市场候选与辅助情报已汇集，准备生成方案依据",
            },
        )

        # ------------------------------------------------------------------
        # Phase 2: hand the compact source evidence directly to compose. A
        # second LLM call used to rewrite these same summaries before compose;
        # removing that duplicate hop cuts latency and one failure surface.
        # ------------------------------------------------------------------
        await self._emit(
            "subagent.fanin",
            {
                "phase": "gather",
                "kinds": list(PARALLEL_KINDS),
                "summary": "证据已整理，直接进入方案生成",
            },
        )

        prior = [briefs[k] for k in PARALLEL_KINDS if k in briefs]
        synth = SourceBrief(
            kind="synthesizer",
            status="skipped",
            summary="分源证据已直送方案生成，省略重复汇总",
            item_count=len(prior),
            citations=[citation for brief in prior for citation in brief.citations][
                :12
            ],
            error_code="source_brief_inlined",
        )
        await self._finish_row("synthesizer", synth)
        await self._emit(
            "subagent.completed",
            {
                "kind": "synthesizer",
                "status": "skipped",
                "summary": synth.summary,
                "itemCount": synth.item_count,
                "errorCode": synth.error_code,
                "brief": synth.as_dict(),
            },
        )
        briefs["synthesizer"] = synth

        ordered = [briefs[k] for k in ALL_KINDS if k in briefs]
        citations = []
        for b in ordered:
            citations.extend(b.citations)
        pack_brief = ""
        if synth.status == "succeeded":
            pack_brief = str((synth.meta or {}).get("brief") or synth.summary)
        pack = EvidencePack(
            sources=ordered,
            brief=pack_brief,
            citations=citations[:24],
        )

        if self.task_id and self.run_id:
            async with AsyncSessionLocal() as db:
                await persist_evidence_pack(
                    db, policy_id=self.policy_id, pack=pack
                )
                await db.commit()

        report = shared.get("market_report")
        candidates = list(shared.get("candidates") or [])
        return CollectResult(
            pack=pack,
            candidates=candidates,
            report=report,
            briefs=ordered,
        )

    async def _ensure_rows(self) -> None:
        assert self.task_id and self.run_id
        async with AsyncSessionLocal() as db:
            for kind in ALL_KINDS:
                await ensure_subagent_row(
                    db,
                    task_id=self.task_id,
                    run_id=self.run_id,
                    kind=kind,
                    query_text=self.goal,
                )
            await db.commit()

    async def _finish_row(self, kind: SubagentKind, brief: SourceBrief) -> None:
        if not (self.task_id and self.run_id):
            return
        async with AsyncSessionLocal() as db:
            row = await ensure_subagent_row(
                db,
                task_id=self.task_id,
                run_id=self.run_id,
                kind=kind,
                query_text=self.goal,
            )
            await mark_subagent_finished(db, row=row, brief=brief)
            await db.commit()

    async def _run_kind(
        self,
        kind: SubagentKind,
        *,
        shared: dict[str, Any],
        prior_briefs: list[SourceBrief],
    ) -> SourceBrief:
        if self.is_cancelled and await self.is_cancelled():
            raise SearchCancelled()

        subagent_id: str | None = None
        if self.task_id and self.run_id:
            async with AsyncSessionLocal() as db:
                row = await ensure_subagent_row(
                    db,
                    task_id=self.task_id,
                    run_id=self.run_id,
                    kind=kind,
                    query_text=self.goal,
                )
                await mark_subagent_running(db, row=row)
                subagent_id = str(row.id)
                await db.commit()

        label = KIND_LABELS.get(kind, kind)
        await self._emit(
            "subagent.started",
            {
                "subagentId": subagent_id,
                "kind": kind,
                "status": "running",
                "summary": f"启动 {label}",
                "query": self.goal[:200],
                "parentStep": "market_search",
            },
        )

        async def on_progress(data: dict[str, Any]) -> None:
            progress = dict(data) if isinstance(data, dict) else {"summary": str(data)}
            # Never block the source on DB/event round trips: queue the frame
            # and return. The flusher persists+emits the latest frame only.
            self._queue_progress(kind, subagent_id, progress)

        ctx = SubagentContext(
            kind=kind,
            goal=self.goal,
            policy_id=self.policy_id,
            task_id=self.task_id,
            run_id=self.run_id,
            input_revision=self.input_revision,
            plan=self.plan,
            constraints=self.constraints,
            budget=self.budget,
            prompt_vars=self.prompt_vars,
            prior_briefs=prior_briefs,
            shared=shared,
            on_progress=on_progress,
            is_cancelled=self.is_cancelled,
        )
        agent = get_subagent(kind)
        try:
            brief = await agent.run(ctx)
        except SearchCancelled:
            await self._drain_progress(kind)
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("subagent %s failed", kind)
            brief = SourceBrief(
                kind=kind,
                status="failed",
                summary=f"{label}失败",
                error_code="subagent_exception",
                error_message=str(exc)[:240],
            )

        # Ordering: the terminal brief must land after the last progress frame,
        # or a late flush would overwrite brief progress_json with a stale one.
        await self._drain_progress(kind)
        await self._finish_row(kind, brief)
        event_type = (
            "subagent.completed"
            if brief.status in ("succeeded", "skipped")
            else "subagent.failed"
        )
        await self._emit(
            event_type,
            {
                "subagentId": subagent_id,
                "kind": kind,
                "status": brief.status,
                "summary": brief.summary,
                "itemCount": brief.item_count,
                "errorCode": brief.error_code,
                "errorMessage": brief.error_message,
                "brief": brief.as_dict(),
            },
        )
        return brief

    def _queue_progress(
        self,
        kind: SubagentKind,
        subagent_id: str | None,
        progress: dict[str, Any],
    ) -> None:
        """Store the latest progress frame and ensure one flusher is running."""
        self._progress_backlog[kind] = progress
        task = self._progress_flush.get(kind)
        if task is None or task.done():
            self._progress_flush[kind] = aio.spawn_protected(
                self._flush_progress(kind, subagent_id)
            )

    async def _flush_progress(
        self, kind: SubagentKind, subagent_id: str | None
    ) -> None:
        """Persist+emit the newest frame per kind until the backlog is empty."""
        while True:
            progress = self._progress_backlog.pop(kind, None)
            if progress is None:
                return
            # The adapter's subagent.updated handler persists progress_json;
            # only write directly when there is no event sink to do it.
            if self.emit_event is None and self.task_id and self.run_id:
                try:
                    from ai.runtime.subagents.persist import (
                        update_subagent_progress,
                    )

                    async with AsyncSessionLocal() as db:
                        await update_subagent_progress(
                            db,
                            task_id=self.task_id,
                            run_id=self.run_id,
                            kind=kind,
                            progress=progress,
                            query_text=self.goal[:200],
                        )
                        await db.commit()
                except Exception:  # noqa: BLE001
                    logger.warning(
                        "persist progress failed for %s", kind, exc_info=True
                    )
            await self._emit(
                "subagent.updated",
                {
                    "subagentId": subagent_id,
                    "kind": kind,
                    "status": "running",
                    "summary": progress.get("summary") or progress.get("phase"),
                    "progress": progress,
                    "query": self.goal[:200],
                },
            )

    async def _drain_progress(self, kind: SubagentKind) -> None:
        """Drop queued frames and wait out the in-flight flush for ordering."""
        self._progress_backlog.pop(kind, None)
        task = self._progress_flush.pop(kind, None)
        if task is not None and not task.done():
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(task), timeout=15.0)

    async def _emit(self, event_type: str, data: dict[str, Any]) -> None:
        if self.emit_event is None:
            return
        try:
            await self.emit_event(event_type, data)
        except Exception:  # noqa: BLE001
            logger.warning("subagent event emit failed: %s", event_type, exc_info=True)
