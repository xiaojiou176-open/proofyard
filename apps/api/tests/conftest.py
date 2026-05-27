from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import pytest


repo_root = Path(__file__).resolve().parents[3]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))


runtime_dir = repo_root / ".runtime-cache" / "artifacts" / "ci" / "test-output" / "backend-tests"
runtime_dir.mkdir(parents=True, exist_ok=True)
pytest_cache_dir = repo_root / ".runtime-cache" / "cache" / "pytest"
pytest_cache_dir.mkdir(parents=True, exist_ok=True)
hypothesis_dir = repo_root / ".runtime-cache" / "cache" / "hypothesis"
hypothesis_dir.mkdir(parents=True, exist_ok=True)
pytest_temp_dir = repo_root / ".runtime-cache" / "temp" / "pytest"
pytest_temp_dir.mkdir(parents=True, exist_ok=True)
worker_id = os.environ.get("PYTEST_XDIST_WORKER", "main")
suite_scope = os.environ.get("UIQ_BACKEND_TEST_SCOPE", "").strip()
scope_prefix = f"{suite_scope}-" if suite_scope else ""
test_db_path = runtime_dir / f"{scope_prefix}backend-tests-{worker_id}.sqlite3"
test_universal_runtime_dir = runtime_dir / f"{scope_prefix}universal-runtime-{worker_id}"
test_universal_runtime_dir.mkdir(parents=True, exist_ok=True)
test_universal_data_dir = test_universal_runtime_dir / "universal"
test_universal_data_dir.mkdir(parents=True, exist_ok=True)

if test_db_path.exists():
    test_db_path.unlink()

os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{test_db_path}"
os.environ["REDIS_URL"] = ""
os.environ["UNIVERSAL_AUTOMATION_RUNTIME_DIR"] = str(test_universal_runtime_dir)
os.environ["UNIVERSAL_PLATFORM_DATA_DIR"] = str(test_universal_data_dir)
os.environ["HYPOTHESIS_STORAGE_DIRECTORY"] = str(hypothesis_dir)


INTEGRATION_SMOKE_TEST_FILES = {
    "apps/api/tests/test_vonage_integration_api.py",
}

INTEGRATION_FULL_TEST_FILES = {
    "apps/api/tests/test_vonage_integration_api.py",
    "apps/api/tests/test_automation_api.py",
    "apps/api/tests/test_computer_use_api.py",
    "apps/api/tests/test_reconstruction_api.py",
    "apps/api/tests/test_universal_platform_runs.py",
}


def pytest_configure(config) -> None:
    config.addinivalue_line("markers", "integration: backend integration suite.")
    config.addinivalue_line("markers", "integration_smoke: PR smoke subset of integration tests.")
    config.addinivalue_line("markers", "integration_full: Nightly full integration suite.")

    invocation_args = [str(item) for item in config.invocation_params.args]
    normalized_targets = {
        arg.split("::", maxsplit=1)[0].strip().rstrip("/")
        for arg in invocation_args
        if arg and not arg.startswith("-")
    }
    is_full_backend_suite = normalized_targets in (set(), {"apps/api/tests"})

    # Keep strict global coverage gate for full-suite runs.
    # Focused test selections should not be blocked by project-wide coverage aggregate.
    if not is_full_backend_suite and hasattr(config.option, "cov_fail_under"):
        config.option.cov_fail_under = 0
        cov_plugin = config.pluginmanager.getplugin("_cov")
        if cov_plugin is not None and hasattr(cov_plugin, "options"):
            cov_plugin.options.cov_fail_under = 0


def _normalize_node_path(node_id: str) -> str:
    return node_id.split("::", maxsplit=1)[0].replace("\\", "/").lstrip("./")


def pytest_collection_modifyitems(items) -> None:
    for item in items:
        node_path = _normalize_node_path(item.nodeid)
        stem = Path(node_path).stem.lower()

        is_integration_full = (
            node_path in INTEGRATION_FULL_TEST_FILES
            or node_path in INTEGRATION_SMOKE_TEST_FILES
            or "integration" in stem
        )
        if not is_integration_full:
            continue

        item.add_marker(pytest.mark.integration)
        item.add_marker(pytest.mark.integration_full)

        if node_path in INTEGRATION_SMOKE_TEST_FILES:
            item.add_marker(pytest.mark.integration_smoke)


@pytest.fixture(autouse=True)
def reset_shared_automation_service_store(
    monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> None:
    from apps.api.app.core.task_store import build_task_store
    from apps.api.app.services.automation_service import automation_service

    node_hash = hashlib.sha1(request.node.nodeid.encode("utf-8")).hexdigest()[:12]
    isolated_db_path = runtime_dir / f"{scope_prefix}backend-tests-{worker_id}-{node_hash}.sqlite3"
    if isolated_db_path.exists():
        isolated_db_path.unlink()
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{isolated_db_path}")
    automation_service._task_store.close()
    automation_service._task_store = build_task_store(automation_service._root)
    with automation_service._lock:
        automation_service._tasks.clear()
        automation_service._idempotency_records.clear()

    yield

    with automation_service._lock:
        automation_service._tasks.clear()
        automation_service._idempotency_records.clear()
