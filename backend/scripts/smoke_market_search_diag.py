"""预测市场检索失败显式化冒烟（差分机 / Difference Engine，决策：仅显式暴露失败）。

全离线（无网络/AI runtime）：
  - _build_report 六类判定：ok / expansion_failed / untranslated_query /
    provider_unavailable / partial-keyword-empty / empty_result。
  - task 层 _classify_search_error：reason -> error_code + 中文 message；
    超时 / 有候选 / 未知 reason 的兜底。
  - _expand_queries：非 ASCII 需求 translated_ok=False（必空池根因可归因），
    ASCII 需求 translated_ok=True（原始诉求可作最后手段关键词）。

跑法（backend/ 目录下）:
    uv run python scripts/smoke_market_search_diag.py
"""

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.policygen.market_search import (
    MarketSearchReport,
    _build_report,
    _expand_queries,
)
from tasks.policy_search import _classify_search_error

FAILURES: list[str] = []


def check(condition: bool, label: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"{status}  {label}")
    if not condition:
        FAILURES.append(label)


def build_report_checks() -> None:
    ok = _build_report(
        ["c"], queries=["q"], expansion_ok=True, translated_ok=True, leg_errors=[]
    )
    check(ok.status == "ok" and ok.reason is None, "有候选 -> status=ok/reason=None")

    exp = _build_report(
        [], queries=["q"], expansion_ok=False, translated_ok=True, leg_errors=[]
    )
    check(
        exp.reason == "expansion_failed" and exp.status == "degraded",
        "扩词失败 -> expansion_failed/degraded",
    )

    unt = _build_report(
        [], queries=["台风"], expansion_ok=True, translated_ok=False, leg_errors=[]
    )
    check(
        unt.reason == "untranslated_query" and unt.status == "empty",
        "非 ASCII 未翻译 -> untranslated_query/empty",
    )

    prov = _build_report(
        [],
        queries=["q1", "q2"],
        expansion_ok=True,
        translated_ok=True,
        leg_errors=["ai_provider_error", "ai_timeout"],
    )
    check(
        prov.reason == "provider_unavailable" and prov.status == "degraded",
        "全部关键词检索报错 -> provider_unavailable/degraded",
    )

    partial = _build_report(
        [],
        queries=["q1", "q2"],
        expansion_ok=True,
        translated_ok=True,
        leg_errors=["ai_provider_error"],
    )
    check(
        partial.reason == "empty_result",
        "部分关键词检索报错(非全部) + 空 -> empty_result（不误判供给不可用）",
    )

    emp = _build_report(
        [], queries=["q1"], expansion_ok=True, translated_ok=True, leg_errors=[]
    )
    check(
        emp.reason == "empty_result" and emp.status == "empty",
        "干净空池 -> empty_result/empty",
    )


def classify_checks() -> None:
    cases = {
        "expansion_failed": "market_expansion_failed",
        "untranslated_query": "market_untranslated_query",
        "provider_unavailable": "market_provider_unavailable",
        "empty_result": "policy_search_empty",
    }
    for reason, code in cases.items():
        rep = MarketSearchReport(candidates=[], status="empty", reason=reason)
        got_code, msg = _classify_search_error(
            timed_out=False, report=rep, candidates=[]
        )
        check(got_code == code and bool(msg), f"reason={reason} -> {code} + 非空 message")

    code, _ = _classify_search_error(timed_out=True, report=None, candidates=[])
    check(code == "policy_search_timeout", "超时 -> policy_search_timeout")

    code, msg = _classify_search_error(timed_out=False, report=None, candidates=["x"])
    check(code is None and msg is None, "有候选 -> 无 error")

    unknown = MarketSearchReport(candidates=[], status="empty", reason=None)
    code, _ = _classify_search_error(timed_out=False, report=unknown, candidates=[])
    check(code == "policy_search_failed", "未知 reason -> 兜底 policy_search_failed")


async def expand_checks() -> None:
    # No AI runtime here: LLM expansion fails (AIError). A non-ASCII need then
    # cannot be translated -> translated_ok=False so the caller surfaces the
    # reason instead of silently returning an empty pool.
    queries, _expansion_ok, translated_ok = await _expand_queries("台风登陆导致航班延误")
    check(translated_ok is False, "非 ASCII 需求 -> translated_ok=False（可归因）")
    check(queries == ["台风登陆导致航班延误"], "兜底保留原始诉求作为最后手段关键词")

    _q2, _ok2, translated_ok2 = await _expand_queries("recession hedge")
    check(translated_ok2 is True, "ASCII 需求 -> translated_ok=True")


async def main() -> int:
    print(f"tested_at: {datetime.now(UTC).isoformat()}")
    build_report_checks()
    classify_checks()
    await expand_checks()

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} 项未过")
        return 1
    print("SMOKE OK: 预测市场检索失败显式化（诊断分类 + error_code 映射）通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
