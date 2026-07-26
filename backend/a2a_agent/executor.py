from __future__ import annotations

from collections.abc import Awaitable, Callable

from a2a.helpers import (
    get_message_text,
    new_task_from_user_message,
    new_text_message,
    new_text_part,
)
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.tasks import TaskUpdater
from a2a.types import TaskState
from a2a.utils.errors import TaskNotCancelableError

from a2a_agent.errors import A2ASkillError
from a2a_agent.intent import resolve_skill
from a2a_agent.light_loop import run_light_skill
from a2a_agent.task_bridge import run_full_system_task

OnStatus = Callable[[str], Awaitable[None]] | None


async def handle_skill(
    skill: str,
    user_text: str,
    on_status: OnStatus = None,
) -> str:
    """Dispatch a resolved skill to light loop or full-system bridge.

    Propagates A2ASkillError from bridge/light failure paths.
    """
    if skill == "full_system_task":
        return await run_full_system_task(user_text, on_status=on_status)
    return await run_light_skill(skill, user_text, on_status=on_status)


class LemmaAgentExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        task = context.current_task or new_task_from_user_message(context.message)
        if context.current_task is None:
            await event_queue.enqueue_event(task)
        updater = TaskUpdater(
            event_queue=event_queue, task_id=task.id, context_id=task.context_id
        )
        await updater.update_status(
            state=TaskState.TASK_STATE_WORKING,
            message=new_text_message("routing"),
        )
        raw = get_message_text(context.message) or ""
        try:
            skill, user_text = await resolve_skill(raw)
            await updater.update_status(
                state=TaskState.TASK_STATE_WORKING,
                message=new_text_message(f"skill:{skill}"),
            )

            async def on_status(msg: str) -> None:
                await updater.update_status(
                    state=TaskState.TASK_STATE_WORKING,
                    message=new_text_message(msg[:500]),
                )

            result = await handle_skill(skill, user_text, on_status=on_status)
            await updater.add_artifact(
                parts=[new_text_part(text=result, media_type="text/plain")]
            )
            await updater.update_status(
                state=TaskState.TASK_STATE_COMPLETED,
                message=new_text_message("completed"),
            )
        except A2ASkillError as exc:
            await updater.update_status(
                state=TaskState.TASK_STATE_FAILED,
                message=new_text_message(f"failed: {exc}"[:500]),
            )
        except Exception as exc:
            await updater.update_status(
                state=TaskState.TASK_STATE_FAILED,
                message=new_text_message(f"failed: {exc}"[:500]),
            )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        # Map to the protocol-level JSON-RPC error instead of a bare 500.
        raise TaskNotCancelableError("cancel not supported in v1")
