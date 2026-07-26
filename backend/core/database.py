import asyncio
import contextlib
from collections.abc import AsyncGenerator

import anyio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from core.aio import spawn_protected
from core.config import settings


class Base(DeclarativeBase):
    pass


# Connection discipline (6-30 / 7-2 两次事故复盘):
# - connect_args 超时: 网络链路劣化时, 已建连接会被黑洞、SSL 握手会被掐断; asyncpg
#   默认等 OS 级 TCP 超时 (60s+), 流水线每一步都跟着挂。收紧为秒级快速失败, 交给上层
#   既有的重试/降级处理。command_timeout 对单条语句生效, 本项目全部是毫秒级 OLTP 查询。
# - pool_size/max_overflow: Supabase session pooler 的客户端配额有限 (项目 Pool Size,
#   超限报 EMAXCONNSESSION)。SQLAlchemy 默认 5+10 让单进程能冲到 15 条 —— uvicorn 与
#   每个 Celery worker 各持一份 engine, 必须收敛每进程上限。
# - pool_recycle: 长闲连接主动换新, 避免被 pooler/NAT 掐掉后才发现。
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
    pool_recycle=1800,
    connect_args={"timeout": 10, "command_timeout": 30},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
)


async def _cleanup_session(session: AsyncSession, *, rollback: bool) -> None:
    """Return a session connection even when its request is being cancelled.

    ``asyncio.shield(coro)`` alone is not sufficient here: the inner coroutine
    survives, but the cancelled caller stops awaiting it immediately.  Keep the
    cleanup in a strongly referenced task and shield this await from AnyIO's
    request cancel scope, which otherwise re-cancels every checkpoint.
    """

    async def cleanup() -> None:
        if rollback:
            with contextlib.suppress(Exception):
                await session.rollback()
        with contextlib.suppress(Exception):
            await session.close()

    cleanup_task = spawn_protected(cleanup())
    with anyio.CancelScope(shield=True):
        await asyncio.shield(cleanup_task)


class _ShieldedSession:
    """Async context manager that shields session close from CancelledError.

    Use in async generators (SSE streams, background loops) where
    CancelledError can propagate into __aexit__ and leak connections.
    """

    __slots__ = ("_session",)

    def __init__(self) -> None:
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        self._session = AsyncSessionLocal()
        return self._session

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:  # noqa: ANN001
        session = self._session
        if session is None:
            return
        await _cleanup_session(session, rollback=exc_type is not None)


def shielded_session() -> _ShieldedSession:
    """Return a context manager whose close is immune to task cancellation."""
    return _ShieldedSession()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    # Explicit lifecycle + shielded close: when the client aborts (SSE disconnect
    # / navigation), anyio's cancel scope re-raises CancelledError on every await
    # in this task. An unshielded session.close() can be interrupted mid-flight,
    # leaving the asyncpg connection non-checked-in for the GC to terminate.
    session = AsyncSessionLocal()
    try:
        yield session
    except BaseException:
        await _cleanup_session(session, rollback=True)
        raise
    else:
        await _cleanup_session(session, rollback=False)
