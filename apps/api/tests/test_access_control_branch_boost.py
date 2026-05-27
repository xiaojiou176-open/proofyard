from __future__ import annotations

from collections import deque
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import apps.api.app.core.access_control as access_control


def _make_request(
    client_host: str | None = "127.0.0.1",
    *,
    headers: dict[str, str] | None = None,
    path: str = "/api/sessions",
    method: str = "GET",
) -> Request:
    encoded_headers = [
        (key.lower().encode("utf-8"), value.encode("utf-8"))
        for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": encoded_headers,
            "scheme": "http",
            "server": ("testserver", 80),
            "client": (client_host, 12345) if client_host is not None else None,
            "http_version": "1.1",
        }
    )


@pytest.fixture(autouse=True)
def _reset_access_control_state(monkeypatch: pytest.MonkeyPatch) -> None:
    access_control.reset_for_tests()
    for env_key in (
        "AUTOMATION_ALLOW_LOCAL_NO_TOKEN",
        "APP_ENV",
        "AUTOMATION_REQUIRE_TOKEN",
        "AUTOMATION_API_TOKEN",
        "REDIS_URL",
    ):
        monkeypatch.delenv(env_key, raising=False)
    yield
    access_control.reset_for_tests()


def test_allow_local_no_token_rejects_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "production")

    with pytest.raises(HTTPException) as exc_info:
        access_control._allow_local_no_token(_make_request("127.0.0.1"))

    assert exc_info.value.status_code == 503
    assert "must be false in production" in str(exc_info.value.detail)


def test_allow_local_no_token_accepts_loopback_in_test_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "test")

    assert access_control._allow_local_no_token(_make_request("127.0.0.1")) is True


def test_check_token_allows_missing_token_when_requirement_disabled_non_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "false")
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "false")
    monkeypatch.setenv("APP_ENV", "test")

    assert access_control.check_token(_make_request("10.0.0.8"), None) is None


def test_requester_id_returns_client_ip_without_client_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)

    assert access_control.requester_id(_make_request("10.0.0.8"), None) == "10.0.0.8"


def test_create_redis_client_uses_redis_from_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class FakeRedisClient:
        @staticmethod
        def from_url(url: str, *, decode_responses: bool):
            captured["url"] = url
            captured["decode_responses"] = decode_responses
            return "fake-client"

    fake_module = SimpleNamespace(Redis=FakeRedisClient)
    monkeypatch.setitem(__import__("sys").modules, "redis", fake_module)

    assert access_control._create_redis_client("redis://example.local/0") == "fake-client"
    assert captured == {"url": "redis://example.local/0", "decode_responses": True}


def test_client_helpers_and_request_trace_id(monkeypatch: pytest.MonkeyPatch) -> None:
    req_unknown = _make_request(None)
    assert access_control._client_ip(req_unknown) == "unknown"
    assert access_control._is_loopback_client(_make_request("localhost")) is True

    req_with_id = _make_request(headers={"x-automation-client-id": " cid-1 "})
    assert access_control._client_id(req_with_id) == "cid-1"

    req_with_state = _make_request("10.0.0.8")
    req_with_state.state.request_id = "state-rid"
    assert access_control._request_trace_id(req_with_state) == "state-rid"

    token = access_control.REQUEST_ID_CTX.set("ctx-rid")
    try:
        assert access_control._request_trace_id(_make_request("10.0.0.8")) == "ctx-rid"
    finally:
        access_control.REQUEST_ID_CTX.reset(token)

    token = access_control.REQUEST_ID_CTX.set(None)
    try:
        assert access_control._request_trace_id(_make_request("10.0.0.8")) == "-"
    finally:
        access_control.REQUEST_ID_CTX.reset(token)


def test_is_local_client_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _make_request("127.0.0.1")
    assert access_control._is_local_client(req) is False
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "yes")
    assert access_control._is_local_client(req) is True


def test_validate_local_no_token_config_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "on")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as exc_info:
        access_control._validate_local_no_token_config()
    assert exc_info.value.status_code == 503

    monkeypatch.setenv("APP_ENV", "development")
    access_control._validate_local_no_token_config()


