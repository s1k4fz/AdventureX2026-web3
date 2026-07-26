"""Live E2E check for the one-click demo pending-settlement policy.

Runs the exact service code path the API endpoint uses, against the real
Injective EVM testnet and the real database.

Usage (from backend/):
  uv run python scripts/verify_demo_policy.py <profile-uuid>
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

logging.basicConfig(level=logging.INFO)

from core.database import AsyncSessionLocal, engine  # noqa: E402
from services import policy_service  # noqa: E402
from services.policy_demo_service import (  # noqa: E402
    create_pending_settlement_policy,
)


async def main() -> None:
    user_id = uuid.UUID(sys.argv[1])
    async with AsyncSessionLocal() as db:
        policy_id = await create_pending_settlement_policy(db, user_id=user_id)
        print(f"\nCREATED policy_id = {policy_id}")
        detail = await policy_service.get_policy_detail(
            db, user_id=user_id, policy_id=policy_id
        )
        assert detail is not None, "detail readback failed"
        print(f"status          = {detail.status}")
        print(f"coverage_end    = {detail.coverage_end}")
        print(f"on_chain_pid    = {detail.on_chain_policy_id}")
        print(f"open_tx         = {detail.open_tx}")
        print(f"premium         = {detail.premium}")
        selected = next(
            p for p in detail.portfolios if p.id == detail.selected_portfolio_id
        )
        for pos in selected.positions:
            print(f"  leg: side={pos.side} weight={pos.weight} q={pos.question[:60]}")

        # Committed-state chain readback (red line ②).
        from services import chain_service  # noqa: PLC0415

        snap = chain_service.read_policy_snapshot(detail.on_chain_policy_id)
        print(f"chain user      = {snap['user']}")
        print(f"chain premium   = {snap['premium'] / 1_000_000} USDC")
        print(f"chain maxPayout = {snap['maxPayout'] / 1_000_000} USDC")
        print(f"chain settled   = {snap['settled']}")
        print(f"chain legs      = {len(snap['positions'])}")
        assert snap["settled"] is False
        assert len(snap["positions"]) == 3
    await engine.dispose()
    print("\n✓ demo pending-settlement policy verified end-to-end")


if __name__ == "__main__":
    asyncio.run(main())
