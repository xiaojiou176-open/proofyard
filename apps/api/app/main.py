from apps.api.app.core.settings import env_str

from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from apps.api.app.api.health import build_prometheus_payload
from apps.api.app.api import api_router
from apps.api.app.core.middleware import RequestContextMiddleware
from apps.api.app.core.observability import configure_logging, configure_tracing
from apps.api.config.settings import load_settings

configure_logging()
configure_tracing()
settings = load_settings()
app = FastAPI(title=settings.app_name)


def _split_csv_env(raw_value: str) -> list[str]:
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def _validated_cors_origins(raw_value: str) -> list[str]:
    origins = _split_csv_env(raw_value)
    if not origins:
        raise RuntimeError("CORS_ALLOWED_ORIGINS must contain at least one explicit origin")
    for origin in origins:
        lowered = origin.lower()
        if lowered in {"*", "null"}:
            raise RuntimeError("CORS_ALLOWED_ORIGINS cannot contain wildcard or null origin")
        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise RuntimeError(f"CORS_ALLOWED_ORIGINS has invalid origin: {origin}")
    return origins


def _validated_trusted_hosts(raw_value: str) -> list[str]:
    hosts = _split_csv_env(raw_value)
    if not hosts:
        raise RuntimeError("TRUSTED_HOSTS must contain at least one host")
    for host in hosts:
        if host == "*":
            raise RuntimeError("TRUSTED_HOSTS cannot contain wildcard '*'")
        if "://" in host or "/" in host:
            raise RuntimeError(f"TRUSTED_HOSTS has invalid host entry: {host}")
    return hosts


allowed_origins = _validated_cors_origins(
    env_str("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:17373,http://localhost:17373")
)
allowed_hosts = _validated_trusted_hosts(env_str("TRUSTED_HOSTS", "127.0.0.1,localhost,testserver"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
app.add_middleware(RequestContextMiddleware)
app.include_router(api_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "service ready"}


@app.get("/metrics", response_class=PlainTextResponse)
def metrics() -> str:
    return build_prometheus_payload()
