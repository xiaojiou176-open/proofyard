from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

RunStatus = Literal[
    "queued", "running", "waiting_user", "waiting_otp", "success", "failed", "cancelled"
]
MAX_RUN_LOG_ENTRIES = 500


class RunLogEntry(BaseModel):
    ts: datetime
    level: Literal["info", "warn", "error"]
    message: str


class RunWaitContext(BaseModel):
    reason_code: str | None = None
    at_step_id: str | None = None
    after_step_id: str | None = None
    resume_from_step_id: str | None = None
    resume_hint: str | None = None
    provider_domain: str | None = None
    gate_required_by_policy: bool | None = None


class RunRecord(BaseModel):
    run_id: str
    template_id: str
    status: RunStatus
    step_cursor: int = 0
    params: dict[str, str] = Field(default_factory=dict)
    task_id: str | None = None
    last_error: str | None = None
    artifacts_ref: dict[str, str] = Field(default_factory=dict)
    correlation_id: str | None = None
    linked_evidence_run_ids: list[str] = Field(default_factory=list)
    wait_context: RunWaitContext | None = None
    created_at: datetime
    updated_at: datetime
    logs: list[RunLogEntry] = Field(default_factory=list)

    @field_validator("logs")
    @classmethod
    def _cap_logs(cls, entries: list[RunLogEntry]) -> list[RunLogEntry]:
        if len(entries) <= MAX_RUN_LOG_ENTRIES:
            return entries
        return entries[-MAX_RUN_LOG_ENTRIES:]
