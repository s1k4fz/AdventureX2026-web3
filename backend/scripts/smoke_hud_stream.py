"""HUD 卡片流冒烟：service 层直测 stream_hud_events(绕过 HTTP 鉴权)。

跑法(backend/ 目录下):
    uv run python scripts/smoke_hud_stream.py

链路:
1. snapshot 首事件 -> SSE 帧格式 + cards/generatedAt 字段
2. heartbeat 心跳 -> ts 字段
3. collect_cards 单独跑一遍 -> 卡片 title/body 不超限、按 priority 排序
"""

import asyncio
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import settings
from core.database import AsyncSessionLocal
from schemas.hud import HUD_BODY_MAX_CHARS, HUD_TITLE_MAX_CHARS
from services.hud_feed_service import _PRIORITY_ORDER, collect_cards, stream_hud_events

FAILURES: list[str] = []


def check(condition: bool, label: str) -> None:
    status = "PASS" if condition else "FAIL"
    print(f"{status}  {label}")
    if not condition:
        FAILURES.append(label)


def parse_sse(frame: str) -> tuple[str, dict]:
    event = ""
    data: dict = {}
    for line in frame.strip().splitlines():
        if line.startswith("event: "):
            event = line[len("event: ") :]
        elif line.startswith("data: "):
            data = json.loads(line[len("data: ") :])
    return event, data


async def main() -> None:
    # 冒烟用随机用户: DB 数据源为空集, world 源走真实(或降级)链路
    user_id = uuid.uuid4()
    settings.hud_heartbeat_interval_seconds = 0.5

    stream = stream_hud_events(user_id)
    try:
        frames = [await asyncio.wait_for(anext(stream), timeout=30) for _ in range(2)]
    finally:
        await stream.aclose()

    event0, data0 = parse_sse(frames[0])
    check(event0 == "snapshot", "首事件是 snapshot")
    check("cards" in data0 and "generatedAt" in data0, "snapshot 携带 cards/generatedAt")
    print(f"      snapshot cards: {len(data0.get('cards', []))}")

    event1, data1 = parse_sse(frames[1])
    check(event1 == "heartbeat", "第二事件是 heartbeat")
    check(bool(data1.get("ts")), "heartbeat 携带 ts")

    async with AsyncSessionLocal() as db:
        cards = await collect_cards(db, user_id)
    check(
        all(len(c.title) <= HUD_TITLE_MAX_CHARS for c in cards),
        "title 不超过 HUD 单行上限",
    )
    check(
        all(len(c.body) <= HUD_BODY_MAX_CHARS for c in cards),
        "body 不超过 HUD 两行上限",
    )
    priorities = [_PRIORITY_ORDER[c.priority] for c in cards]
    check(priorities == sorted(priorities), "卡片按 priority 排序")
    check(len(cards) <= settings.hud_max_cards, "卡片总数不超过 hud_max_cards")
    for card in cards[:5]:
        print(f"      [{card.priority}] {card.title} | {card.body}")

    if FAILURES:
        print(f"\n{len(FAILURES)} check(s) FAILED")
        raise SystemExit(1)
    print("\nAll checks passed.")


if __name__ == "__main__":
    asyncio.run(main())
