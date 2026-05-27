from __future__ import annotations

from pathlib import Path

from pydantic import SecretStr
from pydantic import ValidationError
import pytest
from pytest import MonkeyPatch
import yaml

import apps.api.app.core.settings as settings_module
from apps.api.app.main import _validated_cors_origins, _validated_trusted_hosts
from apps.api.app.core.settings import (
    RuntimeSettings,
    env_bool,
    env_csv,
    env_float,
    env_int,
    env_str,
    refresh_settings_cache,
)


def test_env_helpers_read_typed_values(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_MAX_TASKS", "321")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://a.test, http://b.test")

    assert env_int("AUTOMATION_MAX_TASKS", 1) == 321
    assert env_bool("COOKIE_SECURE", False) is True
    assert env_csv("CORS_ALLOWED_ORIGINS", "") == ["http://a.test", "http://b.test"]


def test_env_str_reads_secret_and_unknown_fallback(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "secret-token")
    monkeypatch.setenv("CUSTOM_UNDECLARED_ENV", "custom")

    assert env_str("AUTOMATION_API_TOKEN", "") == "secret-token"
    assert env_str("CUSTOM_UNDECLARED_ENV", "") == "custom"
    assert env_str("MISSING_ENV", "fallback") == "fallback"


def test_runtime_settings_invalid_int_raises(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_MAX_TASKS", "not-an-int")
    with pytest.raises(ValidationError):
        RuntimeSettings()


def test_runtime_settings_defaults_align_with_contract(monkeypatch: MonkeyPatch) -> None:
    contract_path = Path(__file__).resolve().parents[3] / "configs" / "env" / "contract.yaml"
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    defaults = {
        str(item["name"]): item.get("default") for item in contract["variables"] if "name" in item
    }

    for field_name, field_info in RuntimeSettings.model_fields.items():
        alias = field_info.alias or field_name
        monkeypatch.delenv(alias, raising=False)

    settings = RuntimeSettings(_env_file=None)
    missing_in_contract: list[str] = []
    mismatches: list[tuple[str, str, str]] = []
    for field_name, field_info in RuntimeSettings.model_fields.items():
        alias = field_info.alias or field_name
        if alias not in defaults:
            missing_in_contract.append(alias)
            continue
        actual = getattr(settings, field_name)
        if hasattr(actual, "get_secret_value"):
            actual = actual.get_secret_value()

        actual_str = _to_contract_string(actual)
        expected_str = _to_contract_string(defaults[alias])
        if actual_str != expected_str:
            mismatches.append((alias, actual_str, expected_str))

    assert missing_in_contract == []
    assert mismatches == []


def test_required_prod_env_rejects_placeholder_token(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "replace-with-strong-token")
    with pytest.raises(ValidationError):
        RuntimeSettings()


def test_required_prod_env_accepts_non_placeholder_token(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "strong-prod-token")
    settings = RuntimeSettings(_env_file=None)
    assert settings.app_env == "production"


def test_validated_cors_origins_rejects_wildcard() -> None:
    with pytest.raises(RuntimeError, match="cannot contain wildcard"):
        _validated_cors_origins("*")


def test_validated_cors_origins_requires_explicit_http_scheme() -> None:
    with pytest.raises(RuntimeError, match="invalid origin"):
        _validated_cors_origins("localhost:3000")


def test_validated_trusted_hosts_rejects_global_wildcard() -> None:
    with pytest.raises(RuntimeError, match="cannot contain wildcard"):
        _validated_trusted_hosts("*")


def test_validated_trusted_hosts_rejects_url_style_entry() -> None:
    with pytest.raises(RuntimeError, match="invalid host"):
        _validated_trusted_hosts("https://example.com")


def _to_contract_string(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def test_load_required_in_prod_keys_fallback_paths(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setattr(settings_module.Path, "read_text", lambda *_a, **_k: (_ for _ in ()).throw(OSError("no file")))
    assert settings_module._load_required_in_prod_keys() == settings_module._REQUIRED_IN_PROD_FALLBACK

    monkeypatch.setattr(settings_module.Path, "read_text", lambda *_a, **_k: "ignored")
    monkeypatch.setattr(settings_module.yaml, "safe_load", lambda *_a, **_k: {"variables": "not-a-list"})
    assert settings_module._load_required_in_prod_keys() == settings_module._REQUIRED_IN_PROD_FALLBACK

    monkeypatch.setattr(
        settings_module.yaml,
        "safe_load",
        lambda *_a, **_k: {
            "variables": [
                "bad-item",
                {"required": False, "name": "AUTOMATION_API_TOKEN"},
                {"required": True, "name": "   "},
            ]
        },
    )
    assert settings_module._load_required_in_prod_keys() == settings_module._REQUIRED_IN_PROD_FALLBACK


def test_collect_missing_required_keys_uses_env_fallback_for_unknown_alias(
    monkeypatch: MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings_module, "_REQUIRED_IN_PROD_KEYS", frozenset({"UNKNOWN_KEY"}))
    monkeypatch.delenv("UNKNOWN_KEY", raising=False)
    settings = RuntimeSettings(_env_file=None)
    assert settings_module._collect_missing_required_in_prod(settings) == ["UNKNOWN_KEY"]

    monkeypatch.setenv("UNKNOWN_KEY", "provided")
    assert settings_module._collect_missing_required_in_prod(settings) == []


def test_env_str_placeholder_and_exception_fallbacks(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "replace-with-strong-token")
    assert env_str("AUTOMATION_API_TOKEN", "fallback") == "fallback"

    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    refresh_settings_cache()
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "replace-with-strong-token")
    assert env_str("AUTOMATION_API_TOKEN", "fallback-non-pytest") == "fallback-non-pytest"

    monkeypatch.setattr(settings_module, "get_settings", lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    assert settings_module.env_str("LOG_LEVEL", "DEBUG") == "INFO"


def test_get_settings_cache_behaviour_and_numeric_parser_fallback(
    monkeypatch: MonkeyPatch,
) -> None:
    first = settings_module.get_settings()
    second = settings_module.get_settings()
    assert first is not second

    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    refresh_settings_cache()
    cached_a = settings_module.get_settings()
    cached_b = settings_module.get_settings()
    assert cached_a is cached_b

    monkeypatch.setattr(settings_module, "env_str", lambda *_a, **_k: "not-float")
    assert env_int("AUTOMATION_MAX_TASKS", 42) == 42
    assert env_float("AUTOMATION_FAILURE_ALERT_THRESHOLD", 0.25) == 0.25


def test_as_string_handles_none_secret_and_plain_text() -> None:
    assert settings_module._as_string(None, "default") == "default"
    assert settings_module._as_string(SecretStr("secret-value"), "") == "secret-value"
    assert settings_module._as_string(123, "") == "123"
