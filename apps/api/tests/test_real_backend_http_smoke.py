from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path
from tempfile import mkdtemp
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[2]
REAL_BACKEND_ENABLED = os.getenv("UIQ_ENABLE_REAL_BACKEND_TESTS", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
} or os.getenv("CI", "").strip().lower() == "true"


def _reserve_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _http_json(
    method: str,
    url: str,
    *,
    payload: dict[str, object] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 5.0,
) -> tuple[int, dict[str, object]]:
    request_headers = {"content-type": "application/json"}
    if headers:
        request_headers.update(headers)
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(url=url, data=body, method=method.upper(), headers=request_headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            parsed = json.loads(text) if text else {}
            if isinstance(parsed, dict):
                return int(response.status), parsed
            raise AssertionError(f"expected JSON object from {url}, got: {type(parsed).__name__}")
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"HTTP {exc.code} from {method} {url}: {raw}") from exc


def _wait_backend_ready(base_url: str, process: subprocess.Popen[str], log_path: Path) -> None:
    deadline = time.time() + 30.0
    while time.time() < deadline:
        if process.poll() is not None:
            tail = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
            raise AssertionError(
                f"real backend exited early with code={process.returncode}\n{tail}"
            )
        try:
            status, payload = _http_json("GET", f"{base_url}/health/", timeout=1.0)
            if status == 200 and payload.get("status") == "ok":
                return
        except (AssertionError, URLError):
            pass
        time.sleep(0.2)
    tail = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]
    raise AssertionError(f"timed out waiting for {base_url}/health/\n{tail}")


def _stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5.0)


def test_real_backend_http_smoke_sessions_flows_and_automation() -> None:
    if not REAL_BACKEND_ENABLED:
        return

    runtime_root = Path(mkdtemp(prefix="uiq-real-backend-smoke-"))
    data_dir = runtime_root / "universal-data"
    automation_runtime_dir = runtime_root / "universal-runtime"
    sqlite_path = runtime_root / "automation-smoke.sqlite3"
    log_path = runtime_root / "uvicorn.log"

    port = _reserve_port()
    base_url = f"http://127.0.0.1:{port}"

    env = dict(os.environ)
    env.update(
        {
            "APP_ENV": "test",
            "AUTOMATION_ALLOW_LOCAL_NO_TOKEN": "true",
            "AUTOMATION_REQUIRE_TOKEN": "false",
            "DATABASE_URL": f"sqlite+pysqlite:///{sqlite_path}",
            "UNIVERSAL_PLATFORM_DATA_DIR": str(data_dir),
            "UNIVERSAL_AUTOMATION_RUNTIME_DIR": str(automation_runtime_dir),
        }
    )

    log_handle = log_path.open("w+", encoding="utf-8")
    process = subprocess.Popen(
        [
            "uv",
            "run",
            "--frozen",
            "--extra",
            "dev",
            "uvicorn",
            "apps.api.app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=str(REPO_ROOT),
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        _wait_backend_ready(base_url, process, log_path)

        status_code, health_payload = _http_json("GET", f"{base_url}/health/")
        assert status_code == 200
        assert health_payload == {"status": "ok"}

        common_headers = {"x-automation-client-id": "pytest-real-http-smoke"}
        diagnostics_status, diagnostics_payload = _http_json(
            "GET",
            f"{base_url}/health/diagnostics",
            headers=common_headers,
        )
        assert diagnostics_status == 200
        assert diagnostics_payload["status"] == "ok"
        assert diagnostics_payload["storage_backend"] in {"file", "sql"}
        assert isinstance(diagnostics_payload["metrics"], dict)

        start_status, session_payload = _http_json(
            "POST",
            f"{base_url}/api/sessions/start",
            payload={
                "start_url": "https://example.com/register",
                "mode": "manual",
            },
            headers=common_headers,
        )
        assert start_status == 200
        session_id = str(session_payload["session_id"])
        assert session_id.startswith("ss_")

        sessions_status, sessions_payload = _http_json(
            "GET",
            f"{base_url}/api/sessions?limit=10",
            headers=common_headers,
        )
        assert sessions_status == 200
        sessions = sessions_payload.get("sessions")
        assert isinstance(sessions, list)
        assert any(item.get("session_id") == session_id for item in sessions if isinstance(item, dict))

        flow_status, flow_payload = _http_json(
            "POST",
            f"{base_url}/api/flows",
            payload={
                "session_id": session_id,
                "start_url": "https://example.com/register",
                "source_event_count": 1,
                "steps": [
                    {
                        "step_id": "s1",
                        "action": "navigate",
                        "url": "https://example.com/register",
                    }
                ],
            },
            headers=common_headers,
        )
        assert flow_status == 200
        flow_id = str(flow_payload["flow_id"])
        assert flow_id.startswith("fl_")

        flows_status, flows_payload = _http_json(
            "GET",
            f"{base_url}/api/flows?limit=10",
            headers=common_headers,
        )
        assert flows_status == 200
        flows = flows_payload.get("flows")
        assert isinstance(flows, list)
        assert any(item.get("flow_id") == flow_id for item in flows if isinstance(item, dict))

        commands_status, commands_payload = _http_json(
            "GET",
            f"{base_url}/api/automation/commands",
            headers=common_headers,
        )
        assert commands_status == 200
        commands = commands_payload.get("commands")
        assert isinstance(commands, list)
        command_ids = {
            item.get("command_id")
            for item in commands
            if isinstance(item, dict) and isinstance(item.get("command_id"), str)
        }
        assert "run" in command_ids

        tasks_status, tasks_payload = _http_json(
            "GET",
            f"{base_url}/api/automation/tasks?limit=5",
            headers=common_headers,
        )
        assert tasks_status == 200
        assert isinstance(tasks_payload.get("tasks"), list)

        sessions_file = data_dir / "sessions.json"
        flows_file = data_dir / "flows.json"
        assert sessions_file.exists()
        assert flows_file.exists()
        stored_sessions = json.loads(sessions_file.read_text(encoding="utf-8"))
        stored_flows = json.loads(flows_file.read_text(encoding="utf-8"))
        assert any(item.get("session_id") == session_id for item in stored_sessions)
        assert any(item.get("flow_id") == flow_id for item in stored_flows)
    finally:
        _stop_process(process)
        log_handle.close()
        shutil.rmtree(runtime_root, ignore_errors=True)
