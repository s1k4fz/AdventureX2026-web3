from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from a2a.types import TaskState
from a2a.utils.errors import TaskNotCancelableError

from a2a_agent.errors import A2ASkillError
from a2a_agent.executor import LemmaAgentExecutor, handle_skill


@pytest.mark.asyncio
async def test_handle_skill_routes_light_skills():
    on_status = AsyncMock()
    with patch(
        "a2a_agent.executor.run_light_skill",
        new_callable=AsyncMock,
        return_value="ok",
    ) as mock_light:
        result = await handle_skill(
            "factor_analysis", "analyze momentum", on_status=on_status
        )
    assert result == "ok"
    mock_light.assert_awaited_once_with(
        "factor_analysis", "analyze momentum", on_status=on_status
    )


@pytest.mark.asyncio
async def test_handle_skill_routes_full_system_task():
    on_status = AsyncMock()
    with (
        patch(
            "a2a_agent.executor.run_full_system_task",
            new_callable=AsyncMock,
            return_value="summary",
        ) as mock_full,
        patch(
            "a2a_agent.executor.run_light_skill",
            new_callable=AsyncMock,
        ) as mock_light,
    ):
        result = await handle_skill(
            "full_system_task", "insure oil spike", on_status=on_status
        )
    assert result == "summary"
    mock_full.assert_awaited_once_with(
        "insure oil spike", on_status=on_status
    )
    mock_light.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_skill_propagates_a2a_skill_error():
    with patch(
        "a2a_agent.executor.run_full_system_task",
        new_callable=AsyncMock,
        side_effect=A2ASkillError("A2A_SYSTEM_USER_ID is not configured"),
    ):
        with pytest.raises(A2ASkillError, match="A2A_SYSTEM_USER_ID"):
            await handle_skill("full_system_task", "goal")


@pytest.mark.asyncio
async def test_execute_maps_a2a_skill_error_to_failed():
    """Soft skill failures must set TASK_STATE_FAILED, not COMPLETED."""
    status_states: list[TaskState] = []

    updater = MagicMock()
    updater.update_status = AsyncMock(
        side_effect=lambda *, state, message=None: status_states.append(state)
    )
    updater.add_artifact = AsyncMock()

    message = MagicMock()
    task = MagicMock()
    task.id = "task-1"
    task.context_id = "ctx-1"

    context = MagicMock()
    context.current_task = task
    context.message = message
    event_queue = MagicMock()
    event_queue.enqueue_event = AsyncMock()

    with (
        patch("a2a_agent.executor.TaskUpdater", return_value=updater),
        patch("a2a_agent.executor.get_message_text", return_value="hello"),
        patch(
            "a2a_agent.executor.resolve_skill",
            new_callable=AsyncMock,
            return_value=("full_system_task", "hello"),
        ),
        patch(
            "a2a_agent.executor.handle_skill",
            new_callable=AsyncMock,
            side_effect=A2ASkillError("timed out waiting for compose"),
        ),
    ):
        await LemmaAgentExecutor().execute(context, event_queue)

    assert TaskState.TASK_STATE_FAILED in status_states
    assert TaskState.TASK_STATE_COMPLETED not in status_states
    updater.add_artifact.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_raises_protocol_error():
    """cancel maps to TaskNotCancelableError (JSON-RPC), never a bare 500."""
    with pytest.raises(TaskNotCancelableError):
        await LemmaAgentExecutor().cancel(MagicMock(), MagicMock())
