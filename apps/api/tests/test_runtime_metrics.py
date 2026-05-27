from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from apps.api.app.core.metrics import RuntimeMetrics


def _build_metrics(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> RuntimeMetrics:
    monkeypatch.setenv("RUM_SUMMARY_PATH", str(tmp_path / "metrics" / "rum-summary.json"))
    monkeypatch.setenv("RUNTIME_ROOT", str(tmp_path))
    monkeypatch.setenv("RUNTIME_LOG_DIR", str(tmp_path / "logs"))
    monkeypatch.setenv("RUNTIME_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("RUNTIME_GC_STATE_PATH", str(tmp_path / "metrics" / "runtime-gc-state.json"))
    return RuntimeMetrics()


def test_record_request_covers_latency_bucket_overflow_and_invalid_values(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    metrics = _build_metrics(monkeypatch, tmp_path)

    metrics.record_request(200, 0.01)
    metrics.record_request(201, 15.0)
    metrics.record_request(202, None)
    metrics.record_request(203, float("nan"))
    metrics.record_request(204, float("inf"))
    metrics.record_request(205, -0.001)

    snapshot = metrics.snapshot()
    latency = snapshot["request_latency"]

    assert snapshot["requests_total"] == 6
    assert snapshot["request_status"]["2xx"] == 6
    assert latency["count"] == 2
    assert latency["sum_seconds"] == 15.01
    assert latency["max_seconds"] == 15.0
    assert latency["buckets"]["0.01"] == 1
    assert metrics._request_latency_overflow == 1


def test_record_rum_metric_ignores_empty_or_invalid_values_and_persists_valid_sample(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    metrics = _build_metrics(monkeypatch, tmp_path)
    rum_path = tmp_path / "metrics" / "rum-summary.json"

    metrics.record_rum_metric("   ", 1.0)
    metrics.record_rum_metric("LCP", -1.0)
    metrics.record_rum_metric("LCP", float("inf"))

    assert not rum_path.exists()

    metrics.record_rum_metric("  lcp  ", 123.456)
    assert rum_path.exists()

    payload = json.loads(rum_path.read_text(encoding="utf-8"))
    assert payload["samples_total"] == 1
    assert payload["metrics"]["LCP"]["samples"] == 1
    assert payload["metrics"]["LCP"]["avg"] == 123.456
    assert payload["metrics"]["LCP"]["latest"] == 123.456
    assert list(rum_path.parent.glob(f"{rum_path.name}.*.tmp")) == []


def test_snapshot_and_render_prometheus_text_include_automation_and_runtime_storage(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir(parents=True)
    (logs_dir / "app.log").write_text("abcdef", encoding="utf-8")
    link_target = logs_dir / "skip-target.txt"
    link_target.write_text("12345", encoding="utf-8")
    (logs_dir / "skip-link.txt").symlink_to(link_target)

    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True)
    (cache_dir / "cache.bin").write_bytes(b"1234")

    gc_state_path = tmp_path / "metrics" / "runtime-gc-state.json"
    gc_state_path.parent.mkdir(parents=True)
    gc_state_path.write_text(
        json.dumps(
            {
                "last_run_at": "2024-01-02T03:04:05Z",
                "duration_seconds": "1.5",
                "deleted": {"logs": "2", "runs": 3, "cache": "4", "total": "9"},
                "errors": "5",
                "error_total": "8",
                "bytes_freed": "11",
                "bytes_freed_total": "20",
            }
        ),
        encoding="utf-8",
    )

    metrics = _build_metrics(monkeypatch, tmp_path)
    metrics.record_request(500, 0.02)
    metrics.record_automation_run()
    metrics.record_automation_failure()
    metrics.record_automation_cancellation()
    metrics.record_rate_limited()
    metrics.record_rate_limit_redis_error()
    metrics.record_task_store_decode_error()
    metrics.record_rum_metric("LCP", 250.0)

    snapshot = metrics.snapshot()
    assert snapshot["runtime_storage"]["logs_size_bytes"] == 11
    assert snapshot["runtime_storage"]["cache_size_bytes"] == 4
    assert snapshot["runtime_storage"]["gc"]["total_deleted"] == 9
    assert snapshot["runtime_storage"]["gc"]["error_total"] == 8
    assert snapshot["runtime_storage"]["gc"]["bytes_freed_total"] == 20

    rendered = metrics.render_prometheus_text(
        {"queued": 1, "running": 2, "success": 3, "failed": 4, "cancelled": 5, "total": 15}
    )
    assert 'uiq_automation_tasks{status="queued"} 1' in rendered
    assert 'uiq_automation_tasks{status="total"} 15' in rendered
    assert 'uiq_http_request_duration_seconds_bucket{le="+Inf"} 1' in rendered
    assert 'uiq_rum_metric_latest{metric="LCP"} 250.0' in rendered
    assert "uiq_runtime_gc_last_run_timestamp_seconds 1704164645.0" in rendered


def test_directory_size_bytes_handles_missing_directory_and_skips_symlink(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    metrics = _build_metrics(monkeypatch, tmp_path)

    assert metrics._directory_size_bytes(tmp_path / "missing-dir") == 0

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    target_file = data_dir / "target.bin"
    target_file.write_bytes(b"x" * 7)
    (data_dir / "alias.bin").symlink_to(target_file)

    assert metrics._directory_size_bytes(data_dir) == 7


def test_load_runtime_gc_state_handles_missing_broken_non_dict_and_complete_payload(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    metrics = _build_metrics(monkeypatch, tmp_path)

    assert metrics._load_runtime_gc_state()["last_run_at"] == ""

    metrics._runtime_gc_state_path.parent.mkdir(parents=True, exist_ok=True)
    metrics._runtime_gc_state_path.write_text("{broken", encoding="utf-8")
    assert metrics._load_runtime_gc_state()["duration_seconds"] == 0.0

    metrics._runtime_gc_state_path.write_text(json.dumps(["not-dict"]), encoding="utf-8")
    assert metrics._load_runtime_gc_state()["logs_deleted"] == 0

    metrics._runtime_gc_state_path.write_text(
        json.dumps(
            {
                "last_run_at": "2024-02-01T00:00:00",
                "duration_seconds": "3.5",
                "deleted": {"logs": "1", "runs": "2", "cache": "3"},
                "errors": "4",
                "bytes_freed": "16",
            }
        ),
        encoding="utf-8",
    )
    loaded = metrics._load_runtime_gc_state()
    assert loaded["logs_deleted"] == 1
    assert loaded["runs_deleted"] == 2
    assert loaded["cache_deleted"] == 3
    assert loaded["total_deleted"] == 6
    assert loaded["errors"] == 4
    assert loaded["error_total"] == 4
    assert loaded["bytes_freed"] == 16
    assert loaded["bytes_freed_total"] == 16


def test_coerce_helpers_and_to_unix_timestamp_cover_branches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    metrics = _build_metrics(monkeypatch, tmp_path)

    assert metrics._coerce_non_negative_int("12") == 12
    assert metrics._coerce_non_negative_int(-1) == 0
    assert metrics._coerce_non_negative_int("bad") == 0
    assert metrics._coerce_non_negative_float("2.5") == 2.5
    assert metrics._coerce_non_negative_float(-0.5) == 0.0
    assert metrics._coerce_non_negative_float("bad") == 0.0

    assert metrics._to_unix_timestamp(123) == 0.0
    assert metrics._to_unix_timestamp("   ") == 0.0
    assert metrics._to_unix_timestamp("not-a-date") == 0.0

    naive_dt = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    assert metrics._to_unix_timestamp("2024-01-02T03:04:05") == round(naive_dt.timestamp(), 3)
    assert metrics._to_unix_timestamp("2024-01-02T03:04:05Z") == round(naive_dt.timestamp(), 3)
