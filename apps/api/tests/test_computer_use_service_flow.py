from __future__ import annotations

import json
import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from apps.api.app.services.computer_use_service import (
    ComputerUseAction,
    ComputerUseService,
    ComputerUseServiceError,
)

computer_use_service_module = importlib.import_module("apps.api.app.services.computer_use_service")


def _new_service(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> ComputerUseService:
    monkeypatch.setenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", str(tmp_path / "automation"))
    monkeypatch.setenv("GEMINI_MODEL_PRIMARY", "gemini-3.1-pro-preview")
    return ComputerUseService()


def _new_action(name: str = "click", args: dict[str, object] | None = None) -> ComputerUseAction:
    return ComputerUseAction(
        action_id="act_123456",
        name=name,
        args=args or {"x": 1},
        rationale="rationale",
        risk_level="medium",
        confirmation_reason=None,
        action_digest="digest123",
        require_confirmation=False,
        safety_decision="allow_auto_execute",
    )


def test_read_evidence_when_file_not_exists(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    evidence_file = service._evidence_file(session.session_id)
    evidence_file.unlink(missing_ok=True)

    data = service.read_evidence(session_id=session.session_id, actor="alice")
    assert data["eventCount"] == 0
    assert data["events"] == []


def test_preview_action_rejects_empty_effective_instruction(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")

    with pytest.raises(ComputerUseServiceError) as exc:
        service.preview_action(
            session_id=session.session_id,
            actor="alice",
            screenshot_base64=None,
            screenshot_mime_type="image/png",
            instruction="   ",
        )

    assert exc.value.status_code == 422
    assert str(exc.value) == "effective instruction is empty"


def test_preview_action_rejects_missing_gemini_api_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(ComputerUseServiceError) as exc:
        service.preview_action(
            session_id=session.session_id,
            actor="alice",
            screenshot_base64=None,
            screenshot_mime_type="image/png",
        )

    assert exc.value.status_code == 503
    assert str(exc.value) == "missing GEMINI_API_KEY"


def test_preview_action_sets_confirmation_and_writes_evidence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    response = SimpleNamespace(
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(
                            function_call=SimpleNamespace(name="send_email", args={"to": "bob"})
                        )
                    ]
                )
            )
        ]
    )
    monkeypatch.setattr(service, "_generate_plan", lambda **_: response)

    action = service.preview_action(
        session_id=session.session_id,
        actor="alice",
        screenshot_base64=None,
        screenshot_mime_type="image/png",
    )

    assert action.require_confirmation is True
    assert action.safety_decision == "require_confirmation"
    assert action.confirmation_reason == "action 'send_email' is high impact"

    evidence = service.read_evidence(session_id=session.session_id, actor="alice")
    preview_events = [event for event in evidence["events"] if event["event"] == "action_previewed"]
    assert len(preview_events) == 1
    payload = preview_events[0]["payload"]
    assert payload["actionId"] == action.action_id
    assert payload["safetyDecision"] == "require_confirmation"
    assert payload["requireConfirmation"] is True


def test_confirm_action_approved_rejected_and_reason_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")

    approved = _new_action()
    session.actions[approved.action_id] = approved
    confirmed = service.confirm_action(
        session_id=session.session_id,
        action_id=approved.action_id,
        actor="alice",
        approved=True,
        confirmation_reason=" approved by reviewer ",
    )
    assert confirmed.status == "confirmed"
    assert confirmed.confirmed_by == "alice"
    assert confirmed.confirmation_reason == "approved by reviewer"

    rejected = _new_action()
    rejected.action_id = "act_rejected"
    rejected.confirmation_reason = "keep original"
    session.actions[rejected.action_id] = rejected
    declined = service.confirm_action(
        session_id=session.session_id,
        action_id=rejected.action_id,
        actor="alice",
        approved=False,
        confirmation_reason="  ",
    )
    assert declined.status == "rejected"
    assert declined.confirmation_reason == "keep original"


def test_confirm_action_returns_early_when_already_executed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    action = _new_action()
    action.status = "executed"
    session.actions[action.action_id] = action

    result = service.confirm_action(
        session_id=session.session_id,
        action_id=action.action_id,
        actor="alice",
        approved=False,
        confirmation_reason="should be ignored",
    )

    assert result is action
    assert result.status == "executed"
    assert result.confirmed_by is None


