from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from apps.api.app.services.video_reconstruction import io
from apps.api.app.services.video_reconstruction import generation


def test_resolve_runtime_path_blocks_outside_runtime(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("x", encoding="utf-8")
    with pytest.raises(HTTPException):
        io.resolve_runtime_path(runtime, str(outside))


def test_safe_recon_path_blocks_traversal(tmp_path: Path) -> None:
    parent = tmp_path / "p"
    parent.mkdir()
    with pytest.raises(HTTPException):
        io.safe_recon_path(parent, "../evil.txt")


def test_resolve_preview_path_requires_canonical_preview_id(tmp_path: Path) -> None:
    preview_dir = tmp_path / "previews"
    preview_dir.mkdir()
    pattern = re.compile(r"^prv_[0-9a-f]{32}$")
    preview_id = "prv_12345678123456781234567812345678"

    resolved = io.resolve_preview_path(preview_dir, preview_id, pattern)
    assert resolved == (preview_dir / f"{preview_id}.json").resolve()

    with pytest.raises(HTTPException):
        io.resolve_preview_path(preview_dir, "../evil", pattern)


def test_resolve_generated_dir_and_outputs_require_canonical_preview_id(tmp_path: Path) -> None:
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    pattern = re.compile(r"^prv_[0-9a-f]{32}$")
    preview_id = "prv_12345678123456781234567812345678"

    resolved_dir = io.resolve_generated_dir(generated_dir, preview_id, pattern)
    assert resolved_dir == (generated_dir / preview_id).resolve()

    resolved_outputs = io.default_generator_output_paths(preview_id, pattern, generated_dir)
    assert resolved_outputs["flow_draft"] == (resolved_dir / "flow-draft.json").resolve()

    with pytest.raises(HTTPException):
        io.resolve_generated_dir(generated_dir, "../evil", pattern)


def test_resolve_session_dir_prefers_artifacts_then_latest_then_fallback(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    session = runtime / "sessions" / "s1"
    session.mkdir(parents=True)

    assert io.resolve_session_dir(runtime, {"session_dir": str(session)}) == session.resolve()

    (runtime / "latest-session.json").write_text(
        json.dumps({"sessionDir": str(session)}), encoding="utf-8"
    )
    assert io.resolve_session_dir(runtime, {}) == session.resolve()

    (runtime / "latest-session.json").write_text("{bad", encoding="utf-8")
    fallback = io.resolve_session_dir(runtime, {})
    assert fallback.name == "session-fallback"
    assert fallback.exists()


def test_resolve_optional_path_prefers_explicit_then_fallback(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    session = runtime / "sess"
    runtime.mkdir()
    session.mkdir()
    explicit = session / "custom.har"
    explicit.write_text("{}", encoding="utf-8")

    resolved = io.resolve_optional_path(runtime, session, str(explicit), "register.har")
    assert resolved == explicit.resolve()

    fallback_file = session / "register.har"
    fallback_file.write_text("{}", encoding="utf-8")
    resolved2 = io.resolve_optional_path(runtime, session, "", "register.har")
    assert resolved2 == fallback_file.resolve()

    resolved3 = io.resolve_optional_path(runtime, session, "", "missing.har")
    assert resolved3 is None


def test_parse_har_entries_handles_invalid_and_valid_payload(tmp_path: Path) -> None:
    har = tmp_path / "a.har"
    har.write_text("{bad", encoding="utf-8")
    assert io.parse_har_entries(har) == []

    har.write_text(
        json.dumps(
            {
                "log": {
                    "entries": [
                        {
                            "request": {
                                "method": "post",
                                "url": "https://example.com/api/register",
                                "headers": [{"name": "Content-Type", "value": "application/json"}],
                            },
                            "response": {"status": 201},
                        },
                        {"invalid": True},
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    entries = io.parse_har_entries(har)
    assert entries[0]["method"] == "POST"
    assert entries[0]["path"] == "/api/register"
    assert entries[0]["content_type"] == "application/json"


def test_discover_start_url_returns_first_http() -> None:
    entries = [{"url": ""}, {"url": "ftp://x"}, {"url": "https://example.com/x"}]
    assert io.discover_start_url(entries) == "https://example.com/x"


def test_resolve_artifacts_uses_metadata_or_har_or_default(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    session = runtime / "s"
    runtime.mkdir()
    session.mkdir()

    har_path = session / "register.har"
    har_path.write_text(
        json.dumps(
            {
                "log": {
                    "entries": [
                        {
                            "request": {"method": "GET", "url": "https://example.com/r"},
                            "response": {"status": 200},
                        }
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    html_path = session / "page.html"
    html_path.write_text("<html>hello</html>", encoding="utf-8")

    resolved = io.resolve_artifacts(
        runtime, {"session_dir": str(session), "metadata": {"start_url": "https://m.example.com"}}
    )
    assert resolved.start_url == "https://m.example.com"
    assert resolved.html_content == "<html>hello</html>"
    assert len(resolved.har_entries) == 1

    resolved2 = io.resolve_artifacts(runtime, {"session_dir": str(session)})
    assert resolved2.start_url == "https://example.com/r"

    empty_session = runtime / "empty"
    empty_session.mkdir()
    resolved3 = io.resolve_artifacts(runtime, {"session_dir": str(empty_session)})
    assert resolved3.start_url == "https://example.com"


def test_default_and_materialize_outputs(tmp_path: Path) -> None:
    generated = tmp_path / "generated"
    preview_id = "prv_12345678123456781234567812345678"
    pattern = re.compile(r"^prv_[0-9a-f]{32}$")

    outputs = io.default_generator_outputs(preview_id, pattern, generated)
    assert outputs["flow_draft"].endswith("flow-draft.json")

    flow_draft = {
        "flow_id": "fl_1",
        "steps": [{"action": "manual_gate", "unsupported_reason": "captcha"}],
        "bootstrap_sequence": ["a"],
        "action_endpoint": {"path": "/api/register"},
    }
    written = io.materialize_generated_outputs(
        preview_id,
        flow_draft,
        generated,
        pattern,
        playwright_builder=lambda _fd: "playwright",
        api_builder=lambda _fd: "api",
    )
    assert Path(written["flow_draft"]).exists()
    assert Path(written["playwright_spec"]).read_text(encoding="utf-8") == "playwright"
    readiness = json.loads(Path(written["readiness_report"]).read_text(encoding="utf-8"))
    assert readiness["api_replay_ready"] is True
    assert readiness["manual_gate_reasons"] == ["captcha"]


def test_default_generator_outputs_rejects_invalid_preview_id(tmp_path: Path) -> None:
    with pytest.raises(HTTPException):
        io.default_generator_outputs("../bad", re.compile(r"^prv_[0-9a-f]{32}$"), tmp_path)


def test_generation_pick_endpoint_bootstrap_and_normalize_steps() -> None:
    entries = [
        {"method": "GET", "url": "", "status": 200},
        {"method": "GET", "url": "https://static.example.com/app.js", "status": 200},
        {"method": "GET", "url": "https://example.com/api/csrf", "status": 200},
        {"method": "GET", "url": "https://example.com/challenge", "status": 200},
        {"method": "POST", "url": "https://example.com/api/register", "status": 201},
    ]
    action = generation.pick_action_endpoint(entries)
    assert action is not None
    assert action["path"] == "/api/register"

    bootstrap = generation.derive_bootstrap_sequence(entries, action)
    assert [item["reason"] for item in bootstrap] == ["token-bootstrap", "protection-bootstrap"]
    assert generation.pick_action_endpoint([]) is None
    assert generation.derive_bootstrap_sequence([], None) == []

    normalized = generation.normalize_steps(
        [
            {
                "action": "",
                "target": {"selectors": [{"kind": "css", "value": "#submit"}, {"kind": "", "value": "#skip"}]},
                "confidence": 9,
                "manual_handoff_required": 1,
            }
        ]
    )
    assert normalized[0]["step_id"] == "s1"
    assert normalized[0]["action"] == "manual_gate"
    assert normalized[0]["target"]["selectors"][0] == {"kind": "css", "value": "#submit"}
    assert normalized[0]["confidence"] == 1.0


def test_generation_quality_and_compact_bootstrap_branches() -> None:
    assert generation.calculate_quality([]) == 0
    assert generation.calculate_quality([{"confidence": 0.66}, {"confidence": 0.84}]) == 75

    action = {"method": "POST", "fullUrl": "https://example.com/api/register", "path": "/api/register"}
    bootstrap = generation.derive_bootstrap_sequence(
        [
            {"method": "POST", "url": "https://example.com/api/register", "status": 201},
            {"method": "POST", "url": "https://example.com/api/session", "status": 200},
        ],
        action,
    )
    assert bootstrap == []

    compact = generation.normalize_codegen_steps(
        [
            {
                "target": {
                    "selectors": [
                        {"kind": "css", "value": "#ok"},
                        {"kind": "", "value": "#skip"},
                        "ignored",
                    ]
                },
                "selected_selector_index": 2,
                "preconditions": "skip",
            },
            "ignored",
        ]
    )
    assert compact[0]["selected_selector_index"] == 2
    assert compact[0]["preconditions"] == []
    assert compact[0]["selectors"] == [{"kind": "css", "value": "#ok"}]
