from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel


class BackendSettings(BaseModel):
    host: str
    port: int


class AppSettings(BaseModel):
    app_name: str
    environment: str
    backend: BackendSettings


_APP_ENV_ALIASES = {
    "prod": "production",
    "stage": "staging",
}


def _resolve_app_env() -> str:
    raw = (os.getenv("APP_ENV", "production") or "production").strip().lower()
    return _APP_ENV_ALIASES.get(raw, raw)


def load_settings() -> AppSettings:
    env = _resolve_app_env()
    root = Path(__file__).resolve().parent
    path = root / f"{env}.json"
    if not path.exists():
        raise ValueError(f"unsupported APP_ENV '{env}': config file not found at {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return AppSettings.model_validate(data)
