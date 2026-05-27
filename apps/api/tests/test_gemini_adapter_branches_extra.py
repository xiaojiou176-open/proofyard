from __future__ import annotations

from types import SimpleNamespace

import pytest

import apps.api.app.services.engine_adapters.gemini_adapter as gemini_module
from apps.api.app.services.engine_adapters.gemini_adapter import GeminiAdapter


def test_extract_steps_main_heuristic_without_failure_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace()
    monkeypatch.setattr(adapter, "_try_extract_steps_strong", lambda _p: (None, None))
    monkeypatch.setattr(adapter, "_extract_steps_heuristic", lambda _p: [{"action": "navigate"}])

    steps, meta = adapter._extract_steps_main(payload)
    assert steps == [{"action": "navigate"}]
    assert meta["strategy"] == "heuristic"
    assert meta["fallback"]["reason"] == "strong_unavailable"


def test_extract_steps_with_sdk_reuses_cached_client(monkeypatch: pytest.MonkeyPatch) -> None:
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

    adapter._client = SimpleNamespace(models=_Models())
    monkeypatch.setattr(adapter, "_resolve_api_key", lambda: "token")
    monkeypatch.setattr(gemini_module, "_genai", SimpleNamespace(Client=lambda **_: None))
    monkeypatch.setattr(
        adapter,
        "_parse_response_steps",
        lambda *_args: (
            [{"action": "navigate", "url": "https://example.com", "confidence": 0.9}],
            False,
        ),
    )

    steps, reason = adapter._extract_steps_with_sdk(payload)
    assert reason is None
    assert steps and steps[0]["action"] == "navigate"


def test_build_generate_config_without_sdk_types_returns_dict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = GeminiAdapter()
    monkeypatch.setattr(gemini_module, "_genai_types", None)
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "low")
    monkeypatch.setenv("GEMINI_INCLUDE_THOUGHTS", "false")

    cfg = adapter._build_generate_config()
    assert isinstance(cfg, dict)
    assert cfg["thinking_config"]["thinking_level"] == "low"
    assert cfg["thinking_config"]["include_thoughts"] is False


def test_build_generate_config_with_thinking_level_support(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = GeminiAdapter()

    class _FakeThinkingLevel:
        HIGH = "HIGH"
        MEDIUM = "MEDIUM"

    class _FakeThinkingConfig:
        model_fields = {"thinking_level": object(), "include_thoughts": object()}

        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _FakeGenerateContentConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        gemini_module,
        "_genai_types",
        SimpleNamespace(
            ThinkingConfig=_FakeThinkingConfig,
            ThinkingLevel=_FakeThinkingLevel,
            GenerateContentConfig=_FakeGenerateContentConfig,
        ),
    )
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "medium")
    monkeypatch.setenv("GEMINI_INCLUDE_THOUGHTS", "true")

    cfg = adapter._build_generate_config()
    thinking = cfg.kwargs["thinking_config"].kwargs
    assert thinking["thinking_level"] == "MEDIUM"
    assert thinking["include_thoughts"] is True
    assert "thinking_budget" not in thinking


def test_build_generate_config_with_thinking_budget_only(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()

    class _FakeThinkingConfig:
        model_fields = {"thinking_budget": object(), "include_thoughts": object()}

        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _FakeGenerateContentConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        gemini_module,
        "_genai_types",
        SimpleNamespace(
            ThinkingConfig=_FakeThinkingConfig,
            GenerateContentConfig=_FakeGenerateContentConfig,
        ),
    )
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "low")
    monkeypatch.setenv("GEMINI_INCLUDE_THOUGHTS", "false")

    cfg = adapter._build_generate_config()
    thinking = cfg.kwargs["thinking_config"].kwargs
    assert thinking["thinking_budget"] == 1024
    assert thinking["include_thoughts"] is False
    assert "thinking_level" not in thinking


def test_build_generate_config_without_level_or_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()

    class _FakeThinkingConfig:
        model_fields = {"include_thoughts": object()}

        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _FakeGenerateContentConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        gemini_module,
        "_genai_types",
        SimpleNamespace(
            ThinkingConfig=_FakeThinkingConfig,
            GenerateContentConfig=_FakeGenerateContentConfig,
        ),
    )
    cfg = adapter._build_generate_config()
    thinking = cfg.kwargs["thinking_config"].kwargs
    assert "thinking_level" not in thinking
    assert "thinking_budget" not in thinking
    assert "include_thoughts" in thinking


def test_parse_strong_response_function_call_success() -> None:
    adapter = GeminiAdapter()
    response = SimpleNamespace(
        function_calls=[
            SimpleNamespace(
                name="emit_reconstruction_steps",
                args={"steps": [{"action": "click", "confidence": 0.91}]},
            )
        ],
        parsed=None,
        text="",
    )

    parsed = adapter._parse_strong_response(response, "https://example.com/start")
    assert parsed["path"] == "function_call"
    assert parsed["parser"] == "function_args"
    assert parsed["steps"][0]["action"] == "navigate"
    assert parsed["steps"][1]["action"] == "click"


