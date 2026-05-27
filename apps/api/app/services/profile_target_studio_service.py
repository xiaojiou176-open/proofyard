from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException, status

from apps.api.app.models.profile_target_studio import (
    ConfigStudioDocument,
    ConfigStudioField,
    ConfigStudioReadonlyField,
    ConfigStudioSaveResponse,
    ProfileTargetStudioResponse,
)

CONFIG_NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class FieldSpec:
    label: str
    group: str
    field_type: str
    description: str
    min_value: float | int | None = None
    max_value: float | int | None = None
    enum_values: tuple[str, ...] = ()


PROFILE_EDITABLE_FIELDS: dict[str, FieldSpec] = {
    "geminiAccuracyMin": FieldSpec("Gemini accuracy min", "Scoring", "number", "Lower bound for Gemini accuracy agreement.", 0, 1),
    "geminiParallelConsistencyMin": FieldSpec("Gemini parallel consistency", "Scoring", "number", "Lower bound for Gemini parallel consistency.", 0, 1),
    "geminiSampleSizeMin": FieldSpec("Gemini sample size", "Scoring", "integer", "Minimum Gemini sample size when thresholds are enabled.", 1, 1_000_000),
    "gates.consoleErrorMax": FieldSpec("Console error max", "Gates", "integer", "Maximum allowed console errors.", 0, 1_000_000),
    "gates.pageErrorMax": FieldSpec("Page error max", "Gates", "integer", "Maximum allowed page errors.", 0, 1_000_000),
    "gates.http5xxMax": FieldSpec("HTTP 5xx max", "Gates", "integer", "Maximum allowed HTTP 5xx responses.", 0, 1_000_000),
    "gates.flakeRateMax": FieldSpec("Flake rate max", "Gates", "number", "Maximum allowed flake rate.", 0, 1),
    "gates.a11ySeriousMax": FieldSpec("A11y serious max", "Gates", "integer", "Maximum allowed serious accessibility issues.", 0, 1_000_000),
    "gates.perfLcpMsMax": FieldSpec("Perf LCP max", "Gates", "number", "Largest Contentful Paint budget in milliseconds.", 0, 1_000_000),
    "gates.perfFcpMsMax": FieldSpec("Perf FCP max", "Gates", "number", "First Contentful Paint budget in milliseconds.", 0, 1_000_000),
    "gates.visualDiffPixelsMax": FieldSpec("Visual diff max", "Gates", "number", "Maximum visual diff pixels.", 0, 1_000_000_000),
    "determinism.timezone": FieldSpec("Timezone", "Determinism", "string", "Timezone used for deterministic runs."),
    "determinism.locale": FieldSpec("Locale", "Determinism", "string", "Locale used for deterministic runs."),
    "determinism.seed": FieldSpec("Seed", "Determinism", "integer", "Deterministic random seed.", 0, 2_147_483_647),
    "determinism.disableAnimations": FieldSpec("Disable animations", "Determinism", "boolean", "Force animations off during runs."),
    "determinism.reducedMotion": FieldSpec("Reduced motion", "Determinism", "enum", "Reduced motion preference.", enum_values=("reduce", "no-preference")),
    "diagnostics.maxItems": FieldSpec("Diagnostics max items", "Diagnostics", "integer", "Maximum diagnostics entries kept in reports.", 1, 1000),
    "a11y.standard": FieldSpec("A11y standard", "A11y", "enum", "Accessibility standard.", enum_values=("wcag2a", "wcag2aa", "wcag2aaa")),
    "a11y.maxIssues": FieldSpec("A11y max issues", "A11y", "integer", "Maximum captured accessibility issues.", 0, 1_000_000),
    "a11y.engine": FieldSpec("A11y engine", "A11y", "enum", "Accessibility engine.", enum_values=("axe", "builtin")),
    "perf.preset": FieldSpec("Perf preset", "Performance", "enum", "Performance preset.", enum_values=("mobile", "desktop")),
    "perf.engine": FieldSpec("Perf engine", "Performance", "enum", "Performance engine.", enum_values=("lhci", "builtin")),
    "visual.engine": FieldSpec("Visual engine", "Visual", "enum", "Visual comparison engine.", enum_values=("builtin", "lostpixel", "backstop")),
    "visual.mode": FieldSpec("Visual mode", "Visual", "enum", "Visual comparison mode.", enum_values=("diff", "update")),
}

