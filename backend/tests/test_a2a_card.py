from a2a_agent.card import build_agent_card


def test_agent_card_skills_and_streaming():
    card = build_agent_card(url="http://127.0.0.1:18473/a2a")
    assert card.name == "xEngine 差分机"
    assert card.version == "1.0.0"
    assert card.capabilities.streaming is True
    assert card.capabilities.push_notifications is False
    skill_ids = {s.id for s in card.skills}
    assert {
        "factor_analysis",
        "strategy_backtest",
        "full_system_task",
        "market_intelligence",
    } <= skill_ids
    assert any(i.url.endswith("/a2a") for i in card.supported_interfaces)
