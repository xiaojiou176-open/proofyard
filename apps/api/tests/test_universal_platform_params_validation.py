from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import HTTPException

from apps.api.app.models.template import (
    OtpPolicy,
    TemplateParamSpec,
    TemplatePolicies,
    TemplateRecord,
)
from apps.api.app.services.universal_platform.params import MAX_PARAM_VALUE_CHARS, validate_params


def _template_with_spec(spec: TemplateParamSpec) -> TemplateRecord:
    now = datetime.now(UTC)
    return TemplateRecord(
        template_id="tp-params",
        flow_id="fl-params",
        name="params-check",
        params_schema=[spec],
        defaults={},
        policies=TemplatePolicies(otp=OtpPolicy(required=False)),
        created_by="tester",
        created_at=now,
        updated_at=now,
    )


def test_validate_params_rejects_invalid_regex_pattern() -> None:
    template = _template_with_spec(
        TemplateParamSpec(key="otp", type="regex", required=False, pattern="(unclosed")
    )
    with pytest.raises(HTTPException) as exc_info:
        validate_params(template, {"otp": "123456"}, template.policies.otp)
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "param regex invalid: otp"


def test_validate_params_rejects_overlong_value() -> None:
    template = _template_with_spec(TemplateParamSpec(key="username", type="string", required=False))
    too_long = "a" * (MAX_PARAM_VALUE_CHARS + 1)
    with pytest.raises(HTTPException) as exc_info:
        validate_params(template, {"username": too_long}, template.policies.otp)
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "param too long: username"
