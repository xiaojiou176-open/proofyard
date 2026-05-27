from __future__ import annotations

import hashlib
import hmac
import inspect
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from starlette.requests import Request

import apps.api.app.api.integrations_vonage as vonage_api
from apps.api.app.api.integrations_vonage import (
    InboundAuthError,
    _build_signature_payload,
    _check_inbound_token,
    _load_signature_secret,
    _log_inbound_security_event,
    _resolve_inbound_token,
    _verify_signature,
)
from apps.api.app.main import app
from apps.api.app.services.vonage_inbox import vonage_inbox_service

client = TestClient(app)


class _CaseSensitiveHeaders(dict[str, str]):
    def get(self, key: str, default: str | None = None) -> str | None:
        return super().get(key, default)


class _FakeRequest:
    def __init__(
        self,
        *,
        headers: dict[str, str] | None = None,
        path: str = "/api/integrations/vonage/inbound-sms",
        method: str = "POST",
    ) -> None:
        self.headers = _CaseSensitiveHeaders(headers or {})
        self.url = type("URL", (), {"path": path})()
        self.method = method
        self.state = type("State", (), {})()


@pytest.fixture(autouse=True)
def clean_inbox_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    monkeypatch.setenv("UNIVERSAL_AUTOMATION_RUNTIME_DIR", str(runtime_root))
    vonage_dir = runtime_root / "vonage"

    previous_inbox_path = vonage_inbox_service._inbox_path
    previous_audit_path = vonage_inbox_service._audit_path
    previous_dedupe_path = vonage_inbox_service._dedupe_path
    previous_redis_client = vonage_inbox_service._redis_client
    previous_redis_url_cache = vonage_inbox_service._redis_url_cache
    previous_dedupe_mode = vonage_inbox_service._last_dedupe_mode

    vonage_inbox_service._inbox_path = vonage_dir / "inbox.jsonl"
    vonage_inbox_service._audit_path = vonage_dir / "callback-audit.jsonl"
    vonage_inbox_service._dedupe_path = vonage_dir / "seen-message-ids.json"
    vonage_inbox_service._redis_client = None
    vonage_inbox_service._redis_url_cache = ""
    vonage_inbox_service._last_dedupe_mode = "file"
    yield
    vonage_inbox_service._inbox_path = previous_inbox_path
    vonage_inbox_service._audit_path = previous_audit_path
    vonage_inbox_service._dedupe_path = previous_dedupe_path
    vonage_inbox_service._redis_client = previous_redis_client
    vonage_inbox_service._redis_url_cache = previous_redis_url_cache
    vonage_inbox_service._last_dedupe_mode = previous_dedupe_mode