TARGET_EDITABLE_FIELDS: dict[str, FieldSpec] = {
    "geminiAccuracyMin": FieldSpec("Gemini accuracy min", "Scoring", "number", "Lower bound for Gemini accuracy agreement.", 0, 1),
    "geminiParallelConsistencyMin": FieldSpec("Gemini parallel consistency", "Scoring", "number", "Lower bound for Gemini parallel consistency.", 0, 1),
    "geminiSampleSizeMin": FieldSpec("Gemini sample size", "Scoring", "integer", "Minimum Gemini sample size when thresholds are enabled.", 1, 1_000_000),
    "explore.budgetSeconds": FieldSpec("Explore budget", "Explore", "integer", "Exploration budget in seconds.", 1, 86_400),
    "explore.maxDepth": FieldSpec("Explore depth", "Explore", "integer", "Maximum exploration depth.", 0, 50),
    "explore.maxStates": FieldSpec("Explore states", "Explore", "integer", "Maximum discovered states.", 1, 100_000),
    "chaos.seed": FieldSpec("Chaos seed", "Chaos", "integer", "Chaos seed value.", 0, 2_147_483_647),
    "chaos.budgetSeconds": FieldSpec("Chaos budget", "Chaos", "integer", "Chaos budget in seconds.", 1, 86_400),
    "diagnostics.maxItems": FieldSpec("Diagnostics max items", "Diagnostics", "integer", "Maximum diagnostics entries kept in reports.", 1, 1000),
    "a11y.standard": FieldSpec("A11y standard", "A11y", "enum", "Accessibility standard.", enum_values=("wcag2a", "wcag2aa", "wcag2aaa")),
    "a11y.maxIssues": FieldSpec("A11y max issues", "A11y", "integer", "Maximum captured accessibility issues.", 0, 1_000_000),
    "a11y.engine": FieldSpec("A11y engine", "A11y", "enum", "Accessibility engine.", enum_values=("axe", "builtin")),
    "perf.preset": FieldSpec("Perf preset", "Performance", "enum", "Performance preset.", enum_values=("mobile", "desktop")),
    "perf.engine": FieldSpec("Perf engine", "Performance", "enum", "Performance engine.", enum_values=("lhci", "builtin")),
    "visual.engine": FieldSpec("Visual engine", "Visual", "enum", "Visual comparison engine.", enum_values=("builtin", "lostpixel", "backstop")),
    "visual.mode": FieldSpec("Visual mode", "Visual", "enum", "Visual comparison mode.", enum_values=("diff", "update")),
    "load.vus": FieldSpec("Load VUs", "Load", "integer", "Virtual users for load checks.", 1, 1_000_000),
    "load.durationSeconds": FieldSpec("Load duration", "Load", "integer", "Load test duration in seconds.", 1, 86_400),
    "load.requestTimeoutMs": FieldSpec("Load request timeout", "Load", "integer", "Load request timeout in milliseconds.", 100, 120_000),
}

PROFILE_READONLY_FIELDS = (
    ("name", "Profile name"),
    ("steps", "Execution steps"),
    ("tests", "Test selection"),
    ("enginePolicy", "Engine policy"),
    ("aiReview", "AI review"),
)

TARGET_READONLY_FIELDS = (
    ("name", "Target name"),
    ("type", "Target type"),
    ("driver", "Driver"),
    ("baseUrl", "Base URL"),
    ("start", "Start commands"),
    ("scope", "Scope allowlist"),
    ("gates", "Target gates"),
    ("security", "Security policy"),
    ("app", "App path"),
    ("bundleId", "Bundle ID"),
    ("aiReview", "AI review"),
)


