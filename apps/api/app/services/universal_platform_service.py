from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from apps.api.app.core.settings import env_str
from apps.api.app.core.observability import REQUEST_ID_CTX
from apps.api.app.models.automation import (
    OrchestrateFromArtifactsRequest,
    OrchestrateFromArtifactsResponse,
    ProfileResolveRequest,
    ProfileResolveResponse,
    ReconstructionGenerateRequest,
    ReconstructionGenerateResponse,
    ReconstructionPreviewRequest,
    ReconstructionPreviewResponse,
)
from apps.api.app.models.run import RunLogEntry, RunRecord, RunStatus, RunWaitContext
from apps.api.app.models.template import OtpPolicy, TemplateParamSpec, TemplateRecord
from apps.api.app.services.universal_platform.flows import UniversalPlatformFlowMixin
from apps.api.app.services.universal_platform import params as params_ops
from apps.api.app.services.universal_platform import recovery as recovery_ops
from apps.api.app.services.universal_platform import resume as resume_ops
from apps.api.app.services.universal_platform import run as run_ops
from apps.api.app.services.universal_platform import secrets as secrets_ops
from apps.api.app.services.universal_platform.sessions import UniversalPlatformSessionMixin
from apps.api.app.services.universal_platform import template as template_ops
from apps.api.app.services.template_health_service import get_template_readiness
from apps.api.app.services.video_reconstruction_service import video_reconstruction_service

logger = logging.getLogger("universal_platform")


