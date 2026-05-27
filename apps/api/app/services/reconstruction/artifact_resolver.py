from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable
from urllib.parse import urlparse

from fastapi import HTTPException, status


@dataclass
class ResolvedArtifacts:
    start_url: str
    session_dir: Path
    video_path: Path | None
    har_path: Path | None
    html_path: Path | None
    html_content: str
    har_entries: list[dict[str, Any]]


_SAFE_RUNTIME_PART_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _sanitize_runtime_relative_path(root: Path, candidate: str | Path) -> Path:
    candidate_str = str(candidate).strip().replace("\\", "/")
    if not candidate_str:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="artifact path is required",
        )
    root_prefix = root.resolve().as_posix().rstrip("/")
    if candidate_str == root_prefix:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"artifact path outside runtime root: {candidate_str}",
        )
    if candidate_str.startswith(f"{root_prefix}/"):
        candidate_str = candidate_str[len(root_prefix) + 1 :]
    elif candidate_str.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"artifact path outside runtime root: {candidate_str}",
        )

    parts = []
    for part in PurePosixPath(candidate_str).parts:
        if part in {"", ".", "/"}:
            continue
        if part == "..":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"artifact path outside runtime root: {candidate_str}",
            )
        if not _SAFE_RUNTIME_PART_RE.fullmatch(part):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"invalid artifact path segment: {candidate_str}",
            )
        parts.append(part)

    if not parts:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"invalid artifact path: {candidate_str}",
        )
    return Path(*parts)


def _safe_text_read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unable to read artifact content: {path}",
        ) from exc


def safe_resolve_under(
    root: Path, candidate: str | Path, allowed_exts: set[str] | None, max_bytes: int
) -> Path:
    resolved_root = root.resolve()
    relative_path = _sanitize_runtime_relative_path(resolved_root, candidate)
    candidate_path = resolved_root / relative_path
    try:
        resolved_candidate = candidate_path.resolve()
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"invalid artifact path: {candidate_path}",
        ) from exc

    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"artifact path outside runtime root: {candidate_path}",
        ) from exc

    if allowed_exts:
        normalized_exts = {
            ext.lower() if ext.startswith(".") else f".{ext.lower()}" for ext in allowed_exts
        }
        suffix = resolved_candidate.suffix.lower()
        if suffix not in normalized_exts:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"invalid artifact extension for path: {candidate_path}",
            )

    if resolved_candidate.exists() and resolved_candidate.is_file():
        try:
            size = resolved_candidate.stat().st_size
        except OSError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"unable to read artifact metadata: {candidate_path}",
            ) from exc
        if size > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"artifact exceeds max bytes ({max_bytes}): {candidate_path}",
            )
    return resolved_candidate


def resolve_artifacts(
    runtime_root: Path,
    artifacts: dict[str, Any],
    artifact_max_bytes: int,
    discover_start_url: Callable[[list[dict[str, Any]]], str | None],
) -> ResolvedArtifacts:
    session_dir = resolve_session_dir(runtime_root, artifacts, artifact_max_bytes)
    har_path = resolve_optional_path(
        runtime_root,
        session_dir,
        artifacts.get("har_path"),
        "register.har",
        allowed_exts={".har", ".json"},
        artifact_max_bytes=artifact_max_bytes,
    )
    html_path = resolve_optional_path(
        runtime_root,
        session_dir,
        artifacts.get("html_path"),
        "page.html",
        allowed_exts={".html", ".htm"},
        artifact_max_bytes=artifact_max_bytes,
    )
    video_path = resolve_optional_path(
        runtime_root,
        session_dir,
        artifacts.get("video_path"),
        "session.mp4",
        allowed_exts={".mp4", ".webm", ".mov", ".mkv"},
        artifact_max_bytes=artifact_max_bytes,
    )

    html_content = str(artifacts.get("html_content") or "")
    if not html_content and html_path and html_path.exists():
        html_content = _safe_text_read(html_path)

    har_entries = _parse_har_entries(har_path)
    start_url = str(artifacts.get("metadata", {}).get("start_url") or "").strip()
    if not start_url:
        start_url = discover_start_url(har_entries) or "https://example.com"

    return ResolvedArtifacts(
        start_url=start_url,
        session_dir=session_dir,
        video_path=video_path,
        har_path=har_path,
        html_path=html_path,
        html_content=html_content,
        har_entries=har_entries,
    )


