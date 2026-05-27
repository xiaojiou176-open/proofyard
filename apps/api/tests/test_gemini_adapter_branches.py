from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

import apps.api.app.services.engine_adapters.gemini_adapter as gemini_module
from apps.api.app.services.engine_adapters.gemini_adapter import GeminiAdapter


def test_resolve_model_and_thinking_env_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()

    monkeypatch.delenv("GEMINI_MODEL_PRIMARY", raising=False)
    assert adapter._resolve_model() == "models/gemini-3.1-pro-preview"

    monkeypatch.setenv("GEMINI_MODEL_PRIMARY", "  models/custom ")
    assert adapter._resolve_model() == "models/custom"

    monkeypatch.setenv("GEMINI_THINKING_LEVEL", " medium ")
    assert adapter._resolve_thinking_level() == "medium"

    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "nonsense")
    assert adapter._resolve_thinking_level() == "high"

    monkeypatch.setenv("GEMINI_INCLUDE_THOUGHTS", "off")
    assert adapter._resolve_include_thoughts() is False

    monkeypatch.setenv("GEMINI_INCLUDE_THOUGHTS", "yes")
    assert adapter._resolve_include_thoughts() is True


@pytest.mark.parametrize(
    ("level", "expected"),
    [
        ("minimal", 0),
        ("low", 1024),
        ("medium", 4096),
        ("high", -1),
        ("other", -1),
    ],
)
def test_resolve_thinking_budget(level: str, expected: int) -> None:
    assert GeminiAdapter._resolve_thinking_budget(level) == expected


def test_try_parse_json_supports_fenced_payload() -> None:
    adapter = GeminiAdapter()
    parsed = adapter._try_parse_json('```json\n{"steps": []}\n```')
    assert parsed == {"steps": []}


def test_parse_response_steps_dict_list_and_invalid_schema() -> None:
    adapter = GeminiAdapter()

    parsed_dict, invalid_dict = adapter._parse_response_steps(
        SimpleNamespace(
            parsed={
                "steps": [{"action": "click", "confidence": 0.9, "evidence_ref": "model:click"}]
            },
            text="",
        ),
        "https://example.com/start",
    )
    assert invalid_dict is False
    assert parsed_dict[0]["action"] == "navigate"
    assert parsed_dict[1]["action"] == "click"

    parsed_list, invalid_list = adapter._parse_response_steps(
        SimpleNamespace(
            parsed=[
                {
                    "action": "navigate",
                    "url": "https://example.com/ready",
                    "confidence": 0.95,
                    "evidence_ref": "model:navigate",
                }
            ],
            text="",
        ),
        "https://example.com/start",
    )
    assert invalid_list is False
    assert parsed_list[0]["action"] == "navigate"
    assert parsed_list[0]["url"] == "https://example.com/ready"

    parsed_invalid, invalid_schema = adapter._parse_response_steps(
        SimpleNamespace(parsed={"steps": [{"action": "drag", "confidence": 0.1}]}, text=""),
        "https://example.com/start",
    )
    assert parsed_invalid == []
    assert invalid_schema is True


def test_normalize_model_step_invalid_action_and_manual_gate_reason() -> None:
    adapter = GeminiAdapter()

    invalid = adapter._normalize_model_step({"action": "drag", "confidence": 0.5})
    assert invalid == "__invalid_action_schema__"

    manual = adapter._normalize_model_step(
        {
            "action": "manual_gate",
            "unsupported_reason": "not-prefixed",
            "manual_handoff_required": True,
            "confidence": 0.88,
        }
    )
    assert isinstance(manual, dict)
    assert manual["manual_handoff_required"] is True
    assert manual["unsupported_reason"] == "ai.gemini.model_manual_gate"
    assert manual["reason_code"] == "ai.gemini.model_manual_gate"


def test_ensure_navigate_step_branches() -> None:
    adapter = GeminiAdapter()

    starts_with_navigate = [{"action": "navigate", "url": "https://example.com/1"}]
    assert adapter._ensure_navigate_step(starts_with_navigate, "https://example.com/start") == (
        starts_with_navigate
    )

    has_navigate_later = [{"action": "click"}, {"action": "navigate", "url": "x"}]
    assert adapter._ensure_navigate_step(has_navigate_later, "https://example.com/start") == (
        has_navigate_later
    )

    no_navigate = [{"action": "click", "confidence": 0.9}]
    with_injected = adapter._ensure_navigate_step(no_navigate, "https://example.com/start")
    assert with_injected[0]["action"] == "navigate"
    assert with_injected[0]["url"] == "https://example.com/start"
    assert with_injected[1]["action"] == "click"


def test_find_register_entry_prefers_post_register_or_signup() -> None:
    adapter = GeminiAdapter()
    entries = [
        {"method": "GET", "url": "https://example.com/register"},
        {"request": {"method": "POST", "url": "https://example.com/api/signup"}},
        {"method": "POST", "url": "https://example.com/api/other"},
    ]

    found = adapter._find_register_entry(entries)
    assert found is not None
    assert "signup" in str(found.get("request", {}).get("url", "")).lower()


