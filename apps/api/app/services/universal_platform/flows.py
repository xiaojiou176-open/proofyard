from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from apps.api.app.models.flow import FlowRecord, FlowStep
from apps.api.app.models.template import TemplateRecord


class UniversalPlatformFlowMixin:
    def list_flows(
        self,
        limit: int = 50,
        requester: str | None = None,
        actor: str | None = None,
    ) -> list[FlowRecord]:
        requester = requester or actor
        items = [FlowRecord.model_validate(item) for item in self._read_json(self._flows_path)]
        if requester:
            items = [item for item in items if self._flow_owner(item) == requester]
        items.sort(key=lambda item: item.updated_at, reverse=True)
        return items[: max(1, min(limit, 200))]

    def get_flow(self, flow_id: str, requester: str | None = None) -> FlowRecord:
        for item in self._read_json(self._flows_path):
            if item.get("flow_id") == flow_id:
                flow = FlowRecord.model_validate(item)
                self._ensure_flow_access(flow, requester)
                return flow
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="flow not found")

    def create_flow(
        self,
        session_id: str,
        start_url: str,
        steps: list[dict[str, Any]],
        source_event_count: int = 0,
        requester: str | None = None,
        owner: str | None = None,
    ) -> FlowRecord:
        requester = requester or owner
        session = self._get_session(session_id)
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")
        self._ensure_session_access(session, requester)
        now = datetime.now(UTC)
        record = FlowRecord(
            flow_id=f"fl_{uuid4().hex}",
            session_id=session_id,
            start_url=start_url,
            source_event_count=max(0, source_event_count),
            steps=[FlowStep.model_validate(step) for step in steps],
            created_at=now,
            updated_at=now,
            quality_score=self._score_flow(steps),
        )
        with self._lock:
            flows = self._read_json(self._flows_path)
            flows.append(record.model_dump(mode="json"))
            self._write_json(self._flows_path, flows)
        return record

    def import_latest_flow_draft(self, owner: str | None = None) -> FlowRecord:
        latest_pointer = self._runtime_root / "latest-session.json"
        if not latest_pointer.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="latest session pointer not found",
            )
        try:
            latest = json.loads(latest_pointer.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="latest session pointer is invalid",
            )
        session_id = str(latest.get("sessionId") or "")
        session_dir = str(latest.get("sessionDir") or "")
        if not session_id or not session_dir:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="latest session pointer missing keys",
            )
        session_dir_path = Path(session_dir).resolve()
        if not self._is_within_runtime_root(session_dir_path):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="latest session path is outside runtime root",
            )
        flow_path = (session_dir_path / "flow-draft.json").resolve()
        if not self._is_within_runtime_root(flow_path):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="latest flow path is outside runtime root",
            )
        if not flow_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="latest flow draft not found",
            )
        try:
            raw = json.loads(flow_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="latest flow draft invalid",
            )
        if not isinstance(raw, dict):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="latest flow draft invalid format",
            )
        start_url = str(raw.get("start_url") or "")
        steps = raw.get("steps")
        if not start_url or not isinstance(steps, list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="latest flow draft missing start_url/steps",
            )
        session = self._get_session(session_id)
        if session is not None:
            self._ensure_session_access(session, owner)
        else:
            self._upsert_session_from_import(
                session_id=session_id,
                start_url=start_url,
                owner=owner,
            )
        flow = self.create_flow(
            session_id=session_id,
            start_url=start_url,
            steps=[item for item in steps if isinstance(item, dict)],
            source_event_count=int(raw.get("source_event_count") or 0),
            requester=owner,
        )
        self._audit(
            "flow.import_latest",
            owner,
            {"flow_id": flow.flow_id, "session_id": session_id},
        )
        return flow

    def update_flow(
        self,
        flow_id: str,
        *,
        steps: list[dict[str, Any]] | None = None,
        start_url: str | None = None,
        requester: str | None = None,
    ) -> FlowRecord:
        with self._lock:
            flows = self._read_json(self._flows_path)
            found = None
            for idx, item in enumerate(flows):
                if item.get("flow_id") != flow_id:
                    continue
                model = FlowRecord.model_validate(item)
                self._ensure_flow_access(model, requester)
                if steps is not None:
                    model.steps = [FlowStep.model_validate(step) for step in steps]
                    model.quality_score = self._score_flow(steps)
                if start_url is not None and start_url.strip():
                    model.start_url = start_url.strip()
                model.updated_at = datetime.now(UTC)
                flows[idx] = model.model_dump(mode="json")
                found = model
                break
            if found is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="flow not found")
            self._write_json(self._flows_path, flows)
            return found

    def _score_flow(self, steps: list[dict[str, Any]]) -> int:
        if not steps:
            return 0
        with_selector = 0
        for step in steps:
            target = step.get("target") if isinstance(step, dict) else None
            selectors = target.get("selectors") if isinstance(target, dict) else None
            if isinstance(selectors, list) and selectors:
                with_selector += 1
        return int((with_selector / max(1, len(steps))) * 100)

    def _flow_owner(self, flow: FlowRecord) -> str | None:
        session = self._get_session(flow.session_id)
        return session.owner if session else None

    def _ensure_flow_access(self, flow: FlowRecord, requester: str | None) -> None:
        if requester is None:
            return
        owner = self._flow_owner(flow)
        if owner != requester:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="flow access denied")

    def _template_owner(self, template: TemplateRecord) -> str | None:
        if template.created_by:
            return template.created_by
        flow = self.get_flow(template.flow_id)
        return self._flow_owner(flow)

    def _ensure_template_access(self, template: TemplateRecord, requester: str | None) -> None:
        if requester is None:
            return
        owner = self._template_owner(template)
        if owner != requester:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="template access denied",
            )

    def _is_within_runtime_root(self, path: Path) -> bool:
        try:
            return path.resolve().is_relative_to(self._runtime_root.resolve())
        except ValueError:
            return False