def test_execute_action_rejects_rejected_status(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    action = _new_action()
    action.status = "rejected"
    session.actions[action.action_id] = action

    with pytest.raises(ComputerUseServiceError) as exc:
        service.execute_action(
            session_id=session.session_id, action_id=action.action_id, actor="alice"
        )

    assert exc.value.status_code == 409
    assert "cannot be executed" in str(exc.value)


def test_execute_action_rejects_previewed_requires_confirmation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    action = _new_action()
    action.require_confirmation = True
    action.status = "previewed"
    session.actions[action.action_id] = action

    with pytest.raises(ComputerUseServiceError) as exc:
        service.execute_action(
            session_id=session.session_id, action_id=action.action_id, actor="alice"
        )

    assert exc.value.status_code == 409
    assert str(exc.value) == "action requires confirmation before execution"


def test_execute_action_rejects_non_confirmed_when_confirmation_required(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    action = _new_action()
    action.require_confirmation = True
    action.status = "pending"
    session.actions[action.action_id] = action

    with pytest.raises(ComputerUseServiceError) as exc:
        service.execute_action(
            session_id=session.session_id, action_id=action.action_id, actor="alice"
        )

    assert exc.value.status_code == 409
    assert str(exc.value) == "action requires confirmation before execution"


def test_execute_action_success_updates_status_and_result(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    action = _new_action(args={"selector": "#run"})
    session.actions[action.action_id] = action

    execution_payload = {
        "executor": "mock-executor",
        "evidence": {
            "screens": ["screen.png"],
            "clips": [],
            "network_summary": {"requests": 1},
            "dom_summary": {"title": "ok"},
            "replay_trace": {"steps": 1},
        },
    }
    monkeypatch.setattr(service, "_execute_with_playwright", lambda **_: execution_payload)

    result = service.execute_action(
        session_id=session.session_id, action_id=action.action_id, actor="alice"
    )

    assert action.status == "executed"
    assert action.executed_at is not None
    assert result["status"] == "executed"
    assert result["executor"] == "mock-executor"
    assert result["executedAt"] == action.executed_at
    assert result["confirmationReason"] == action.confirmation_reason
    assert result["evidence"]["screens"] == ["screen.png"]


def test_generate_plan_handles_invalid_screenshot_and_tool_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    captured: dict[str, object] = {}

    class _FakeModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(ok=True)

    class _FakeClient:
        def __init__(self, api_key: str) -> None:
            captured["api_key"] = api_key
            self.models = _FakeModels()

    class _ToolRaises:
        def __init__(self, **_kwargs) -> None:
            raise RuntimeError("tool init failed")

    class _DummyComputerUse:
        def __init__(self) -> None:
            pass

    monkeypatch.setattr(computer_use_service_module.genai, "Client", _FakeClient)
    monkeypatch.setattr(computer_use_service_module.genai_types, "Tool", _ToolRaises, raising=False)
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "ComputerUse",
        _DummyComputerUse,
        raising=False,
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "ThinkingConfig",
        lambda **kwargs: {"thinking": kwargs},
        raising=False,
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "GenerateContentConfig",
        lambda **kwargs: kwargs,
        raising=False,
    )
    monkeypatch.setattr(service, "_resolve_thinking_level", lambda: "high-level")

    service._generate_plan(
        api_key="test-key",
        model="gemini-3.1-pro-preview",
        instruction="open page",
        screenshot_base64="%%%invalid-base64%%%",
        screenshot_mime_type="image/png",
        include_thoughts=True,
    )

    assert captured["api_key"] == "test-key"
    assert captured["model"] == "gemini-3.1-pro-preview"
    assert captured["contents"] == ["open page", "[invalid screenshot payload]"]
    assert isinstance(captured["config"], dict)
    assert "tools" not in captured["config"]


def test_generate_plan_with_valid_screenshot_and_tools(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    captured: dict[str, object] = {}

    class _FakeModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(ok=True)

    class _FakeClient:
        def __init__(self, api_key: str) -> None:
            captured["api_key"] = api_key
            self.models = _FakeModels()

    class _DummyTool:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

    class _DummyComputerUse:
        def __init__(self) -> None:
            pass

    monkeypatch.setattr(computer_use_service_module.genai, "Client", _FakeClient)
    monkeypatch.setattr(computer_use_service_module.genai_types, "Tool", _DummyTool, raising=False)
    monkeypatch.setattr(
        computer_use_service_module.genai_types, "ComputerUse", _DummyComputerUse, raising=False
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "Part",
        SimpleNamespace(from_bytes=lambda data, mime_type: {"data": data, "mime_type": mime_type}),
        raising=False,
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "ThinkingConfig",
        lambda **kwargs: {"thinking": kwargs},
        raising=False,
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "GenerateContentConfig",
        lambda **kwargs: kwargs,
        raising=False,
    )
    monkeypatch.setattr(service, "_resolve_thinking_level", lambda: "high-level")

    response = service._generate_plan(
        api_key="test-key",
        model="gemini-3.1-pro-preview",
        instruction="open page",
        screenshot_base64="aGVsbG8=",
        screenshot_mime_type="image/png",
        include_thoughts=False,
    )

    assert response.ok is True
    assert captured["api_key"] == "test-key"
    assert isinstance(captured["contents"], list)
    assert captured["contents"][0] == "open page"
    assert captured["contents"][1]["mime_type"] == "image/png"
    assert "tools" in captured["config"]


def test_extract_action_from_response_branch_without_function_call(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    response = SimpleNamespace(
        candidates=[
            SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(function_call=None)])),
            SimpleNamespace(content=SimpleNamespace(parts="not-a-list")),
        ],
        text="fallback text",
    )

    name, args, rationale = service._extract_action_from_response(response)
    assert name == "manual_review"
    assert rationale == "text-only fallback"
    assert args["summary"] == "fallback text"


def test_extract_action_from_response_non_dict_args_to_raw(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    response = SimpleNamespace(
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(function_call=SimpleNamespace(name="click", args="raw-arg"))
                    ]
                )
            )
        ]
    )
    name, args, _ = service._extract_action_from_response(response)
    assert name == "click"
    assert args == {"raw": "raw-arg"}


