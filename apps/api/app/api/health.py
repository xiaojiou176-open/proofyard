from apps.api.app.core.settings import env_str

import time

from fastapi import APIRouter
from fastapi import Header, Request
from fastapi import status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from apps.api.app.core.access_control import require_access
from apps.api.app.core.metrics import runtime_metrics
from apps.api.app.core.observability import STARTED_AT
from apps.api.app.services.automation_service import automation_service

router = APIRouter(prefix="/health", tags=["health"])


class RumMetricIngestRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    metric_name: str = Field(alias="metric")
    value: float
    rating: str | None = None
    path: str | None = None
    navigation_type: str | None = Field(default=None, alias="navigationType")
    timestamp_ms: float | None = Field(default=None, alias="timestampMs")


@router.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/diagnostics")
def diagnostics(
    request: Request, x_automation_token: str | None = Header(default=None)
) -> dict[str, object]:
    require_access(request, x_automation_token)
    return build_diagnostics_payload()


def build_diagnostics_payload() -> dict[str, object]:
    summary = automation_service.task_summary()
    return {
        "status": "ok",
        "uptime_seconds": int(time.time() - STARTED_AT),
        "storage_backend": automation_service.storage_backend(),
        "task_counts": {
            "queued": summary["queued"],
            "running": summary["running"],
            "success": summary["success"],
            "failed": summary["failed"],
            "cancelled": summary["cancelled"],
        },
        "task_total": summary["total"],
        "metrics": runtime_metrics.snapshot(),
    }


@router.get("/alerts")
def alerts(
    request: Request, x_automation_token: str | None = Header(default=None)
) -> dict[str, object]:
    require_access(request, x_automation_token)
    return build_alerts_payload()


def build_alerts_payload() -> dict[str, object]:
    summary = automation_service.task_summary()
    completed = summary["completed"]
    failed = summary["failed_completed"]
    failure_rate = (failed / completed) if completed else 0.0
    threshold = _parse_failure_threshold()
    state = "ok" if failure_rate <= threshold else "degraded"
    return {
        "state": state,
        "failure_rate": round(failure_rate, 4),
        "threshold": threshold,
        "completed": completed,
        "failed": failed,
    }


def _parse_failure_threshold() -> float:
    raw = env_str("AUTOMATION_FAILURE_ALERT_THRESHOLD", "0.2").strip()
    try:
        value = float(raw)
    except ValueError:
        return 0.2
    return min(1.0, max(0.0, value))


@router.get("/metrics", response_class=PlainTextResponse)
def metrics() -> str:
    return build_prometheus_payload()


def build_prometheus_payload() -> str:
    summary = automation_service.task_summary()
    return runtime_metrics.render_prometheus_text(summary)


@router.post("/rum", status_code=status.HTTP_202_ACCEPTED)
def ingest_rum(payload: RumMetricIngestRequest) -> dict[str, object]:
    runtime_metrics.record_rum_metric(payload.metric_name, payload.value)
    rum_snapshot = runtime_metrics.snapshot().get("rum", {})
    return {
        "status": "accepted",
        "metric": payload.metric_name.upper(),
        "samples_total": int(rum_snapshot.get("samples_total", 0))
        if isinstance(rum_snapshot, dict)
        else 0,
    }
