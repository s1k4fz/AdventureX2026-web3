"""Unit tests for A2A DeepSeek client 429 backoff."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from openai import RateLimitError

from a2a_agent import deepseek_client


def _rate_limit_error() -> RateLimitError:
    # openai.RateLimitError(message, response=..., body=...) — construct lightly.
    return RateLimitError(
        "rate limited",
        response=SimpleNamespace(
            status_code=429,
            headers={},
            request=SimpleNamespace(),
        ),
        body=None,
    )


@pytest.mark.asyncio
async def test_chat_text_retries_on_429_then_succeeds(monkeypatch):
    calls = {"n": 0}

    class FakeMsg:
        content = "ok-after-retry"

    class FakeChoice:
        message = FakeMsg()

    class FakeResp:
        choices = [FakeChoice()]

    async def fake_create(**kwargs):
        calls["n"] += 1
        if calls["n"] < 3:
            raise _rate_limit_error()
        return FakeResp()

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(deepseek_client, "get_deepseek_client", lambda: fake_client)
    monkeypatch.setattr(deepseek_client, "_429_BACKOFF_S", (0.0, 0.0, 0.0))

    out = await deepseek_client.chat_text(
        model="deepseek-v4-flash",
        system="sys",
        user="hi",
    )
    assert out == "ok-after-retry"
    assert calls["n"] == 3


@pytest.mark.asyncio
async def test_create_chat_completion_gives_up_after_bounded_429(monkeypatch):
    create = AsyncMock(side_effect=_rate_limit_error())
    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
    )
    monkeypatch.setattr(deepseek_client, "get_deepseek_client", lambda: fake_client)
    monkeypatch.setattr(deepseek_client, "_429_BACKOFF_S", (0.0, 0.0, 0.0))
    monkeypatch.setattr(deepseek_client, "_MAX_429_ATTEMPTS", 3)

    with pytest.raises(RateLimitError):
        await deepseek_client.create_chat_completion(
            model="deepseek-v4-pro", messages=[]
        )

    assert create.await_count == 3
