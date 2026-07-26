"""AI-powered task title and description generation.

Given a user's goal text, calls the LLM to produce:
- A concise task title (≤ 25 chars) that captures the essence
- A rich description (≤ 200 chars) suitable for schedule/calendar display

Falls back gracefully to deterministic truncation on failure.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass

from core.database import AsyncSessionLocal
from services import agent_event_service

logger = logging.getLogger("lemma.services.task_naming")

_NAMING_PROMPT = """\
你是一个任务命名助手。根据用户描述的保障规划目标，生成简洁的任务标题和描述。

要求：
1. title：用中文概括任务核心意图，不超过25个字符，像日程标题一样简短有力
2. description：用一句话描述任务的关键信息（保障对象、时间范围、核心诉求），不超过120个字符，适合在日程卡片中展示

示例：
- 目标："我下个月要去日本旅行，担心航班延误和行李丢失，想要一个旅行保障"
  → title: "日本旅行保障"
  → description: "为下月日本行程提供航班延误与行李丢失风险保障方案"

- 目标："比特币最近波动很大，我持有5个BTC，想对冲下跌风险"
  → title: "BTC下跌对冲"
  → description: "为5 BTC持仓规划下跌风险对冲方案，应对近期高波动市场"

- 目标："帮我关注一下美国大选结果对我的投资组合的影响"
  → title: "美选影响监控"
  → description: "监控美国大选结果对投资组合的潜在冲击，预判风险敞口"

请严格以JSON格式返回，不要包含其他内容：
{"title": "...", "description": "..."}
"""


@dataclass(frozen=True)
class TaskNaming:
    """Result of AI task naming."""

    title: str
    description: str


def _fallback_naming(goal_text: str) -> TaskNaming:
    """Deterministic fallback when AI is unavailable."""
    title = " ".join(goal_text.strip().split())[:50] or "新保障任务"
    # Take a meaningful snippet for description
    desc = " ".join(goal_text.strip().split())[:120] or "保障规划任务"
    return TaskNaming(title=title, description=desc)


async def generate_task_naming(goal_text: str, *, user_id: str | None = None) -> TaskNaming:
    """Call the LLM to generate a concise title and description for a task.

    Returns a TaskNaming with AI-generated or fallback values.
    """
    from ai.client import ai_client
    from ai.types import AIUseCase, ChatMessage

    if not goal_text.strip():
        return _fallback_naming(goal_text)

    try:
        messages = [
            ChatMessage(role="system", content=_NAMING_PROMPT),
            ChatMessage(role="user", content=f"用户目标：{goal_text.strip()[:2000]}"),
        ]
        response = await ai_client.chat(
            AIUseCase.TEXT_CHAT,
            messages,
            user_id=user_id,
        )
        # Parse JSON response
        text = response.text.strip()
        # Handle markdown code block wrapping
        if text.startswith("```"):
            lines = text.split("\n")
            lines = [l for l in lines if not l.startswith("```")]
            text = "\n".join(lines).strip()

        result = json.loads(text)
        title = str(result.get("title", "")).strip()[:50]
        description = str(result.get("description", "")).strip()[:200]

        if not title:
            return _fallback_naming(goal_text)

        return TaskNaming(
            title=title,
            description=description or _fallback_naming(goal_text).description,
        )
    except Exception as exc:
        logger.warning("AI task naming failed, using fallback: %s", exc)
        return _fallback_naming(goal_text)


async def apply_task_naming(
    task_id: uuid.UUID,
    goal_text: str,
    *,
    user_id: str | None = None,
    run_id: uuid.UUID | None = None,
) -> None:
    """Asynchronously generate and apply AI title+description to a task.

    Called via spawn_protected after task creation. Updates the task in a new
    DB session and emits a task.renamed event so the frontend updates.
    """
    from models.agent_task import AgentTask

    naming = await generate_task_naming(goal_text, user_id=user_id)

    async with AsyncSessionLocal() as db:
        task = await db.get(AgentTask, task_id)
        if task is None:
            return

        # Only update if the title is still the truncation default
        # (user hasn't manually renamed it)
        old_title = task.title
        truncated_default = " ".join(goal_text.strip().split())[:50] or "新保障任务"
        if old_title == truncated_default or old_title == "新保障任务":
            task.title = naming.title

        task.description = naming.description

        event = await agent_event_service.append_event(
            db,
            task_id=task_id,
            run_id=run_id,
            event_type="task.renamed",
            data={
                "taskId": str(task_id),
                "title": task.title,
                "description": task.description,
            },
        )
        await db.commit()
        await agent_event_service.publish_notify(task_id, event.sequence)

    logger.info(
        "AI named task %s: title=%r desc=%r",
        task_id,
        naming.title,
        naming.description[:60],
    )