class UniversalPlatformService(UniversalPlatformFlowMixin, UniversalPlatformSessionMixin):
    _DEFAULT_VALIDATED_CACHE_TTL_SECONDS = 900
    _DEFAULT_VALIDATED_CACHE_MAX_ENTRIES = 500
    _SESSION_MODE_ALIAS: dict[str, str] = {
        "midscene": "ai",
    }
    _STRIPE_PARAM_KEYS: tuple[str, ...] = (
        "stripeCardNumber",
        "stripeExpMonth",
        "stripeExpYear",
        "stripeCvc",
        "stripeCardholderName",
        "stripePostalCode",
        "stripeCountry",
    )
    _SENSITIVE_PARAM_KEYS: frozenset[str] = frozenset(
        {
            "stripeCardNumber",
            "stripeExpMonth",
            "stripeExpYear",
            "stripeCvc",
            "stripeCardholderName",
            "stripePostalCode",
            "stripeCountry",
        }
    )
    _SENSITIVE_LOG_PATTERNS: tuple[re.Pattern[str], ...] = (
        re.compile(
            r"((?:otp|code|token|key|password|secret|card)[^=\n\r]{0,40}[=:]\s*)([^\s,;]+)",
            re.IGNORECASE,
        ),
        re.compile(r"(\b(?:otp|code|token|key|password|secret|card)\b)", re.IGNORECASE),
    )
    _LEGACY_VALIDATED_PARAMS_KEY = "validated_params_snapshot"
    _run_owner_key = "owner"
    _run_resume_params_key = "resume_params"

    def __init__(self) -> None:
        self._root = Path(__file__).resolve().parents[4]
        runtime_cache_override = env_str("UIQ_RUNTIME_CACHE_ROOT", "").strip()
        self._runtime_cache_root = (
            Path(runtime_cache_override)
            if runtime_cache_override
            else (self._root / ".runtime-cache")
        )
        runtime_root_override = env_str("UNIVERSAL_AUTOMATION_RUNTIME_DIR", "").strip()
        platform_data_override = env_str("UNIVERSAL_PLATFORM_DATA_DIR", "").strip()
        self._runtime_root = (
            Path(runtime_root_override)
            if runtime_root_override
            else (self._runtime_cache_root / "automation")
        )
        self._base_dir = (
            Path(platform_data_override)
            if platform_data_override
            else (self._runtime_root / "universal")
        )
        self._sessions_path = self._base_dir / "sessions.json"
        self._flows_path = self._base_dir / "flows.json"
        self._templates_path = self._base_dir / "templates.json"
        self._runs_path = self._base_dir / "runs.json"
        self._audit_path = self._base_dir / "audit.jsonl"
        self._audit_max_bytes = self._read_positive_int_env(
            "UNIVERSAL_AUDIT_MAX_BYTES", default=5 * 1024 * 1024, minimum=1024
        )
        self._audit_backup_count = self._read_positive_int_env(
            "UNIVERSAL_AUDIT_BACKUP_COUNT", default=5, minimum=1
        )
        self._audit_retention_days = self._read_positive_int_env(
            "UNIVERSAL_AUDIT_RETENTION_DAYS", default=7, minimum=1
        )
        self._audit_write_failures = 0
        self._cache_ttl_seconds = self._read_non_negative_int_env(
            "CACHE_TTL_SECONDS",
            self._DEFAULT_VALIDATED_CACHE_TTL_SECONDS,
        )
        self._cache_max_entries = self._read_non_negative_int_env(
            "CACHE_MAX_ENTRIES",
            self._DEFAULT_VALIDATED_CACHE_MAX_ENTRIES,
        )
        self._lock = Lock()
        self._audit_lock = Lock()
        self._validated_params_cache: dict[str, tuple[float, dict[str, str]]] = {}

    def resolve_target_profile(self, payload: ProfileResolveRequest) -> ProfileResolveResponse:
        return video_reconstruction_service.resolve_profile(payload)

    def create_reconstruction_preview(
        self, payload: ReconstructionPreviewRequest
    ) -> ReconstructionPreviewResponse:
        return video_reconstruction_service.preview(payload)

    def generate_reconstruction(
        self,
        payload: ReconstructionGenerateRequest,
        actor: str | None = None,
    ) -> ReconstructionGenerateResponse:
        preview = payload.preview
        if preview is None:
            if not payload.preview_id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="preview or preview_id is required",
                )
            preview = video_reconstruction_service.load_preview(payload.preview_id)

        generated = video_reconstruction_service.generate(preview)
        flow_draft = preview.flow_draft
        session_id = str(flow_draft.get("session_id") or f"ss_{uuid4().hex}")
        start_url = str(flow_draft.get("start_url") or "")
        steps = flow_draft.get("steps")
        if not start_url or not isinstance(steps, list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="preview flow_draft missing start_url/steps",
            )
        session = self._get_session(session_id)
        if session is not None:
            self._ensure_session_access(session, actor)
        else:
            self._upsert_session_from_import(
                session_id=session_id, start_url=start_url, owner=actor
            )

        flow = self.create_flow(
            session_id=session_id,
            start_url=start_url,
            steps=[item for item in steps if isinstance(item, dict)],
            source_event_count=int(flow_draft.get("source_event_count") or 0),
            requester=actor,
        )
        generated.flow_id = flow.flow_id

        template = self.create_template(
            flow_id=flow.flow_id,
            name=payload.template_name,
            params_schema=[
                {"key": "email", "type": "email", "required": True},
                {"key": "password", "type": "secret", "required": True},
            ],
            defaults={},
            policies={"otp": {"required": False, "provider": "manual"}},
            created_by=actor,
        )
        generated.template_id = template.template_id

        if payload.create_run:
            run = self.create_run(template.template_id, payload.run_params, actor=actor)
            generated.run_id = run.run_id
        return generated

    def create_template_from_artifacts(
        self,
        payload: OrchestrateFromArtifactsRequest,
        actor: str | None = None,
    ) -> OrchestrateFromArtifactsResponse:
        preview = self.create_reconstruction_preview(
            ReconstructionPreviewRequest(
                artifacts=payload.artifacts,
                video_analysis_mode="gemini",
                extractor_strategy=payload.extractor_strategy,
                auto_refine_iterations=payload.auto_refine_iterations,
            )
        )
        generated = self.generate_reconstruction(
            ReconstructionGenerateRequest(
                preview=preview,
                template_name=payload.template_name,
                create_run=payload.create_run,
                run_params=payload.run_params,
            ),
            actor=actor,
        )
        return OrchestrateFromArtifactsResponse(
            template_id=generated.template_id,
            run_id=generated.run_id,
            reconstructed_flow_quality=generated.reconstructed_flow_quality,
            step_confidence=generated.step_confidence,
            unresolved_segments=generated.unresolved_segments,
            generator_outputs=generated.generator_outputs,
            manual_handoff_required=generated.manual_handoff_required,
            unsupported_reason=generated.unsupported_reason,
        )

    def autofill_required_run_params(self, template: TemplateRecord) -> dict[str, str]:
        return template_ops.autofill_required_run_params(template)

    def list_templates(
        self,
        limit: int = 100,
        requester: str | None = None,
        actor: str | None = None,
    ) -> list[TemplateRecord]:
        return template_ops.list_templates(self, limit=limit, requester=requester or actor)

    def get_template(self, template_id: str, requester: str | None = None) -> TemplateRecord:
        return template_ops.get_template(self, template_id, requester=requester)

    def create_template(
        self,
        *,
        flow_id: str,
        name: str,
        params_schema: list[dict[str, Any]],
        defaults: dict[str, str],
        policies: dict[str, Any],
        created_by: str | None = None,
    ) -> TemplateRecord:
        return template_ops.create_template(
            self,
            flow_id=flow_id,
            name=name,
            params_schema=params_schema,
            defaults=defaults,
            policies=policies,
            created_by=created_by,
        )

    def update_template(
        self,
        template_id: str,
        *,
        name: str | None = None,
        params_schema: list[dict[str, Any]] | None = None,
        defaults: dict[str, str] | None = None,
        policies: dict[str, Any] | None = None,
        actor: str | None = None,
    ) -> TemplateRecord:
        return template_ops.update_template(
            self,
            template_id,
            name=name,
            params_schema=params_schema,
            defaults=defaults,
            policies=policies,
            actor=actor,
        )

    def export_template(self, template_id: str, actor: str | None = None) -> dict[str, Any]:
        return template_ops.export_template(self, template_id, actor=actor)

    def import_template(
        self,
        template_payload: dict[str, Any],
        *,
        actor: str | None = None,
        name: str | None = None,
    ) -> TemplateRecord:
        return template_ops.import_template(
            self,
            template_payload,
            actor=actor,
            name=name,
        )

    def get_template_readiness(self, template_id: str, requester: str | None = None):
        return get_template_readiness(self, template_id, requester=requester)

    def list_runs(
        self,
        limit: int = 100,
        requester: str | None = None,
        actor: str | None = None,
    ) -> list[RunRecord]:
        return run_ops.list_runs(self, limit=limit, requester=requester or actor)

    def get_run(self, run_id: str, requester: str | None = None) -> RunRecord:
        return run_ops.get_run(self, run_id, requester=requester)

    def create_run(
        self,
        template_id: str,
        params: dict[str, str],
        actor: str | None = None,
        otp_code: str | None = None,
    ) -> RunRecord:
        return run_ops.create_run(self, template_id, params, actor=actor, otp_code=otp_code)

    def submit_otp_and_resume(
        self, run_id: str, otp_code: str | None, actor: str | None = None
    ) -> RunRecord:
        return resume_ops.submit_otp_and_resume(self, run_id, otp_code, actor=actor)

    def build_recovery_plan(self, run_id: str, requester: str | None = None):
        return recovery_ops.build_recovery_plan(self, run_id, requester=requester)

    def cancel_run(self, run_id: str, actor: str | None = None) -> RunRecord:
        return run_ops.cancel_run(self, run_id, actor=actor)

    def _materialize_replay_bridge(self, flow: Any):
        return run_ops.materialize_replay_bridge(self, flow)

    def _upsert_run(self, run: RunRecord, extras: dict[str, Any] | None = None) -> None:
        with self._lock:
            self._save_run_locked(run, extras=extras)

    def _save_run_locked(self, run: RunRecord, extras: dict[str, Any] | None = None) -> None:
        runs = self._read_json(self._runs_path)
        encoded = self._encode_run(run)
        if isinstance(extras, dict):
            encoded.update(extras)
        replaced = False
        for idx, item in enumerate(runs):
            if item.get("run_id") != run.run_id:
                continue
            if isinstance(item, dict):
                for key, value in item.items():
                    if key not in encoded:
                        encoded[key] = value
            runs[idx] = encoded
            replaced = True
            break
        if not replaced:
            runs.append(encoded)
        self._write_json(self._runs_path, runs)

    def _load_run_locked(self, run_id: str) -> RunRecord | None:
        runs = self._read_json(self._runs_path)
        for item in runs:
            if item.get("run_id") == run_id:
                return RunRecord.model_validate(item)
        return None

    def _get_validated_params_snapshot(self, run_id: str) -> dict[str, str]:
        with self._lock:
            now_ts = time.time()
            self._prune_validated_params_cache_locked(now_ts=now_ts)
            cached = self._validated_params_cache.get(run_id)
            if cached is not None:
                return dict(cached[1])
            for item in self._read_json(self._runs_path):
                if item.get("run_id") != run_id:
                    continue
                snapshot = self._decode_validated_params_snapshot(item)
                if snapshot:
                    if self._cache_max_entries > 0:
                        self._validated_params_cache[run_id] = (now_ts, dict(snapshot))
                        self._prune_validated_params_cache_locked(now_ts=now_ts)
                    return dict(snapshot)
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="run params snapshot unavailable"
                )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="run not found")

    def _encode_run(self, run: RunRecord) -> dict[str, Any]:
        return run.model_dump(mode="json")

    def _decode_validated_params_snapshot(self, payload: dict[str, Any]) -> dict[str, str]:
        return self._normalize_snapshot_params(payload.get(self._LEGACY_VALIDATED_PARAMS_KEY))

    def _normalize_snapshot_params(self, raw: Any) -> dict[str, str]:
        if not isinstance(raw, dict):
            return {}
        snapshot: dict[str, str] = {}
        for key, value in raw.items():
            if isinstance(key, str):
                snapshot[key] = value if isinstance(value, str) else ""
        return snapshot

    def _cache_validated_params_snapshot(self, run_id: str, params: dict[str, str]) -> None:
        with self._lock:
            if self._cache_max_entries == 0:
                self._validated_params_cache.clear()
                return
            now_ts = time.time()
            self._validated_params_cache[run_id] = (now_ts, dict(params))
            self._prune_validated_params_cache_locked(now_ts=now_ts)

    def _prune_validated_params_cache_locked(self, *, now_ts: float | None = None) -> None:
        if not self._validated_params_cache:
            return
        now_value = now_ts if now_ts is not None else time.time()
        ttl_seconds = self._cache_ttl_seconds
        if ttl_seconds > 0:
            expired_keys = [
                run_id
                for run_id, (cached_at, _) in self._validated_params_cache.items()
                if now_value - cached_at > ttl_seconds
            ]
            for run_id in expired_keys:
                self._validated_params_cache.pop(run_id, None)
        max_entries = self._cache_max_entries
        if max_entries >= 0 and len(self._validated_params_cache) > max_entries:
            overflow = len(self._validated_params_cache) - max_entries
            oldest = sorted(self._validated_params_cache.items(), key=lambda item: item[1][0])[
                :overflow
            ]
            for run_id, _ in oldest:
                self._validated_params_cache.pop(run_id, None)

    def _read_non_negative_int_env(self, key: str, default: int) -> int:
        raw = os.getenv(key, str(default)).strip()
        if not raw:
            return default
        try:
            value = int(raw)
        except ValueError:
            return default
        return max(0, value)

    def _claim_run_for_resume(
        self, run_id: str, actor: str | None, otp_value: str
    ) -> tuple[RunRecord, RunStatus]:
        return resume_ops.claim_run_for_resume(self, run_id, actor, otp_value)

    def _mark_run_resume_failed(self, run_id: str, message: str) -> RunRecord:
        return resume_ops.mark_run_resume_failed(self, run_id, message)

    def _sync_run_status(self, run: RunRecord) -> None:
        run_ops.sync_run_status(self, run)

    def _map_task_status(self, task_status: str) -> RunStatus:
        return run_ops.map_task_status(task_status)

    def _build_env(
        self, start_url: str, params: dict[str, str], otp_code: str | None
    ) -> dict[str, str]:
        return run_ops.build_env(
            start_url,
            params,
            otp_code,
            stripe_param_keys=self._STRIPE_PARAM_KEYS,
            is_secret_param_key=self._is_secret_param_key,
        )

    def _resolve_otp_code(self, otp: OtpPolicy, manual_code: str | None) -> str | None:
        return run_ops.resolve_otp_code(otp, manual_code)

    def _validate_params(
        self, template: TemplateRecord, params: dict[str, str], otp: OtpPolicy
    ) -> None:
        params_ops.validate_params(template, params, otp)

    def _sanitize_defaults(
        self, params_schema: list[dict[str, Any]], defaults: dict[str, str]
    ) -> dict[str, str]:
        return params_ops.sanitize_defaults(params_schema, defaults)

    def _export_scrubbed_defaults(self, template: TemplateRecord) -> dict[str, str]:
        return params_ops.export_scrubbed_defaults(template)

    def _public_params(self, template: TemplateRecord, params: dict[str, str]) -> dict[str, str]:
        return params_ops.public_params(template, params, self._SENSITIVE_PARAM_KEYS)

    def _is_secret_param_key(self, key: str) -> bool:
        return params_ops.is_secret_param_key(key, self._SENSITIVE_PARAM_KEYS)

    def _extract_progress(self, output_tail: str) -> tuple[int, list[RunLogEntry]]:
        cursor, logs, _wait_context = run_ops.extract_progress(
            output_tail, redact_text=self._redact_text
        )
        return cursor, logs

    def _extract_wait_context(self, payload: dict[str, Any]) -> RunWaitContext | None:
        return run_ops.extract_wait_context(payload)

    def _resolve_resume_from_step_id(self, wait_context: RunWaitContext | None) -> str | None:
        return run_ops.resolve_resume_from_step_id(wait_context)

    def _coerce_optional_text(self, *candidates: Any) -> str | None:
        return run_ops.coerce_optional_text(*candidates)

    def _coerce_optional_bool(self, *candidates: Any) -> bool | None:
        return run_ops.coerce_optional_bool(*candidates)

    def _append_unique_logs(self, run: RunRecord, entries: list[RunLogEntry]) -> None:
        run_ops.append_unique_logs(run, entries)

    def _read_json(self, path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            quarantine_path = path.with_suffix(f"{path.suffix}.corrupt")
            moved_to_quarantine = False
            try:
                path.replace(quarantine_path)
                moved_to_quarantine = True
            except OSError as move_exc:
                logger.warning(
                    "universal data json decode error; failed to quarantine corrupt file",
                    extra={
                        "error": str(move_exc),
                        "source_path": str(path),
                        "quarantine_path": str(quarantine_path),
                    },
                )
            logger.warning(
                "universal data json decode error",
                extra={
                    "error": str(exc),
                    "source_path": str(path),
                    "quarantine_path": str(quarantine_path) if moved_to_quarantine else None,
                    "quarantined": moved_to_quarantine,
                },
            )
            return []
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        return []

    def _write_json(self, path: Path, payload: list[dict[str, Any]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)

    def _read_positive_int_env(self, key: str, *, default: int, minimum: int = 1) -> int:
        raw = env_str(key, "").strip()
        try:
            parsed = int(raw) if raw else default
        except ValueError:
            parsed = default
        return max(minimum, parsed)

    def _rotate_audit_if_needed(self, incoming_bytes: int) -> None:
        current_size = self._audit_path.stat().st_size if self._audit_path.exists() else 0
        if current_size + max(0, incoming_bytes) <= self._audit_max_bytes:
            return
        oldest = self._audit_path.with_name(f"{self._audit_path.name}.{self._audit_backup_count}")
        if oldest.exists():
            oldest.unlink()
        for idx in range(self._audit_backup_count - 1, 0, -1):
            source = self._audit_path.with_name(f"{self._audit_path.name}.{idx}")
            target = self._audit_path.with_name(f"{self._audit_path.name}.{idx + 1}")
            if source.exists():
                source.replace(target)
        if self._audit_path.exists():
            self._audit_path.replace(self._audit_path.with_name(f"{self._audit_path.name}.1"))

    def _prune_audit_history(self) -> None:
        cutoff_ts = datetime.now(UTC).timestamp() - (self._audit_retention_days * 24 * 60 * 60)
        candidates = [self._audit_path]
        for idx in range(1, self._audit_backup_count + 1):
            candidates.append(self._audit_path.with_name(f"{self._audit_path.name}.{idx}"))
        for candidate in candidates:
            if not candidate.exists():
                continue
            if candidate.stat().st_mtime < cutoff_ts:
                candidate.unlink()

    def _audit(self, action: str, actor: str | None, payload: dict[str, Any]) -> None:
        request_id = REQUEST_ID_CTX.get()
        redacted_payload = self._redact_payload(payload)
        line = json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat(),
                "level": "info",
                "kind": "audit",
                "service": "api",
                "component": "universal-platform",
                "channel": "automation.universal.audit",
                "run_id": redacted_payload.get("run_id"),
                "trace_id": None if request_id in {"", "-"} else request_id,
                "request_id": None if request_id in {"", "-"} else request_id,
                "test_id": None,
                "event_code": self._sanitize_audit_code(action),
                "message": action,
                "attrs": {
                    "actor": actor or "anonymous",
                    "payload": redacted_payload,
                },
                "redaction_state": "redacted",
                "source_kind": "app",
            },
            ensure_ascii=False,
        )
        incoming_bytes = len((line + "\n").encode("utf-8"))
        with self._audit_lock:
            try:
                self._audit_path.parent.mkdir(parents=True, exist_ok=True)
                self._rotate_audit_if_needed(incoming_bytes)
                with self._audit_path.open("a", encoding="utf-8") as f:
                    f.write(line + "\n")
                self._prune_audit_history()
            except OSError as exc:
                self._audit_write_failures += 1
                print(
                    f"[universal-audit] write failed (count={self._audit_write_failures}): {exc}",
                    file=sys.stderr,
                )

    def _redact_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return secrets_ops.redact_payload(payload, self._redact_text)

    def _redact_text(self, value: str) -> str:
        return secrets_ops.redact_text(value, self._SENSITIVE_LOG_PATTERNS)

    def _sanitize_audit_code(self, raw_value: str) -> str:
        normalized = "".join(
            character.lower() if character.isalnum() else "."
            for character in str(raw_value).strip()
        )
        normalized = ".".join(segment for segment in normalized.split(".") if segment)
        return normalized or "automation.universal.audit"

    def _ensure_allowed_param_keys(
        self, params_schema: list[TemplateParamSpec], params: dict[str, str], *, source: str
    ) -> None:
        params_ops.ensure_allowed_param_keys(params_schema, params, source=source)

    def _run_owner(self, run: RunRecord) -> str | None:
        try:
            template = self.get_template(run.template_id)
            return self._template_owner(template)
        except HTTPException:
            for item in self._read_json(self._runs_path):
                if item.get("run_id") != run.run_id:
                    continue
                owner = item.get(self._run_owner_key)
                return owner if isinstance(owner, str) else None
            return None


universal_platform_service = UniversalPlatformService()
