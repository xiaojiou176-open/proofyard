from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from apps.api.app.api.dependencies.security import (
    AutomationSecurityContext,
    require_automation_access,
)
from apps.api.app.models.automation import (
    OrchestrateFromArtifactsRequest,
    OrchestrateFromArtifactsResponse,
)
from apps.api.app.models.template import TemplateRecord
from apps.api.app.models.template import TemplateReadiness
from apps.api.app.models.universal_api import (
    TemplateCreateRequest,
    TemplateImportRequest,
    TemplateListResponse,
    TemplateUpdateRequest,
)
from apps.api.app.services.universal_platform_service import universal_platform_service

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=TemplateListResponse)
def list_templates(
    limit: int = Query(default=100, ge=1, le=300),
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> TemplateListResponse:
    return TemplateListResponse(
        templates=universal_platform_service.list_templates(limit=limit, requester=security.actor)
    )


@router.post("", response_model=TemplateRecord)
def create_template(
    payload: TemplateCreateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> TemplateRecord:
    return universal_platform_service.create_template(
        flow_id=payload.flow_id,
        name=payload.name,
        params_schema=payload.params_schema,
        defaults=payload.defaults,
        policies=payload.policies,
        created_by=security.actor,
    )


@router.post("/import", response_model=TemplateRecord)
def import_template(
    payload: TemplateImportRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> TemplateRecord:
    return universal_platform_service.import_template(
        payload.template,
        actor=security.actor,
        name=payload.name,
    )


@router.get("/{template_id}", response_model=TemplateRecord)
def get_template(
    template_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> TemplateRecord:
    return universal_platform_service.get_template(template_id, requester=security.actor)


@router.patch("/{template_id}", response_model=TemplateRecord)
def update_template(
    template_id: str,
    payload: TemplateUpdateRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> TemplateRecord:
    return universal_platform_service.update_template(
        template_id,
        name=payload.name,
        params_schema=payload.params_schema,
        defaults=payload.defaults,
        policies=payload.policies,
        actor=security.actor,
    )


@router.get("/{template_id}/export")
def export_template(
    template_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> dict[str, Any]:
    return universal_platform_service.export_template(template_id, actor=security.actor)


@router.get("/{template_id}/readiness", response_model=TemplateReadiness)
def get_template_readiness(
    template_id: str,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> TemplateReadiness:
    return universal_platform_service.get_template_readiness(template_id, requester=security.actor)


@router.post("/from-artifacts", response_model=OrchestrateFromArtifactsResponse)
def create_template_from_artifacts(
    payload: OrchestrateFromArtifactsRequest,
    security: AutomationSecurityContext = Depends(require_automation_access),
) -> OrchestrateFromArtifactsResponse:
    return universal_platform_service.create_template_from_artifacts(
        payload,
        actor=security.actor,
    )