def _signed_payload(secret: str, payload: dict[str, str]) -> dict[str, str]:
    signed = dict(payload)
    signed["timestamp"] = str(int(time.time()))
    data = _build_signature_payload(signed)
    signed["sig"] = hmac.new(
        secret.encode("utf-8"), data.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return signed


def _signed_payload_at(secret: str, payload: dict[str, str], ts: int) -> dict[str, str]:
    signed = dict(payload)
    signed["timestamp"] = str(ts)
    data = _build_signature_payload(signed)
    signed["sig"] = hmac.new(
        secret.encode("utf-8"), data.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return signed


def _request(
    headers: list[tuple[bytes, bytes]] | None = None,
    *,
    path: str = "/api/integrations/vonage/inbound-sms",
    method: str = "POST",
) -> Request:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("utf-8"),
        "query_string": b"",
        "headers": headers or [],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    return Request(scope)


def _jsonl_line_count(path) -> int:
    if not path.exists():
        return 0
    return len(path.read_text(encoding="utf-8").splitlines())


def _last_audit_reason() -> str | None:
    if not vonage_inbox_service._audit_path.exists():
        return None
    records = [
        json.loads(line)
        for line in vonage_inbox_service._audit_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        return None
    return records[-1].get("attrs", {}).get("reason")


def test_inbound_auth_error_keeps_audit_reason() -> None:
    exc = InboundAuthError(detail="x", audit_reason="audit-x")
    assert exc.detail == "x"
    assert exc.status_code == 401
    assert exc.audit_reason == "audit-x"


def test_log_inbound_security_event_structured_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    req = _request()
    req.state.request_id = "req-123"
    calls: dict[str, tuple[str, dict[str, object]]] = {}

    def _warning(msg: str, *, extra: dict[str, object]) -> None:
        calls["warning"] = (msg, extra)

    def _error(msg: str, *, extra: dict[str, object]) -> None:
        calls["error"] = (msg, extra)

    monkeypatch.setattr(vonage_api.logger, "warning", _warning)
    monkeypatch.setattr(vonage_api.logger, "error", _error)
    assert inspect.signature(_log_inbound_security_event).parameters["level"].default == "warning"

    _log_inbound_security_event(
        request=req,
        status_code=401,
        error="invalid inbound token",
        reason="auth_token_invalid",
    )
    warning_msg, warning_extra = calls["warning"]
    assert warning_msg == "vonage inbound rejected"
    assert warning_extra == {
        "request_id": "req-123",
        "trace_id": "req-123",
        "path": "/api/integrations/vonage/inbound-sms",
        "method": "POST",
        "status_code": 401,
        "error": "invalid inbound token",
        "audit_reason": "auth_token_invalid",
    }

    _log_inbound_security_event(
        request=req,
        status_code=503,
        error="strict backend unavailable",
        reason="dedupe_backend_unavailable_strict",
        level="error",
    )
    error_msg, error_extra = calls["error"]
    assert error_msg == "vonage inbound rejected"
    assert error_extra["audit_reason"] == "dedupe_backend_unavailable_strict"
    assert error_extra["status_code"] == 503

    token = vonage_api.REQUEST_ID_CTX.set("ctx-123")
    try:
        req_without_request_id = _request()
        _log_inbound_security_event(
            request=req_without_request_id,
            status_code=401,
            error="missing request id attr",
            reason="auth_token_invalid",
        )
        _, fallback_extra = calls["warning"]
        assert fallback_extra["request_id"] == "ctx-123"
        assert fallback_extra["trace_id"] == "ctx-123"

        req_without_state = _FakeRequest()
        delattr(req_without_state, "state")
        _log_inbound_security_event(
            request=req_without_state,  # type: ignore[arg-type]
            status_code=401,
            error="missing state attr",
            reason="auth_token_invalid",
        )
        _, state_missing_extra = calls["warning"]
        assert state_missing_extra["request_id"] == "ctx-123"
        assert state_missing_extra["trace_id"] == "ctx-123"
    finally:
        vonage_api.REQUEST_ID_CTX.reset(token)


def test_log_inbound_security_event_signature_defaults() -> None:
    sig = inspect.signature(_log_inbound_security_event)
    assert sig.parameters["level"].default == "warning"


def test_resolve_inbound_token_header_fallback_order() -> None:
    assert (
        _resolve_inbound_token(
            _request(headers=[(b"x-vonage-inbound-token", b"token-header-primary")]),
            None,
        )
        == "token-header-primary"
    )

def test_resolve_inbound_token_query_is_rejected() -> None:
    with pytest.raises(InboundAuthError) as exc:
        _resolve_inbound_token(_request(), "query-token")
    assert exc.value.detail == "query token no longer supported; use x-vonage-inbound-token header"
    assert exc.value.audit_reason == "auth_query_token_expired"


def test_resolve_inbound_token_header_names_are_lowercase_exact() -> None:
    request = _FakeRequest(headers={"X-VONAGE-INBOUND-TOKEN": "upper-primary"})
    assert _resolve_inbound_token(request, None) is None

    request = _FakeRequest(headers={"x-vonage-inbound-token": "lower-primary"})
    assert _resolve_inbound_token(request, None) == "lower-primary"


def test_check_inbound_token_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VONAGE_INBOUND_TOKEN", raising=False)
    with pytest.raises(InboundAuthError) as missing:
        _check_inbound_token(None)
    assert missing.value.status_code == 503
    assert missing.value.detail == "vonage inbound token is not configured"
    assert missing.value.audit_reason == "auth_token_not_configured"

    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", " expected-token ")
    _check_inbound_token(" expected-token ")
    with pytest.raises(InboundAuthError) as invalid:
        _check_inbound_token(None)
    assert invalid.value.status_code == 401
    assert invalid.value.detail == "invalid inbound token"
    assert invalid.value.audit_reason == "auth_token_invalid"


def test_check_inbound_token_none_uses_empty_string(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, str]] = []

    def _compare_digest(provided: str, expected: str) -> bool:
        seen.append((provided, expected))
        return False

    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "expected-token")
    monkeypatch.setattr(vonage_api.hmac, "compare_digest", _compare_digest)
    with pytest.raises(InboundAuthError):
        _check_inbound_token(None)
    assert seen == [("", "expected-token")]


def test_load_signature_secret_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VONAGE_SIGNATURE_SECRET", raising=False)
    with pytest.raises(InboundAuthError) as missing:
        _load_signature_secret()
    assert missing.value.status_code == 503
    assert missing.value.detail == "vonage signature secret is not configured"
    assert missing.value.audit_reason == "auth_signature_secret_missing"

    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", " sig-secret ")
    assert _load_signature_secret() == "sig-secret"


def test_build_signature_payload_sanitizes_and_orders() -> None:
    payload = {
        "sig": "must-be-ignored",
        "z": "3",
        "a": "1=2",
        "b": "x&y",
        "none": None,
    }
    assert _build_signature_payload(payload) == "a=1_2&b=x_y&z=3"


def test_verify_signature_defaults_and_timestamp_edges(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = 1_700_000_000
    monkeypatch.setattr(vonage_api.time, "time", lambda: fixed_now)
    monkeypatch.delenv("VONAGE_SIGNATURE_ALGO", raising=False)
    monkeypatch.delenv("VONAGE_SIGNATURE_MAX_SKEW_SECONDS", raising=False)

    payload = _signed_payload_at(
        "sig-secret",
        {"msisdn": "1555", "to": "1888", "text": "Code 111111"},
        fixed_now - 100,
    )
    assert _verify_signature(payload, "sig-secret") is True

    monkeypatch.setenv("VONAGE_SIGNATURE_MAX_SKEW_SECONDS", "60")
    at_boundary = _signed_payload_at(
        "sig-secret",
        {"msisdn": "1555", "to": "1888", "text": "Code 222222"},
        fixed_now - 60,
    )
    assert _verify_signature(at_boundary, "sig-secret") is True

    beyond_boundary = _signed_payload_at(
        "sig-secret",
        {"msisdn": "1555", "to": "1888", "text": "Code 333333"},
        fixed_now - 61,
    )
    assert _verify_signature(beyond_boundary, "sig-secret") is False


def test_verify_signature_uses_expected_env_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    def _env_str(name: str, default: str = "") -> str:
        calls.append((name, default))
        if name == "VONAGE_SIGNATURE_ALGO":
            return default
        if name == "VONAGE_SIGNATURE_MAX_SKEW_SECONDS":
            return default
        raise AssertionError(f"unexpected env lookup: {name}")

    monkeypatch.setattr(vonage_api, "env_str", _env_str)
    payload = _signed_payload_at(
        "sig-secret",
        {"msisdn": "1555", "to": "1888", "text": "Code 101010"},
        int(time.time()),
    )
    assert _verify_signature(payload, "sig-secret") is True
    assert ("VONAGE_SIGNATURE_ALGO", "sha256") in calls
    assert ("VONAGE_SIGNATURE_MAX_SKEW_SECONDS", "600") in calls


def test_verify_signature_respects_skew_env_name(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = 1_700_000_000
    monkeypatch.setattr(vonage_api.time, "time", lambda: fixed_now)
    monkeypatch.setenv("VONAGE_SIGNATURE_ALGO", "sha256")
    monkeypatch.setenv("VONAGE_SIGNATURE_MAX_SKEW_SECONDS", "60")

    payload = _signed_payload_at(
        "sig-secret",
        {"msisdn": "1666", "to": "1999", "text": "Code 444444"},
        fixed_now - 100,
    )
    assert _verify_signature(payload, "sig-secret") is False


def test_vonage_inbound_sms_post_persists_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "Code 123456",
                "messageId": "abc-1",
                "token": "token-123",
            },
        ),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    code = vonage_inbox_service.latest_otp(regex=r"\b(\d{6})\b", to_number="15550001111")
    assert code == "123456"


def test_vonage_inbound_sms_number_normalization_keeps_strict_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "+1 (555) 666-7777",
                "to": "+1 (555) 000-1111",
                "text": "Code 111222",
                "messageId": "abc-normalized-1",
                "token": "token-123",
            },
        ),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    code = vonage_inbox_service.latest_otp(regex=r"\b(\d{6})\b", to_number=15550001111)
    assert code == "111222"

    wrong_number_code = vonage_inbox_service.latest_otp(
        regex=r"\b(\d{6})\b", to_number="15550002222"
    )
    assert wrong_number_code is None


