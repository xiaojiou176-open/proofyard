from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from fastapi import HTTPException, status
from fastapi import Query

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.core.access_control import require_access, require_actor
from apps.api.app.models.automation import (
    CommandListResponse,
    RunCommandRequest,
    RunCommandResponse,
    TaskListResponse,
    TaskSnapshot,
)
from apps.api.app.core.observability import REQUEST_ID_CTX
from apps.api.app.services.automation_service import automation_service

router = APIRouter(prefix="/api/automation", tags=["automation"])


@router.get("/commands", response_model=CommandListResponse)
def list_commands(
    request: Request, x_automation_token: str | None = Header(default=None)
) -> CommandListResponse:
    require_access(request, x_automation_token)
    return CommandListResponse(commands=automation_service.list_commands())


@router.get("/tasks", response_model=TaskListResponse)
def list_tasks(
    security: AutomationSecurityContext = Depends(require_automation_access),
    status_filter: str | None = Query(default=None, alias="status"),
    command_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> TaskListResponse:
    allowed_status = {"queued", "running", "success", "failed", "cancelled"}
    if status_filter is not None and status_filter not in allowed_status:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid status filter"
        )
    return TaskListResponse(
        tasks=automation_service.list_tasks(
            status=status_filter,
            command_id=command_id,
            limit=limit,
            requested_by=security.actor,
        )
    )


@router.get("/tasks/{task_id}", response_model=TaskSnapshot)
def get_task(
    task_id: str, request: Request, x_automation_token: str | None = Header(default=None)
) -> TaskSnapshot:
    return automation_service.get_task(
        task_id, requested_by=require_actor(request, x_automation_token)
    )


@router.post("/run", response_model=RunCommandResponse)
def run_command(
    payload: RunCommandRequest,
    request: Request,
    x_automation_token: str | None = Header(default=None),
) -> RunCommandResponse:
    actor = require_actor(request, x_automation_token)
    request_id = (
        getattr(request.state, "request_id", None)
        or request.headers.get("x-request-id")
        or REQUEST_ID_CTX.get()
    )
    task = automation_service.run_command(
        payload.command,
        payload.resolved_params,
        requested_by=actor,
        request_id=request_id,
    )
    return RunCommandResponse(task=task)


@router.post("/tasks/{task_id}/cancel", response_model=TaskSnapshot)
def cancel_task(
    task_id: str, request: Request, x_automation_token: str | None = Header(default=None)
) -> TaskSnapshot:
    return automation_service.cancel_task(
        task_id, requested_by=require_actor(request, x_automation_token)
    )
