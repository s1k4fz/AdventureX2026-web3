from ai.model_factory import build_model, init_http_client
from ai.types import ModelRoute
from core.config import settings


def test_deepseek_openai_compatible_builds(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", "test-key")
    monkeypatch.setattr(settings, "deepseek_base_url", "https://api.deepseek.com")
    init_http_client()
    route = ModelRoute(
        platform="deepseek",
        adapter="openai_compatible",
        model="deepseek-v4-pro",
        priority=0,
        timeout_s=30,
        extra={"max_tokens": 1024},
    )
    model = build_model(route)
    assert model is not None
    assert "deepseek-v4-pro" in str(model.model_name)
