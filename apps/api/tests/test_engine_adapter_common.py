from __future__ import annotations

import json

import pytest

from apps.api.app.services.engine_adapters import common


class _FakeResponse:
    def __init__(self, status: int, payload: str) -> None:
        self.status = status
        self._payload = payload

    def read(self) -> bytes:
        return self._payload.encode("utf-8")


class _FakeConnection:
    def __init__(self, *args, **kwargs) -> None:
        self.response = _FakeResponse(200, '{"steps": [{"action": "navigate", "confidence": 0.9}]}')
        self.closed = False

    def request(self, method: str, path: str, body: bytes, headers: dict[str, str]) -> None:
        assert method == "POST"
        assert path.startswith("/")
        assert headers["Content-Type"] == "application/json"
        assert isinstance(body, bytes)

    def getresponse(self) -> _FakeResponse:
        return self.response

    def close(self) -> None:
        self.closed = True


class _FakeErrorConnection(_FakeConnection):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.response = _FakeResponse(500, '{"error":"boom"}')


def _payload() -> common.EngineInput:
    return common.EngineInput(
        start_url="https://example.com/register",
        har_entries=[
            {"method": "GET", "url": "https://example.com/assets/app.css", "status": 200},
            {"method": "POST", "url": "https://example.com/api/register", "status": 201},
        ],
        html_content="<input name='email'><input type='password'><button type='submit'>Go</button>",
        extractor_strategy="balanced",
    )


def test_pick_primary_entry_prefers_actionable_request() -> None:
    picked = common.pick_primary_entry(_payload().har_entries)
    assert picked is not None
    assert picked["method"] == "POST"


def test_pick_primary_entry_empty_returns_none() -> None:
    assert common.pick_primary_entry([]) is None


def test_score_entry_handles_url_absent_and_static_assets() -> None:
    assert common._score_entry({"method": "POST", "url": "", "status": 200}, None) == -999
    static_score = common._score_entry(
        {"method": "GET", "url": "https://example.com/a.js", "status": 200}, "example.com"
    )
    assert static_score < 0


def test_score_entry_covers_non_get_non_mutating_branch_paths() -> None:
    score = common._score_entry(
        {"method": "OPTIONS", "url": "https://edge.example.com/register", "status": 500},
        "api.example.com",
    )
    # Non-GET and non-mutating method should skip method bonus; keyword in path still contributes.
    assert score == 10


def test_pick_primary_entry_skips_empty_urls_before_selecting_host() -> None:
    picked = common.pick_primary_entry(
        [
            {"method": "POST", "url": "https://example.com/api/register", "status": 201},
            {"method": "GET", "url": "", "status": 200},
            {"method": "GET", "url": "", "status": 200},
        ]
    )
    assert picked is not None
    assert picked["url"] == "https://example.com/api/register"


def test_selector_from_html_variants() -> None:
    html = "<input name='email'><input name='password'><button type='submit'>Submit</button>"
    assert common._selector_from_html(html, "email")["selectors"][0]["value"] == "[name='email']"
    assert (
        common._selector_from_html(html, "password")["selectors"][0]["value"] == "[name='password']"
    )
    assert (
        common._selector_from_html(html, "submit")["selectors"][0]["value"]
        == "button[type='submit']"
    )
    assert common._selector_from_html("<html></html>", "unknown") == {"selectors": []}


def test_selector_from_html_fallback_variants() -> None:
    html = "<input type='email'><input type='password'><button>Go</button>"
    assert (
        common._selector_from_html(html, "email")["selectors"][0]["value"] == "input[type='email']"
    )
    assert (
        common._selector_from_html(html, "password")["selectors"][0]["value"]
        == "input[type='password']"
    )
    assert (
        common._selector_from_html(html, "submit")["selectors"][0]["value"]
        == "button[name='Submit']"
    )


def test_build_heuristic_steps_with_no_primary_adds_manual_gate() -> None:
    payload = common.EngineInput(
        start_url="https://example.com",
        har_entries=[],
        html_content="",
        extractor_strategy="strict",
    )
    steps = common.build_heuristic_steps("engine-a", payload, 0.7)
    assert steps[0]["action"] == "navigate"
    assert steps[-1]["action"] == "manual_gate"
    assert steps[-1]["manual_handoff_required"] is True


def test_build_heuristic_steps_with_primary_creates_flow_steps() -> None:
    steps = common.build_heuristic_steps("engine-a", _payload(), 0.8)
    actions = [step["action"] for step in steps]
    assert actions == ["navigate", "type", "type", "click", "assert"]