class ProfileTargetStudioService:
    def __init__(self) -> None:
        self._repo_root = Path(__file__).resolve().parents[4]
        self._profiles_root = self._repo_root / "configs" / "profiles"
        self._targets_root = self._repo_root / "configs" / "targets"
        self._python_runtime_root = self._repo_root / ".runtime-cache" / "temp"

    def get_studio(
        self, profile_name: str | None = None, target_name: str | None = None
    ) -> ProfileTargetStudioResponse:
        selected_profile = self._resolve_name("profile", profile_name)
        selected_target = self._resolve_name("target", target_name)
        return ProfileTargetStudioResponse(
            profile_options=self._list_names("profile"),
            target_options=self._list_names("target"),
            selected_profile=selected_profile,
            selected_target=selected_target,
            profile=self._build_document("profile", selected_profile),
            target=self._build_document("target", selected_target),
        )

    def update_profile(self, profile_name: str, updates: dict[str, Any]) -> ConfigStudioSaveResponse:
        return self._save("profile", profile_name, updates)

    def update_target(self, target_name: str, updates: dict[str, Any]) -> ConfigStudioSaveResponse:
        return self._save("target", target_name, updates)

    def _save(self, kind: str, config_name: str, updates: dict[str, Any]) -> ConfigStudioSaveResponse:
        safe_name = self._resolve_name(kind, config_name)
        specs = self._editable_specs(kind)
        self._validate_update_keys(specs, updates)
        file_path = self._config_path(kind, safe_name)
        current = self._load_yaml(file_path)
        next_payload = deepcopy(current)
        for path, value in updates.items():
            normalized = self._normalize_value(specs[path], value, path)
            self._set_path(next_payload, path, normalized)

        self._run_schema_validation(kind, safe_name, next_payload)

        original_text = file_path.read_text(encoding="utf-8")
        audit = [
            f"{kind}:{safe_name}",
            "schema-precheck:ok",
        ]
        file_path.write_text(
            yaml.safe_dump(next_payload, sort_keys=False, allow_unicode=False),
            encoding="utf-8",
        )
        try:
            self._run_schema_validation(kind, safe_name, None)
            self._run_post_save_validation()
            audit.extend(["schema-postcheck:ok", "config-drift:ok"])
        except Exception as exc:
            file_path.write_text(original_text, encoding="utf-8")
            audit.append("rollback:applied")
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Studio save rolled back: {exc}",
            ) from exc

        return ConfigStudioSaveResponse(
            document=self._build_document(kind, safe_name),
            audit=audit,
        )

    def _build_document(self, kind: str, config_name: str) -> ConfigStudioDocument:
        file_path = self._config_path(kind, config_name)
        payload = self._load_yaml(file_path)
        editable_fields = [
            ConfigStudioField(
                path=path,
                label=spec.label,
                group=spec.group,
                field_type=spec.field_type,  # type: ignore[arg-type]
                value=self._get_path(payload, path),
                description=spec.description,
                min_value=spec.min_value,
                max_value=spec.max_value,
                enum_values=list(spec.enum_values),
            )
            for path, spec in self._editable_specs(kind).items()
        ]
        readonly_fields = [
            ConfigStudioReadonlyField(path=path, label=label, value=self._get_path(payload, path))
            for path, label in self._readonly_specs(kind)
        ]
        validation_summary = [
            "Allowlisted fields only: high-risk config remains read-only in Studio.",
            "Pre-save guardrail: canonical profile/target schema validation runs before any write sticks.",
            "Post-save guardrail: schema validation and pnpm check:config-drift rerun; invalid saves roll back automatically.",
        ]
        return ConfigStudioDocument(
            kind=kind,  # type: ignore[arg-type]
            config_name=config_name,
            file_path=str(file_path.relative_to(self._repo_root)),
            editable_fields=editable_fields,
            readonly_fields=readonly_fields,
            validation_summary=validation_summary,
        )

    def _run_schema_validation(self, kind: str, config_name: str, payload: dict[str, Any] | None) -> None:
        validated_kind = self._validated_kind(kind)
        validated_name = self._resolve_name(validated_kind, config_name)
        temp_path: Path | None = None
        if payload is not None:
            self._python_runtime_root.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".json",
                dir=self._python_runtime_root,
                delete=False,
                encoding="utf-8",
            ) as handle:
                json.dump(payload, handle)
                temp_path = Path(handle.name)
        env = {
            **os.environ,
            "UIQ_STUDIO_CONFIG_KIND": validated_kind,
            "UIQ_STUDIO_CONFIG_NAME": validated_name,
        }
        if temp_path is not None:
            env["UIQ_STUDIO_PAYLOAD_PATH"] = self._validated_temp_payload_path(temp_path)
        try:
            completed = subprocess.run(
                [
                    "node",
                    "--import",
                    "tsx",
                    "scripts/config/validate-studio-config.mts",
                ],
                cwd=self._repo_root,
                check=False,
                capture_output=True,
                text=True,
                env=env,
            )
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "studio schema validation failed").strip()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)

    def _run_post_save_validation(self) -> None:
        completed = subprocess.run(
            ["pnpm", "check:config-drift"],
            cwd=self._repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "config drift validation failed").strip()
            raise RuntimeError(detail)

    def _config_path(self, kind: str, config_name: str) -> Path:
        root = self._profiles_root if kind == "profile" else self._targets_root
        file_path = (root / f"{config_name}.yaml").resolve()
        if not file_path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{kind} config not found")
        if root.resolve() not in file_path.parents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="path traversal blocked")
        return file_path

    def _validated_kind(self, kind: str) -> str:
        if kind not in {"profile", "target"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid config kind")
        return kind

    def _validated_temp_payload_path(self, temp_path: Path) -> str:
        resolved = temp_path.resolve()
        runtime_root = self._python_runtime_root.resolve()
        if runtime_root not in resolved.parents:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="temp payload path traversal blocked")
        return str(resolved)

    def _resolve_name(self, kind: str, candidate: str | None) -> str:
        options = self._list_names(kind)
        if not options:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"no {kind} configs available")
        selected = (candidate or "").strip() or options[0]
        if not CONFIG_NAME_PATTERN.fullmatch(selected):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"invalid {kind} config name")
        if selected not in options:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{kind} config not found")
        return selected

    def _list_names(self, kind: str) -> list[str]:
        root = self._profiles_root if kind == "profile" else self._targets_root
        return sorted(file.stem for file in root.glob("*.yaml"))

    @staticmethod
    def _load_yaml(file_path: Path) -> dict[str, Any]:
        payload = yaml.safe_load(file_path.read_text(encoding="utf-8")) or {}
        if not isinstance(payload, dict):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="config must be a YAML object")
        return payload

    @staticmethod
    def _get_path(payload: dict[str, Any], path: str) -> Any:
        cursor: Any = payload
        for key in path.split("."):
            if not isinstance(cursor, dict):
                return None
            cursor = cursor.get(key)
        return cursor

    @staticmethod
    def _set_path(payload: dict[str, Any], path: str, value: Any) -> None:
        keys = path.split(".")
        cursor: dict[str, Any] = payload
        for key in keys[:-1]:
            nested = cursor.get(key)
            if not isinstance(nested, dict):
                nested = {}
                cursor[key] = nested
            cursor = nested
        cursor[keys[-1]] = value

    @staticmethod
    def _validate_update_keys(specs: dict[str, FieldSpec], updates: dict[str, Any]) -> None:
        for path in updates:
            if path not in specs:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"field '{path}' is not editable in studio",
                )

    @staticmethod
    def _normalize_value(spec: FieldSpec, value: Any, path: str) -> Any:
        if spec.field_type == "boolean":
            if not isinstance(value, bool):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} must be boolean")
            return value
        if spec.field_type == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} must be integer")
            if spec.min_value is not None and value < spec.min_value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} below minimum")
            if spec.max_value is not None and value > spec.max_value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} above maximum")
            return value
        if spec.field_type == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} must be number")
            numeric = float(value)
            if spec.min_value is not None and numeric < spec.min_value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} below minimum")
            if spec.max_value is not None and numeric > spec.max_value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} above maximum")
            return value
        if spec.field_type == "enum":
            if not isinstance(value, str) or value not in spec.enum_values:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"{path} must be one of {', '.join(spec.enum_values)}",
                )
            return value
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"{path} must be non-empty string")
        return value.strip()

    @staticmethod
    def _editable_specs(kind: str) -> dict[str, FieldSpec]:
        return PROFILE_EDITABLE_FIELDS if kind == "profile" else TARGET_EDITABLE_FIELDS

    @staticmethod
    def _readonly_specs(kind: str) -> tuple[tuple[str, str], ...]:
        return PROFILE_READONLY_FIELDS if kind == "profile" else TARGET_READONLY_FIELDS


profile_target_studio_service = ProfileTargetStudioService()
