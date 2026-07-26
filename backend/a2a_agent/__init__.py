"""A2A Remote Agent — exposes xEngine 差分机 as a standard A2A server.

This package wraps existing xEngine capabilities (factor analysis,
strategy backtesting, market data, web search, PandaAI financial data)
as an A2A-protocol-compliant remote agent endpoint.
"""

__all__ = ["attach_a2a"]


def __getattr__(name: str):
    if name == "attach_a2a":
        from a2a_agent.mount import attach_a2a

        return attach_a2a
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