def test_vonage_inbound_sms_get_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-456")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    params = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 654321",
        },
    )
    response = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
    )
    assert response.status_code == 401


def test_vonage_inbound_sms_deduplicates_message_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    inbox_count_before = _jsonl_line_count(vonage_inbox_service._inbox_path)
    audit_count_before = _jsonl_line_count(vonage_inbox_service._audit_path)
    payload = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 123456",
            "messageId": "dup-1",
            "token": "token-123",
        },
    )
    first = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=payload,
    )
    assert first.status_code == 200
    assert first.json().get("duplicate") is not True
    inbox_count_after_first = _jsonl_line_count(vonage_inbox_service._inbox_path)
    audit_count_after_first = _jsonl_line_count(vonage_inbox_service._audit_path)
    dedupe_snapshot_after_first = vonage_inbox_service._dedupe_path.read_text(encoding="utf-8")
    assert inbox_count_after_first == inbox_count_before + 1
    assert audit_count_after_first == audit_count_before + 1

    second = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=payload,
    )
    assert second.status_code == 200
    assert second.json().get("duplicate") is True
    assert _jsonl_line_count(vonage_inbox_service._inbox_path) == inbox_count_after_first
    assert _jsonl_line_count(vonage_inbox_service._audit_path) == audit_count_after_first + 1
    assert (
        vonage_inbox_service._dedupe_path.read_text(encoding="utf-8") == dedupe_snapshot_after_first
    )


