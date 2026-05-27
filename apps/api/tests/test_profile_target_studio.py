from __future__ import annotations

from types import SimpleNamespace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import apps.api.app.core.access_control as access_control
from apps.api.app.api import profiles as profiles_api
from apps.api.app.main import app
from apps.api.app.services.profile_target_studio_service import ProfileTargetStudioService

TEST_AUTOMATION_TOKEN = "test-token-0123456789"

client = TestClient(
    app,
    headers={
        "x-automation-token": TEST_AUTOMATION_TOKEN,
        "x-automation-client-id": "pytest-studio",
    },
)


def _write_profile(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "name: pr",
                "steps:",
                "  - unit",
                "gates:",
                "  consoleErrorMax: 0",
                "  pageErrorMax: 0",
                "  http5xxMax: 0",
                "determinism:",
                "  disableAnimations: true",
                "diagnostics:",
                "  maxItems: 10",
                "a11y:",
                "  standard: wcag2aa",
                "  maxIssues: 300",
                "  engine: axe",
                "perf:",
                "  preset: mobile",
                "  engine: lhci",
                "visual:",
                "  mode: diff",
                "  engine: builtin",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _write_target(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "name: web.local",
                "type: web",
                "driver: web-playwright",
                "baseUrl: http://127.0.0.1:43173",
                "scope:",
                "  domains:",
                "    - http://127.0.0.1:43173",
                "explore:",
                "  budgetSeconds: 180",
                "  maxDepth: 2",
                "  maxStates: 20",
                "diagnostics:",
                "  maxItems: 20",
                "a11y:",
                "  standard: wcag2aa",
                "  maxIssues: 200",
                "  engine: axe",
                "perf:",
                "  preset: desktop",
                "  engine: lhci",
                "visual:",
                "  mode: diff",
                "load:",
                "  vus: 6",
                "  durationSeconds: 15",
                "  requestTimeoutMs: 8000",
                "",
            ]
        ),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def reset_profile_target_studio(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", TEST_AUTOMATION_TOKEN)
    access_control.reset_for_tests()

    profiles_root = tmp_path / "configs" / "profiles"
    targets_root = tmp_path / "configs" / "targets"
    profiles_root.mkdir(parents=True, exist_ok=True)
    targets_root.mkdir(parents=True, exist_ok=True)
    _write_profile(profiles_root / "pr.yaml")
    _write_target(targets_root / "web.local.yaml")

    service = ProfileTargetStudioService()
    service._repo_root = tmp_path
    service._profiles_root = profiles_root
    service._targets_root = targets_root
    service._python_runtime_root = tmp_path / ".runtime-cache" / "temp"
    monkeypatch.setattr(service, "_run_schema_validation", lambda *args, **kwargs: None)
    monkeypatch.setattr(service, "_run_post_save_validation", lambda *args, **kwargs: None)
    profiles_api.profile_target_studio_service = service


def test_profile_target_studio_lists_allowlisted_documents() -> None:
    response = client.get("/api/profiles/studio")

    assert response.status_code == 200
    payload = response.json()
    assert payload["selected_profile"] == "pr"
    assert payload["selected_target"] == "web.local"
    profile_paths = {field["path"] for field in payload["profile"]["editable_fields"]}
    target_paths = {field["path"] for field in payload["target"]["editable_fields"]}
    assert "gates.consoleErrorMax" in profile_paths
    assert "steps" not in profile_paths
    assert "explore.budgetSeconds" in target_paths
    assert "baseUrl" not in target_paths
    validation_summary = payload["profile"]["validation_summary"]
    assert any("Allowlisted fields only" in item for item in validation_summary)
    assert any("roll back" in item.lower() or "rollback" in item.lower() for item in validation_summary)


def test_profile_target_studio_updates_profile_and_persists_yaml() -> None:
    response = client.patch(
        "/api/profiles/studio/profiles/pr",
        json={"updates": {"gates.consoleErrorMax": 3, "determinism.disableAnimations": False}},
    )

    assert response.status_code == 200
    payload = response.json()
    values = {
        field["path"]: field["value"] for field in payload["document"]["editable_fields"]
    }
    assert values["gates.consoleErrorMax"] == 3
    assert values["determinism.disableAnimations"] is False


def test_profile_target_studio_rolls_back_when_post_save_validation_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = profiles_api.profile_target_studio_service
    profile_path = service._profiles_root / "pr.yaml"
    original = profile_path.read_text(encoding="utf-8")

    monkeypatch.setattr(
        service,
        "_run_post_save_validation",
        lambda: (_ for _ in ()).throw(RuntimeError("config drift failed")),
    )

    response = client.patch(
        "/api/profiles/studio/profiles/pr",
        json={"updates": {"gates.consoleErrorMax": 7}},
    )

    assert response.status_code == 422
    assert "rolled back" in response.json()["detail"]
    assert profile_path.read_text(encoding="utf-8") == original


def test_profile_target_studio_schema_validation_uses_static_command_and_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = profiles_api.profile_target_studio_service
    captured: dict[str, object] = {}

    def _fake_run(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr("apps.api.app.services.profile_target_studio_service.subprocess.run", _fake_run)

    ProfileTargetStudioService._run_schema_validation(
        service,
        "profile",
        "pr",
        {"gates": {"consoleErrorMax": 1}},
    )

    assert captured["args"] == (
        [
            "node",
            "--import",
            "tsx",
            "scripts/config/validate-studio-config.mts",
        ],
    )
    env = captured["kwargs"]["env"]
    assert env["UIQ_STUDIO_CONFIG_KIND"] == "profile"
    assert env["UIQ_STUDIO_CONFIG_NAME"] == "pr"
    payload_path = Path(env["UIQ_STUDIO_PAYLOAD_PATH"])
    assert service._python_runtime_root.resolve() in payload_path.parents
    assert not payload_path.exists()
