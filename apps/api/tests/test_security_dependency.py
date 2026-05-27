from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from starlette.requests import Request

import apps.api.app.core.access_control as access_control
from apps.api.app.main import app


@pytest.fixture(autouse=True)
def reset_security_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUTOMATION_API_TOKEN", "security-token-123456")
    access_control.reset_for_tests()


def test_require_automation_access_rate_limit_uses_verified_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from apps.api.app.api.dependencies import security as security_dep

    captured: dict[str, str | None] = {"validated_token": None}

    def fake_rate_limit(request, validated_token: str | None = None) -> None:
        captured["validated_token"] = validated_token

    monkeypatch.setattr(security_dep, "check_rate_limit", fake_rate_limit)
    client = TestClient(app)

    response = client.get(
        "/api/sessions",
        params={"limit": 1},
        headers={
            "x-automation-token": "security-token-123456",
            "x-automation-client-id": "security-test-client",
        },
    )

    assert response.status_code == 200
    assert captured["validated_token"] == "security-token-123456"


def test_require_automation_access_uses_unknown_host_when_request_client_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from apps.api.app.api.dependencies import security as security_dep

    def fake_check_token(request: Request, token: str | None) -> str | None:
        return token

    def fake_check_rate_limit(request: Request, validated_token: str | None = None) -> None:
        return None

    def fake_requester_id(request: Request, token: str | None) -> str:
        return f"actor:{token or 'none'}"

    monkeypatch.setattr(security_dep, "check_token", fake_check_token)
    monkeypatch.setattr(security_dep, "check_rate_limit", fake_check_rate_limit)
    monkeypatch.setattr(security_dep, "requester_id", fake_requester_id)

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/sessions",
            "raw_path": b"/api/sessions",
            "query_string": b"",
            "headers": [],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": None,
            "http_version": "1.1",
        }
    )

    context = security_dep.require_automation_access(
        request,
        x_automation_token="security-token-123456",
        x_automation_client_id="",
    )

    assert context.client_host == "unknown"
    assert context.actor == "actor:security-token-123456"
    assert context.verified_actor == "actor:security-token-123456"
    assert context.client_id is None


def test_require_automation_access_requires_client_id_for_overview_with_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from apps.api.app.api.dependencies import security as security_dep

    monkeypatch.setattr(security_dep, "check_token", lambda _req, token: token)
    monkeypatch.setattr(security_dep, "check_rate_limit", lambda _req, _validated_token=None: None)
    monkeypatch.setattr(
        security_dep, "requester_id", lambda _req, token: f"actor:{token or 'none'}"
    )

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/command-tower/overview",
            "raw_path": b"/api/command-tower/overview",
            "query_string": b"",
            "headers": [],
            "scheme": "http",
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 12345),
            "http_version": "1.1",
        }
    )

    with pytest.raises(HTTPException) as exc_info:
        security_dep.require_automation_access(
            request,
            x_automation_token="security-token-123456",
            x_automation_client_id=" ",
        )

    assert exc_info.value.status_code == 400
    assert "x-automation-client-id" in str(exc_info.value.detail)