def test_generate_plan_without_screenshot_and_non_callable_tools(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    captured: dict[str, object] = {}

    class _FakeModels:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(ok=True)

    class _FakeClient:
        def __init__(self, api_key: str) -> None:
            self.models = _FakeModels()

    monkeypatch.setattr(computer_use_service_module.genai, "Client", _FakeClient)
    monkeypatch.setattr(computer_use_service_module.genai_types, "Tool", object(), raising=False)
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "ComputerUse",
        SimpleNamespace,
        raising=False,
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "ThinkingConfig",
        lambda **kwargs: {"thinking": kwargs},
        raising=False,
    )
    monkeypatch.setattr(
        computer_use_service_module.genai_types,
        "GenerateContentConfig",
        lambda **kwargs: kwargs,
        raising=False,
    )
    monkeypatch.setattr(service, "_resolve_thinking_level", lambda: "high-level")

    response = service._generate_plan(
        api_key="test-key",
        model="gemini-3.1-pro-preview",
        instruction="open page",
        screenshot_base64=None,
        screenshot_mime_type="image/png",
        include_thoughts=True,
    )
    assert response.ok is True
    assert captured["contents"] == ["open page"]
    assert "tools" not in captured["config"]


def test_execute_with_playwright_non_dict_evidence_normalized(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_service(monkeypatch, tmp_path)
    session = service.create_session(instruction="open", actor="alice")
    action = _new_action(args={"key": "value"})
    script = tmp_path / "executor.mjs"
    script.write_text("// stub", encoding="utf-8")
    service._playwright_executor_script = script

    monkeypatch.setattr(
        computer_use_service_module.subprocess,
        "run",
        lambda *a, **k: SimpleNamespace(
            returncode=0, stdout=json.dumps({"executor": "node", "evidence": "bad"}), stderr=""
        ),
    )
    result = service._execute_with_playwright(session=session, action=action, actor="alice")
    assert result["evidence"] == {
        "screens": [],
        "clips": [],
        "network_summary": {},
        "dom_summary": {},
        "replay_trace": {},
    }
