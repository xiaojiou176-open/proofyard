from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "scripts" / "ci" / "wait-http-ready.py"


def _base_env() -> dict[str, str]:
    env = dict(os.environ)
    env.update(
        {
            "INPUT_HOST": "127.0.0.1",
            "INPUT_PORT": "9",
            "INPUT_READY_TIMEOUT_SEC": "0.2",
            "INPUT_READY_INITIAL_DELAY_SEC": "0.01",
            "INPUT_READY_MAX_DELAY_SEC": "0.02",
            "INPUT_READY_JITTER_RATIO": "0",
        }
    )
    return env


def test_wait_http_ready_reports_last_error_on_timeout() -> None:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        env=_base_env(),
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode != 0
    assert "last_error=" in completed.stderr


def test_wait_http_ready_rejects_invalid_float_env() -> None:
    env = _base_env()
    env["INPUT_READY_TIMEOUT_SEC"] = "not-a-number"
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode != 0
    assert "must be a float" in completed.stderr
