from unittest.mock import AsyncMock, patch

import pytest

from a2a_agent.intent import parse_skill_prefix, resolve_skill, resolve_skill_heuristic


def test_parse_skill_prefix():
    skill, rest = parse_skill_prefix("[skill:strategy_backtest] run MA")
    assert skill == "strategy_backtest"
    assert rest == "run MA"


def test_heuristic_factor():
    assert resolve_skill_heuristic("请分析动量因子表现") == "factor_analysis"


def test_heuristic_backtest():
    assert resolve_skill_heuristic("帮我回测双均线策略") == "strategy_backtest"


def test_heuristic_full():
    assert resolve_skill_heuristic("我想投保防油价暴涨") == "full_system_task"


@pytest.mark.asyncio
async def test_resolve_skill_empty_seed_response():
    with patch(
        "a2a_agent.deepseek_client.chat_text", new_callable=AsyncMock, return_value=""
    ):
        skill, rest = await resolve_skill("ambiguous query with no keywords")
    assert skill == "factor_analysis"
    assert rest == "ambiguous query with no keywords"
