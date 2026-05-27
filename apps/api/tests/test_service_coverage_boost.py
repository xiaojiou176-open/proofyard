from __future__ import annotations

import json
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import HTTPException, status

from apps.api.app.services.universal_platform import run as run_ops
from apps.api.app.models.automation import (
    ReconstructionGenerateRequest,
    ReconstructionPreviewResponse,
)
from apps.api.app.models.run import RunLogEntry, RunRecord
from apps.api.app.models.template import (
    OtpPolicy,
    TemplateParamSpec,
    TemplatePolicies,
    TemplateRecord,
)
from apps.api.app.services.universal_platform_service import UniversalPlatformService
from apps.api.app.services.video_reconstruction_service import (
    ResolvedArtifacts,
    VideoReconstructionService,
    safe_resolve_under,
)
import apps.api.app.services.universal_platform_service as universal_platform_module


def _new_universal_service(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> UniversalPlatformService:
    runtime_root = tmp_path / "automation"
    monkeypatch.setenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", str(runtime_root))
    monkeypatch.setenv("UNIVERSAL_PLATFORM_DATA_DIR", str(runtime_root / "universal"))
    return UniversalPlatformService()


def _new_video_service(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> VideoReconstructionService:
    runtime_root = tmp_path / "automation"
    monkeypatch.setenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", str(runtime_root))
    return VideoReconstructionService()


def test_universal_validation_and_missing_resource_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)

    with pytest.raises(HTTPException) as missing_url:
        service.start_session("   ", "manual")
    assert missing_url.value.status_code == 422

    with pytest.raises(HTTPException) as bad_mode:
        service.start_session("https://example.com", "robot")
    assert bad_mode.value.status_code == 422

    with pytest.raises(HTTPException) as missing_session:
        service.finish_session("ss-missing")
    assert missing_session.value.status_code == 404

    with pytest.raises(HTTPException) as missing_flow:
        service.get_flow("fl-missing")
    assert missing_flow.value.status_code == 404

    with pytest.raises(HTTPException) as missing_template:
        service.get_template("tp-missing")
    assert missing_template.value.status_code == 404

    with pytest.raises(HTTPException) as missing_update:
        service.update_template("tp-missing", name="x")
    assert missing_update.value.status_code == 404

    with pytest.raises(HTTPException) as missing_preview:
        service.generate_reconstruction(ReconstructionGenerateRequest())
    assert missing_preview.value.status_code == 422


def test_universal_import_latest_flow_draft_error_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    latest = service._runtime_root / "latest-session.json"
    session_dir = service._runtime_root / "session-a"
    session_dir.mkdir(parents=True, exist_ok=True)
    flow_path = session_dir / "flow-draft.json"

    with pytest.raises(HTTPException) as no_pointer:
        service.import_latest_flow_draft()
    assert no_pointer.value.status_code == 404

    latest.write_text("{ broken", encoding="utf-8")
    with pytest.raises(HTTPException) as invalid_pointer:
        service.import_latest_flow_draft()
    assert invalid_pointer.value.status_code == 500

    latest.write_text(json.dumps({"sessionId": "s-only"}), encoding="utf-8")
    with pytest.raises(HTTPException) as missing_keys:
        service.import_latest_flow_draft()
    assert missing_keys.value.status_code == 500

    latest.write_text(
        json.dumps({"sessionId": "s-a", "sessionDir": str(session_dir)}), encoding="utf-8"
    )
    with pytest.raises(HTTPException) as missing_flow:
        service.import_latest_flow_draft()
    assert missing_flow.value.status_code == 404

    flow_path.write_text("{ invalid", encoding="utf-8")
    with pytest.raises(HTTPException) as invalid_flow:
        service.import_latest_flow_draft()
    assert invalid_flow.value.status_code == 500

    flow_path.write_text("[]", encoding="utf-8")
    with pytest.raises(HTTPException) as invalid_shape:
        service.import_latest_flow_draft()
    assert invalid_shape.value.status_code == 500

    flow_path.write_text(json.dumps({"start_url": "", "steps": []}), encoding="utf-8")
    with pytest.raises(HTTPException) as missing_fields:
        service.import_latest_flow_draft()
    assert missing_fields.value.status_code == 422


def test_universal_helpers_filters_and_progress(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    now = datetime.now(UTC)

    session = service.start_session("https://example.com", "manual", owner="owner-a")
    flow = service.create_flow(
        session_id=session.session_id,
        start_url="https://example.com",
        steps=[{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        owner="owner-a",
    )
    assert service.list_flows(actor="owner-b") == []

    template = service.create_template(
        flow_id=flow.flow_id,
        name="template-a",
        params_schema=[{"key": "username", "type": "string", "required": True}],
        defaults={"username": "u"},
        policies={"otp": {"required": False, "provider": "manual"}},
        created_by="owner-a",
    )
    assert service.list_templates(actor="owner-b") == []

    run = RunRecord(
        run_id="rn-a",
        template_id=template.template_id,
        status="queued",
        params={"username": "u"},
        created_at=now,
        updated_at=now,
    )
    service._upsert_run(
        run,
        extras={
            service._run_owner_key: "owner-a",
            service._run_resume_params_key: {"username": "u"},
        },
    )
    assert service.list_runs(actor="owner-b") == []
    assert service._map_task_status("unexpected") == "failed"
    assert service._score_flow([]) == 0
    assert service._normalize_snapshot_params("not-a-dict") == {}
    assert service._normalize_snapshot_params({1: "x", "k": None}) == {"k": ""}

    required_template = TemplateRecord(
        template_id="tp-required",
        flow_id=flow.flow_id,
        name="required",
        params_schema=[TemplateParamSpec(key="username", type="string", required=True)],
        defaults={},
        policies=TemplatePolicies(otp=OtpPolicy(required=False)),
        created_by="owner-a",
        created_at=now,
        updated_at=now,
    )
    with pytest.raises(HTTPException) as required_error:
        service._validate_params(required_template, {}, required_template.policies.otp)
    assert required_error.value.status_code == 422

    enum_template = required_template.model_copy(
        update={
            "params_schema": [
                TemplateParamSpec(key="tier", type="enum", required=False, enum_values=["pro"])
            ]
        }
    )
    with pytest.raises(HTTPException):
        service._validate_params(enum_template, {"tier": "free"}, enum_template.policies.otp)

    regex_template = required_template.model_copy(
        update={
            "params_schema": [
                TemplateParamSpec(key="otp", type="regex", required=False, pattern=r"^\d{6}$")
            ]
        }
    )
    with pytest.raises(HTTPException):
        service._validate_params(regex_template, {"otp": "abc"}, regex_template.policies.otp)

    email_template = required_template.model_copy(
        update={"params_schema": [TemplateParamSpec(key="email", type="email", required=False)]}
    )
    with pytest.raises(HTTPException):
        service._validate_params(
            email_template, {"email": "invalid-email"}, email_template.policies.otp
        )

    secret_template = required_template.model_copy(
        update={
            "params_schema": [TemplateParamSpec(key="password", type="secret", required=False)],
            "defaults": {"password": "hidden"},
        }
    )
    assert service._export_scrubbed_defaults(secret_template)["password"] == "***"
    assert (
        service.autofill_required_run_params(
            required_template.model_copy(
                update={
                    "params_schema": [
                        TemplateParamSpec(key="email", type="email"),
                        TemplateParamSpec(key="password", type="secret"),
                        TemplateParamSpec(key="username", type="string"),
                    ],
                    "defaults": {"username": "fallback-user"},
                }
            )
        )["username"]
        == "fallback-user"
    )

    assert service._extract_progress("") == (0, [])
    assert service._extract_progress("plain text without json") == (0, [])
    assert service._extract_progress("{ bad json") == (0, [])
    cursor, logs = service._extract_progress(
        json.dumps(
            {
                "stepResults": [
                    "bad",
                    {"step_id": "s1", "action": "click", "ok": True, "detail": "done"},
                ]
            }
        )
    )
    assert cursor == 1
    assert logs and "step s1" in logs[0].message
    single_cursor, single_logs = service._extract_progress(
        json.dumps({"stepId": "sx", "action": "type", "ok": False, "detail": "no"})
    )
    assert single_cursor == 1
    assert single_logs and "failed" in single_logs[0].message

    run.logs = [RunLogEntry(ts=now, level="info", message="dup")]
    service._append_unique_logs(
        run,
        [
            RunLogEntry(ts=now, level="info", message="dup"),
            RunLogEntry(ts=now, level="warn", message="new"),
        ],
    )
    assert [entry.message for entry in run.logs] == ["dup", "new"]


def test_universal_json_io_upsert_and_cancel_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    now = datetime.now(UTC)

    service._runs_path.parent.mkdir(parents=True, exist_ok=True)
    service._runs_path.write_text(
        json.dumps(
            [
                {
                    "run_id": "rn-1",
                    "template_id": "tp-1",
                    "status": "queued",
                    "step_cursor": 0,
                    "params": {},
                    "task_id": "task-1",
                    "created_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                    "logs": [],
                    "_legacy_hint": "keep",
                }
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    service._upsert_run(
        RunRecord(
            run_id="rn-1",
            template_id="tp-1",
            status="queued",
            task_id="task-1",
            params={},
            created_at=now,
            updated_at=now,
        ),
        extras={service._run_owner_key: "owner-a"},
    )
    persisted = json.loads(service._runs_path.read_text(encoding="utf-8"))
    assert persisted[0]["_legacy_hint"] == "keep"
    assert persisted[0][service._run_owner_key] == "owner-a"

    invalid_json_path = tmp_path / "invalid.json"
    invalid_json_path.write_text("{ broken", encoding="utf-8")
    assert service._read_json(invalid_json_path) == []
    invalid_json_path.write_text(json.dumps({"not": "a-list"}), encoding="utf-8")
    assert service._read_json(invalid_json_path) == []
    invalid_json_path.write_text(json.dumps([{"k": 1}, "skip"]), encoding="utf-8")
    assert service._read_json(invalid_json_path) == [{"k": 1}]

    def _cancel_missing(*args: Any, **kwargs: Any):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="missing")

    monkeypatch.setattr(run_ops.automation_service, "cancel_task", _cancel_missing)
    cancelled = service.cancel_run("rn-1", actor="owner-a")
    assert cancelled.status == "cancelled"
    assert any("not found" in entry.message for entry in cancelled.logs)


def test_video_safe_paths_and_helper_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    root = tmp_path / "root"
    root.mkdir(parents=True)
    inside = root / "artifact.har"
    inside.write_text("{}", encoding="utf-8")
    outside = tmp_path / "outside.har"
    outside.write_text("{}", encoding="utf-8")

    with pytest.raises(HTTPException):
        safe_resolve_under(root, inside, allowed_exts={".json"}, max_bytes=1024)
    with pytest.raises(HTTPException):
        safe_resolve_under(root, outside, allowed_exts={".har"}, max_bytes=1024)

    service = _new_video_service(monkeypatch, tmp_path)
    monkeypatch.setenv("RECONSTRUCTION_ARTIFACT_MAX_BYTES", "bad")
    assert service._artifact_max_bytes() == 10 * 1024 * 1024
    monkeypatch.setenv("RECONSTRUCTION_ARTIFACT_MAX_BYTES", "0")
    assert service._artifact_max_bytes() == 1

    session_dir = service._runtime_root / "s1"
    session_dir.mkdir(parents=True, exist_ok=True)
    assert (
        service._resolve_optional_path(session_dir, None, "missing.har", allowed_exts={".har"})
        is None
    )
    fallback_dir = session_dir / "register.har"
    fallback_dir.mkdir(parents=True, exist_ok=True)
    with pytest.raises(HTTPException):
        service._resolve_optional_path(session_dir, None, "register.har", allowed_exts={".har"})

    assert (
        service._discover_start_url([{"url": "ftp://x"}, {"url": "https://ok.example"}])
        == "https://ok.example"
    )
    assert service._calculate_quality([]) == 0
    preview_id = "prv_" + ("a" * 32)
    assert service._default_generator_outputs(preview_id)["flow_draft"].endswith(
        f"/{preview_id}/flow-draft.json"
    )

    action_endpoint = service._pick_action_endpoint(
        [
            {"method": "GET", "url": "https://example.com/app.js", "status": 200},
            {"method": "POST", "url": "https://example.com/api/register", "status": 201},
            {"method": "GET", "url": "https://example.com/api/csrf", "status": 200},
        ]
    )
    assert action_endpoint is not None
    assert action_endpoint["path"] == "/api/register"

    assert service._derive_bootstrap_sequence([], None) == []
    assert (
        service._derive_bootstrap_sequence([], {"method": "POST", "fullUrl": "", "path": "/x"})
        == []
    )
    bootstrap = service._derive_bootstrap_sequence(
        [
            {"method": "GET", "url": "https://example.com/api/csrf", "status": 200},
            {"method": "GET", "url": "https://example.com/challenge", "status": 200},
            {"method": "POST", "url": "https://example.com/api/register", "status": 201},
            {"method": "GET", "url": "https://example.com/preflight", "status": 200},
        ],
        {"method": "POST", "fullUrl": "https://example.com/api/register", "path": "/api/register"},
    )
    assert bootstrap
    assert bootstrap[-1]["reason"] in {
        "context-bootstrap",
        "token-bootstrap",
        "protection-bootstrap",
    }


def test_video_ensemble_codegen_and_materialization(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_video_service(monkeypatch, tmp_path)
    assert hasattr(service, "_lavague"), (
        "H-08-ENSEMBLE-ADAPTERS: ensemble adapters missing in current reconstruction service"
    )
    monkeypatch.setenv("RECON_ENABLE_ENSEMBLE", "true")
    monkeypatch.setenv("RECON_EXPERIMENTAL_ENGINES", "lavague,uitars,openadapt")

    monkeypatch.setattr(
        service._gemini,
        "extract_steps",
        lambda _: [
            {"step_id": "s1", "action": "navigate", "confidence": 0.9, "source_engine": "gemini"},
            {"step_id": "s2", "action": "click", "confidence": 0.4, "source_engine": "gemini"},
        ],
    )
    monkeypatch.setattr(
        service._lavague,
        "extract_steps",
        lambda _: [
            {"step_id": "s1", "action": "navigate", "confidence": 0.1, "source_engine": "lavague"}
        ],
    )
    monkeypatch.setattr(
        service._ui_tars,
        "extract_steps",
        lambda _: [
            {"step_id": "s2", "action": "click", "confidence": 0.95, "source_engine": "ui_tars"}
        ],
    )
    monkeypatch.setattr(service._openadapt, "extract_steps", lambda _: [])

    artifacts = ResolvedArtifacts(
        start_url="https://example.com",
        session_dir=service._runtime_root / "session-e",
        video_path=None,
        har_path=None,
        html_path=None,
        html_content="<html/>",
        har_entries=[],
    )
    merged = service._extract_steps(artifacts, "ensemble", "balanced")
    assert merged
    assert len(merged) >= 2

    assert service._normalize_codegen_steps("not-a-list") == []
    normalized = service._normalize_codegen_steps(
        [
            "skip",
            {
                "step_id": "s1",
                "action": "click",
                "target": {
                    "selectors": [
                        "skip",
                        {"kind": "css", "value": "#ok"},
                        {"kind": "", "value": "x"},
                    ]
                },
                "selected_selector_index": 0,
                "preconditions": ["a", 1],
            },
        ]
    )
    assert len(normalized) == 1
    assert normalized[0]["selectors"] == [{"kind": "css", "value": "#ok"}]

    api_spec = service._build_generated_api(
        {"start_url": "https://example.com", "action_endpoint": "bad", "bootstrap_sequence": {}}
    )
    assert "generated reconstruction api replay" in api_spec
    assert "ACTION_ENDPOINT" in api_spec

    flow_draft = {
        "flow_id": "fl-g",
        "start_url": "https://example.com",
        "steps": [{"step_id": "s1", "action": "navigate", "confidence": 0.8}],
        "action_endpoint": {
            "method": "POST",
            "path": "/api/register",
            "fullUrl": "https://example.com/api/register",
        },
        "bootstrap_sequence": [],
    }
    preview_id = "prv_" + ("b" * 32)
    outputs = service._materialize_generated_outputs(preview_id, flow_draft)
    assert Path(outputs["flow_draft"]).exists()
    assert Path(outputs["playwright_spec"]).exists()
    assert Path(outputs["api_spec"]).exists()
    assert Path(outputs["readiness_report"]).exists()

    preview = ReconstructionPreviewResponse(
        preview_id=preview_id,
        flow_draft=flow_draft,
        reconstructed_flow_quality=80,
        step_confidence=[0.8],
        unresolved_segments=[],
        generator_outputs=outputs,
    )
    generated = service.generate(preview)
    assert generated.flow_id == "fl-g"


def test_generate_reconstruction_loads_preview_id_and_creates_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    now = datetime.now(UTC)

    preview = ReconstructionPreviewResponse(
        preview_id="prv_" + ("1" * 32),
        flow_draft={
            "session_id": "ss-imported",
            "start_url": "https://example.com/signup",
            "steps": [
                {"step_id": "s1", "action": "navigate", "url": "https://example.com/signup"},
                "skip-non-dict",
            ],
            "source_event_count": 2,
        },
        reconstructed_flow_quality=84,
        step_confidence=[0.8, 0.88],
        unresolved_segments=[],
        generator_outputs={"flow_draft": "x.json"},
    )

    loaded_ids: list[str] = []
    create_run_calls: list[tuple[str, dict[str, str], str | None]] = []

    def _load_preview(preview_id: str) -> ReconstructionPreviewResponse:
        loaded_ids.append(preview_id)
        return preview

    def _generate(_: ReconstructionPreviewResponse):
        return universal_platform_module.ReconstructionGenerateResponse(
            flow_id="pending",
            template_id="pending",
            reconstructed_flow_quality=preview.reconstructed_flow_quality,
            step_confidence=preview.step_confidence,
            unresolved_segments=preview.unresolved_segments,
            generator_outputs=preview.generator_outputs,
        )

    def _create_run(
        template_id: str, params: dict[str, str], actor: str | None = None
    ) -> RunRecord:
        create_run_calls.append((template_id, dict(params), actor))
        return RunRecord(
            run_id="rn-created",
            template_id=template_id,
            status="queued",
            params=params,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(
        universal_platform_module.video_reconstruction_service, "load_preview", _load_preview
    )
    monkeypatch.setattr(
        universal_platform_module.video_reconstruction_service, "generate", _generate
    )
    monkeypatch.setattr(service, "create_run", _create_run)

    generated = service.generate_reconstruction(
        ReconstructionGenerateRequest(
            preview_id="prv_" + ("1" * 32),
            template_name="generated-template",
            create_run=True,
            run_params={"email": "user@example.com"},
        ),
        actor="owner-a",
    )

    created_flow = service.get_flow(generated.flow_id, requester="owner-a")
    assert loaded_ids == ["prv_" + ("1" * 32)]
    assert generated.run_id == "rn-created"
    assert create_run_calls and create_run_calls[0][1] == {"email": "user@example.com"}
    assert create_run_calls[0][2] == "owner-a"
    assert len(created_flow.steps) == 1


def test_generate_reconstruction_rejects_invalid_flow_draft(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)

    invalid_preview = ReconstructionPreviewResponse(
        preview_id="prv_" + ("c" * 32),
        flow_draft={"session_id": "ss-bad", "start_url": "", "steps": "not-a-list"},
        reconstructed_flow_quality=20,
    )

    monkeypatch.setattr(
        universal_platform_module.video_reconstruction_service,
        "generate",
        lambda _: universal_platform_module.ReconstructionGenerateResponse(
            flow_id="pending",
            template_id="pending",
            reconstructed_flow_quality=20,
        ),
    )

    with pytest.raises(HTTPException) as invalid_flow:
        service.generate_reconstruction(
            ReconstructionGenerateRequest(preview=invalid_preview),
            actor="owner-a",
        )
    assert invalid_flow.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_universal_resume_snapshot_missing_conflict(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    now = datetime.now(UTC)
    service._upsert_run(
        RunRecord(
            run_id="rn-snapshot-missing",
            template_id="tp-1",
            status="waiting_otp",
            params={"username": "demo"},
            created_at=now,
            updated_at=now,
        ),
        extras={service._run_owner_key: "owner-a"},
    )

    with pytest.raises(HTTPException) as missing_snapshot:
        service._get_validated_params_snapshot("rn-snapshot-missing")
    assert missing_snapshot.value.status_code == status.HTTP_409_CONFLICT


def test_upsert_session_from_import_rejects_owner_conflict(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    session = service.start_session("https://example.com", "manual", owner="owner-a")

    with pytest.raises(HTTPException) as denied:
        service._upsert_session_from_import(
            session_id=session.session_id,
            start_url="https://example.com/new",
            owner="owner-b",
        )
    assert denied.value.status_code == status.HTTP_403_FORBIDDEN


def test_universal_internal_cache_env_and_owner_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    service._cache_max_entries = 0
    service._validated_params_cache = {"stale": (time.time(), {"k": "v"})}
    service._cache_validated_params_snapshot("run-x", {"k": "v2"})
    assert service._validated_params_cache == {}

    service._cache_max_entries = 1
    service._cache_ttl_seconds = 0
    service._validated_params_cache = {
        "a": (1.0, {"a": "1"}),
        "b": (2.0, {"b": "2"}),
    }
    service._prune_validated_params_cache_locked(now_ts=10.0)
    assert len(service._validated_params_cache) == 1

    monkeypatch.setenv("CACHE_MAX_ENTRIES", "bad-int")
    monkeypatch.setenv("UNIVERSAL_AUDIT_BACKUP_COUNT", "bad-int")
    assert service._read_non_negative_int_env("CACHE_MAX_ENTRIES", 5) == 5
    assert service._read_positive_int_env("UNIVERSAL_AUDIT_BACKUP_COUNT", default=3, minimum=1) == 3

    session = service.start_session("https://example.com", "manual", owner="owner-a")
    service._ensure_session_access(session, None)
    flow = service.create_flow(
        session_id=session.session_id,
        start_url="https://example.com",
        steps=[{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
        requester="owner-a",
    )
    service._ensure_flow_access(flow, None)
    template = service.create_template(
        flow_id=flow.flow_id,
        name="fallback-template-owner",
        params_schema=[],
        defaults={},
        policies={"otp": {"required": False, "provider": "manual"}},
        created_by=None,
    )
    assert service._template_owner(template) == "owner-a"

    now = datetime.now(UTC)
    run = RunRecord(
        run_id="rn-owner-fallback",
        template_id=template.template_id,
        status="queued",
        params={},
        created_at=now,
        updated_at=now,
    )
    service._upsert_run(run, extras={service._run_owner_key: "stored-owner"})
    monkeypatch.setattr(
        service,
        "get_template",
        lambda *_a, **_k: (_ for _ in ()).throw(HTTPException(status_code=404, detail="missing")),
    )
    assert service._run_owner(run) == "stored-owner"


def test_universal_update_flow_snapshot_cache_and_run_owner_remaining_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    session = service.start_session("https://example.com", "manual", owner="owner-a")
    service.create_flow(
        session_id=session.session_id,
        start_url="https://example.com/a",
        steps=[{"step_id": "s1", "action": "navigate", "url": "https://example.com/a"}],
        requester="owner-a",
    )
    flow_b = service.create_flow(
        session_id=session.session_id,
        start_url="https://example.com/b",
        steps=[{"step_id": "s2", "action": "navigate", "url": "https://example.com/b"}],
        requester="owner-a",
    )

    updated = service.update_flow(flow_b.flow_id, steps=None, start_url="   ", requester="owner-a")
    assert updated.flow_id == flow_b.flow_id
    assert updated.start_url == "https://example.com/b"
    assert [step.step_id for step in updated.steps] == ["s2"]

    with pytest.raises(HTTPException) as missing_flow:
        service.update_flow("fl-missing", steps=None, start_url=" ", requester="owner-a")
    assert missing_flow.value.status_code == status.HTTP_404_NOT_FOUND

    service._cache_ttl_seconds = 1
    service._validated_params_cache = {"expired": (0.0, {"stale": "1"})}
    service._prune_validated_params_cache_locked(now_ts=10.0)
    assert service._validated_params_cache == {}

    monkeypatch.setenv("CACHE_MAX_ENTRIES", "")
    assert service._read_non_negative_int_env("CACHE_MAX_ENTRIES", 7) == 7

    now = datetime.now(UTC)
    target_run = RunRecord(
        run_id="rn-target",
        template_id="tp-target",
        status="queued",
        params={},
        created_at=now,
        updated_at=now,
    )
    service._runs_path.write_text(
        json.dumps(
            [
                {"run_id": "rn-other", "template_id": "tp-other", "status": "queued"},
                {
                    "run_id": target_run.run_id,
                    "template_id": target_run.template_id,
                    "status": target_run.status,
                    "params": {},
                    "created_at": now.isoformat(),
                    "updated_at": now.isoformat(),
                    service._LEGACY_VALIDATED_PARAMS_KEY: {"email": "demo@example.com"},
                    service._run_owner_key: 123,
                },
            ]
        ),
        encoding="utf-8",
    )
    snapshot = service._get_validated_params_snapshot(target_run.run_id)
    assert snapshot == {"email": "demo@example.com"}

    monkeypatch.setattr(
        service,
        "get_template",
        lambda *_a, **_k: (_ for _ in ()).throw(HTTPException(status_code=404, detail="missing")),
    )
    assert service._run_owner(target_run) is None


def test_universal_read_json_quarantine_move_failure_and_audit_prune(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)

    bad_path = service._base_dir / "broken.json"
    bad_path.parent.mkdir(parents=True, exist_ok=True)
    bad_path.write_text("{ invalid", encoding="utf-8")

    original_replace = Path.replace

    def _broken_replace(self: Path, target: Path) -> Path:
        if self == bad_path:
            raise OSError("permission denied")
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", _broken_replace)
    assert service._read_json(bad_path) == []
    assert bad_path.exists()

    service._audit_path.parent.mkdir(parents=True, exist_ok=True)
    service._audit_backup_count = 1
    service._audit_retention_days = 1
    old_backup = service._audit_path.with_name(f"{service._audit_path.name}.1")
    old_backup.write_text("old", encoding="utf-8")
    old_ts = time.time() - (10 * 24 * 60 * 60)
    os.utime(old_backup, (old_ts, old_ts))
    service._prune_audit_history()
    assert not old_backup.exists()


def test_universal_service_snapshot_not_found_import_owner_conflict_and_audit_rotation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_universal_service(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as missing_run:
        service._get_validated_params_snapshot("rn-missing")
    assert missing_run.value.status_code == status.HTTP_404_NOT_FOUND

    session = service.start_session("https://example.com", "manual", owner="owner-a")
    session_dir = service._runtime_root / session.session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    latest = service._runtime_root / "latest-session.json"
    latest.write_text(
        json.dumps({"sessionId": session.session_id, "sessionDir": str(session_dir)}),
        encoding="utf-8",
    )
    (session_dir / "flow-draft.json").write_text(
        json.dumps(
            {
                "start_url": "https://example.com",
                "steps": [{"step_id": "s1", "action": "navigate", "url": "https://example.com"}],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(HTTPException) as denied_owner:
        service.import_latest_flow_draft(owner="owner-b")
    assert denied_owner.value.status_code == status.HTTP_403_FORBIDDEN

    monkeypatch.setattr(service, "_audit_max_bytes", 4)
    monkeypatch.setattr(service, "_audit_backup_count", 2)
    service._audit_path.parent.mkdir(parents=True, exist_ok=True)
    service._audit_path.write_text("abcdef", encoding="utf-8")
    backup_one = service._audit_path.with_name(f"{service._audit_path.name}.1")
    backup_two = service._audit_path.with_name(f"{service._audit_path.name}.2")
    backup_one.write_text("older", encoding="utf-8")
    backup_two.write_text("oldest", encoding="utf-8")

    service._rotate_audit_if_needed(8)
    assert backup_one.exists()
    assert backup_two.exists()


def test_video_generation_helper_remaining_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    service = _new_video_service(monkeypatch, tmp_path)

    assert service._pick_action_endpoint([{"method": "GET", "url": "", "status": 200}]) is None

    action_endpoint = service._pick_action_endpoint(
        [
            {"method": "HEAD", "url": "", "status": 500},
            {"method": "HEAD", "url": "https://example.com/static/app.js", "status": 404},
            {"method": "GET", "url": "https://example.com/api/ping", "status": 500},
        ]
    )
    assert action_endpoint is not None
    assert action_endpoint["path"] in {"/static/app.js", "/api/ping"}

    normalized = service._normalize_codegen_steps(
        [
            {
                "step_id": "s-fallback",
                "action": "click",
                "target": {"selectors": {"kind": "css", "value": "#submit"}},
                "selected_selector_index": "bad-index",
                "preconditions": "not-a-list",
            }
        ]
    )
    assert normalized[0]["selectors"] == []
    assert normalized[0]["selected_selector_index"] is None
    assert normalized[0]["preconditions"] == []
