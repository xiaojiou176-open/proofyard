from __future__ import annotations

import builtins
import json
import logging
import sys
from types import ModuleType
from typing import Any

import pytest

from apps.api.app.core import observability as obs


@pytest.fixture(autouse=True)
def _isolate_root_logger() -> Any:
    root = logging.getLogger()
    old_handlers = list(root.handlers)
    old_level = root.level
    try:
        yield
    finally:
        current_handlers = list(root.handlers)
        root.handlers.clear()
        for handler in current_handlers:
            if handler in old_handlers:
                continue
            try:
                handler.flush()
                handler.close()
            except Exception:
                pass
        for handler in old_handlers:
            root.addHandler(handler)
        root.setLevel(old_level)


def test_read_non_negative_int_env_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBS_INT_ENV", "")
    assert obs._read_non_negative_int_env("OBS_INT_ENV", 7) == 7

    monkeypatch.setenv("OBS_INT_ENV", "invalid")
    assert obs._read_non_negative_int_env("OBS_INT_ENV", 7) == 7

    monkeypatch.setenv("OBS_INT_ENV", "-3")
    assert obs._read_non_negative_int_env("OBS_INT_ENV", 7) == 0

    monkeypatch.setenv("OBS_INT_ENV", "42")
    assert obs._read_non_negative_int_env("OBS_INT_ENV", 7) == 42


def test_read_bool_env_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OBS_BOOL_ENV", "   ")
    assert obs._read_bool_env("OBS_BOOL_ENV", default=True) is True

    monkeypatch.setenv("OBS_BOOL_ENV", "YeS")
    assert obs._read_bool_env("OBS_BOOL_ENV", default=False) is True

    monkeypatch.setenv("OBS_BOOL_ENV", "off")
    assert obs._read_bool_env("OBS_BOOL_ENV", default=True) is False


def test_runtime_policy_snapshot_defaults_and_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RUNTIME_ROOT", "   ")
    monkeypatch.setenv("RUNTIME_GC_SCOPE", "   ")
    monkeypatch.delenv("CACHE_TTL_SECONDS", raising=False)
    monkeypatch.delenv("RUNTIME_GC_RETENTION_DAYS", raising=False)

    defaults = obs._runtime_policy_snapshot()
    assert defaults["log_retention_days"] == 7
    assert defaults["runtime_gc_scope"] == "all"
    assert defaults["runtime_logs_dir"].endswith(".runtime-cache/logs")
    assert defaults["runtime_gc_state_path"].endswith(
        ".runtime-cache/metrics/runtime-gc-state.json"
    )

    monkeypatch.setenv("RUNTIME_ROOT", "/tmp/runtime-x")
    monkeypatch.setenv("RUNTIME_GC_RETENTION_DAYS", "11")
    monkeypatch.setenv("CACHE_TTL_SECONDS", "123")
    monkeypatch.setenv("CACHE_MAX_ENTRIES", "321")
    monkeypatch.setenv("RUNTIME_GC_MAX_LOG_SIZE_MB", "8")
    monkeypatch.setenv("RUNTIME_GC_LOG_TAIL_LINES", "77")
    monkeypatch.setenv("RUNTIME_GC_SCOPE", "logs")
    monkeypatch.setenv("RUNTIME_GC_KEEP_RUNS", "5")
    monkeypatch.setenv("RUNTIME_GC_MAX_DELETE_PER_RUN", "20")
    monkeypatch.setenv("RUNTIME_GC_FAIL_ON_ERROR", "yes")
    monkeypatch.setenv("LOG_MAX_BYTES", "2222222")
    monkeypatch.setenv("LOG_BACKUP_COUNT", "9")
    monkeypatch.setenv("RUNTIME_LOG_DIR", "/custom/logs")
    monkeypatch.setenv("RUNTIME_CACHE_DIR", "/custom/cache")
    monkeypatch.setenv("RUNTIME_GC_STATE_PATH", "/custom/state.json")

    overrides = obs._runtime_policy_snapshot()
    assert overrides["log_retention_days"] == 11
    assert overrides["cache_ttl_seconds"] == 123
    assert overrides["cache_max_entries"] == 321
    assert overrides["runtime_gc_max_log_size_mb"] == 8
    assert overrides["runtime_gc_log_tail_lines"] == 77
    assert overrides["runtime_gc_scope"] == "logs"
    assert overrides["runtime_gc_keep_runs"] == 5
    assert overrides["runtime_gc_max_delete_per_run"] == 20
    assert overrides["runtime_gc_fail_on_error"] is True
    assert overrides["runtime_rotating_log_max_bytes"] == 2222222
    assert overrides["runtime_rotating_log_backup_count"] == 9
    assert overrides["runtime_logs_dir"] == "/custom/logs"
    assert overrides["runtime_cache_dir"] == "/custom/cache"
    assert overrides["runtime_gc_state_path"] == "/custom/state.json"


