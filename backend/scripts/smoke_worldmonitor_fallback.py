"""WorldMonitor 本地→云端回退链冒烟（差分机 / Difference Engine）。

离线段（无网络/AI）：
  - _bases() 组链：primary + cloud 去重；关闭回退仅 primary；primary==cloud 去重。
  - _rank() 降级快照排序（live > health_only > unavailable）。
  - request_with_retry：瞬时 TransportError 退避重试后成功（MockTransport）。
网络段（需公网到 api.worldmonitor.app，--offline / 无网自动 SKIP）：
  - 主源指向 dead port -> 透明回退云端 public bootstrap，served_by=cloud、
    source=live、signals>0。

跑法（backend/ 目录下）:
    uv run python scripts/smoke_worldmonitor_fallback.py
    uv run python scripts/smoke_worldmonitor_fallback.py --offline
"""

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from ai.http_retry import request_with_retry
from ai.worldmonitor import client as wm
from ai.worldmonitor.types import WorldContext
from core import config

FAILURES: list[str] = []

_DEAD_PRIMARY = "http://localhost:19999"
_CLOUD = "https://api.worldmonitor.app"


def check(condition: bool, label: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"{status}  {label}")
    if not condition:
        FAILURES.append(label)


def offline_checks() -> None:
    config.settings.worldmonitor_api_base_url = _DEAD_PRIMARY
    config.settings.worldmonitor_cloud_base_url = _CLOUD
    config.settings.worldmonitor_enable_cloud_fallback = True
    check(
        wm._bases() == [(_DEAD_PRIMARY, True), (_CLOUD, False)],
        "_bases 组链 primary->cloud（key 仅作用 primary）",
    )

    config.settings.worldmonitor_enable_cloud_fallback = False
    check(wm._bases() == [(_DEAD_PRIMARY, True)], "关闭回退仅 primary")

    config.settings.worldmonitor_enable_cloud_fallback = True
    config.settings.worldmonitor_api_base_url = _CLOUD
    check(wm._bases() == [(_CLOUD, True)], "primary==cloud 去重（不重复拉取）")

    live = WorldContext(fetched_at="x", freshness="fresh", source="live")
    health = WorldContext(fetched_at="x", freshness="degraded", source="health_only")
    dead = WorldContext(fetched_at="x", freshness="unavailable", source="unavailable")
    check(
        wm._rank(live) > wm._rank(health) > wm._rank(dead),
        "_rank: live > health_only > unavailable",
    )


async def retry_check() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("transient boom", request=request)
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        resp = await request_with_retry(
            http, "GET", "http://x/api", attempts=3, backoff_base=0.01
        )
    check(
        resp.status_code == 200 and calls["n"] == 3,
        "request_with_retry 瞬时错误退避后第 3 次成功",
    )


async def network_checks() -> None:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0), headers={"User-Agent": "lemma-smoke/1.0"}
        ) as http:
            probe = await http.get(
                f"{_CLOUD}/api/bootstrap", params={"tier": "fast", "public": "1"}
            )
        if probe.status_code != 200:
            print(f"SKIP: 云端 bootstrap 返回 {probe.status_code}，跳过网络段")
            return
    except httpx.HTTPError:
        print("SKIP: 公网到 api.worldmonitor.app 不可达，跳过网络段")
        return

    # Dead primary -> must transparently fall back to the cloud public tier.
    config.settings.worldmonitor_api_base_url = _DEAD_PRIMARY
    config.settings.worldmonitor_cloud_base_url = _CLOUD
    config.settings.worldmonitor_enable_cloud_fallback = True
    ctx = await wm.fetch_world_context(force=True)
    check(ctx.served_by == "cloud", f"主源宕机 -> served_by=cloud（实际 {ctx.served_by}）")
    check(ctx.source == "live", f"云端回退 source=live（实际 {ctx.source}）")
    check(len(ctx.signals) > 0, f"云端回退返回信号 >0（实际 {len(ctx.signals)}）")


async def main() -> int:
    offline_only = "--offline" in sys.argv[1:]
    print(f"tested_at: {datetime.now(UTC).isoformat()}  (offline_only={offline_only})")

    offline_checks()
    await retry_check()
    if offline_only:
        print("SKIP: --offline 指定，跳过网络段")
    else:
        await network_checks()

    print()
    if FAILURES:
        print(f"SMOKE FAILED: {len(FAILURES)} 项未过")
        return 1
    print("SMOKE OK: WorldMonitor 本地→云端回退链（组链 + 重试 + 归因）通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
