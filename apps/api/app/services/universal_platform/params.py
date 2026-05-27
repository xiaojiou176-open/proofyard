from __future__ import annotations

from functools import lru_cache
import re
from typing import Any

from fastapi import HTTPException, status

from apps.api.app.models.template import OtpPolicy, TemplateParamSpec, TemplateRecord

MAX_PARAM_VALUE_CHARS = 4096


@lru_cache(maxsize=256)
def _compile_regex(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern)


def validate_params(template: TemplateRecord, params: dict[str, str], otp: OtpPolicy) -> None:
    for spec in template.params_schema:
        value = (params.get(spec.key) or "").strip()
        if len(value) > MAX_PARAM_VALUE_CHARS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"param too long: {spec.key}",
            )
        if spec.required and not value:
            if otp.required and "otp" in spec.key.lower():
                continue
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"param is required: {spec.key}",
            )
        if spec.type == "enum" and value and spec.enum_values and value not in spec.enum_values:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"param not in enum: {spec.key}",
            )
        if spec.type == "regex" and value and spec.pattern:
            try:
                matched = _compile_regex(spec.pattern).search(value) is not None
            except re.error as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"param regex invalid: {spec.key}",
                ) from exc
            if matched:
                continue
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"param regex mismatch: {spec.key}",
            )
        if spec.type == "email" and value and "@" not in value:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"param email invalid: {spec.key}",
            )


def sanitize_defaults(
    params_schema: list[dict[str, Any]], defaults: dict[str, str]
) -> dict[str, str]:
    schema_by_key: dict[str, str] = {}
    for item in params_schema:
        key = item.get("key")
        typ = item.get("type", "string")
        if isinstance(key, str):
            schema_by_key[key] = str(typ)
    unknown = sorted(set(defaults.keys()) - set(schema_by_key.keys()))
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unknown defaults keys: {', '.join(unknown)}",
        )
    sanitized: dict[str, str] = {}
    for key, value in defaults.items():
        if schema_by_key.get(key) == "secret":
            continue
        sanitized[key] = value
    return sanitized


def export_scrubbed_defaults(template: TemplateRecord) -> dict[str, str]:
    secret_keys = {spec.key for spec in template.params_schema if spec.type == "secret"}
    exported = dict(template.defaults)
    for key in secret_keys:
        if key in exported:
            exported[key] = "***"
    return exported


def public_params(
    template: TemplateRecord,
    params: dict[str, str],
    sensitive_param_keys: set[str] | frozenset[str],
) -> dict[str, str]:
    secret_keys = {spec.key for spec in template.params_schema if spec.type == "secret"}
    secret_keys.update(sensitive_param_keys)
    return {key: value for key, value in params.items() if key not in secret_keys}


def is_secret_param_key(key: str, sensitive_param_keys: set[str] | frozenset[str]) -> bool:
    lowered = key.lower()
    if key in sensitive_param_keys:
        return True
    return any(
        token in lowered
        for token in (
            "secret",
            "password",
            "otp",
            "token",
            "key",
            "card",
            "cvc",
            "cvv",
            "exp",
            "postal",
        )
    )


def ensure_allowed_param_keys(
    params_schema: list[TemplateParamSpec], params: dict[str, str], *, source: str
) -> None:
    allowed = {spec.key for spec in params_schema}
    unknown = sorted(set(params.keys()) - allowed)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unknown {source} keys: {', '.join(unknown)}",
        )
