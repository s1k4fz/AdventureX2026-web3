from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from a2a_agent.deepseek_client import create_chat_completion
from a2a_agent.errors import A2ASkillError
from a2a_agent.intent import SkillId
from a2a_agent.tools import TOOL_REGISTRY as _TOOL_REGISTRY
from core.config import settings

logger = logging.getLogger("lemma.a2a_agent.light_loop")

# Re-export for tests / monkeypatch
TOOL_REGISTRY = _TOOL_REGISTRY

MAX_ROUNDS = 6

_SYSTEM_PROMPTS: dict[SkillId, str] = {
    "factor_analysis": (
        "You are a quantitative factor research assistant. Use the provided tools "
        "to fetch real market data before answering. Analyze factors only from "
        "tool results—never invent prices or series. Reply in the same language "
        "as the user (Chinese or English)."
    ),
    "strategy_backtest": (
        "You are a strategy backtest narrator. Use tools for real data context, "
        "then produce a simplified backtest narrative: assumptions, methodology, "
        "return/risk caveats, and limitations. Never invent price series or "
        "performance numbers. Match the user's language."
    ),
    "market_intelligence": (
        "You are a market intelligence analyst. Prefer search_web and "
        "search_prediction_markets to gather current information before "
        "synthesizing. Cite tool outputs; do not fabricate news or odds. "
        "Match the user's language."
    ),
}


def _param_to_schema(param_type: str) -> dict[str, Any]:
    lower = param_type.lower()
    if "integer" in lower:
        return {"type": "integer", "description": param_type}
    return {"type": "string", "description": param_type}


def _build_openai_tools(registry: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    for name, entry in registry.items():
        params = entry.get("parameters") or {}
        properties: dict[str, Any] = {}
        required: list[str] = []
        for param_name, param_type in params.items():
            properties[param_name] = _param_to_schema(str(param_type))
            if "optional" not in str(param_type).lower():
                required.append(param_name)
        parameters: dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            parameters["required"] = required
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": entry.get("description", name),
                    "parameters": parameters,
                },
            }
        )
    return tools


async def _execute_tool(name: str, arguments: str) -> dict[str, Any]:
    entry = TOOL_REGISTRY.get(name)
    if entry is None:
        return {"status": "error", "error": f"unknown tool: {name}"}
    try:
        args = json.loads(arguments or "{}")
        if not isinstance(args, dict):
            return {"status": "error", "error": "tool arguments must be a JSON object"}
        result = await entry["function"](**args)
        if isinstance(result, dict):
            return result
        return {"status": "ok", "result": result}
    except Exception as exc:
        logger.warning("tool %s failed: %s", name, exc)
        return {"status": "error", "error": str(exc)[:200]}


async def run_light_skill(
    skill: SkillId | str,
    user_text: str,
    *,
    on_status: Callable[[str], Awaitable[None]] | None = None,
) -> str:
    """Run a light DeepSeek tool loop for research skills (≤ MAX_ROUNDS).

    Raises:
        A2ASkillError: wrong skill routing or tool-loop exhaustion.
    """
    if skill == "full_system_task":
        raise A2ASkillError(
            "full_system_task requires the remote agent bridge; not handled here."
        )

    system = _SYSTEM_PROMPTS.get(skill)  # type: ignore[arg-type]
    if system is None:
        system = _SYSTEM_PROMPTS["factor_analysis"]

    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_text},
    ]
    tools = _build_openai_tools(TOOL_REGISTRY)
    last_content = ""

    for _ in range(MAX_ROUNDS):
        resp = await create_chat_completion(
            model=settings.deepseek_model_pro,
            messages=messages,
            tools=tools,
            tool_choice="auto",
            max_tokens=2048,
            temperature=0.2,
        )
        msg = resp.choices[0].message
        last_content = msg.content or ""

        if not msg.tool_calls:
            return last_content.strip()

        messages.append(
            {
                "role": "assistant",
                "content": msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": tc.type,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ],
            }
        )

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            if on_status is not None:
                await on_status(f"tool:{fn_name}")
            result = await _execute_tool(fn_name, tc.function.arguments or "{}")
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )

    trimmed = last_content.strip()
    raise A2ASkillError(
        trimmed or "Tool loop exhausted without a final answer."
    )
