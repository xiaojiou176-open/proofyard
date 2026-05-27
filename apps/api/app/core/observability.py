from __future__ import annotations

from apps.api.app.core.settings import env_str

import os
import json
import logging
import time
import atexit
import traceback
from datetime import datetime, timezone
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

STARTED_AT = time.time()
REQUEST_ID_CTX: ContextVar[str] = ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        context_request_id = REQUEST_ID_CTX.get()
        request_id = context_request_id
        if hasattr(record, "request_id"):
            request_id = record.request_id
        trace_id = request_id
        if hasattr(record, "trace_id"):
            trace_id = record.trace_id
        if trace_id in {None, "", "-"} and request_id:
            trace_id = request_id

        attrs: dict[str, Any] = {"logger": record.name}
        extra_attr_fields = [
            "path",
            "method",
            "status_code",
            "duration_ms",
            "error",
            "audit_reason",
            "task_id",
            "state_path",
            "quarantine_path",
            "runtime_policy",
            "command_id",
            "attempt",
            "max_attempts",
            "requested_by",
            "model",
            "text_count",
            "har_entries",
        ]
        for field in extra_attr_fields:
            if hasattr(record, field):
                attrs[field] = getattr(record, field)
        if record.exc_info:
            exc_type, exc_value, exc_tb = record.exc_info
            attrs["exception"] = {
                "type": exc_type.__name__ if exc_type else "Exception",
                "message": str(exc_value),
                "stack": "".join(traceback.format_exception(exc_type, exc_value, exc_tb)),
            }
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "kind": getattr(record, "kind", "runtime"),
            "service": getattr(record, "service", "api"),
            "component": getattr(record, "component", "backend"),
            "channel": getattr(record, "channel", "backend.runtime"),
            "run_id": getattr(record, "run_id", os.getenv("UIQ_GOVERNANCE_RUN_ID") or os.getenv("UIQ_RUN_ID")),
            "trace_id": None if trace_id in {None, "", "-"} else trace_id,
            "request_id": None if request_id in {None, "", "-"} else request_id,
            "test_id": getattr(record, "test_id", None),
            "event_code": _sanitize_event_code(getattr(record, "event_code", f"backend.{record.name}")),
            "message": record.getMessage(),
            "attrs": attrs,
            "redaction_state": getattr(record, "redaction_state", "unknown"),
            "source_kind": getattr(record, "source_kind", "app"),
        }
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> None:
    log_level = env_str("LOG_LEVEL", "DEBUG").upper()
    runtime_log_dir = Path(".runtime-cache/logs/runtime")
    runtime_log_dir.mkdir(parents=True, exist_ok=True)
    log_file = runtime_log_dir / "apps.api.app.log"
    max_bytes = max(1_048_576, int(env_str("LOG_MAX_BYTES", str(5 * 1_048_576))))
    backup_count = max(2, int(env_str("LOG_BACKUP_COUNT", "5")))

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(JsonFormatter())
    file_handler = RotatingFileHandler(
        log_file, maxBytes=max_bytes, backupCount=backup_count, encoding="utf-8"
    )
    file_handler.setFormatter(JsonFormatter())
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)
    root_logger.setLevel(log_level)
    runtime_policy = _runtime_policy_snapshot()
    logging.getLogger("observability").info(
        "runtime storage policy initialized",
        extra={
            "runtime_policy": runtime_policy,
            "trace_id": "startup",
            "status_code": 0,
            "audit_reason": "bootstrap",
            "event_code": "backend.runtime.bootstrap",
            "redaction_state": "secret-free",
            "service": "api",
            "source_kind": "app",
        },
    )

    @atexit.register
    def _flush_logs() -> None:
        for handler in root_logger.handlers:
            try:
                handler.flush()
                handler.close()
            except Exception:
                continue