def test_json_formatter_basic_record() -> None:
    formatter = obs.JsonFormatter()
    token = obs.REQUEST_ID_CTX.set("ctx-basic")
    try:
        record = logging.LogRecord(
            name="unit.test",
            level=logging.INFO,
            pathname=__file__,
            lineno=10,
            msg="hello %s",
            args=("world",),
            exc_info=None,
        )
        payload = json.loads(formatter.format(record))
    finally:
        obs.REQUEST_ID_CTX.reset(token)

    assert payload["component"] == "backend"
    assert payload["channel"] == "backend.runtime"
    assert payload["kind"] == "runtime"
    assert payload["level"] == "info"
    assert payload["message"] == "hello world"
    assert payload["request_id"] == "ctx-basic"
    assert payload["trace_id"] == "ctx-basic"
    assert payload["event_code"] == "backend.unit.test"
    assert payload["attrs"]["logger"] == "unit.test"


def test_json_formatter_with_extra_exc_info_and_trace_fallback() -> None:
    formatter = obs.JsonFormatter()
    token = obs.REQUEST_ID_CTX.set("-")
    try:
        try:
            raise RuntimeError("boom")
        except RuntimeError:
            exc_info = sys.exc_info()
        record = logging.LogRecord(
            name="unit.test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=50,
            msg="failed",
            args=(),
            exc_info=exc_info,
        )
        record.request_id = "req-1"
        record.trace_id = "-"
        record.path = "/api/demo"
        record.method = "POST"
        record.status_code = 500
        record.task_id = "task-1"
        payload = json.loads(formatter.format(record))
    finally:
        obs.REQUEST_ID_CTX.reset(token)

    assert payload["request_id"] == "req-1"
    assert payload["trace_id"] == "req-1"
    assert payload["attrs"]["path"] == "/api/demo"
    assert payload["attrs"]["method"] == "POST"
    assert payload["attrs"]["status_code"] == 500
    assert payload["attrs"]["task_id"] == "task-1"
    assert payload["attrs"]["exception"]["type"] == "RuntimeError"
    assert payload["attrs"]["exception"]["message"] == "boom"
    assert "RuntimeError: boom" in payload["attrs"]["exception"]["stack"]


def test_json_formatter_includes_extended_runtime_fields() -> None:
    formatter = obs.JsonFormatter()
    record = logging.LogRecord(
        name="unit.extended",
        level=logging.INFO,
        pathname=__file__,
        lineno=99,
        msg="extended",
        args=(),
        exc_info=None,
    )
    record.state_path = "/tmp/tasks.json"
    record.quarantine_path = "/tmp/tasks.json.corrupt"
    record.model = "gemini-3.1-pro-preview"
    record.text_count = 2
    record.har_entries = 7
    payload = json.loads(formatter.format(record))

    assert payload["attrs"]["state_path"] == "/tmp/tasks.json"
    assert payload["attrs"]["quarantine_path"] == "/tmp/tasks.json.corrupt"
    assert payload["attrs"]["model"] == "gemini-3.1-pro-preview"
    assert payload["attrs"]["text_count"] == 2
    assert payload["attrs"]["har_entries"] == 7