def test_vonage_inbound_sms_rejects_invalid_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "secret-1")
    monkeypatch.setenv("VONAGE_SIGNATURE_ALGO", "sha256")
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json={
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 123456",
            "messageId": "sig-1",
            "sig": "invalid-signature",
            "timestamp": "1893456000",
            "api_key": "dummy",
        },
    )
    assert response.status_code == 401


def test_vonage_inbound_sms_rejects_when_token_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("VONAGE_INBOUND_TOKEN", raising=False)
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "Code 123456",
                "messageId": "no-token",
            },
        ),
    )
    assert response.status_code == 503


def test_vonage_inbound_sms_rejects_when_signature_secret_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.delenv("VONAGE_SIGNATURE_SECRET", raising=False)
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json={
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 123456",
            "messageId": "no-secret",
        },
    )
    assert response.status_code == 503


def test_vonage_inbound_sms_rejects_unsupported_signature_algo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    monkeypatch.setenv("VONAGE_SIGNATURE_ALGO", "md5")
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "Code 123456",
                "messageId": "bad-algo",
                "token": "token-123",
            },
        ),
    )
    assert response.status_code == 400
    detail = response.json().get("detail", "")
    assert "unsupported Vonage signature algorithm" in detail
    assert "md5" in detail


def test_vonage_inbound_sms_header_token_takes_precedence_over_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.post(
        "/api/integrations/vonage/inbound-sms?token=wrong-query-token",
        headers={"x-vonage-inbound-token": "token-123"},
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "Code 999888",
                "messageId": "header-precedence",
                "token": "wrong-query-token",
            },
        ),
    )
    assert response.status_code == 200


def test_vonage_inbound_sms_query_token_blocked_after_compat_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.post(
        "/api/integrations/vonage/inbound-sms?token=token-123",
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "Code 555444",
                "messageId": "compat-window",
            },
        ),
    )
    assert response.status_code == 401
    assert "query token no longer supported" in response.json()["detail"]


def test_vonage_inbound_sms_respects_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    import apps.api.app.core.access_control as access_control

    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    access_control.reset_for_tests()
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 1)

    payload = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 111000",
            "messageId": "rate-limit-1",
        },
    )
    first = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=payload,
    )
    second = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=payload,
    )
    assert first.status_code == 200
    assert second.status_code == 429