def _runtime_policy_snapshot() -> dict[str, Any]:
    runtime_root = Path(os.getenv("RUNTIME_ROOT", ".runtime-cache").strip() or ".runtime-cache")
    runtime_gc_retention_days = _read_non_negative_int_env("RUNTIME_GC_RETENTION_DAYS", 7)
    return {
        "log_retention_days": runtime_gc_retention_days,
        "runtime_gc_retention_days": runtime_gc_retention_days,
        "cache_ttl_seconds": _read_non_negative_int_env("CACHE_TTL_SECONDS", 900),
        "cache_max_entries": _read_non_negative_int_env("CACHE_MAX_ENTRIES", 500),
        "runtime_gc_max_log_size_mb": _read_non_negative_int_env("RUNTIME_GC_MAX_LOG_SIZE_MB", 64),
        "runtime_gc_log_tail_lines": _read_non_negative_int_env("RUNTIME_GC_LOG_TAIL_LINES", 4000),
        "runtime_gc_scope": os.getenv("RUNTIME_GC_SCOPE", "all").strip() or "all",
        "runtime_gc_keep_runs": _read_non_negative_int_env("RUNTIME_GC_KEEP_RUNS", 50),
        "runtime_gc_max_delete_per_run": _read_non_negative_int_env(
            "RUNTIME_GC_MAX_DELETE_PER_RUN", 500
        ),
        "runtime_gc_fail_on_error": _read_bool_env("RUNTIME_GC_FAIL_ON_ERROR", False),
        "runtime_rotating_log_max_bytes": _read_non_negative_int_env(
            "LOG_MAX_BYTES", 5 * 1_048_576
        ),
        "runtime_rotating_log_backup_count": _read_non_negative_int_env("LOG_BACKUP_COUNT", 5),
        "runtime_logs_dir": os.getenv("RUNTIME_LOG_DIR", str(runtime_root / "logs")).strip()
        or str(runtime_root / "logs"),
        "runtime_cache_dir": os.getenv("RUNTIME_CACHE_DIR", str(runtime_root / "cache")).strip()
        or str(runtime_root / "cache"),
        "runtime_gc_state_path": os.getenv(
            "RUNTIME_GC_STATE_PATH", str(runtime_root / "metrics" / "runtime-gc-state.json")
        ).strip()
        or str(runtime_root / "metrics" / "runtime-gc-state.json"),
    }


def _read_non_negative_int_env(key: str, default: int) -> int:
    raw = os.getenv(key, str(default)).strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(0, value)


def _read_bool_env(key: str, default: bool) -> bool:
    raw = os.getenv(key, "true" if default else "false").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _sanitize_event_code(raw_value: str) -> str:
    normalized = "".join(
        character.lower() if character.isalnum() else "."
        for character in str(raw_value).strip()
    )
    normalized = ".".join(segment for segment in normalized.split(".") if segment)
    return normalized or "backend.runtime.event"


def configure_tracing() -> bool:
    enabled = os.getenv("TRACING_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return False

    tracer_logger = logging.getLogger("tracing")
    exporter = os.getenv("TRACING_EXPORTER", "console").strip().lower() or "console"
    service_name = os.getenv("TRACING_SERVICE_NAME", "uiq-backend").strip() or "uiq-backend"

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    except Exception as exc:  # pragma: no cover - optional dependency branch
        tracer_logger.warning(
            "tracing enabled but opentelemetry packages are unavailable", extra={"error": str(exc)}
        )
        return False

    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    if exporter == "otlp":
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            exporter_kwargs: dict[str, str] = {}
            endpoint = os.getenv("TRACING_OTLP_ENDPOINT", "").strip()
            headers = os.getenv("TRACING_OTLP_HEADERS", "").strip()
            if endpoint:
                exporter_kwargs["endpoint"] = endpoint
            if headers:
                exporter_kwargs["headers"] = headers
            span_exporter = OTLPSpanExporter(**exporter_kwargs)
        except Exception as exc:  # pragma: no cover - optional dependency branch
            tracer_logger.warning(
                "otlp exporter unavailable, fallback to console exporter",
                extra={"error": str(exc)},
            )
            span_exporter = ConsoleSpanExporter()
    else:
        span_exporter = ConsoleSpanExporter()

    provider.add_span_processor(BatchSpanProcessor(span_exporter))
    trace.set_tracer_provider(provider)
    tracer_logger.info(
        "tracing initialized", extra={"exporter": exporter, "service_name": service_name}
    )
    return True