def test_required_client_id_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _make_request("8.8.8.8", headers={"x-automation-client-id": "x-1"})
    assert access_control._required_client_id(req) == "x-1"

    captured: dict[str, object] = {}

    def _fake_log_auth_rejection(request: Request, **kwargs) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(access_control, "_log_auth_rejection", _fake_log_auth_rejection)
    with pytest.raises(HTTPException) as exc_info:
        access_control._required_client_id(_make_request("8.8.8.8"))
    assert exc_info.value.status_code == 400
    assert captured["audit_reason"] == "auth_client_id_missing"


@pytest.mark.parametrize("raw", ["0", "false", "NO", "off"])
def test_token_required_false_values(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", raw)
    assert access_control._token_required() is False


def test_token_required_defaults_true(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AUTOMATION_REQUIRE_TOKEN", raising=False)
    assert access_control._token_required() is True


def test_configured_automation_token_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    assert access_control._configured_automation_token() is None

    monkeypatch.setenv("AUTOMATION_API_TOKEN", "test-token")
    assert access_control._configured_automation_token() == "test-token"

    monkeypatch.setenv("AUTOMATION_API_TOKEN", "default")
    with pytest.raises(HTTPException) as weak_exc:
        access_control._configured_automation_token()
    assert weak_exc.value.status_code == 503

    monkeypatch.setenv("AUTOMATION_API_TOKEN", "replace-custom-token")
    with pytest.raises(HTTPException) as replace_exc:
        access_control._configured_automation_token()
    assert replace_exc.value.status_code == 503

    monkeypatch.setenv("AUTOMATION_API_TOKEN", "short-token")
    with pytest.raises(HTTPException) as short_exc:
        access_control._configured_automation_token()
    assert short_exc.value.status_code == 401

    monkeypatch.setenv("AUTOMATION_API_TOKEN", "strong-token-123456789")
    assert access_control._configured_automation_token() == "strong-token-123456789"


def test_requester_id_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    request = _make_request("8.8.8.8", headers={"x-automation-client-id": "pytest-client"})
    token_actor = access_control.requester_id(request, "validated-token")
    assert token_actor.startswith("token:")
    assert len(token_actor) == len("token:") + 16

    monkeypatch.setenv("AUTOMATION_API_TOKEN", "strong-token-123456789")
    assert access_control.requester_id(request, None) == "token:anonymous"

    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    assert access_control.requester_id(request, None) == "8.8.8.8:pytest-client"
    assert access_control.requester_id(_make_request("8.8.8.8"), None) == "8.8.8.8"


def test_log_auth_rejection_includes_expected_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def _fake_warning(message: str, *, extra: dict[str, object]) -> None:
        captured["message"] = message
        captured["extra"] = extra

    monkeypatch.setattr(access_control.logger, "warning", _fake_warning)
    req = _make_request("8.8.8.8", path="/api/automation/commands", method="POST")
    req.state.request_id = "req-1"

    access_control._log_auth_rejection(
        req,
        status_code=401,
        error="invalid automation token",
        audit_reason="auth_token_invalid",
    )

    assert captured["message"] == "automation auth rejected"
    extra = captured["extra"]
    assert extra["request_id"] == "req-1"
    assert extra["trace_id"] == "req-1"
    assert extra["path"] == "/api/automation/commands"
    assert extra["method"] == "POST"
    assert extra["status_code"] == 401
    assert extra["audit_reason"] == "auth_token_invalid"


def test_check_token_expected_token_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "strong-token-123456789")
    request = _make_request("8.8.8.8", headers={"x-automation-client-id": "pytest-client"})

    with pytest.raises(HTTPException) as invalid_exc:
        access_control.check_token(request, "wrong-token")
    assert invalid_exc.value.status_code == 401

    with pytest.raises(HTTPException) as missing_client_exc:
        access_control.check_token(_make_request("8.8.8.8"), "strong-token-123456789")
    assert missing_client_exc.value.status_code == 400

    assert access_control.check_token(request, "strong-token-123456789") == "strong-token-123456789"

    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "false")
    assert access_control.check_token(_make_request("8.8.8.8"), None) is None

    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "true")
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    with pytest.raises(HTTPException) as non_local_exc:
        access_control.check_token(_make_request("8.8.8.8"), None)
    assert non_local_exc.value.status_code == 401
    assert "non-local client" in str(non_local_exc.value.detail)

    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "false")
    with pytest.raises(HTTPException) as missing_exc:
        access_control.check_token(_make_request("8.8.8.8"), None)
    assert missing_exc.value.status_code == 401


