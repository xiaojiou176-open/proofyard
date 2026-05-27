from __future__ import annotations

from types import SimpleNamespace

import apps.api.app.services.engine_adapters.gemini_adapter as gemini_module
from apps.api.app.services.engine_adapters.gemini_adapter import GeminiAdapter, GeminiExtractionInput


def _payload(*, event_summary: str = "") -> GeminiExtractionInput:
    return GeminiExtractionInput(
        start_url="https://example.com/register",
        har_entries=[
            {
                "method": "POST",
                "url": "https://example.com/api/register",
                "status": 201,
            }
        ],
        html_content="<form><input name='email'><input name='password'></form>",
        extractor_strategy="balanced",
        event_summary_text=event_summary,
    )


def test_gemini_adapter_uses_sdk_generation(monkeypatch) -> None:
    calls: dict[str, object] = {}

    class FakeModels:
        def generate_content(self, *, model: str, contents: list[str], config: object) -> object:
            calls["model"] = model
            calls["contents"] = contents
            calls["config"] = config
            return SimpleNamespace(
                parsed={
                    "steps": [
                        {
                            "action": "click",
                            "confidence": 0.92,
                            "evidence_ref": "model:submit",
                        }
                    ]
                }
            )

    class FakeClient:
        def __init__(self, *, api_key: str) -> None:
            calls["api_key"] = api_key
            self.models = FakeModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=FakeClient))
    monkeypatch.setattr(gemini_module, "_genai_types", None)

    steps = GeminiAdapter().extract_steps(_payload(event_summary="typed email then submitted"))

    assert calls["api_key"] == "test-gemini-key"
    assert calls["model"] == "models/gemini-3.1-pro-preview"
    assert "typed email then submitted" in str(calls["contents"])
    assert isinstance(calls["config"], dict)
    assert calls["config"]["response_schema"]["type"] == "object"
    assert calls["config"]["thinking_config"]["thinking_level"] == "high"
    assert steps[0]["action"] == "navigate"
    assert steps[1]["action"] == "click"
    assert steps[1]["source_engine"] == "gemini"


def test_gemini_adapter_fallbacks_with_ai_reason_code(monkeypatch) -> None:
    class FailingModels:
        def generate_content(self, *, model: str, contents: list[str], config: object) -> object:
            raise RuntimeError("boom")

    class FakeClient:
        def __init__(self, *, api_key: str) -> None:
            self.models = FailingModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=FakeClient))
    monkeypatch.setattr(gemini_module, "_genai_types", None)

    payload = GeminiExtractionInput(
        start_url="https://example.com/register",
        har_entries=[],
        html_content="<html></html>",
        extractor_strategy="strict",
    )

    steps = GeminiAdapter().extract_steps(payload)

    manual_step = next(step for step in steps if step.get("action") == "manual_gate")
    assert manual_step["unsupported_reason"] == "ai.gemini.request_failed"
    assert manual_step["reason_code"] == "ai.gemini.request_failed"


def test_gemini_adapter_keeps_heuristic_steps_without_api_key(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    steps = GeminiAdapter().extract_steps(_payload())

    assert steps[0]["action"] == "navigate"
    assert any(step.get("action") == "type" for step in steps)
    assert all(step.get("action") != "manual_gate" for step in steps)


def test_gemini_adapter_invalid_action_schema_returns_reason_code(monkeypatch) -> None:
    class InvalidActionModels:
        def generate_content(self, *, model: str, contents: list[str], config: object) -> object:
            return SimpleNamespace(
                parsed={
                    "steps": [
                        {
                            "action": "drag",
                            "confidence": 0.8,
                            "evidence_ref": "model:drag",
                        }
                    ]
                }
            )

    class FakeClient:
        def __init__(self, *, api_key: str) -> None:
            self.models = InvalidActionModels()

    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=FakeClient))
    monkeypatch.setattr(gemini_module, "_genai_types", None)

    payload = GeminiExtractionInput(
        start_url="https://example.com/register",
        har_entries=[],
        html_content="<html></html>",
        extractor_strategy="balanced",
    )

    steps = GeminiAdapter().extract_steps(payload)
    manual_step = next(step for step in steps if step.get("action") == "manual_gate")
    assert manual_step["unsupported_reason"] == "ai.gemini.invalid_action_schema"
    assert manual_step["reason_code"] == "ai.gemini.invalid_action_schema"
