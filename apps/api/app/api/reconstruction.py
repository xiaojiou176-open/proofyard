from __future__ import annotations

from fastapi import APIRouter, Depends

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.models.automation import (
    ReconstructionGenerateRequest,
    ReconstructionGenerateResponse,
    ReconstructionPreviewRequest,
    ReconstructionPreviewResponse,
)
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/reconstruction", tags=["reconstruction"])


@router.post("/preview", response_model=ReconstructionPreviewResponse)
def reconstruction_preview(
    payload: ReconstructionPreviewRequest,
    _security: AutomationSecurityContext = Depends(require_automation_access),
) -> ReconstructionPreviewResponse:
    return universal_platform_service.create_reconstruction_preview(payload)


@router.post("/generate", response_model=ReconstructionGenerateResponse)
def reconstruction_generate(
    payload: ReconstructionGenerateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> ReconstructionGenerateResponse:
    return universal_platform_service.generate_reconstruction(
        payload,
        actor=security.actor,
    )