def test_extract_steps_with_context_cache_hit_and_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    calls = {"count": 0}

    def fake_extract_steps_main(_payload):
        calls["count"] += 1
        return ([{"action": "navigate", "url": "https://example.com"}], {"strategy": "strong"})

    monkeypatch.setattr(adapter, "_extract_steps_main", fake_extract_steps_main)

    result_miss = adapter.extract_steps_with_context_cache(
        payload=SimpleNamespace(),
        cache_key="k1",
        ttl_seconds=60,
    )
    assert result_miss["hit"] is False
    assert result_miss["status"] == "api_miss"
    assert calls["count"] == 1

    result_hit = adapter.extract_steps_with_context_cache(
        payload=SimpleNamespace(),
        cache_key="k1",
        ttl_seconds=60,
    )
    assert result_hit["hit"] is True
    assert result_hit["status"] == "api_hit"
    assert calls["count"] == 1

    adapter._context_cache["k1"]["expires_at"] = datetime.now(UTC) - timedelta(seconds=1)
    result_expired_miss = adapter.extract_steps_with_context_cache(
        payload=SimpleNamespace(),
        cache_key="k1",
        ttl_seconds=60,
    )
    assert result_expired_miss["hit"] is False
    assert result_expired_miss["status"] == "api_miss"
    assert calls["count"] == 2


def test_extract_steps_with_sdk_branch_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace(start_url="https://example.com", har_entries=[])
    monkeypatch.setattr(adapter, "_resolve_api_key", lambda: "")

    steps, reason = adapter._extract_steps_with_sdk(payload)
    assert steps is None
    assert reason == GeminiAdapter._FAILURE_MISSING_KEY


def test_extract_steps_with_sdk_branch_sdk_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace(start_url="https://example.com", har_entries=[])
    monkeypatch.setattr(adapter, "_resolve_api_key", lambda: "token")
    monkeypatch.setattr(gemini_module, "_genai", None)

    steps, reason = adapter._extract_steps_with_sdk(payload)
    assert steps is None
    assert reason == GeminiAdapter._FAILURE_SDK_UNAVAILABLE


def test_extract_steps_with_sdk_branch_request_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace(
        start_url="https://example.com",
        har_entries=[],
        html_content="",
        extractor_strategy="balanced",
        event_summary_text="",
    )

    class _FailingModels:
        @staticmethod
        def generate_content(**_kwargs):
            raise RuntimeError("boom")

    class _FailingClient:
        def __init__(self, api_key: str):
            assert api_key == "token"
            self.models = _FailingModels()

    monkeypatch.setattr(adapter, "_resolve_api_key", lambda: "token")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=_FailingClient))

    steps, reason = adapter._extract_steps_with_sdk(payload)
    assert steps is None
    assert reason == GeminiAdapter._FAILURE_REQUEST_FAILED


@pytest.mark.parametrize(
    ("parsed_result", "expected_reason"),
    [
        (([], True), GeminiAdapter._FAILURE_INVALID_ACTION_SCHEMA),
        (([], False), GeminiAdapter._FAILURE_INVALID_RESPONSE),
    ],
)
def test_extract_steps_with_sdk_invalid_schema_or_response(
    monkeypatch: pytest.MonkeyPatch,
    parsed_result: tuple[list[dict[str, object]], bool],
    expected_reason: str,
) -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace(
        start_url="https://example.com",
        har_entries=[],
        html_content="",
        extractor_strategy="balanced",
        event_summary_text="",
    )

    class _Models:
        @staticmethod
        def generate_content(**_kwargs):
            return SimpleNamespace(parsed=None, text="")

    class _Client:
        def __init__(self, api_key: str):
            assert api_key == "token"
            self.models = _Models()

    monkeypatch.setattr(adapter, "_resolve_api_key", lambda: "token")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=_Client))
    monkeypatch.setattr(adapter, "_parse_response_steps", lambda *_args: parsed_result)

    steps, reason = adapter._extract_steps_with_sdk(payload)
    assert steps is None
    assert reason == expected_reason


def test_extract_steps_with_sdk_success(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace(
        start_url="https://example.com",
        har_entries=[],
        html_content="",
        extractor_strategy="balanced",
        event_summary_text="",
    )

    class _Models:
        @staticmethod
        def generate_content(**_kwargs):
            return SimpleNamespace(parsed=None, text="")

    class _Client:
        def __init__(self, api_key: str):
            assert api_key == "token"
            self.models = _Models()

    expected = [{"action": "navigate", "url": "https://example.com", "confidence": 0.95}]
    monkeypatch.setattr(adapter, "_resolve_api_key", lambda: "token")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=_Client))
    monkeypatch.setattr(adapter, "_parse_response_steps", lambda *_args: (expected, False))

    steps, reason = adapter._extract_steps_with_sdk(payload)
    assert steps == expected
    assert reason is None