def test_parse_remote_endpoint_rejects_non_https_or_private_or_unallowed(monkeypatch) -> None:
    monkeypatch.setattr(
        common,
        "env_str",
        lambda key, default="": "api.example.com"
        if key == "RECON_ENGINE_ALLOWED_HOSTS"
        else default,
    )
    assert common._parse_remote_endpoint("http://api.example.com/run") is None
    assert common._parse_remote_endpoint("https://127.0.0.1/run") is None
    assert common._parse_remote_endpoint("https://other.example.com/run") is None


def test_parse_remote_endpoint_accepts_allowed_host_and_query(monkeypatch) -> None:
    monkeypatch.setattr(
        common,
        "env_str",
        lambda key, default="": "api.example.com"
        if key == "RECON_ENGINE_ALLOWED_HOSTS"
        else default,
    )
    parsed = common._parse_remote_endpoint("https://api.example.com:8443/run?x=1")
    assert parsed == ("https", "api.example.com", 8443, "/run?x=1")


def test_call_remote_engine_handles_missing_endpoint_and_bad_payload(monkeypatch) -> None:
    monkeypatch.setattr(common, "env_str", lambda key, default="": "")
    assert common.call_remote_engine("RECON_ENGINE_ENDPOINT", _payload(), "engine-a") is None

    monkeypatch.setattr(
        common,
        "env_str",
        lambda key, default="": (
            "https://api.example.com/engine"
            if key == "RECON_ENGINE_ENDPOINT"
            else ("api.example.com" if key == "RECON_ENGINE_ALLOWED_HOSTS" else "20")
        ),
    )
    monkeypatch.setattr(common, "_post_json", lambda *_args, **_kwargs: "not-json")
    assert common.call_remote_engine("RECON_ENGINE_ENDPOINT", _payload(), "engine-a") is None

    monkeypatch.setattr(
        common,
        "_post_json",
        lambda *_args, **_kwargs: json.dumps(
            {"steps": [{"foo": "bar"}, "bad", {"action": "click", "confidence": 2.0}]}
        ),
    )
    steps = common.call_remote_engine("RECON_ENGINE_ENDPOINT", _payload(), "engine-a")
    assert isinstance(steps, list)
    assert len(steps) == 1
    assert steps[0]["action"] == "click"
    assert steps[0]["confidence"] == 1.0


def test_call_remote_engine_rejects_unparsable_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(
        common,
        "env_str",
        lambda key, default="": (
            "https://127.0.0.1/engine"
            if key == "RECON_ENGINE_ENDPOINT"
            else ("127.0.0.1" if key == "RECON_ENGINE_ALLOWED_HOSTS" else "20")
        ),
    )
    assert common.call_remote_engine("RECON_ENGINE_ENDPOINT", _payload(), "engine-a") is None


def test_call_remote_engine_rejects_non_dict_or_non_list_steps(monkeypatch) -> None:
    monkeypatch.setattr(
        common,
        "env_str",
        lambda key, default="": (
            "https://api.example.com/engine"
            if key == "RECON_ENGINE_ENDPOINT"
            else ("api.example.com" if key == "RECON_ENGINE_ALLOWED_HOSTS" else "20")
        ),
    )
    monkeypatch.setattr(common, "_post_json", lambda *_args, **_kwargs: '["bad-shape"]')
    assert common.call_remote_engine("RECON_ENGINE_ENDPOINT", _payload(), "engine-a") is None

    monkeypatch.setattr(common, "_post_json", lambda *_args, **_kwargs: '{"steps":{"action":"go"}}')
    assert common.call_remote_engine("RECON_ENGINE_ENDPOINT", _payload(), "engine-a") is None


def test_post_json_uses_https_connection(monkeypatch) -> None:
    monkeypatch.setattr(common.http.client, "HTTPSConnection", _FakeConnection)
    result = common._post_json(("https", "api.example.com", 443, "/run"), {"a": 1}, 5)
    assert "steps" in result


def test_post_json_rejects_non_https_scheme() -> None:
    with pytest.raises(ValueError, match="unsupported scheme"):
        common._post_json(("http", "api.example.com", 80, "/run"), {}, 5)


def test_parse_remote_endpoint_rejects_missing_hostname() -> None:
    assert common._parse_remote_endpoint("https:///run") is None


def test_post_json_raises_on_non_2xx(monkeypatch) -> None:
    monkeypatch.setattr(common.http.client, "HTTPSConnection", _FakeErrorConnection)
    with pytest.raises(ValueError, match="remote engine returned 500"):
        common._post_json(("https", "api.example.com", 443, "/run"), {"a": 1}, 5)