def test_vonage_inbound_sms_query_token_is_rejected_without_compat_window() -> None:
    response = client.post(
        "/api/integrations/vonage/inbound-sms?token=token-123",
        json={"msisdn": "15556667777", "to": "15550001111", "text": "Code 888999"},
    )
    assert response.status_code == 401
    assert "query token no longer supported" in response.json()["detail"]


def test_verify_signature_rejects_missing_sig_and_invalid_timestamp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_SIGNATURE_ALGO", "sha256")
    assert _verify_signature({"text": "hello"}, "sig-secret") is False
    assert (
        _verify_signature({"text": "hello", "sig": "abcd", "timestamp": "not-int"}, "sig-secret")
        is False
    )


def test_verify_signature_missing_sig_short_circuits_before_env_lookups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _env_str(name: str, default: str = "") -> str:
        raise AssertionError(f"env lookup should not happen when sig is missing: {name}")

    monkeypatch.setattr(vonage_api, "env_str", _env_str)
    assert _verify_signature({"text": "hello"}, "sig-secret") is False


def test_vonage_inbound_sms_get_accepts_valid_signed_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    params = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 765432",
            "messageId": "get-ok-1",
        },
    )
    response = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["message_id"] == "get-ok-1"


def test_vonage_inbound_sms_post_rejects_empty_text_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "   ",
                "messageId": "empty-text-post",
            },
        ),
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "empty text payload"


def test_vonage_inbound_sms_post_dedupe_backend_unavailable_in_strict_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    monkeypatch.setenv("REDIS_URL", "redis://invalid")
    monkeypatch.setenv("OTP_DEDUPE_STRICT", "true")

    def _raise_redis_unavailable(_: str):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(vonage_inbox_service, "_create_redis_client", _raise_redis_unavailable)
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=_signed_payload(
            "sig-secret",
            {
                "msisdn": "15556667777",
                "to": "15550001111",
                "text": "Code 343434",
                "messageId": "strict-failure-1",
            },
        ),
    )
    assert response.status_code == 503
    assert "OTP dedupe backend unavailable" in response.json()["detail"]


def test_vonage_inbound_sms_get_uses_degraded_dedupe_reasons(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    monkeypatch.setenv("REDIS_URL", "redis://invalid")
    monkeypatch.delenv("OTP_DEDUPE_STRICT", raising=False)

    def _raise_redis_unavailable(_: str):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(vonage_inbox_service, "_create_redis_client", _raise_redis_unavailable)
    params = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 556677",
            "messageId": "get-degraded-1",
        },
    )
    first = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert first.status_code == 200
    assert _last_audit_reason() == "stored_degraded"

    second = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert second.status_code == 200
    assert second.json()["duplicate"] is True
    assert _last_audit_reason() == "message_id_seen_degraded"


def test_vonage_inbound_sms_get_rejects_invalid_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    response = client.get(
        "/api/integrations/vonage/inbound-sms",
        params={
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 909090",
            "messageId": "get-invalid-signature",
            "sig": "invalid",
            "timestamp": str(int(time.time())),
        },
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid Vonage signature"


def test_vonage_inbound_sms_get_rejects_empty_text_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    params = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "   ",
            "messageId": "get-empty-text",
        },
    )
    response = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "empty text payload"


def test_vonage_inbound_sms_get_without_message_id_skips_dedupe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    params = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 456123",
        },
    )
    response = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert response.status_code == 200
    assert response.json()["message_id"] is None


def test_vonage_inbound_sms_get_dedupe_backend_unavailable_in_strict_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    monkeypatch.setenv("REDIS_URL", "redis://invalid")
    monkeypatch.setenv("OTP_DEDUPE_STRICT", "true")

    def _raise_redis_unavailable(_: str):
        raise RuntimeError("redis unavailable")

    monkeypatch.setattr(vonage_inbox_service, "_create_redis_client", _raise_redis_unavailable)
    params = _signed_payload(
        "sig-secret",
        {
            "msisdn": "15556667777",
            "to": "15550001111",
            "text": "Code 121212",
            "messageId": "get-strict-failure-1",
        },
    )
    response = client.get(
        "/api/integrations/vonage/inbound-sms",
        params=params,
        headers={"x-vonage-inbound-token": "token-123"},
    )
    assert response.status_code == 503
    assert "OTP dedupe backend unavailable" in response.json()["detail"]


