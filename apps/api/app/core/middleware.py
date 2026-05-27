from __future__ import annotations

import logging
import os
import time
from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from apps.api.app.core.metrics import runtime_metrics
from apps.api.app.core.observability import REQUEST_ID_CTX

logger = logging.getLogger("http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id", str(uuid4()))
        request.state.request_id = request_id
        token = REQUEST_ID_CTX.set(request_id)
        start = time.perf_counter()
        runtime_metrics.increment_active_requests()
        response: Response | None = None
        status_code = 500
        request_error: Exception | None = None
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception as exc:
            request_error = exc
        finally:
            elapsed_seconds = time.perf_counter() - start
            elapsed_ms = round(elapsed_seconds * 1000, 2)
            runtime_metrics.record_request(status_code, elapsed_seconds)
            runtime_metrics.decrement_active_requests()

            if response is not None:
                response.headers["x-request-id"] = request_id
                response.headers["x-content-type-options"] = "nosniff"
                response.headers["x-frame-options"] = "DENY"
                response.headers["referrer-policy"] = "same-origin"
                response.headers["permissions-policy"] = "geolocation=(), microphone=(), camera=()"
                response.headers["cache-control"] = "no-store"
                response.headers["content-security-policy"] = (
                    "default-src 'self'; frame-ancestors 'none'; base-uri 'self'"
                )
                if os.getenv("APP_ENV", "development").lower() in {"production", "staging"}:
                    response.headers["strict-transport-security"] = (
                        "max-age=31536000; includeSubDomains"
                    )

            log_extra = {
                "request_id": request_id,
                "trace_id": request_id,
                "path": request.url.path,
                "method": request.method,
                "status_code": status_code,
                "duration_ms": elapsed_ms,
            }
            if request_error is None:
                logger.info(
                    "request completed",
                    extra={**log_extra, "audit_reason": "request_completed"},
                )
            else:
                logger.exception(
                    "request failed",
                    exc_info=(type(request_error), request_error, request_error.__traceback__),
                    extra={
                        **log_extra,
                        "error": str(request_error),
                        "audit_reason": "request_unhandled_exception",
                    },
                )
            REQUEST_ID_CTX.reset(token)

        if request_error is not None:
            raise request_error
        if response is None:  # pragma: no cover - defensive guard
            raise RuntimeError("response is unavailable after middleware dispatch")
        return response
