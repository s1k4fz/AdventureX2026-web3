"""One-off demo reset: wipe ALL policies (and policy-planning agent tasks).

portfolios / positions / market_search_candidates cascade from policies;
agent task events / approvals cascade from agent_tasks. Policy-planning agent
tasks point at policies via primary_ref_id (deliberately no FK), so they are
removed explicitly to keep the board clean.

Usage (from backend/):
  uv run python scripts/wipe_policies.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from core.database import AsyncSessionLocal, engine  # noqa: E402

COUNTS = [
    ("policies", "SELECT count(*) FROM policies"),
    ("policy_portfolios", "SELECT count(*) FROM policy_portfolios"),
    ("policy_positions", "SELECT count(*) FROM policy_positions"),
    ("market_search_candidates", "SELECT count(*) FROM market_search_candidates"),
    (
        "agent_tasks(policy)",
        "SELECT count(*) FROM agent_tasks WHERE primary_ref_type = 'policy'",
    ),
]


async def main() -> None:
    async with AsyncSessionLocal() as db:
        r1 = await db.execute(
            text("DELETE FROM agent_tasks WHERE primary_ref_type = 'policy'")
        )
        r2 = await db.execute(text("DELETE FROM policies"))
        await db.commit()
        print(f"deleted agent_tasks={r1.rowcount}, policies={r2.rowcount}")
        for label, sql in COUNTS:
            n = (await db.execute(text(sql))).scalar()
            print(f"{label}: {n}")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
