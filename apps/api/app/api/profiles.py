from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query, Request

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.core.access_control import require_access
from apps.api.app.models.automation import ProfileResolveRequest, ProfileResolveResponse
from apps.api.app.models.profile_target_studio import (
    ConfigStudioSaveRequest,
    ConfigStudioSaveResponse,
    ProfileTargetStudioResponse,
)
from apps.api.app.services.profile_target_studio_service import profile_target_studio_service
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


@router.post("/resolve", response_model=ProfileResolveResponse)
def resolve_profile(
    payload: ProfileResolveRequest,
    request: Request,
    x_automation_token: str | None = Header(default=None),
) -> ProfileResolveResponse:
    require_access(request, x_automation_token)
    return universal_platform_service.resolve_target_profile(payload)


@router.get("/studio", response_model=ProfileTargetStudioResponse)
def get_profile_target_studio(
    profile_name: str | None = Query(default=None),
    target_name: str | None = Query(default=None),
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> ProfileTargetStudioResponse:
    return profile_target_studio_service.get_studio(profile_name=profile_name, target_name=target_name)


@router.patch("/studio/profiles/{profile_name}", response_model=ConfigStudioSaveResponse)
def update_profile_studio(
    profile_name: str,
    payload: ConfigStudioSaveRequest,
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> ConfigStudioSaveResponse:
    return profile_target_studio_service.update_profile(profile_name, payload.updates)


@router.patch("/studio/targets/{target_name}", response_model=ConfigStudioSaveResponse)
def update_target_studio(
    target_name: str,
    payload: ConfigStudioSaveRequest,
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> ConfigStudioSaveResponse:
    return profile_target_studio_service.update_target(target_name, payload.updates)