def test_configure_tracing_disabled_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRACING_ENABLED", "false")
    assert obs.configure_tracing() is False


def test_configure_tracing_missing_dependency_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRACING_ENABLED", "true")

    original_import = builtins.__import__

    def _fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name.startswith("opentelemetry"):
            raise ImportError("missing opentelemetry")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _fake_import)
    assert obs.configure_tracing() is False


def test_configure_tracing_console_exporter_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRACING_ENABLED", "true")
    monkeypatch.setenv("TRACING_EXPORTER", "console")
    monkeypatch.setenv("TRACING_SERVICE_NAME", "svc-x")

    provider_bucket: dict[str, Any] = {}

    opentelemetry_mod = ModuleType("opentelemetry")
    trace_mod = ModuleType("opentelemetry.trace")

    def _set_tracer_provider(provider: Any) -> None:
        provider_bucket["provider"] = provider

    trace_mod.set_tracer_provider = _set_tracer_provider  # type: ignore[attr-defined]
    opentelemetry_mod.trace = trace_mod  # type: ignore[attr-defined]

    sdk_mod = ModuleType("opentelemetry.sdk")
    resources_mod = ModuleType("opentelemetry.sdk.resources")
    trace_sdk_mod = ModuleType("opentelemetry.sdk.trace")
    export_mod = ModuleType("opentelemetry.sdk.trace.export")

    class FakeResource:
        @staticmethod
        def create(values: dict[str, Any]) -> dict[str, Any]:
            return {"resource": values}

    class FakeTracerProvider:
        def __init__(self, resource: dict[str, Any]) -> None:
            self.resource = resource
            self.processors: list[Any] = []

        def add_span_processor(self, processor: Any) -> None:
            self.processors.append(processor)

    class FakeConsoleSpanExporter:
        pass

    class FakeBatchSpanProcessor:
        def __init__(self, exporter: Any) -> None:
            self.exporter = exporter

    resources_mod.Resource = FakeResource  # type: ignore[attr-defined]
    trace_sdk_mod.TracerProvider = FakeTracerProvider  # type: ignore[attr-defined]
    export_mod.BatchSpanProcessor = FakeBatchSpanProcessor  # type: ignore[attr-defined]
    export_mod.ConsoleSpanExporter = FakeConsoleSpanExporter  # type: ignore[attr-defined]
    sdk_mod.resources = resources_mod  # type: ignore[attr-defined]
    sdk_mod.trace = trace_sdk_mod  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "opentelemetry", opentelemetry_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.trace", trace_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk", sdk_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.resources", resources_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.trace", trace_sdk_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.trace.export", export_mod)

    assert obs.configure_tracing() is True
    provider = provider_bucket["provider"]
    assert provider.resource == {"resource": {"service.name": "svc-x"}}
    assert len(provider.processors) == 1
    assert isinstance(provider.processors[0].exporter, FakeConsoleSpanExporter)


