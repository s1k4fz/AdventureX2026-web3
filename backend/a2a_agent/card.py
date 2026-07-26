from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
)


def build_agent_card(*, url: str) -> AgentCard:
    skills = [
        AgentSkill(
            id="factor_analysis",
            name="factor_analysis",
            description="Analyze factor performance using provided research skills",
            tags=["factor", "research"],
            examples=["Analyze momentum factor on CSI 300 last quarter"],
            input_modes=["text/plain"],
            output_modes=["text/plain"],
        ),
        AgentSkill(
            id="strategy_backtest",
            name="strategy_backtest",
            description="Run strategy backtests and summarize results",
            tags=["backtest", "strategy"],
            examples=["Backtest a simple MA crossover on HS300"],
            input_modes=["text/plain"],
            output_modes=["text/plain"],
        ),
        AgentSkill(
            id="full_system_task",
            name="full_system_task",
            description=(
                "Run the full xEngine 差分机 policy-planning task flow"
            ),
            tags=["policy", "difference-engine"],
            examples=["I need protection if oil spikes next month"],
            input_modes=["text/plain"],
            output_modes=["text/plain"],
        ),
        AgentSkill(
            id="market_intelligence",
            name="market_intelligence",
            description="Aggregate prediction-market and web intelligence for a goal",
            tags=["intel", "markets"],
            examples=["What are markets pricing for Fed cuts?"],
            input_modes=["text/plain"],
            output_modes=["text/plain"],
        ),
    ]
    return AgentCard(
        name="xEngine 差分机",
        description=(
            "An AI-native insurance engine: factor analysis, backtesting, plus full "
            "xEngine 差分机 research/policy workflows"
        ),
        version="1.0.0",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=AgentCapabilities(streaming=True, push_notifications=False),
        supported_interfaces=[
            AgentInterface(
                protocol_binding="JSONRPC",
                url=url,
                protocol_version="1.0",
            )
        ],
        skills=skills,
    )
