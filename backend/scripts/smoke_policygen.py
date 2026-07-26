"""ai/policygen 冒烟：离线验证零信任校验/排序/模板加载契约。

跑法（backend/ 目录下）:
    .venv/bin/python scripts/smoke_policygen.py

全部离线（不联网）：
- _validate_composed 零信任：虚构ref被丢弃、重复ref被丢弃、过期ref被丢弃、
  存活头寸有正确的 entry_price_bps、权重归一化到10000、空组合被丢弃。
- rank() 确定性排序（volume/liquidity/time-fit）。
- render_system_prompt 能加载全部 4 个新模板。
"""

import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.markets.types import MarketCandidate, MarketPlatform
from ai.policygen.compose import _validate_composed, candidate_ref
from ai.policygen.ranking import rank
from ai.policygen.types import (
    ComposedPortfolio,
    ComposedPosition,
    PortfolioSet,
    ResolvedPortfolioSet,
)
from ai.prompts.registry import render_system_prompt
from ai.types import AIUseCase

FAILURES: list[str] = []


def check(condition: bool, label: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"{status}  {label}")
    if not condition:
        FAILURES.append(label)


def _mc(
    cid: str,
    question: str = "Will X happen?",
    volume: float = 100_000,
    liquidity: float = 50_000,
    end_date: datetime | None = None,
    outcomes: list[str] | None = None,
    outcome_prices: list[float] | None = None,
) -> MarketCandidate:
    return MarketCandidate(
        platform=MarketPlatform.POLYMARKET,
        condition_id=cid,
        question=question,
        url=f"https://polymarket.com/event/{cid}",
        outcomes=outcomes or ["Yes", "No"],
        outcome_prices=outcome_prices or [0.65, 0.35],
        volume=volume,
        liquidity=liquidity,
        end_date=end_date,
    )


def test_zero_trust() -> None:
    """Core zero-trust validation assertions."""
    coverage_end = datetime(2026, 12, 31, tzinfo=UTC)

    # 4 fake candidates
    c_normal = _mc("cond-AAA", volume=200_000, liquidity=80_000,
                   end_date=datetime(2026, 9, 1, tzinfo=UTC),
                   outcomes=["Yes", "No"], outcome_prices=[0.72, 0.28])
    c_expired = _mc("cond-BBB", volume=150_000, liquidity=60_000,
                    end_date=datetime(2027, 6, 1, tzinfo=UTC),  # past coverage_end
                    outcomes=["Yes", "No"], outcome_prices=[0.50, 0.50])
    c_dup_target = _mc("cond-CCC", volume=120_000, liquidity=40_000,
                       end_date=datetime(2026, 11, 1, tzinfo=UTC),
                       outcomes=["Yes", "No"], outcome_prices=[0.30, 0.70])
    c_extra = _mc("cond-DDD", volume=90_000, liquidity=30_000,
                  end_date=datetime(2026, 10, 1, tzinfo=UTC),
                  outcomes=["Yes", "No"], outcome_prices=[0.85, 0.15])

    by_ref = {
        candidate_ref(c_normal): c_normal,
        candidate_ref(c_expired): c_expired,
        candidate_ref(c_dup_target): c_dup_target,
        candidate_ref(c_extra): c_extra,
    }

    # Build a fake PortfolioSet with:
    # - one valid ref (cond-AAA)
    # - one fabricated ref (cond-FAKE)
    # - one duplicate ref within the same portfolio (cond-CCC appears twice)
    # - one ref whose end_date is past coverage_end (cond-BBB)
    fake_set = PortfolioSet(
        factor_categories=[
            {"id": "macro-rates", "label": "宏观利率", "rationale": "覆盖利率路径风险"},
            {"id": "energy", "label": "能源商品", "rationale": "分散至商品敞口"},
        ],
        portfolios=[
        ComposedPortfolio(
            tier="conservative",
            title="稳健组合",
            thesis="低风险对冲",
            positions=[
                ComposedPosition(market_ref="cond-AAA", side="YES", weight_bps=4000, ai_reason="对冲风险A"),
                ComposedPosition(market_ref="cond-FAKE", side="NO", weight_bps=2000, ai_reason="虚构的"),
                ComposedPosition(market_ref="cond-CCC", side="NO", weight_bps=2000, ai_reason="第一次用"),
                ComposedPosition(market_ref="cond-CCC", side="YES", weight_bps=1000, ai_reason="重复的"),
                ComposedPosition(market_ref="cond-BBB", side="YES", weight_bps=1000, ai_reason="已过期的"),
            ],
        ),
        ComposedPortfolio(
            tier="balanced",
            title="均衡组合",
            thesis="适度分散",
            positions=[
                ComposedPosition(market_ref="cond-DDD", side="NO", weight_bps=5000, ai_reason="对冲D"),
                ComposedPosition(market_ref="cond-AAA", side="YES", weight_bps=5000, ai_reason="对冲A"),
            ],
        ),
        ComposedPortfolio(
            tier="aggressive",
            title="激进组合",
            thesis="高赔率",
            positions=[
                # All invalid -> portfolio should be dropped
                ComposedPosition(market_ref="cond-NONEXIST", side="YES", weight_bps=10000, ai_reason="不存在"),
            ],
        ),
    ])

    result = _validate_composed(fake_set, by_ref, coverage_end=coverage_end)

    # --- Assertions ---
    check(result is not None, "零信任: _validate_composed returns non-None for partially valid input")
    assert result is not None  # for type narrowing

    # Aggressive portfolio should be dropped (0 surviving positions)
    tiers_present = [p.tier for p in result.portfolios]
    check("aggressive" not in tiers_present, "零信任: aggressive portfolio with all invalid positions is dropped")

    # Conservative portfolio: only cond-AAA and cond-CCC survive
    # (cond-FAKE dropped, cond-CCC duplicate dropped, cond-BBB expired dropped)
    cons = next((p for p in result.portfolios if p.tier == "conservative"), None)
    check(cons is not None, "零信任: conservative portfolio survives")
    if cons:
        refs = [pos.market_ref for pos in cons.positions]
        check("cond-AAA" in refs, "零信任: valid ref cond-AAA survives")
        check("cond-FAKE" not in refs, "零信任: fabricated ref cond-FAKE is dropped")
        check(refs.count("cond-CCC") == 1, "零信任: duplicate ref cond-CCC deduplicated (first kept)")
        check("cond-BBB" not in refs, "零信任: expired ref cond-BBB is dropped")

        # entry_price_bps computed correctly
        pos_aaa = next((p for p in cons.positions if p.market_ref == "cond-AAA"), None)
        check(pos_aaa is not None, "零信任: cond-AAA position object exists")
        if pos_aaa:
            # side=YES, outcomes=["Yes","No"], prices=[0.72, 0.28] -> YES index=0 -> 0.72*10000=7200
            check(pos_aaa.entry_price_bps == 7200, f"零信任: entry_price_bps=7200 (got {pos_aaa.entry_price_bps})")

        pos_ccc = next((p for p in cons.positions if p.market_ref == "cond-CCC"), None)
        if pos_ccc:
            # side=NO, outcomes=["Yes","No"], prices=[0.30, 0.70] -> NO index=1 -> 0.70*10000=7000
            check(pos_ccc.entry_price_bps == 7000, f"零信任: cond-CCC entry_price_bps=7000 (got {pos_ccc.entry_price_bps})")

        # weight_bps renormalized to sum 10000
        total_w = sum(p.weight_bps for p in cons.positions)
        check(total_w == 10000, f"零信任: conservative weight_bps sum=10000 (got {total_w})")

    # Balanced portfolio: both should survive (within coverage, valid refs)
    bal = next((p for p in result.portfolios if p.tier == "balanced"), None)
    check(bal is not None, "零信任: balanced portfolio survives")
    if bal:
        total_w = sum(p.weight_bps for p in bal.positions)
        check(total_w == 10000, f"零信任: balanced weight_bps sum=10000 (got {total_w})")
        # cond-DDD side=NO, prices=[0.85, 0.15] -> NO index=1 -> 0.15*10000=1500
        pos_ddd = next((p for p in bal.positions if p.market_ref == "cond-DDD"), None)
        if pos_ddd:
            check(pos_ddd.entry_price_bps == 1500, f"零信任: cond-DDD entry_price_bps=1500 (got {pos_ddd.entry_price_bps})")

    # Tier ordering: conservative before balanced
    check(
        tiers_present == sorted(tiers_present, key=lambda t: ["conservative", "balanced", "aggressive"].index(t)),
        "零信任: tier ordering is conservative, balanced, aggressive",
    )

    # position_count property
    check(result.position_count == sum(len(p.positions) for p in result.portfolios),
          "零信任: position_count property matches")