def test_configure_tracing_otlp_exporter_uses_endpoint_and_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRACING_ENABLED", "true")
    monkeypatch.setenv("TRACING_EXPORTER", "otlp")
    monkeypatch.setenv("TRACING_OTLP_ENDPOINT", "https://otlp.example.com")
    monkeypatch.setenv("TRACING_OTLP_HEADERS", "x-api-key=abc")

    provider_bucket: dict[str, Any] = {}
    otlp_kwargs: dict[str, str] = {}

    opentelemetry_mod = ModuleType("opentelemetry")
    trace_mod = ModuleType("opentelemetry.trace")

    def _set_tracer_provider(provider: Any) -> None:
        provider_bucket["provider"] = provider

    trace_mod.set_tracer_provider = _set_tracer_provider  # type: ignore[attr-defined]
    opentelemetry_mod.trace = trace_mod  # type: ignore[attr-defined]

    sdk_mod = ModuleType("opentelemetry.sdk")
    resources_mod = ModuleType("opentelemetry.sdk.resources")
    trace_sdk_mod = ModuleType("opentelemetry.sdk.trace")
    export_mod = ModuleType("opentelemetry.sdk.trace.export")
    otlp_mod = ModuleType("opentelemetry.exporter.otlp.proto.http.trace_exporter")

    class FakeResource:
        @staticmethod
        def create(values: dict[str, Any]) -> dict[str, Any]:
            return {"resource": values}

    class FakeTracerProvider:
        def __init__(self, resource: dict[str, Any]) -> None:
            self.resource = resource
            self.processors: list[Any] = []

        def add_span_processor(self, processor: Any) -> None:
            self.processors.append(processor)

    class FakeBatchSpanProcessor:
        def __init__(self, exporter: Any) -> None:
            self.exporter = exporter

    class FakeConsoleSpanExporter:
        pass

    class FakeOTLPSpanExporter:
        def __init__(self, **kwargs: str) -> None:
            otlp_kwargs.update(kwargs)

    resources_mod.Resource = FakeResource  # type: ignore[attr-defined]
    trace_sdk_mod.TracerProvider = FakeTracerProvider  # type: ignore[attr-defined]
    export_mod.BatchSpanProcessor = FakeBatchSpanProcessor  # type: ignore[attr-defined]
    export_mod.ConsoleSpanExporter = FakeConsoleSpanExporter  # type: ignore[attr-defined]
    otlp_mod.OTLPSpanExporter = FakeOTLPSpanExporter  # type: ignore[attr-defined]
    sdk_mod.resources = resources_mod  # type: ignore[attr-defined]
    sdk_mod.trace = trace_sdk_mod  # type: ignore[attr-defined]

    monkeypatch.setitem(sys.modules, "opentelemetry", opentelemetry_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.trace", trace_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk", sdk_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.resources", resources_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.trace", trace_sdk_mod)
    monkeypatch.setitem(sys.modules, "opentelemetry.sdk.trace.export", export_mod)
    monkeypatch.setitem(
        sys.modules, "opentelemetry.exporter.otlp.proto.http.trace_exporter", otlp_mod
    )

    assert obs.configure_tracing() is True
    provider = provider_bucket["provider"]
    assert len(provider.processors) == 1
    assert otlp_kwargs == {
        "endpoint": "https://otlp.example.com",
        "headers": "x-api-key=abc",
    }


def test_configure_logging_sets_root_handlers(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LOG_LEVEL", "warning")
    monkeypatch.setenv("LOG_MAX_BYTES", "128")
    monkeypatch.setenv("LOG_BACKUP_COUNT", "1")

    obs.configure_logging()

    root = logging.getLogger()
    assert root.level == logging.WARNING
    assert len(root.handlers) == 2

    stream_handlers = [h for h in root.handlers if isinstance(h, logging.StreamHandler)]
    rotating_handlers = [h for h in root.handlers if hasattr(h, "baseFilename")]
    assert stream_handlers
    assert rotating_handlers
    assert rotating_handlers[0].maxBytes == 1_048_576
    assert rotating_handlers[0].backupCount == 2
    assert str(rotating_handlers[0].baseFilename).endswith(
        ".runtime-cache/logs/runtime/apps.api.app.log"
    )


def test_configure_logging_atexit_flush_tolerates_handler_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    callbacks: list[Any] = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(obs.atexit, "register", lambda fn: callbacks.append(fn) or fn)

    obs.configure_logging()
    root = logging.getLogger()

    class BrokenHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            _ = record

        def flush(self) -> None:
            raise OSError("flush failed")

    root.addHandler(BrokenHandler())
    assert callbacks
    callbacks[0]()
