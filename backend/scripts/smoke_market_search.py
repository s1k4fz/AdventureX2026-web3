"""ai/markets 冒烟：离线验证归一化/字段映射（不联网、不需 key）。

跑法（backend/ 目录下）:
    SUPABASE_URL=https://x.supabase.co DATABASE_URL='postgresql+asyncpg://u:p@localhost:5432/postgres' \
    DEEPSEEK_API_KEY=dummy uv run python scripts/smoke_market_search.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.markets import (
    MarketCandidate,
    MarketPlatform,
    MarketSearchQuery,
    validate_market_routes,
)
from ai.markets.config import get_market_routes
from ai.markets.normalize import maybe_json_list, parse_float, parse_iso_datetime
from ai.markets.providers.polymarket.provider import to_candidate

FAILURES: list[str] = []


def check(condition: bool, label: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"{status}  {label}")
    if not condition:
        FAILURES.append(label)


# --- 样例 Gamma item (hardcoded, realistic) ---

FAKE_GAMMA_ITEM = {
    "conditionId": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "question": "Will the US GDP growth exceed 3% in 2026?",
    "slug": "us-gdp-growth-2026",
    "volume": "1500000.50",
    "volumeNum": 1500000.50,
    "liquidity": "250000.00",
    "liquidityNum": 250000.00,
    "endDate": "2026-12-31T00:00:00Z",
    "outcomes": '["Yes","No"]',
    "outcomePrices": '["0.65","0.35"]',
    "clobTokenIds": '["tok_yes_123","tok_no_456"]',
    "active": True,
    "closed": False,
}


def offline_checks() -> None:
    print("=" * 60)
    print("离线段: 归一化原语 + 字段映射")
    print("=" * 60)

    # --- normalize primitives ---
    check(parse_float("1500000.50") == 1500000.50, 'parse_float "1500000.50"')
    check(parse_float(None) is None, "parse_float None -> None")
    check(parse_float("") is None, "parse_float empty -> None")
    check(parse_float(42) == 42.0, "parse_float int -> float")
    check(parse_float("abc") is None, "parse_float non-numeric -> None")

    check(
        parse_iso_datetime("2026-12-31T00:00:00Z") is not None,
        'parse_iso_datetime "2026-12-31T00:00:00Z" 解析成功',
    )
    dt = parse_iso_datetime("2026-11-05T00:00:00Z")
    check(dt is not None and dt.year == 2026 and dt.month == 11, "ISO datetime 年月正确")
    check(parse_iso_datetime(None) is None, "parse_iso_datetime None -> None")
    check(parse_iso_datetime("garbage") is None, "parse_iso_datetime bad str -> None")

    # maybe_json_list: JSON-encoded string
    check(maybe_json_list('["Yes","No"]') == ["Yes", "No"], "maybe_json_list JSON str")
    # maybe_json_list: native list passthrough
    check(maybe_json_list(["a", "b"]) == ["a", "b"], "maybe_json_list native list")
    # maybe_json_list: bad input
    check(maybe_json_list(None) == [], "maybe_json_list None -> []")
    check(maybe_json_list("not json") == [], "maybe_json_list bad str -> []")

    # --- to_candidate mapping ---
    candidate = to_candidate(FAKE_GAMMA_ITEM)
    check(candidate is not None, "to_candidate 返回非 None")
    assert candidate is not None

    check(candidate.platform == MarketPlatform.POLYMARKET, "platform=polymarket")
    check(
        candidate.condition_id
        == "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        "condition_id 正确",
    )
    check(candidate.question == "Will the US GDP growth exceed 3% in 2026?", "question 正确")
    check(candidate.slug == "us-gdp-growth-2026", "slug 正确")
    check(
        candidate.url == "https://polymarket.com/event/us-gdp-growth-2026",
        "url 从 slug 拼接正确",
    )
    check(candidate.outcomes == ["Yes", "No"], "outcomes JSON解码正确")
    check(candidate.outcome_prices == [0.65, 0.35], "outcome_prices JSON解码+float 正确")
    check(
        candidate.clob_token_ids == ["tok_yes_123", "tok_no_456"],
        "clob_token_ids JSON解码正确",
    )
    check(candidate.volume == 1500000.50, "volume 正确 (from volumeNum)")
    check(candidate.liquidity == 250000.00, "liquidity 正确 (from liquidityNum)")
    check(candidate.end_date is not None and candidate.end_date.year == 2026, "end_date 年份正确")
    check(candidate.raw == FAKE_GAMMA_ITEM, "raw 保留原始 item")

    # --- skip items without conditionId/question ---
    check(to_candidate({}) is None, "缺 conditionId/question -> None")
    check(to_candidate({"conditionId": "x"}) is None, "缺 question -> None")
    check(to_candidate({"question": "x?"}) is None, "缺 conditionId -> None")

    # --- config validation ---
    print("\n" + "=" * 60)
    print("配置段: validate_market_routes / get_market_routes")
    print("=" * 60)
    validate_market_routes()
    routes = get_market_routes()
    check(MarketPlatform.POLYMARKET in routes, "polymarket 平台在路由表中")
    polymarket_routes = routes[MarketPlatform.POLYMARKET]
    check(len(polymarket_routes) == 1, "polymarket 有 1 条路由")
    check(polymarket_routes[0].provider == "polymarket_gamma", "provider=polymarket_gamma")
    check(polymarket_routes[0].max_items == 40, "max_items=40")
    check(polymarket_routes[0].timeout_s == 12, "timeout_s=12（快速失败预算）")
    print()

    # --- print the full MarketCandidate for visual inspection ---
    print("=" * 60)
    print("MarketCandidate 完整输出:")
    print("=" * 60)
    print(candidate.model_dump_json(indent=2))


def main() -> None:
    offline_checks()
    print()
    if FAILURES:
        print(f"❌ {len(FAILURES)} check(s) FAILED:")
        for f in FAILURES:
            print(f"   - {f}")
        sys.exit(1)
    else:
        print("✅ All offline checks passed.")


if __name__ == "__main__":
    main()