def resolve_session_dir(
    runtime_root: Path, artifacts: dict[str, Any], artifact_max_bytes: int
) -> Path:
    session_dir_value = str(artifacts.get("session_dir") or "").strip()
    if session_dir_value:
        resolved = safe_resolve_under(
            runtime_root, session_dir_value, allowed_exts=None, max_bytes=artifact_max_bytes
        )
        if not resolved.exists() or not resolved.is_dir():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"session_dir is not an existing directory: {session_dir_value}",
            )
        return resolved

    latest_pointer = runtime_root / "latest-session.json"
    if latest_pointer.exists():
        try:
            raw = json.loads(_safe_text_read(latest_pointer))
            session_dir = str(raw.get("sessionDir") or "").strip()
            if session_dir:
                resolved = safe_resolve_under(
                    runtime_root,
                    session_dir,
                    allowed_exts=None,
                    max_bytes=artifact_max_bytes,
                )
                if not resolved.exists() or not resolved.is_dir():
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                        detail=f"latest sessionDir is not an existing directory: {session_dir}",
                    )
                return resolved
        except json.JSONDecodeError:
            pass

    fallback = runtime_root / "session-fallback"
    fallback.mkdir(parents=True, exist_ok=True)
    return safe_resolve_under(
        runtime_root, fallback, allowed_exts=None, max_bytes=artifact_max_bytes
    )


def resolve_optional_path(
    runtime_root: Path,
    session_dir: Path,
    raw_path: Any,
    fallback_name: str,
    *,
    allowed_exts: set[str],
    artifact_max_bytes: int,
) -> Path | None:
    value = str(raw_path or "").strip()
    if value:
        resolved = safe_resolve_under(
            runtime_root,
            value,
            allowed_exts=allowed_exts,
            max_bytes=artifact_max_bytes,
        )
        if not resolved.exists():
            return None
        if not resolved.is_file():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"artifact path must be a file: {value}",
            )
        return resolved
    candidate = session_dir / fallback_name
    if not candidate.exists():
        return None
    resolved = safe_resolve_under(
        runtime_root,
        candidate,
        allowed_exts=allowed_exts,
        max_bytes=artifact_max_bytes,
    )
    if not resolved.is_file():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"artifact path must be a file: {candidate}",
        )
    return resolved


def _parse_har_entries(har_path: Path | None) -> list[dict[str, Any]]:
    if not har_path or not har_path.exists():
        return []

    entries: list[dict[str, Any]] = []
    try:
        parsed = json.loads(_safe_text_read(har_path))
        raw_entries = parsed.get("log", {}).get("entries", []) if isinstance(parsed, dict) else []
        for entry in raw_entries:
            if not isinstance(entry, dict):
                continue
            request = entry.get("request", {}) if isinstance(entry.get("request"), dict) else {}
            response = entry.get("response", {}) if isinstance(entry.get("response"), dict) else {}
            url = str(request.get("url") or "")
            parsed_url = urlparse(url) if url else None
            headers = request.get("headers") if isinstance(request.get("headers"), list) else []
            content_type = None
            for header in headers:
                if not isinstance(header, dict):
                    continue
                name = str(header.get("name") or "").lower()
                if name == "content-type":
                    content_type = str(header.get("value") or "") or None
                    break
            entries.append(
                {
                    "method": str(request.get("method") or "").upper(),
                    "url": url,
                    "path": parsed_url.path if parsed_url else "",
                    "status": int(response.get("status") or 0),
                    "content_type": content_type,
                }
            )
    except json.JSONDecodeError:
        return []

    return entries
