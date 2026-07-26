"""Offline unit coverage for the HUD card feed (pure mappers + diffing)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from types import SimpleNamespace

from schemas.hud import HUD_BODY_MAX_CHARS, HUD_TITLE_MAX_CHARS, HudCardOut
from services.hud_feed_service import (
    _clip,
    card_fingerprint,
    policy_cards,
    task_cards,
    watch_cards,
    world_cards,
)

_NOW = "2026-07-25T12:00:00+00:00"


# --- _clip ---


def test_clip_passthrough_short_text():
    assert _clip("市场情绪", 24) == "市场情绪"


def test_clip_collapses_whitespace_and_truncates():
    long = "  a" + "很长的字" * 40
    clipped = _clip(long, HUD_BODY_MAX_CHARS)
    assert len(clipped) == HUD_BODY_MAX_CHARS
    assert clipped.endswith("…")
    assert "  " not in clipped


# --- world_cards ---


def _world_ctx(**overrides):
    base = dict(
        freshness="fresh",
        fear_greed=63,
        fear_greed_label="Greed",
        top_risks=[
            SimpleNamespace(
                id="r1", label="地缘风险", value="升温", detail="",
                region=None, score=None, trend=None,
            ),
            SimpleNamespace(
                id="r2", label="能源", value="", detail="油价波动",
                region=None, score=None, trend=None,
            ),
        ],
        signals=[],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_world_cards_fear_greed_plus_top_risks():
    cards = world_cards(_world_ctx(), now_iso=_NOW)
    assert [c.id for c in cards] == ["world:fear_greed", "world:risk:r1", "world:risk:r2"]
    # 情绪标签汉化：Greed -> 贪婪
    assert cards[0].body == "恐惧贪婪 63/100 · 贪婪"
    # 非评分形态：无法汉化的原文保留；value 为空时回落 detail
    assert cards[1].title == "风险·地缘风险"
    assert cards[1].body == "升温"
    assert cards[2].body == "油价波动"
    assert all(c.kind == "world_signal" for c in cards)


def test_world_cards_global_risk_score_localized():
    risk = SimpleNamespace(
        id="risk:global", label="global", value="64/100", detail="",
        region="global", score=64.0, trend="rising",
    )
    cards = world_cards(
        _world_ctx(fear_greed=None, top_risks=[risk]), now_iso=_NOW
    )
    (card,) = cards
    assert card.title == "全球风险"
    assert card.body == "评分 64/100 · 中高 ↑"


def test_world_cards_region_and_level_localized():
    risk = SimpleNamespace(
        id="risk:us", label="US", value="82/100", detail="high",
        region="US", score=82.0, trend=None,
    )
    (card,) = world_cards(
        _world_ctx(fear_greed=None, top_risks=[risk]), now_iso=_NOW
    )
    assert card.title == "风险·美国"
    assert card.body == "评分 82/100 · 高"


def test_world_cards_extra_signals_capped_at_two_low_priority():
    signals = [
        SimpleNamespace(id="p1", kind="prediction", label="Fed cut", value="62%", detail=""),
        SimpleNamespace(id="n1", kind="news", label="某地冲突升级", value="", detail=""),
        SimpleNamespace(id="m1", kind="macro", label="CPI", value="3.2%", detail=""),
        SimpleNamespace(id="s1", kind="sentiment", label="dup", value="", detail=""),
    ]
    cards = world_cards(
        _world_ctx(fear_greed=None, top_risks=[], signals=signals), now_iso=_NOW
    )
    assert [c.id for c in cards] == ["world:sig:p1", "world:sig:n1"]
    assert cards[0].title == "预测市场"
    # 概率前置，长问题被截断也不丢关键数字
    assert cards[0].body == "62% · Fed cut"
    assert all(c.priority == "low" for c in cards)


def test_prediction_price_normalized_to_percent():
    def one(value):
        sig = SimpleNamespace(id="p", kind="prediction", label="Q", value=value, detail="")
        (card,) = world_cards(
            _world_ctx(fear_greed=None, top_risks=[], signals=[sig]), now_iso=_NOW
        )
        return card.body

    assert one("0.12") == "12% · Q"      # 0-1 量纲
    assert one("13.5") == "14% · Q"      # 0-100 量纲
    assert one("n/a") == "n/a · Q"       # 非数字原样


def test_world_cards_unavailable_yields_nothing():
    assert world_cards(_world_ctx(freshness="unavailable"), now_iso=_NOW) == []
    assert world_cards(None, now_iso=_NOW) == []


def test_world_cards_caps_top_risks_at_three():
    risks = [
        SimpleNamespace(
            id=f"r{i}", label=f"风险{i}", value="v", detail="",
            region=None, score=None, trend=None,
        )
        for i in range(5)
    ]
    cards = world_cards(_world_ctx(top_risks=risks), now_iso=_NOW)
    assert len(cards) == 1 + 3


# --- watch_cards ---


def test_watch_cards_due_reminder_is_high_priority():
    item_id = uuid.uuid4()
    item = SimpleNamespace(
        id=item_id, title="美联储决议", due_on=date(2026, 7, 25)
    )
    (card,) = watch_cards([item], now_iso=_NOW)
    assert card.id == f"watch_due:{item_id}"
    assert card.priority == "high"
    assert card.title == "盯盘到期 07-25"
    assert card.body == "美联储决议"
    assert card.ref.type == "watch_item"


# --- task_cards ---


def _task(status: str, title: str = "关税保单研究"):
    return SimpleNamespace(id=uuid.uuid4(), status=status, title=title)


def test_task_cards_running_shows_step_progress():
    (card,) = task_cards([(_task("running"), 3, 5)], now_iso=_NOW)
    assert card.priority == "normal"
    assert card.title == "研究中"
    assert card.body == "关税保单研究 3/5 步"


def test_task_cards_waiting_user_is_urgent_without_progress():
    (card,) = task_cards([(_task("waiting_user"), 3, 5)], now_iso=_NOW)
    assert card.priority == "urgent"
    assert card.title == "等待你确认"
    assert card.body == "关税保单研究"


# --- policy_cards ---


def test_policy_cards_active_with_coverage_end():
    policy = SimpleNamespace(
        id=uuid.uuid4(),
        status="active",
        title="台风损失对冲",
        coverage_end=datetime(2026, 8, 30),
    )
    (card,) = policy_cards([policy], now_iso=_NOW)
    assert card.title == "保单·保障中"
    assert card.body == "台风损失对冲 至 08-30"
    assert card.ref.type == "policy"


def test_policy_cards_unknown_status_renders_raw():
    policy = SimpleNamespace(
        id=uuid.uuid4(), status="odd", title="X", coverage_end=None
    )
    (card,) = policy_cards([policy], now_iso=_NOW)
    assert card.title == "保单·odd"


# --- fingerprint diffing ---


def _card(**overrides) -> HudCardOut:
    base = dict(
        id="task:1",
        kind="agent_progress",
        priority="normal",
        title="研究中",
        body="3/5 步",
        ts=_NOW,
    )
    base.update(overrides)
    return HudCardOut(**base)


def test_fingerprint_ignores_ts_only_changes():
    a = _card()
    b = _card(ts="2026-07-25T12:05:00+00:00")
    assert card_fingerprint(a) == card_fingerprint(b)


def test_fingerprint_changes_with_content():
    assert card_fingerprint(_card()) != card_fingerprint(_card(body="4/5 步"))
    assert card_fingerprint(_card()) != card_fingerprint(
        _card(priority="urgent", title="等待你确认")
    )


def test_clip_keeps_titles_within_schema_limit():
    # HudCardOut enforces max_length; _clip 是所有出口的守门员
    long_title = "这是一个超过二十四个字符长度限制的超长标题需要被截断处理"
    card = _card(title=_clip(long_title, HUD_TITLE_MAX_CHARS))
    assert len(card.title) <= HUD_TITLE_MAX_CHARS