def test_ranking() -> None:
    """rank() orders by volume/liquidity/time-fit deterministically."""
    now = datetime(2026, 7, 24, tzinfo=UTC)
    coverage_end = datetime(2026, 12, 31, tzinfo=UTC)

    high_vol = _mc("rank-A", volume=1_000_000, liquidity=500_000,
                   end_date=datetime(2026, 10, 1, tzinfo=UTC))
    mid_vol = _mc("rank-B", volume=100_000, liquidity=50_000,
                  end_date=datetime(2026, 9, 1, tzinfo=UTC))
    low_vol = _mc("rank-C", volume=1_000, liquidity=500,
                  end_date=datetime(2026, 8, 1, tzinfo=UTC))
    past_cov = _mc("rank-D", volume=500_000, liquidity=200_000,
                   end_date=datetime(2027, 6, 1, tzinfo=UTC))  # past coverage -> penalized

    ranked = rank([low_vol, past_cov, mid_vol, high_vol], coverage_end=coverage_end, now=now)
    ids = [c.condition_id for c in ranked]
    check(ids[0] == "rank-A", f"rank: high_vol+in_window is top (got {ids[0]})")
    check(ids.index("rank-A") < ids.index("rank-D"),
          "rank: past-coverage market penalized below high-vol in-window")
    # Stability: same input same output
    ranked2 = rank([low_vol, past_cov, mid_vol, high_vol], coverage_end=coverage_end, now=now)
    check(
        [c.condition_id for c in ranked] == [c.condition_id for c in ranked2],
        "rank: deterministic on same input",
    )


def test_templates() -> None:
    """All 4 new templates load without error."""
    for use_case in (
        AIUseCase.POLICY_INTAKE,
        AIUseCase.MARKET_SEARCH,
        AIUseCase.PORTFOLIO_COMPOSE,
        AIUseCase.POLICY_PLAN_INTRO,
    ):
        text = render_system_prompt(use_case)
        check(len(text) > 20, f"template {use_case.value} loads (len={len(text)})")


def main() -> int:
    print("=== 零信任校验 ===")
    test_zero_trust()
    print("\n=== 排序确定性 ===")
    test_ranking()
    print("\n=== 模板加载 ===")
    test_templates()

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} 项未过")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("SMOKE OK: ai/policygen 差分机投保大脑通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
