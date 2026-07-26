import pytest

from a2a_agent import light_loop


@pytest.mark.asyncio
async def test_light_loop_calls_tool_then_finishes(monkeypatch):
    calls: list[str] = []

    async def fake_fetch() -> dict:
        return {"status": "ok", "summary": "HS300 up"}

    monkeypatch.setattr(
        light_loop,
        "TOOL_REGISTRY",
        {
            "fetch_financial_data": {
                "function": fake_fetch,
                "description": "fin",
                "parameters": {},
            }
        },
    )

    class FakeMsg:
        def __init__(self, content=None, tool_calls=None):
            self.content = content
            self.tool_calls = tool_calls

    class FakeChoice:
        def __init__(self, message):
            self.message = message

    class FakeResp:
        def __init__(self, message):
            self.choices = [FakeChoice(message)]

    round_msgs = [
        FakeResp(
            FakeMsg(
                tool_calls=[
                    type(
                        "TC",
                        (),
                        {
                            "id": "1",
                            "type": "function",
                            "function": type(
                                "F",
                                (),
                                {
                                    "name": "fetch_financial_data",
                                    "arguments": "{}",
                                },
                            )(),
                        },
                    )()
                ]
            )
        ),
        FakeResp(FakeMsg(content="Factor summary: HS300 up")),
    ]

    async def fake_create(**kwargs):
        calls.append("create")
        return round_msgs.pop(0)

    monkeypatch.setattr(light_loop, "create_chat_completion", fake_create)
    from core.config import settings as _settings

    monkeypatch.setattr(_settings, "deepseek_model_pro", "deepseek-v4-pro")

    out = await light_loop.run_light_skill(
        "factor_analysis", "分析因子", on_status=None
    )
    assert "HS300" in out
    assert calls
