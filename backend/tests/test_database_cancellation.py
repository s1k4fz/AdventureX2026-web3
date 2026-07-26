"""Regression coverage for returning DB connections during request cancellation."""

from __future__ import annotations

import asyncio

import anyio
import pytest

from core import database


class _Session:
    def __init__(self) -> None:
        self.rollback_started = asyncio.Event()
        self.allow_rollback = asyncio.Event()
        self.rolled_back = False
        self.closed = False

    async def rollback(self) -> None:
        self.rollback_started.set()
        await self.allow_rollback.wait()
        self.rolled_back = True

    async def close(self) -> None:
        await asyncio.sleep(0)
        self.closed = True


@pytest.mark.asyncio
async def test_cleanup_completes_inside_cancelled_anyio_scope() -> None:
    session = _Session()

    async def release_rollback() -> None:
        await session.rollback_started.wait()
        session.allow_rollback.set()

    release_task = asyncio.create_task(release_rollback())
    with anyio.CancelScope() as request_scope:
        request_scope.cancel()
        await database._cleanup_session(session, rollback=True)  # noqa: SLF001

    await release_task
    assert session.rolled_back
    assert session.closed


@pytest.mark.asyncio
async def test_shielded_session_closes_after_body_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _Session()
    session.allow_rollback.set()
    monkeypatch.setattr(database, "AsyncSessionLocal", lambda: session)

    with anyio.CancelScope() as request_scope:
        async with database.shielded_session():
            request_scope.cancel()

    assert session.rolled_back is False
    assert session.closed
