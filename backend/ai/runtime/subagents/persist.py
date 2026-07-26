"""DB helpers for agent_subagents rows + EvidencePack on policy intake."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai.runtime.subagents.types import EvidencePack, SourceBrief, SubagentKind
from models.agent_task import AgentSubagent
from models.policy import Policy


async def ensure_subagent_row(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    run_id: uuid.UUID,
    kind: SubagentKind,
    query_text: str | None = None,
) -> AgentSubagent:
    result = await db.execute(
        select(AgentSubagent).where(
            AgentSubagent.run_id == run_id,
            AgentSubagent.kind == kind,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        return row
    row = AgentSubagent(
        task_id=task_id,
        run_id=run_id,
        parent_step="market_search",
        kind=kind,
        status="pending",
        query_text=query_text,
    )
    db.add(row)
    await db.flush()
    return row


async def mark_subagent_running(
    db: AsyncSession,
    *,
    row: AgentSubagent,
    progress: dict[str, Any] | None = None,
) -> None:
    row.status = "running"
    row.started_at = row.started_at or datetime.now(UTC)
    row.error_code = None
    row.error_message = None
    if progress is not None:
        row.progress_json = progress
    await db.flush()


async def update_subagent_progress(
    db: AsyncSession,
    *,
    task_id: uuid.UUID,
    run_id: uuid.UUID,
    kind: SubagentKind,
    progress: dict[str, Any],
    query_text: str | None = None,
) -> AgentSubagent:
    """Persist mid-run progress so refresh can restore the last phase."""
    row = await ensure_subagent_row(
        db, task_id=task_id, run_id=run_id, kind=kind, query_text=query_text
    )
    if row.status == "pending":
        row.status = "running"
        row.started_at = row.started_at or datetime.now(UTC)
    row.progress_json = progress
    if query_text and not row.query_text:
        row.query_text = query_text
    await db.flush()
    return row


async def mark_subagent_finished(
    db: AsyncSession,
    *,
    row: AgentSubagent,
    brief: SourceBrief,
) -> None:
    row.status = brief.status
    row.brief_json = brief.as_dict()
    row.progress_json = {
        "summary": brief.summary,
        "itemCount": brief.item_count,
    }
    row.error_code = brief.error_code
    row.error_message = brief.error_message
    row.finished_at = datetime.now(UTC)
    await db.flush()


async def persist_evidence_pack(
    db: AsyncSession,
    *,
    policy_id: uuid.UUID,
    pack: EvidencePack,
) -> None:
    policy = await db.get(Policy, policy_id)
    if policy is None:
        return
    intake = dict(policy.intake_json or {})
    intake["evidencePack"] = pack.as_dict()
    policy.intake_json = intake
    await db.flush()
