from __future__ import annotations

from collections import deque

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import apps.api.app.core.access_control as access_control


def _make_request(
    client_host: str | None,
    headers: list[tuple[bytes, bytes]] | None = None,
    path: str = "/api/sessions",
) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": headers or [],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": (client_host, 12345) if client_host is not None else None,
            "http_version": "1.1",
        }
    )


def test_client_ip_returns_unknown_without_client() -> None:
    request = _make_request(None)
    assert access_control._client_ip(request) == "unknown"


def test_check_token_rejects_supplied_token_when_server_token_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AUTOMATION_API_TOKEN", raising=False)
    monkeypatch.setenv("AUTOMATION_REQUIRE_TOKEN", "true")
    monkeypatch.setenv("AUTOMATION_ALLOW_LOCAL_NO_TOKEN", "false")

    with pytest.raises(HTTPException) as exc_info:
        access_control.check_token(_make_request("10.0.0.8"), "rogue-token")

    assert exc_info.value.status_code == 503
    assert "required in production-like environments" in str(exc_info.value.detail)


def test_check_rate_limit_short_circuits_when_redis_allows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = _make_request("10.0.0.8")
    monkeypatch.setattr(access_control, "_check_rate_limit_via_redis", lambda *_: True)
    in_memory_called = {"called": False}

    def _in_memory(*_args, **_kwargs):
        in_memory_called["called"] = True

    monkeypatch.setattr(access_control, "_check_rate_limit_in_memory", _in_memory)

    access_control.check_rate_limit(request, None)
    assert in_memory_called["called"] is False


def test_rate_limit_identity_includes_client_id_header() -> None:
    request = _make_request(
        "10.0.0.8",
        headers=[(b"x-automation-client-id", b"client-123")],
    )
    assert access_control._rate_limit_identity(request, None) == "10.0.0.8:client-123"


def test_in_memory_rate_limit_prunes_stale_buckets_when_bucket_limit_is_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access_control.reset_for_tests()
    monkeypatch.setattr(access_control, "_MAX_RATE_BUCKETS", 1)
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 5)
    monkeypatch.setattr(access_control.time, "time", lambda: 120.0)

    access_control._RATE_BUCKETS["stale-key"] = deque([10.0])
    access_control._RATE_BUCKETS["fresh-key"] = deque([110.0])

    request = _make_request(
        "10.0.0.8",
        headers=[(b"x-automation-client-id", b"client-456")],
        path="/api/templates",
    )
    route_key = f"10.0.0.8:client-456:{request.url.path}"
    access_control._RATE_BUCKETS[route_key] = deque([10.0, 61.0, 80.0])

    access_control._check_rate_limit_in_memory(request, None)

    assert "stale-key" not in access_control._RATE_BUCKETS
    assert route_key in access_control._RATE_BUCKETS
    assert list(access_control._RATE_BUCKETS[route_key]) == [120.0]


def test_in_memory_rate_limit_prunes_old_entries_within_active_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access_control.reset_for_tests()
    monkeypatch.setattr(access_control, "_MAX_RATE_BUCKETS", 5)
    monkeypatch.setattr(access_control, "_RATE_LIMIT_PER_MINUTE", 5)
    monkeypatch.setattr(access_control.time, "time", lambda: 120.0)

    request = _make_request(
        "10.0.0.8",
        headers=[(b"x-automation-client-id", b"client-789")],
        path="/api/templates",
    )
    route_key = f"10.0.0.8:client-789:{request.url.path}"
    access_control._RATE_BUCKETS[route_key] = deque([10.0, 61.0, 80.0])

    access_control._check_rate_limit_in_memory(request, None)

    assert list(access_control._RATE_BUCKETS[route_key]) == [61.0, 80.0, 120.0]