def test_vonage_inbound_sms_post_without_message_id_skips_dedupe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("VONAGE_INBOUND_TOKEN", "token-123")
    monkeypatch.setenv("VONAGE_SIGNATURE_SECRET", "sig-secret")
    payload = {
        "msisdn": "15556667777",
        "to": "15550001111",
        "text": "Code 787878",
    }
    payload["sig"] = hmac.new(
        b"sig-secret",
        _build_signature_payload(payload).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    response = client.post(
        "/api/integrations/vonage/inbound-sms",
        headers={"x-vonage-inbound-token": "token-123"},
        json=payload,
    )
    assert response.status_code == 200
    assert response.json()["message_id"] is None


def test_vonage_read_positive_int_env_invalid_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VONAGE_AUDIT_BACKUP_COUNT", "invalid")
    assert (
        vonage_inbox_service._read_positive_int_env(
            "VONAGE_AUDIT_BACKUP_COUNT", default=4, minimum=1
        )
        == 4
    )


def test_vonage_append_message_reports_write_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    target_path = vonage_inbox_service._inbox_path
    original_open = Path.open

    def _raise_open(self: Path, *args: object, **kwargs: object):
        if self == target_path:
            raise OSError("disk full")
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", _raise_open)
    before = vonage_inbox_service._write_failures.get("inbox", 0)
    with pytest.raises(OSError):
        vonage_inbox_service.append_message(
            vonage_inbox_service.from_payload(
                {"msisdn": "15556667777", "to": "15550001111", "text": "Code 112233"}
            )
        )
    assert vonage_inbox_service._write_failures["inbox"] == before + 1


def test_vonage_register_message_id_redis_success_path(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeRedis:
        def __init__(self) -> None:
            self.calls = 0

        def set(self, *_args, **_kwargs):
            self.calls += 1
            return self.calls == 1

    fake = FakeRedis()
    monkeypatch.setenv("REDIS_URL", "redis://unit-test")
    monkeypatch.setenv("OTP_DEDUPE_REDIS_PREFIX", "otp:test")
    monkeypatch.setattr(vonage_inbox_service, "_create_redis_client", lambda _url: fake)
    vonage_inbox_service._redis_client = None
    vonage_inbox_service._redis_url_cache = ""

    assert vonage_inbox_service.register_message_id("msg-redis", 30) is True
    assert vonage_inbox_service.register_message_id("msg-redis", 30) is False
    assert vonage_inbox_service.last_dedupe_mode == "redis"


def test_vonage_latest_otp_invalid_regex_and_sender_filter_paths() -> None:
    now = datetime.now(timezone.utc).isoformat()
    vonage_inbox_service._inbox_path.parent.mkdir(parents=True, exist_ok=True)
    vonage_inbox_service._inbox_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "from_number": "15551230000",
                        "to_number": "15550001111",
                        "text": "Code 998877",
                        "received_at": now,
                    }
                ),
                "{ invalid-json",
            ]
        ),
        encoding="utf-8",
    )
    assert vonage_inbox_service.latest_otp(regex="(", to_number="15550001111") is None
    assert (
        vonage_inbox_service.latest_otp(
            regex=r"\b(\d{6})\b",
            to_number="15550009999",
            sender_filter="not-present",
        )
        is None
    )


def test_vonage_prune_jsonl_history_removes_expired_backups(tmp_path: Path) -> None:
    target = tmp_path / "callback-audit.jsonl"
    backup = tmp_path / "callback-audit.jsonl.1"
    target.write_text("live", encoding="utf-8")
    backup.write_text("old", encoding="utf-8")
    old_timestamp = time.time() - (10 * 24 * 60 * 60)
    os.utime(backup, (old_timestamp, old_timestamp))
    vonage_inbox_service._prune_jsonl_history(target, backup_count=1, retention_days=1)
    assert target.exists()
    assert not backup.exists()