def test_check_token_without_configured_token_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(HTTPException) as token_config_exc:
        access_control.check_token(_make_request("8.8.8.8"), "any-token")
    assert token_config_exc.value.status_code == 503

    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    assert access_control.check_token(_make_request("127.0.0.1"), None) is None

    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "false")
    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "false")
    assert access_control.check_token(_make_request("8.8.8.8"), None) is None

    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "true")
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    with pytest.raises(HTTPException) as non_local_exc:
        access_control.check_token(_make_request("8.8.8.8"), None)
    assert non_local_exc.value.status_code == 401
    assert "non-local client" in str(non_local_exc.value.detail)

    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "false")
    with pytest.raises(HTTPException) as invalid_exc:
        access_control.check_token(_make_request("8.8.8.8"), None)
    assert invalid_exc.value.status_code == 401


def test_check_token_rejects_invalid_local_no_token_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "true")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as exc_info:
        access_control.check_token(_make_request("127.0.0.1"), None)
    assert exc_info.value.status_code == 503


def test_rate_limit_identity_branches() -> None:
    request_with_id = _make_request("8.8.8.8", headers={"x-automation-client-id": "pytest-client"})
    identity = access_control._rate_limit_identity(request_with_id, "validated-token")
    assert identity.startswith("token:")
    assert len(identity) == len("token:") + 16

    with pytest.raises(HTTPException) as missing_client_exc:
        access_control._rate_limit_identity(_make_request("8.8.8.8"), "validated-token")
    assert missing_client_exc.value.status_code == 400

    assert access_control._rate_limit_identity(request_with_id, None) == "8.8.8.8:pytest-client"
    assert access_control._rate_limit_identity(_make_request("8.8.8.8"), None) == "8.8.8.8"


def test_check_rate_limit_via_redis_without_url_returns_false() -> None:
    assert access_control._check_rate_limit_via_redis(_make_request("8.8.8.8")) is False


def test_check_rate_limit_via_redis_success_and_cache_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://example.local/0")

    class AllowRedis:
        def __init__(self):
            self.calls = 0

        def eval(self, *_args):
            self.calls += 1
            return 1

    created: list[AllowRedis] = []

    def _create(_url: str) -> AllowRedis:
        client = AllowRedis()
        created.append(client)
        return client

    monkeypatch.setattr(access_control, "_create_redis_client", _create)
    assert access_control._check_rate_limit_via_redis(_make_request("8.8.8.8")) is True
    assert len(created) == 1
    assert access_control._REDIS_URL_CACHE == "redis://example.local/0"

    existing = created[0]
    monkeypatch.setattr(access_control, "_create_redis_client", lambda _url: pytest.fail("unexpected"))
    access_control._REDIS_CLIENT = existing
    assert access_control._check_rate_limit_via_redis(_make_request("8.8.8.8")) is True
    assert existing.calls == 2

    monkeypatch.setattr(access_control, "_create_redis_client", _create)
    monkeypatch.setenv("REDIS_URL", "redis://example.local/1")
    assert access_control._check_rate_limit_via_redis(_make_request("8.8.8.8")) is True
    assert len(created) == 2
    assert access_control._REDIS_URL_CACHE == "redis://example.local/1"


