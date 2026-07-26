"""Data-source tools for the xEngine A2A Agent.

Wraps existing xEngine data facades (PandaAI, WebSearch, Markets) into
simple async callables usable by the agent executor's LLM reasoning loop.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("lemma.a2a_agent.tools")


async def fetch_financial_data() -> dict[str, Any]:
    """Fetch A-share financial context from PandaAI (indices, futures, macro)."""
    from ai.pandaai import fetch_panda_context, is_pandaai_enabled

    if not is_pandaai_enabled():
        return {"status": "disabled", "summary": "PandaAI not configured"}

    ctx = await fetch_panda_context()
    return {
        "status": ctx.source,
        "freshness": ctx.freshness,
        "summary": ctx.summary,
        "last_trade_date": ctx.last_trade_date,
        "signals": [
            {
                "kind": s.kind,
                "label": s.label,
                "value": s.value,
                "detail": s.detail,
                "symbol": s.symbol,
                "as_of": s.as_of,
            }
            for s in ctx.signals
        ],
        "modules": ctx.modules,
        "latency_ms": ctx.latency_ms,
        "prompt_block": ctx.as_prompt_block(),
    }


async def search_web(query: str, *, count: int = 8) -> dict[str, Any]:
    """Perform a web search via Bocha (博查) API."""
    from ai.websearch import WebSearchQuery, web_search

    q = WebSearchQuery(query=query, count=count)
    try:
        response = await web_search(q)
        return response.as_tool_payload()
    except Exception as exc:
        logger.warning("web search failed: %s", exc)
        return {"status": "error", "error": str(exc)[:200]}


async def search_prediction_markets(
    keyword: str, *, limit: int = 20
) -> dict[str, Any]:
    """Search Polymarket prediction markets (xEngine 差分机)."""
    from ai.markets import MarketSearchQuery, search_markets

    query = MarketSearchQuery(keyword=keyword)
    try:
        candidates = await search_markets(query, limit=limit)
        return {
            "status": "ok",
            "count": len(candidates),
            "markets": [
                {
                    "condition_id": c.condition_id,
                    "question": c.question,
                    "url": c.url,
                    "outcomes": c.outcomes,
                    "outcome_prices": c.outcome_prices,
                    "volume": c.volume,
                    "liquidity": c.liquidity,
                    "category": c.category,
                    "end_date": c.end_date.isoformat() if c.end_date else None,
                }
                for c in candidates
            ],
        }
    except Exception as exc:
        logger.warning("market search failed: %s", exc)
        return {"status": "error", "error": str(exc)[:200]}


# Tool registry used by the agent executor
TOOL_REGISTRY: dict[str, dict[str, Any]] = {
    "fetch_financial_data": {
        "function": fetch_financial_data,
        "description": (
            "获取 A 股金融数据快照（沪深300、上证、创业板、期货、宏观利率/PMI 等），"
            "来源 PandaAI。返回 JSON 含信号列表和 prompt 格式块。"
        ),
        "parameters": {},
    },
    "search_web": {
        "function": search_web,
        "description": (
            "通过博查搜索引擎执行网络搜索，获取实时新闻、研报摘要。"
            "参数 query: 搜索关键词；count: 返回结果数（默认8）。"
        ),
        "parameters": {"query": "string", "count": "integer (optional, default 8)"},
    },
    "search_prediction_markets": {
        "function": search_prediction_markets,
        "description": (
            "搜索 Polymarket 预测市场行情，获取事件概率、流动性和交易量。"
            "参数 keyword: 搜索关键词；limit: 返回数量（默认20）。"
        ),
        "parameters": {
            "keyword": "string",
            "limit": "integer (optional, default 20)",
        },
    },
}
