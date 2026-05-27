from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException, status

from apps.api.app.models.flow import SessionRecord


class UniversalPlatformSessionMixin:
    def list_sessions(self, limit: int = 30, requester: str | None = None) -> list[SessionRecord]:
        sessions = [
            SessionRecord.model_validate(item) for item in self._read_json(self._sessions_path)
        ]
        if requester:
            sessions = [item for item in sessions if item.owner == requester]
        sessions.sort(key=lambda item: item.started_at, reverse=True)
        return sessions[: max(1, min(limit, 200))]

    def start_session(self, start_url: str, mode: str, owner: str | None = None) -> SessionRecord:
        normalized_url = start_url.strip()
        if not normalized_url:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="start_url is required",
            )
        normalized_mode = self._normalize_session_mode(mode)
        if normalized_mode not in {"manual", "ai"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="mode must be manual or ai",
            )
        record = SessionRecord(
            session_id=f"ss_{uuid4().hex}",
            start_url=normalized_url,
            mode=normalized_mode,  # type: ignore[arg-type]
            owner=owner,
            started_at=datetime.now(UTC),
        )
        with self._lock:
            sessions = self._read_json(self._sessions_path)
            sessions.append(record.model_dump(mode="json"))
            self._write_json(self._sessions_path, sessions)
            self._audit(
                "session.start",
                owner,
                {
                    "session_id": record.session_id,
                    "start_url": normalized_url,
                    "mode": normalized_mode,
                },
            )
        return record

    def get_session(self, session_id: str, requester: str | None = None) -> SessionRecord:
        session = self._get_session(session_id)
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
        self._ensure_session_access(session, requester)
        return session

    def finish_session(self, session_id: str, owner: str | None = None) -> SessionRecord:
        with self._lock:
            sessions = self._read_json(self._sessions_path)
            found = None
            for idx, item in enumerate(sessions):
                if item.get("session_id") != session_id:
                    continue
                model = SessionRecord.model_validate(item)
                self._ensure_session_access(model, owner)
                model.finished_at = datetime.now(UTC)
                sessions[idx] = model.model_dump(mode="json")
                found = model
                break
            if found is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="session not found",
                )
            self._write_json(self._sessions_path, sessions)
            self._audit("session.finish", owner, {"session_id": session_id})
            return found

    def _normalize_session_mode(self, mode: str) -> str:
        normalized = mode.strip().lower()
        return self._SESSION_MODE_ALIAS.get(normalized, normalized)

    def _get_session(self, session_id: str) -> SessionRecord | None:
        for item in self._read_json(self._sessions_path):
            if item.get("session_id") == session_id:
                return SessionRecord.model_validate(item)
        return None

    def _ensure_session_access(self, session: SessionRecord, requester: str | None) -> None:
        if requester is None:
            return
        if session.owner != requester:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="session access denied",
            )

    def _upsert_session_from_import(
        self,
        *,
        session_id: str,
        start_url: str,
        owner: str | None,
    ) -> None:
        now = datetime.now(UTC)
        with self._lock:
            sessions = self._read_json(self._sessions_path)
            for idx, item in enumerate(sessions):
                if item.get("session_id") != session_id:
                    continue
                model = SessionRecord.model_validate(item)
                if owner and model.owner != owner:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="session access denied",
                    )
                sessions[idx] = model.model_dump(mode="json")
                self._write_json(self._sessions_path, sessions)
                return
            model = SessionRecord(
                session_id=session_id,
                start_url=start_url,
                mode="manual",
                owner=owner,
                started_at=now,
            )
            sessions.append(model.model_dump(mode="json"))
            self._write_json(self._sessions_path, sessions)
