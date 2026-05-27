from __future__ import annotations

import json
import os
import sys
from typing import Any


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        raise ValueError("stdin payload is empty")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("stdin payload must be a JSON object")
    return parsed


def parse_bool_flag(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return fallback


def parse_context_cache_ttl_seconds(value: Any, fallback: int) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return max(0, fallback)
    return max(0, parsed)


def parse_positive_int(value: Any, fallback: int, *, minimum: int = 1, maximum: int = 10) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, parsed))


def resolve_model_name(
    payload: dict[str, Any],
    *,
    default_model: str,
    fast_model: str,
) -> str:
    explicit_model = str(
        payload.get("modelName") or os.getenv("GEMINI_MODEL_PRIMARY") or ""
    ).strip()
    if explicit_model:
        return explicit_model
    quality_profile = (
        str(payload.get("qualityProfile") or os.getenv("GEMINI_QUALITY_PROFILE") or "")
        .strip()
        .lower()
    )
    if quality_profile == "fast":
        return fast_model
    return default_model
