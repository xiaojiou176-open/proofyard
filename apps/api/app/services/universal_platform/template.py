from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from apps.api.app.models.template import TemplateParamSpec, TemplatePolicies, TemplateRecord


def autofill_required_run_params(template: TemplateRecord) -> dict[str, str]:
    params: dict[str, str] = {}
    for spec in template.params_schema:
        if spec.type == "email":
            params[spec.key] = f"auto+{uuid4().hex[:8]}@example.com"
        elif spec.type == "secret":
            params[spec.key] = ""
        else:
            params[spec.key] = template.defaults.get(spec.key, "")
    return params


def list_templates(
    service: Any, limit: int = 100, requester: str | None = None
) -> list[TemplateRecord]:
    items = [
        TemplateRecord.model_validate(item) for item in service._read_json(service._templates_path)
    ]
    if requester:
        items = [item for item in items if service._template_owner(item) == requester]
    items.sort(key=lambda item: item.updated_at, reverse=True)
    return items[: max(1, min(limit, 300))]


def get_template(service: Any, template_id: str, requester: str | None = None) -> TemplateRecord:
    for item in service._read_json(service._templates_path):
        if item.get("template_id") == template_id:
            template = TemplateRecord.model_validate(item)
            service._ensure_template_access(template, requester)
            return template
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="template not found")


def create_template(
    service: Any,
    *,
    flow_id: str,
    name: str,
    params_schema: list[dict[str, Any]],
    defaults: dict[str, str],
    policies: dict[str, Any],
    created_by: str | None = None,
) -> TemplateRecord:
    service.get_flow(flow_id, requester=created_by)
    now = datetime.now(UTC)
    model = TemplateRecord(
        template_id=f"tp_{uuid4().hex}",
        flow_id=flow_id,
        name=name.strip() or "untitled-template",
        params_schema=params_schema,  # type: ignore[arg-type]
        defaults=service._sanitize_defaults(params_schema, defaults),
        policies=TemplatePolicies.model_validate(policies),
        created_by=created_by,
        created_at=now,
        updated_at=now,
    )
    with service._lock:
        templates = service._read_json(service._templates_path)
        templates.append(model.model_dump(mode="json"))
        service._write_json(service._templates_path, templates)
        service._audit(
            "template.create",
            created_by,
            {"template_id": model.template_id, "flow_id": flow_id, "name": model.name},
        )
    return model


def update_template(
    service: Any,
    template_id: str,
    *,
    name: str | None = None,
    params_schema: list[dict[str, Any]] | None = None,
    defaults: dict[str, str] | None = None,
    policies: dict[str, Any] | None = None,
    actor: str | None = None,
) -> TemplateRecord:
    with service._lock:
        templates = service._read_json(service._templates_path)
        found = None
        for idx, item in enumerate(templates):
            if item.get("template_id") != template_id:
                continue
            model = TemplateRecord.model_validate(item)
            service._ensure_template_access(model, actor)
            if name is not None:
                model.name = name.strip() or model.name
            schema_dict = [x.model_dump() for x in model.params_schema]
            if params_schema is not None:
                model.params_schema = [TemplateParamSpec.model_validate(x) for x in params_schema]
                schema_dict = params_schema
            if defaults is not None:
                model.defaults = service._sanitize_defaults(schema_dict, defaults)
            if policies is not None:
                model.policies = TemplatePolicies.model_validate(policies)
            model.updated_at = datetime.now(UTC)
            templates[idx] = model.model_dump(mode="json")
            found = model
            break
        if found is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="template not found")
        service._write_json(service._templates_path, templates)
        service._audit("template.update", actor, {"template_id": template_id, "name": found.name})
        return found


def export_template(service: Any, template_id: str, actor: str | None = None) -> dict[str, Any]:
    template = service.get_template(template_id, requester=actor)
    exported = template.model_dump(mode="json")
    exported["defaults"] = service._export_scrubbed_defaults(template)
    service._audit("template.export", actor, {"template_id": template_id})
    return exported


def import_template(
    service: Any,
    template_payload: dict[str, Any],
    *,
    actor: str | None = None,
    name: str | None = None,
) -> TemplateRecord:
    flow_id = template_payload.get("flow_id")
    if not isinstance(flow_id, str) or not flow_id.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="template import requires flow_id")

    params_schema = template_payload.get("params_schema")
    if not isinstance(params_schema, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="template import requires params_schema",
        )

    defaults = template_payload.get("defaults")
    if not isinstance(defaults, dict):
        defaults = {}

    policies = template_payload.get("policies")
    if not isinstance(policies, dict):
        policies = {}

    imported = create_template(
        service,
        flow_id=flow_id,
        name=(name or template_payload.get("name") or "imported-template"),
        params_schema=params_schema,
        defaults=defaults,
        policies=policies,
        created_by=actor,
    )
    service._audit(
        "template.import",
        actor,
        {
            "template_id": imported.template_id,
            "flow_id": imported.flow_id,
            "source_template_id": template_payload.get("template_id"),
        },
    )
    return imported
