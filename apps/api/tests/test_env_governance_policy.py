from __future__ import annotations

from pathlib import Path

from apps.api.app.core import env_governance


def test_parse_scalar_handles_comments_null_and_quotes() -> None:
    assert env_governance._parse_scalar(" value # comment ") == "value"
    assert env_governance._parse_scalar("null") is None
    assert env_governance._parse_scalar("~") is None
    assert env_governance._parse_scalar("   ") is None
    assert env_governance._parse_scalar('"strict"') == "strict"
    assert env_governance._parse_scalar("'strict'") == "strict"


def test_get_policy_returns_defaults_when_policy_file_missing(monkeypatch) -> None:
    missing = Path("/tmp/this-policy-should-not-exist.yaml")
    monkeypatch.setattr(env_governance, "_policy_path", lambda: missing)
    env_governance.refresh_env_governance_policy_cache()

    policy = env_governance.get_env_governance_policy()

    assert policy.automation_run_payload_mode == "strict"
    assert env_governance.is_automation_run_payload_strict() is True


def test_get_policy_parses_scalar_values_from_yaml_like_content(tmp_path, monkeypatch) -> None:
    policy_path = tmp_path / "env-governance-policy.yaml"
    policy_path.write_text(
        "\n".join(
            [
                "# comment",
                "automation_run_payload_mode: strict",
                "invalid_line_without_colon",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(env_governance, "_policy_path", lambda: policy_path)
    env_governance.refresh_env_governance_policy_cache()

    policy = env_governance.get_env_governance_policy()

    assert policy.automation_run_payload_mode == "strict"
    assert env_governance.is_automation_run_payload_strict() is True


def test_get_policy_treats_unknown_mode_as_strict(tmp_path, monkeypatch) -> None:
    policy_path = tmp_path / "env-governance-policy.yaml"
    policy_path.write_text("automation_run_payload_mode: unknown", encoding="utf-8")
    monkeypatch.setattr(env_governance, "_policy_path", lambda: policy_path)
    env_governance.refresh_env_governance_policy_cache()

    policy = env_governance.get_env_governance_policy()

    assert policy.automation_run_payload_mode == "strict"
