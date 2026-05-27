from __future__ import annotations

import json
import math
from typing import Any


def parse_json_loose(text: str) -> dict[str, Any] | None:
    body = text.strip()
    if not body:
        return None
    try:
        parsed = json.loads(body)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    start = body.find("{")
    end = body.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(body[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def extract_response_text(response: Any) -> str:
    direct_text = getattr(response, "text", None)
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text

    chunks: list[str] = []
    candidates = getattr(response, "candidates", None)
    if not isinstance(candidates, list):
        return ""
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None)
        if not isinstance(parts, list):
            continue
        for part in parts:
            text = getattr(part, "text", None)
            if isinstance(text, str) and text:
                chunks.append(text)
    return "\n".join(chunks)


def extract_function_call_payload(response: Any, function_name: str) -> dict[str, Any] | None:
    candidates = getattr(response, "candidates", None)
    if not isinstance(candidates, list):
        return None

    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None)
        if not isinstance(parts, list):
            continue
        for part in parts:
            function_call = getattr(part, "function_call", None)
            if not function_call:
                continue
            if str(getattr(function_call, "name", "")).strip() != function_name:
                continue
            args = getattr(function_call, "args", None)
            if isinstance(args, dict):
                return args
            if isinstance(args, str):
                parsed = parse_json_loose(args)
                if parsed:
                    return parsed
    return None


def normalize_selectors(raw_selectors: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_selectors, list):
        return []
    selectors: list[dict[str, Any]] = []
    for item in raw_selectors:
        if not isinstance(item, dict):
            continue
        value = item.get("value")
        if not isinstance(value, str) or not value.strip():
            continue
        selectors.append(
            {
                "kind": str(item.get("kind") or "css"),
                "value": value.strip(),
                "score": float(item.get("score") or 70),
            }
        )
    return selectors


def normalize_confidence(value: Any, fallback: float = 0.75) -> float:
    try:
        fallback_value = float(fallback)
    except (TypeError, ValueError):
        fallback_value = 0.75
    if not math.isfinite(fallback_value):
        fallback_value = 0.75
    fallback_normalized = max(0.0, min(1.0, fallback_value))

    if value is None:
        return fallback_normalized
    raw_value: Any = value
    if isinstance(raw_value, str):
        normalized_text = raw_value.strip().lower()
        if not normalized_text or normalized_text in {"null", "none", "nan", "n/a"}:
            return fallback_normalized
        raw_value = raw_value.strip()

    try:
        parsed = float(raw_value)
    except (TypeError, ValueError):
        return fallback_normalized
    if not math.isfinite(parsed):
        return fallback_normalized
    return max(0.0, min(1.0, parsed))


def normalize_candidate_steps(raw_steps: Any, allowed_actions: set[str]) -> list[dict[str, Any]]:
    if not isinstance(raw_steps, list):
        return []
    normalized_steps: list[dict[str, Any]] = []
    for index, item in enumerate(raw_steps, start=1):
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "").strip().lower()
        if action not in allowed_actions:
            continue

        normalized: dict[str, Any] = {
            "step_id": str(item.get("step_id") or f"s{index}"),
            "action": action,
            "confidence": normalize_confidence(item.get("confidence"), 0.75),
            "evidence_ref": str(item.get("evidence_ref") or "llm:gemini-video"),
        }

        url = item.get("url")
        if isinstance(url, str) and url:
            normalized["url"] = url
        value_ref = item.get("value_ref")
        if isinstance(value_ref, str) and value_ref:
            normalized["value_ref"] = value_ref
        unsupported_reason = item.get("unsupported_reason")
        if isinstance(unsupported_reason, str) and unsupported_reason:
            normalized["unsupported_reason"] = unsupported_reason

        target = item.get("target")
        selectors = normalize_selectors(
            target.get("selectors") if isinstance(target, dict) else None
        )
        if selectors:
            normalized["target"] = {"selectors": selectors}
        normalized_steps.append(normalized)
    return normalized_steps
