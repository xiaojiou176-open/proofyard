from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from apps.api.app.services.reconstruction import artifact_resolver as ar


def test_safe_resolve_under_branches(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()

    ok_file = runtime / "inside.har"
    ok_file.write_text("{}", encoding="utf-8")

    resolved = ar.safe_resolve_under(runtime, "inside.har", {".har"}, max_bytes=32)
    assert resolved == ok_file.resolve()

    outside = tmp_path / "outside.har"
    outside.write_text("{}", encoding="utf-8")
    with pytest.raises(HTTPException) as outside_err:
        ar.safe_resolve_under(runtime, outside, {".har"}, max_bytes=32)
    assert outside_err.value.status_code == 400
    assert "outside runtime root" in str(outside_err.value.detail)

    bad_ext = runtime / "inside.txt"
    bad_ext.write_text("ok", encoding="utf-8")
    with pytest.raises(HTTPException) as ext_err:
        ar.safe_resolve_under(runtime, bad_ext, {".har", ".json"}, max_bytes=32)
    assert ext_err.value.status_code == 422
    assert "invalid artifact extension" in str(ext_err.value.detail)

    too_large = runtime / "large.har"
    too_large.write_bytes(b"x" * 8)
    with pytest.raises(HTTPException) as size_err:
        ar.safe_resolve_under(runtime, too_large, {".har"}, max_bytes=4)
    assert size_err.value.status_code == 422
    assert "exceeds max bytes" in str(size_err.value.detail)

    with pytest.raises(HTTPException) as segment_err:
        ar.safe_resolve_under(runtime, "bad$/inside.har", {".har"}, max_bytes=32)
    assert segment_err.value.status_code == 422
    assert "invalid artifact path segment" in str(segment_err.value.detail)


def test_resolve_session_dir_explicit_latest_and_bad_json_fallback(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()

    explicit = runtime / "sessions" / "explicit"
    explicit.mkdir(parents=True)
    resolved_explicit = ar.resolve_session_dir(runtime, {"session_dir": str(explicit)}, 1024)
    assert resolved_explicit == explicit.resolve()

    latest = runtime / "sessions" / "latest"
    latest.mkdir(parents=True)
    (runtime / "latest-session.json").write_text(
        json.dumps({"sessionDir": str(latest)}), encoding="utf-8"
    )
    resolved_latest = ar.resolve_session_dir(runtime, {}, 1024)
    assert resolved_latest == latest.resolve()

    resolved_absolute = ar.resolve_session_dir(runtime, {"session_dir": str(explicit.resolve())}, 1024)
    assert resolved_absolute == explicit.resolve()

    (runtime / "latest-session.json").write_text("{bad", encoding="utf-8")
    fallback = ar.resolve_session_dir(runtime, {}, 1024)
    assert fallback.name == "session-fallback"
    assert fallback.exists()
    assert fallback.is_dir()


def test_resolve_optional_path_nonexistent_non_file_and_fallback(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    session = runtime / "session"
    runtime.mkdir()
    session.mkdir()

    missing = ar.resolve_optional_path(
        runtime,
        session,
        str(session / "missing.har"),
        "register.har",
        allowed_exts={".har"},
        artifact_max_bytes=1024,
    )
    assert missing is None

    as_dir = session / "dir.har"
    as_dir.mkdir()
    with pytest.raises(HTTPException) as non_file_err:
        ar.resolve_optional_path(
            runtime,
            session,
            str(as_dir),
            "register.har",
            allowed_exts={".har"},
            artifact_max_bytes=1024,
        )
    assert non_file_err.value.status_code == 422
    assert "must be a file" in str(non_file_err.value.detail)

    fallback_file = session / "register.har"
    fallback_file.write_text("{}", encoding="utf-8")
    fallback = ar.resolve_optional_path(
        runtime,
        session,
        "",
        "register.har",
        allowed_exts={".har"},
        artifact_max_bytes=1024,
    )
    assert fallback == fallback_file.resolve()


def test_parse_har_entries_valid_and_invalid_json(tmp_path: Path) -> None:
    har = tmp_path / "register.har"

    har.write_text("{bad", encoding="utf-8")
    assert ar._parse_har_entries(har) == []

    har.write_text(
        json.dumps(
            {
                "log": {
                    "entries": [
                        {
                            "request": {
                                "method": "post",
                                "url": "https://example.com/api/register",
                                "headers": [{"name": "Content-Type", "value": "application/json"}],
                            },
                            "response": {"status": 201},
                        },
                        {"not": "a-valid-entry"},
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    entries = ar._parse_har_entries(har)

    assert len(entries) == 2
    assert entries[0]["method"] == "POST"
    assert entries[0]["path"] == "/api/register"
    assert entries[0]["status"] == 201
    assert entries[0]["content_type"] == "application/json"
    assert entries[1]["method"] == ""
    assert entries[1]["path"] == ""
    assert entries[1]["status"] == 0
    assert entries[1]["content_type"] is None


def test_resolve_session_dir_rejects_file_paths_and_resolve_artifacts_reads_html(
    tmp_path: Path,
) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()

    explicit_file = runtime / "session.txt"
    explicit_file.write_text("nope", encoding="utf-8")
    with pytest.raises(HTTPException) as explicit_not_dir:
        ar.resolve_session_dir(runtime, {"session_dir": str(explicit_file)}, 1024)
    assert explicit_not_dir.value.status_code == 422

    latest_file = runtime / "latest-session-file"
    latest_file.write_text("nope", encoding="utf-8")
    (runtime / "latest-session.json").write_text(
        json.dumps({"sessionDir": str(latest_file)}), encoding="utf-8"
    )
    with pytest.raises(HTTPException) as latest_not_dir:
        ar.resolve_session_dir(runtime, {}, 1024)
    assert latest_not_dir.value.status_code == 422

    session_dir = runtime / "session-ok"
    session_dir.mkdir()
    html_path = session_dir / "page.html"
    html_path.write_text("<html>ok</html>", encoding="utf-8")
    resolved = ar.resolve_artifacts(
        runtime,
        {
            "session_dir": str(session_dir),
            "html_path": str(html_path),
            "metadata": {},
        },
        artifact_max_bytes=4096,
        discover_start_url=lambda _entries: None,
    )
    assert resolved.html_content == "<html>ok</html>"
    assert resolved.start_url == "https://example.com"


def test_safe_resolve_under_rejects_absolute_outside_root_and_parent_segments(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    inside = runtime / "inside.json"
    inside.write_text("{}", encoding="utf-8")
    assert ar.safe_resolve_under(runtime, str(inside.resolve()), {".json"}, 1024) == inside.resolve()

    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    with pytest.raises(HTTPException):
        ar.safe_resolve_under(runtime, str(outside.resolve()), {".json"}, 1024)

    with pytest.raises(HTTPException):
        ar.safe_resolve_under(runtime, "../escape.json", {".json"}, 1024)


def test_resolve_artifacts_uses_safe_text_read_for_html_and_har(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    session_dir = runtime / "session-ok"
    runtime.mkdir()
    session_dir.mkdir()
    har_path = session_dir / "register.har"
    html_path = session_dir / "page.html"
    har_path.write_text('{"log":{"entries":[]}}', encoding="utf-8")
    html_path.write_text("<html>safe</html>", encoding="utf-8")

    resolved = ar.resolve_artifacts(
        runtime,
        {
            "session_dir": str(session_dir.resolve()),
            "har_path": str(har_path.resolve()),
            "html_path": str(html_path.resolve()),
            "metadata": {},
        },
        artifact_max_bytes=4096,
        discover_start_url=lambda _entries: None,
    )

    assert resolved.har_path == har_path.resolve()
    assert resolved.html_path == html_path.resolve()
    assert resolved.html_content == "<html>safe</html>"