def test_check_rate_limit_via_redis_block_and_degrade(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REDIS_URL", "redis://example.local/0")

    blocked_metric: list[int] = []
    redis_error_metric: list[int] = []
    exception_logs: list[dict[str, object]] = []

    monkeypatch.setattr(
        access_control.runtime_metrics, "record_rate_limited", lambda: blocked_metric.append(1)
    )
    monkeypatch.setattr(
        access_control.runtime_metrics,
        "record_rate_limit_redis_error",
        lambda: redis_error_metric.append(1),
    )
    monkeypatch.setattr(
        access_control.logger,
        "exception",
        lambda _msg, **kwargs: exception_logs.append(kwargs),
    )

    class BlockRedis:
        def eval(self, *_args):
            return 0

    access_control._REDIS_CLIENT = BlockRedis()
    access_control._REDIS_URL_CACHE = "redis://example.local/0"
    with pytest.raises(HTTPException) as blocked_exc:
        access_control._check_rate_limit_via_redis(_make_request("8.8.8.8"))
    assert blocked_exc.value.status_code == 429
    assert blocked_metric == [1]

    class BrokenRedis:
        def eval(self, *_args):
            raise RuntimeError("redis-down")

    access_control._REDIS_CLIENT = BrokenRedis()
    access_control._REDIS_URL_CACHE = "redis://example.local/0"
    assert access_control._check_rate_limit_via_redis(_make_request("8.8.8.8")) is False
    assert redis_error_metric == [1]
    assert exception_logs


def test_check_rate_limit_in_memory_cleanup_and_window(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 1_000.0
    monkeypatch.setattr(access_control.time, "time", lambda: now)
    monkeypatch.setattr(access_control, "_MAX_RATE_BUCKETS", 1)
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 10)

    with access_control._RATE_LOCK:
        access_control._RATE_BUCKETS.clear()
        access_control._RATE_BUCKETS["stale-empty"] = deque()
        access_control._RATE_BUCKETS["older"] = deque([now - 10])
        access_control._RATE_BUCKETS["newer"] = deque([now - 5])

    access_control._check_rate_limit_in_memory(_make_request("8.8.8.8"))

    with access_control._RATE_LOCK:
        assert "stale-empty" not in access_control._RATE_BUCKETS
        assert any(key in access_control._RATE_BUCKETS for key in ("older", "newer"))

    target = "8.8.8.8:/api/sessions"
    with access_control._RATE_LOCK:
        access_control._RATE_BUCKETS[target] = deque([now - 120])
    access_control._check_rate_limit_in_memory(_make_request("8.8.8.8"))
    with access_control._RATE_LOCK:
        assert list(access_control._RATE_BUCKETS[target]) == [now]


def test_check_rate_limit_in_memory_raises_on_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 2_000.0
    monkeypatch.setattr(access_control.time, "time", lambda: now)
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 1)
    blocked_metric: list[int] = []
    monkeypatch.setattr(
        access_control.runtime_metrics, "record_rate_limited", lambda: blocked_metric.append(1)
    )

    key = "8.8.8.8:/api/sessions"
    with access_control._RATE_LOCK:
        access_control._RATE_BUCKETS.clear()
        access_control._RATE_BUCKETS[key] = deque([now - 1])

    with pytest.raises(HTTPException) as exc_info:
        access_control._check_rate_limit_in_memory(_make_request("8.8.8.8"))
    assert exc_info.value.status_code == 429
    assert blocked_metric == [1]


def test_check_rate_limit_dispatches_between_redis_and_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    in_memory_calls: list[tuple[Request, str | None]] = []
    monkeypatch.setattr(access_control, "_check_rate_limit_via_redis", lambda *_args: True)
    monkeypatch.setattr(
        access_control,
        "_check_rate_limit_in_memory",
        lambda request, validated_token=None: in_memory_calls.append((request, validated_token)),
    )
    access_control.check_rate_limit(_make_request("8.8.8.8"), "tok")
    assert in_memory_calls == []

    monkeypatch.setattr(access_control, "_check_rate_limit_via_redis", lambda *_args: False)
    access_control.check_rate_limit(_make_request("8.8.8.8"), "tok")
    assert len(in_memory_calls) == 1
    assert in_memory_calls[0][1] == "tok"


def test_require_access_require_actor_and_aliases(monkeypatch: pytest.MonkeyPatch) -> None:
    req = _make_request("8.8.8.8")
    calls: dict[str, object] = {}

    monkeypatch.setattr(access_control, "check_token", lambda _request, _token: "validated")
    monkeypatch.setattr(
        access_control,
        "check_rate_limit",
        lambda _request, _validated_token=None: calls.setdefault("rate", _validated_token),
    )
    monkeypatch.setattr(
        access_control, "requester_id", lambda _request, validated_token=None: f"actor:{validated_token}"
    )

    assert access_control.require_rate_limit(req, "validated") is None
    assert calls["rate"] == "validated"

    assert access_control.require_access(req, "header-token") == "validated"
    assert access_control.require_actor(req, "header-token") == "actor:validated"


def test_reset_for_tests_clears_global_state() -> None:
    access_control._REDIS_CLIENT = object()
    access_control._REDIS_URL_CACHE = "redis://example.local/0"
    with access_control._RATE_LOCK:
        access_control._RATE_BUCKETS["k"] = deque([1.0])

    access_control.reset_for_tests()
    assert access_control._REDIS_CLIENT is None
    assert access_control._REDIS_URL_CACHE == ""
    with access_control._RATE_LOCK:
        assert access_control._RATE_BUCKETS == {}