def test_parse_strong_response_function_call_invalid_fallback_text() -> None:
    adapter = GeminiAdapter()
    response = SimpleNamespace(
        function_calls=[
            SimpleNamespace(name="emit_reconstruction_steps", args={"steps": [{"action": "drag"}]})
        ],
        parsed=None,
        text='{"steps":[{"action":"click","confidence":0.9,"evidence_ref":"x"}]}',
    )

    parsed = adapter._parse_strong_response(response, "https://example.com/start")
    assert parsed["path"] == "text_json_fallback"
    assert parsed["parser"] == "response_text"
    assert parsed["steps"][1]["action"] == "click"


def test_parse_strong_response_parses_string_args(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    monkeypatch.setattr(
        adapter,
        "_try_parse_json",
        lambda value: {"steps": [{"action": "click", "confidence": 0.9}]}
        if value == '{"steps":[{"action":"click","confidence":0.9}]}'
        else None,
    )
    response = SimpleNamespace(
        function_calls=[
            SimpleNamespace(
                name="emit_reconstruction_steps",
                args='{"steps":[{"action":"click","confidence":0.9}]}',
            )
        ],
        parsed=None,
        text="",
    )

    parsed = adapter._parse_strong_response(response, "https://example.com/start")
    assert parsed["path"] == "function_call"
    assert parsed["steps"][1]["action"] == "click"


def test_parse_strong_response_none_branch(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = GeminiAdapter()
    response = SimpleNamespace(function_calls=None, parsed=None, text="")
    monkeypatch.setattr(adapter, "_parse_response_steps", lambda *_args: ([], False))

    parsed = adapter._parse_strong_response(response, "https://example.com/start")
    assert parsed == {"path": "none", "parser": "none", "steps": []}


def test_parse_response_steps_invalid_payload_shapes() -> None:
    adapter = GeminiAdapter()
    empty_steps, invalid = adapter._parse_response_steps(
        SimpleNamespace(parsed="bad", text=""),
        "https://example.com/start",
    )
    assert empty_steps == []
    assert invalid is False

    empty_steps_2, invalid_2 = adapter._parse_response_steps(
        SimpleNamespace(parsed={"steps": "bad"}, text=""),
        "https://example.com/start",
    )
    assert empty_steps_2 == []
    assert invalid_2 is False

    empty_steps_3, invalid_3 = adapter._parse_response_steps(
        SimpleNamespace(parsed={"steps": [{"action": ""}]}, text=""),
        "https://example.com/start",
    )
    assert empty_steps_3 == []
    assert invalid_3 is False


def test_entry_method_path_status_and_summaries_multi_branches() -> None:
    adapter = GeminiAdapter()

    method, path, status = adapter._entry_method_path_status(
        {
            "request": {"method": "post", "url": "https://example.com/api/register"},
            "response": {"status": 201},
        }
    )
    assert (method, path, status) == ("POST", "/api/register", 201)

    method2, path2, status2 = adapter._entry_method_path_status(
        {"method": "get", "url": "urn:test", "status": 204}
    )
    assert (method2, path2, status2) == ("GET", "test", 204)

    entries = [
        {"method": "POST", "url": "https://example.com/api/register", "status": 201},
        {"method": "POST", "url": "https://example.com/mfa/challenge", "status": 401},
        {"method": "PATCH", "url": "https://example.com/cart", "status": 200},
        {"method": "GET", "url": "", "status": 200},
    ]
    events = adapter._summarize_events(entries)
    assert "[account-flow] POST /api/register (status=201)" in events
    assert "[protection-checkpoint] POST /mfa/challenge (status=401)" in events
    assert "[mutation] PATCH /cart (status=200)" in events
    assert "status=200)" in events

    assert adapter._summarize_events([]) == "No event summary provided."

    har_entries = [
        {"method": "GET", "url": f"https://example.com/p/{idx}", "status": 200} for idx in range(26)
    ]
    har = adapter._summarize_har(har_entries)
    assert "1. GET /p/0 status=200" in har
    assert "25. GET /p/24 status=200" in har
    assert "truncated 1 additional entries" in har
    assert adapter._summarize_har([]) == "No HAR entries provided."


def test_extract_text_empty_and_non_empty() -> None:
    adapter = GeminiAdapter()

    assert adapter._extract_text(SimpleNamespace(text="  hello  ")) == "hello"
    assert adapter._extract_text(SimpleNamespace(text="")) == ""
    assert adapter._extract_text(SimpleNamespace(text=None)) == ""

    # exercise _try_parse_json error branch
    assert adapter._try_parse_json("{bad-json") is None


def test_allowed_actions_cache_hit_without_reading_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(GeminiAdapter, "_allowed_actions_cache", frozenset({"navigate", "click"}))

    class _PathShouldNotBeUsed:
        @staticmethod
        def read_text(*_args, **_kwargs):
            raise AssertionError("read_text should not be called when cache exists")

    monkeypatch.setattr(GeminiAdapter, "_ACTION_SCHEMA_PATH", _PathShouldNotBeUsed())
    assert GeminiAdapter._allowed_actions() == frozenset({"navigate", "click"})


def test_allowed_actions_invalid_schema_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(GeminiAdapter, "_allowed_actions_cache", None)

    class _InvalidPath:
        @staticmethod
        def read_text(*_args, **_kwargs):
            return '{"actions": [1, 2]}'

    monkeypatch.setattr(GeminiAdapter, "_ACTION_SCHEMA_PATH", _InvalidPath())
    with pytest.raises(ValueError, match="invalid action schema"):
        GeminiAdapter._allowed_actions()


def test_attach_failure_reason_normalize_and_clamp_boundaries() -> None:
    adapter = GeminiAdapter()
    steps = [
        {"action": "click"},
        {"action": "manual_gate", "unsupported_reason": "old"},
        {"action": "manual_gate", "unsupported_reason": "keep-me"},
    ]

    patched = adapter._attach_failure_reason(steps, GeminiAdapter._FAILURE_REQUEST_FAILED)
    assert patched[1]["manual_handoff_required"] is True
    assert patched[1]["unsupported_reason"] == GeminiAdapter._FAILURE_REQUEST_FAILED
    assert patched[1]["reason_code"] == GeminiAdapter._FAILURE_REQUEST_FAILED
    assert patched[2]["unsupported_reason"] == "keep-me"

    assert adapter._normalize_reason("ai.gemini.request_failed") == "ai.gemini.request_failed"
    assert adapter._normalize_reason("other") == "ai.gemini.model_manual_gate"

    assert adapter._clamp_confidence(-1) == 0.0
    assert adapter._clamp_confidence(2) == 1.0
    assert adapter._clamp_confidence("0.42") == 0.42
    assert adapter._clamp_confidence("oops") == 0.0


def test_find_register_entry_skips_non_matching_post() -> None:
    adapter = GeminiAdapter()
    entries = [
        {"method": "GET", "url": "https://example.com/register"},
        {"method": "POST", "url": "https://example.com/api/login"},
    ]
    assert adapter._find_register_entry(entries) is None


def test_parse_strong_response_function_call_parse_fail_and_non_list_steps(monkeypatch) -> None:
    adapter = GeminiAdapter()
    monkeypatch.setattr(adapter, "_try_parse_json", lambda _value: None)

    response_parse_fail = SimpleNamespace(
        function_calls=[SimpleNamespace(name="emit_reconstruction_steps", args='{"bad":1}')],
        parsed=None,
        text="",
    )
    parsed_fail = adapter._parse_strong_response(response_parse_fail, "https://example.com/start")
    assert parsed_fail["path"] == "none"

    response_non_list = SimpleNamespace(
        function_calls=[
            SimpleNamespace(name="emit_reconstruction_steps", args={"steps": {"action": "click"}})
        ],
        parsed=None,
        text="",
    )
    parsed_non_list = adapter._parse_strong_response(response_non_list, "https://example.com/start")
    assert parsed_non_list["path"] == "none"


def test_extract_steps_heuristic_aggressive_branch() -> None:
    adapter = GeminiAdapter()
    payload = SimpleNamespace(
        start_url="https://example.com/register",
        har_entries=[{"method": "POST", "url": "https://example.com/api/register", "status": 201}],
        extractor_strategy="aggressive",
    )
    steps = adapter._extract_steps_heuristic(payload)
    assert any(step.get("action") == "extract" for step in steps)


def test_entry_method_path_status_raw_url_without_path() -> None:
    adapter = GeminiAdapter()
    method, path, status = adapter._entry_method_path_status(
        {"method": "GET", "url": "mailto:test"}
    )
    assert method == "GET"
    assert path == "test"
    assert status == 0


def test_summarize_har_skips_entries_without_path() -> None:
    adapter = GeminiAdapter()
    result = adapter._summarize_har([{"method": "GET", "url": "", "status": 200}])
    assert result == "No HAR entries provided."


def test_parse_response_steps_with_no_text_and_non_dict_item() -> None:
    adapter = GeminiAdapter()
    steps1, invalid1 = adapter._parse_response_steps(SimpleNamespace(parsed=None, text=""), "u")
    assert steps1 == []
    assert invalid1 is False

    steps2, invalid2 = adapter._parse_response_steps(
        SimpleNamespace(parsed={"steps": ["bad"]}, text=""), "u"
    )
    assert steps2 == []
    assert invalid2 is False


def test_normalize_model_step_non_dict_returns_none() -> None:
    adapter = GeminiAdapter()
    assert adapter._normalize_model_step("not-dict") is None
