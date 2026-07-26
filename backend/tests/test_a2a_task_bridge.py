"""Unit tests for A2A full_system_task → policy_planning bridge (heavy mocks)."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from a2a_agent.errors import A2ASkillError
from core.config import settings


@pytest.mark.asyncio
async def test_missing_system_user_id_raises_skill_error(monkeypatch):
    from a2a_agent import task_bridge

    monkeypatch.setattr(settings, "a2a_system_user_id", "")
    statuses: list[str] = []

    async def on_status(msg: str) -> None:
        statuses.append(msg)

    with pytest.raises(A2ASkillError, match="A2A_SYSTEM_USER_ID"):
        await task_bridge.run_full_system_task("防油价暴涨", on_status=on_status)
    assert statuses == []


@pytest.mark.asyncio
async def test_run_full_system_task_summary_contains_task_id(monkeypatch):
    from a2a_agent import task_bridge

    task_id = uuid.uuid4()
    policy_id = uuid.uuid4()
    user_id = uuid.uuid4()

    monkeypatch.setattr(settings, "a2a_system_user_id", str(user_id))
    monkeypatch.setattr(settings, "deepseek_model_pro", "deepseek-v4-pro")

    questionnaire = {
        "factor_categories": [
            {"id": "oil", "label": "油价", "rationale": "相关"},
            {"id": "fx", "label": "汇率", "rationale": "相关"},
        ],
        "questions": [
            {
                "id": "horizon",
                "title": "覆盖窗口",
                "options": ["1个月", "3个月"],
            }
        ],
    }

    task = SimpleNamespace(id=task_id, input_revision=0)
    policy = SimpleNamespace(
        id=policy_id,
        status="intake",
        search_status="searching",
        intake_json={"questionnaire": questionnaire},
        title="oil hedge",
        portfolios=[],
    )

    start_mock = AsyncMock(return_value=(task, policy))
    submit_mock = AsyncMock(
        return_value=SimpleNamespace(
            id=policy_id,
            status="composing",
            portfolios=[],
        )
    )
    chat_mock = AsyncMock(return_value='{"horizon": "3个月"}')

    monkeypatch.setattr(task_bridge, "start_policy_task", start_mock)
    monkeypatch.setattr(task_bridge, "submit_answers", submit_mock)
    monkeypatch.setattr(task_bridge, "chat_text", chat_mock)

    # Session context manager: yield a dummy db
    class _Sess:
        async def __aenter__(self):
            return SimpleNamespace()

        async def __aexit__(self, *args):
            return False

        async def commit(self):
            return None

        async def get(self, model, pk):
            return policy

    monkeypatch.setattr(task_bridge, "AsyncSessionLocal", lambda: _Sess())

    # Fast-forward waits: questionnaire already present; compose already terminal
    async def fake_wait_q(policy_id, *, task_id=None, on_status=None, timeout_s=180):
        if on_status:
            await on_status("waiting:questionnaire")
        return task_bridge.WaitOutcome("ok", questionnaire)

    async def fake_wait_compose(
        policy_id, *, task_id=None, on_status=None, timeout_s=300
    ):
        if on_status:
            await on_status("waiting:compose")
        return task_bridge.WaitOutcome(
            "ok",
            SimpleNamespace(
                id=policy_id,
                status="proposed",
                search_status="searched",
                intake_json={
                    "questionnaire": questionnaire,
                    "answers": {"horizon": "3个月"},
                },
                title="oil hedge",
                portfolios=[],
            ),
        )

    monkeypatch.setattr(task_bridge, "_wait_questionnaire", fake_wait_q)
    monkeypatch.setattr(task_bridge, "_wait_compose", fake_wait_compose)

    statuses: list[str] = []

    async def on_status(msg: str) -> None:
        statuses.append(msg)

    out = await task_bridge.run_full_system_task(
        "担心油价暴涨", on_status=on_status
    )

    assert str(task_id) in out
    assert str(policy_id) in out
    assert "Full-system policy task complete." in out
    assert "proposed" in out or "search" in out.lower() or "horizon" in out
    assert any(f"task:{task_id}" in s for s in statuses)
    start_mock.assert_awaited_once()
    submit_mock.assert_awaited_once()
    chat_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_full_system_task_policy_missing_not_labeled_timeout(monkeypatch):
    """Missing/failed waits must not be summarized as timed out."""
    from a2a_agent import task_bridge

    task_id = uuid.uuid4()
    policy_id = uuid.uuid4()
    user_id = uuid.uuid4()

    monkeypatch.setattr(settings, "a2a_system_user_id", str(user_id))

    task = SimpleNamespace(id=task_id)
    policy = SimpleNamespace(id=policy_id)
    start_mock = AsyncMock(return_value=(task, policy))
    monkeypatch.setattr(task_bridge, "start_policy_task", start_mock)

    class _Sess:
        async def __aenter__(self):
            return SimpleNamespace()

        async def __aexit__(self, *args):
            return False

        async def commit(self):
            return None

    monkeypatch.setattr(task_bridge, "AsyncSessionLocal", lambda: _Sess())

    async def fake_wait_q(policy_id, *, task_id=None, on_status=None, timeout_s=180):
        if on_status:
            await on_status("error:policy_missing")
        return task_bridge.WaitOutcome("missing")

    monkeypatch.setattr(task_bridge, "_wait_questionnaire", fake_wait_q)

    with pytest.raises(A2ASkillError) as ei:
        await task_bridge.run_full_system_task("担心油价暴涨")

    out = str(ei.value)
    assert "timed out" not in out.lower()
    assert "policy missing" in out
    assert str(task_id) in out
    assert str(policy_id) in out
    start_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_full_system_task_policy_failed_not_labeled_timeout(monkeypatch):
    from a2a_agent import task_bridge

    task_id = uuid.uuid4()
    policy_id = uuid.uuid4()
    user_id = uuid.uuid4()

    monkeypatch.setattr(settings, "a2a_system_user_id", str(user_id))

    task = SimpleNamespace(id=task_id)
    policy = SimpleNamespace(id=policy_id)
    start_mock = AsyncMock(return_value=(task, policy))
    monkeypatch.setattr(task_bridge, "start_policy_task", start_mock)

    class _Sess:
        async def __aenter__(self):
            return SimpleNamespace()

        async def __aexit__(self, *args):
            return False

        async def commit(self):
            return None

    monkeypatch.setattr(task_bridge, "AsyncSessionLocal", lambda: _Sess())

    async def fake_wait_q(policy_id, *, task_id=None, on_status=None, timeout_s=180):
        return task_bridge.WaitOutcome("failed")

    monkeypatch.setattr(task_bridge, "_wait_questionnaire", fake_wait_q)

    with pytest.raises(A2ASkillError) as ei:
        await task_bridge.run_full_system_task("担心油价暴涨")

    out = str(ei.value)
    assert "timed out" not in out.lower()
    assert "policy failed" in out
    assert str(task_id) in out
    assert str(policy_id) in out


@pytest.mark.asyncio
async def test_compose_failed_status_raises_skill_error(monkeypatch):
    """Compose terminal `failed` must not emit a success summary."""
    from a2a_agent import task_bridge

    task_id = uuid.uuid4()
    policy_id = uuid.uuid4()
    user_id = uuid.uuid4()

    monkeypatch.setattr(settings, "a2a_system_user_id", str(user_id))
    monkeypatch.setattr(settings, "deepseek_model_pro", "deepseek-v4-pro")

    questionnaire = {
        "questions": [
            {"id": "horizon", "title": "覆盖窗口", "options": ["1个月", "3个月"]}
        ],
    }

    task = SimpleNamespace(id=task_id)
    policy = SimpleNamespace(id=policy_id)
    start_mock = AsyncMock(return_value=(task, policy))
    submit_mock = AsyncMock(return_value=SimpleNamespace(id=policy_id))
    chat_mock = AsyncMock(return_value='{"horizon": "3个月"}')

    monkeypatch.setattr(task_bridge, "start_policy_task", start_mock)
    monkeypatch.setattr(task_bridge, "submit_answers", submit_mock)
    monkeypatch.setattr(task_bridge, "chat_text", chat_mock)

    class _Sess:
        async def __aenter__(self):
            return SimpleNamespace()

        async def __aexit__(self, *args):
            return False

        async def commit(self):
            return None

    monkeypatch.setattr(task_bridge, "AsyncSessionLocal", lambda: _Sess())

    async def fake_wait_q(policy_id, *, task_id=None, on_status=None, timeout_s=180):
        return task_bridge.WaitOutcome("ok", questionnaire)

    async def fake_wait_compose(
        policy_id, *, task_id=None, on_status=None, timeout_s=300
    ):
        return task_bridge.WaitOutcome("failed")

    monkeypatch.setattr(task_bridge, "_wait_questionnaire", fake_wait_q)
    monkeypatch.setattr(task_bridge, "_wait_compose", fake_wait_compose)

    with pytest.raises(A2ASkillError) as ei:
        await task_bridge.run_full_system_task("担心油价暴涨")

    out = str(ei.value)
    assert "Full-system policy task complete." not in out
    assert "policy failed" in out
    assert "compose" in out
    assert str(task_id) in out


@pytest.mark.asyncio
async def test_wait_compose_failed_status_is_failure_outcome(monkeypatch):
    """_wait_compose must return WaitOutcome('failed') for policy.status=failed."""
    from a2a_agent import task_bridge

    policy_id = uuid.uuid4()
    failed_policy = SimpleNamespace(
        id=policy_id,
        status="failed",
        search_status="failed",
        title="x",
        intake_json={},
        portfolios=[],
    )

    class _Result:
        def scalar_one_or_none(self):
            return failed_policy

    class _Sess:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, *_a, **_k):
            return _Result()

    monkeypatch.setattr(task_bridge, "AsyncSessionLocal", lambda: _Sess())
    monkeypatch.setattr(task_bridge, "_POLL_INTERVAL_S", 0.01)

    statuses: list[str] = []

    async def on_status(msg: str) -> None:
        statuses.append(msg)

    out = await task_bridge._wait_compose(
        policy_id, on_status=on_status, timeout_s=5.0
    )
    assert out.reason == "failed"
    assert any("failed" in s for s in statuses)
