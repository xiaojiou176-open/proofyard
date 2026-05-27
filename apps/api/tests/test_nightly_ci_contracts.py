from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
NIGHTLY_WORKFLOW_PATH = REPO_ROOT / ".github/workflows/nightly.yml"
CI_WORKFLOW_PATH = REPO_ROOT / ".github/workflows/ci.yml"
WORKFLOW_DIR = REPO_ROOT / ".github/workflows"
QUALITY_GATES_DOC_PATH = REPO_ROOT / "docs/quality-gates.md"
JOB_REPRO_SCRIPT_PATH = REPO_ROOT / "scripts/ci/job-repro-command.sh"
FAILURE_BUNDLE_SCRIPT_PATH = REPO_ROOT / "scripts/ci/make-failure-bundle.sh"
WORKSPACE_FORBIDDEN_CACHE_VARS = (
    "UV_CACHE_DIR",
    "PIP_CACHE_DIR",
    "TMPDIR",
    "RUNNER_TOOL_CACHE",
    "AGENT_TOOLSDIRECTORY",
)
CLEAN_FALSE_ALLOW_MARKER = "workspace-hygiene: allow-checkout-clean-false"
FORBIDDEN_PRE_COMMIT_HOME_PATTERNS = (
    "~/.cache/pre-commit",
    "${HOME}/.cache/pre-commit",
    "$HOME/.cache/pre-commit",
)


def _workflow_text() -> str:
    return NIGHTLY_WORKFLOW_PATH.read_text(encoding="utf-8")


def _workflow_text_from(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _workflow_paths() -> list[Path]:
    return sorted(WORKFLOW_DIR.glob("*.yml"))


def _step_block_from(path: Path, step_name: str) -> str:
    text = _workflow_text_from(path)
    marker = f"      - name: {step_name}\n"
    start = text.find(marker)
    assert start != -1, f"step not found: {step_name}"
    next_step = text.find("\n      - name: ", start + len(marker))
    if next_step == -1:
        return text[start:]
    return text[start:next_step]


def _step_block(step_name: str) -> str:
    return _step_block_from(NIGHTLY_WORKFLOW_PATH, step_name)


def _extract_heredoc_python_blocks(step_block: str) -> list[str]:
    blocks: list[str] = []
    marker = "python - <<'PY'\n"
    cursor = 0
    while True:
        start = step_block.find(marker, cursor)
        if start == -1:
            return blocks
        body_start = start + len(marker)
        end = step_block.find("\n          PY", body_start)
        assert end != -1, "unterminated python heredoc block"
        blocks.append(textwrap.dedent(step_block[body_start:end]))
        cursor = end + 1


def _extract_run_script(step_block: str) -> str:
    lines = step_block.splitlines()
    run_index = -1
    for idx, line in enumerate(lines):
        if line.strip() == "run: |":
            run_index = idx
            break
    assert run_index != -1, "run: | block not found"

    script_lines: list[str] = []
    for line in lines[run_index + 1 :]:
        if not line.startswith("          "):
            break
        script_lines.append(line[10:])
    return "\n".join(script_lines) + "\n"


def _require_script(path: Path) -> None:
    assert path.exists(), f"missing script in this checkout: {path}"


def _workflow_lines(path: Path) -> list[str]:
    return _workflow_text_from(path).splitlines()


def _path_value_is_workspace_or_repo_relative(raw_value: str) -> bool:
    value = raw_value.strip().strip("\"'")
    lowered = value.lower()
    workspace_tokens = (
        "${{ github.workspace }}",
        "$GITHUB_WORKSPACE",
        "${GITHUB_WORKSPACE}",
    )
    if any(token.lower() in lowered for token in workspace_tokens):
        return True
    return value.startswith(("./", "../", ".runtime-cache", ".", "cache/", "tmp/", "tools/"))


def _find_env_assignments(path: Path, variable: str) -> list[tuple[int, str]]:
    pattern = re.compile(rf"^\s*{re.escape(variable)}:\s*(?P<value>.+?)\s*$")
    matches: list[tuple[int, str]] = []
    for lineno, line in enumerate(_workflow_lines(path), start=1):
        match = pattern.match(line)
        if match:
            matches.append((lineno, match.group("value")))
    return matches


def test_job_repro_command_script_usage_error() -> None:
    _require_script(JOB_REPRO_SCRIPT_PATH)
    result = subprocess.run(
        ["bash", str(JOB_REPRO_SCRIPT_PATH)],
        check=False,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 2
    assert "Usage: scripts/ci/job-repro-command.sh <job-name>" in result.stderr


def test_job_repro_command_script_normalize_and_mapping() -> None:
    _require_script(JOB_REPRO_SCRIPT_PATH)
    backend = subprocess.run(
        ["bash", str(JOB_REPRO_SCRIPT_PATH), "backend"],
        check=True,
        text=True,
        capture_output=True,
    )
    assert "uv run pytest" in backend.stdout
    assert "scripts/check-db-migrations.sh" in backend.stdout

    normalized = subprocess.run(
        ["bash", str(JOB_REPRO_SCRIPT_PATH), "CI / root_web_ct"],
        check=True,
        text=True,
        capture_output=True,
    )
    assert "pnpm test:ct" in normalized.stdout

    unknown = subprocess.run(
        ["bash", str(JOB_REPRO_SCRIPT_PATH), "unknown-job"],
        check=True,
        text=True,
        capture_output=True,
    )
    assert "# Unknown CI job: unknown-job" in unknown.stdout
    assert ".github/workflows/ci.yml" in unknown.stdout


def test_make_failure_bundle_script_usage_and_outputs(tmp_path: Path) -> None:
    _require_script(FAILURE_BUNDLE_SCRIPT_PATH)
    shadow_repo = tmp_path / "repo"
    shadow_ci = shadow_repo / "scripts/ci"
    shadow_ci.mkdir(parents=True, exist_ok=True)
    shadow_job_repro = shadow_ci / "job-repro-command.sh"
    shadow_bundle = shadow_ci / "make-failure-bundle.sh"
    shutil.copy2(JOB_REPRO_SCRIPT_PATH, shadow_job_repro)
    shutil.copy2(FAILURE_BUNDLE_SCRIPT_PATH, shadow_bundle)
    shadow_job_repro.chmod(0o755)
    shadow_bundle.chmod(0o755)

    usage = subprocess.run(
        ["bash", str(shadow_bundle)],
        check=False,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "FAILURE_BUNDLE_JOB": "",
            "CI_JOB_NAME": "",
            "GITHUB_JOB": "",
        },
    )
    assert usage.returncode == 2
    assert "Usage: scripts/ci/make-failure-bundle.sh <job-name> [output-dir]" in usage.stderr

    out_dir = tmp_path / "bundle-out"
    run = subprocess.run(
        ["bash", str(shadow_bundle), "nightly-gate", str(out_dir)],
        check=True,
        text=True,
        capture_output=True,
    )
    assert f"bundle_dir={out_dir}" in run.stdout
    assert f"bundle_index={out_dir / 'bundle-index.json'}" in run.stdout

    bundle_index = out_dir / "bundle-index.json"
    repro = out_dir / "repro.md"
    env_file = out_dir / "env.txt"
    paths_file = out_dir / "paths.txt"
    assert bundle_index.exists()
    assert repro.exists()
    assert env_file.exists()
    assert paths_file.exists()

    payload = json.loads(bundle_index.read_text(encoding="utf-8"))
    assert payload["job_name"] == "nightly-gate"
    assert payload["safe_job"] == "nightly-gate"
    assert payload["bundle_dir"] == str(out_dir)
    assert payload["files"]["repro"] == str(repro)
    assert payload["files"]["env"] == str(env_file)
    assert payload["files"]["paths"] == str(paths_file)
    assert payload["runtime_cache"]["root_exists"] is False
    assert payload["runtime_cache"]["subset_count"] == 0
    assert payload["runtime_cache"]["manifest"] is None
    assert payload["runtime_cache"]["tar"] is None
    assert isinstance(payload["runtime_cache"]["tar_created"], bool)

    repro_text = repro.read_text(encoding="utf-8")
    assert "Minimal Reproduction Command" in repro_text
    assert "bash scripts/ci/run-in-container.sh --task nightly-core-run --gate nightly-core-run" in repro_text


def test_nightly_workflow_strict_fallback_and_bundle_paths() -> None:
    text = _workflow_text()
    assert "bash scripts/ci/run-in-container.sh --task nightly-core-run --gate nightly-core-run" in text

    nightly_run = _step_block("Run Nightly Core Gate")
    assert 'UIQ_ORCHESTRATOR_PARALLEL: "1"' in nightly_run
    assert 'UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS: "6"' in nightly_run
    assert 'UIQ_CI_IMAGE_REF: ${{ needs.build_ci_image.outputs.image_ref }}' in nightly_run
    assert "bash scripts/ci/run-in-container.sh --task nightly-core-run --gate nightly-core-run" in nightly_run

    status_step = _step_block("Write nightly fallback status evidence")
    assert "PRIMARY_OUTCOME" in status_step
    assert "FALLBACK_OUTCOME" in status_step
    assert "nightly-fallback-status.json" in status_step

    upload = _step_block("Upload Artifacts")
    assert ".runtime-cache/artifacts/runs/" in upload
    assert ".runtime-cache/artifacts/ci/" in upload
    assert ".runtime-cache/artifacts/perf/" in upload
    assert ".runtime-cache/artifacts/api/" in upload

    failure_build = _step_block("Build failure bundle")
    assert "if: ${{ failure() || cancelled() }}" in failure_build
    assert "bash scripts/ci/make-failure-bundle.sh || true" in failure_build
    failure_upload = _step_block("Upload failure bundle artifact")
    assert "if: ${{ failure() || cancelled() }}" in failure_upload
    assert ".runtime-cache/artifacts/ci/failure-bundles/" in failure_upload


def test_nightly_fallback_status_schema_and_defaults() -> None:
    status_step = _step_block("Write nightly fallback status evidence")
    assert "PRIMARY_OUTCOME" in status_step
    assert "FALLBACK_OUTCOME" in status_step
    assert "nightly-fallback-status.json" in status_step

    python_blocks = _extract_heredoc_python_blocks(status_step)
    assert len(python_blocks) >= 2
    status_writer = python_blocks[-1]

    for key in (
        "primary_outcome",
        "fallback_outcome",
        "strict_failure_enforced",
        "session_dir",
        "generated_at",
    ):
        assert f'"{key}"' in status_writer

    assert 'os.environ.get("PRIMARY_OUTCOME", "unknown")' in status_writer
    assert 'os.environ.get("FALLBACK_OUTCOME", "skipped")' in status_writer
    assert 'os.environ.get("SESSION_DIR", "")' in status_writer
    assert 'os.environ.get("GENERATED_AT", "")' in status_writer
    assert 'os.environ.get("STRICT_FAILURE_ENFORCED", "false").lower() == "true"' in status_writer


def test_nightly_fallback_status_writer_runtime_semantics(tmp_path: Path) -> None:
    status_step = _step_block("Write nightly fallback status evidence")
    status_writer = _extract_heredoc_python_blocks(status_step)[-1]
    cases = (
        ("success", "skipped", "false", False),
        ("failure", "success", "true", True),
    )
    for primary_outcome, fallback_outcome, strict_env, strict_expected in cases:
        env = os.environ.copy()
        env.update(
            {
                "PRIMARY_OUTCOME": primary_outcome,
                "FALLBACK_OUTCOME": fallback_outcome,
                "STRICT_FAILURE_ENFORCED": strict_env,
                "SESSION_DIR": "",
                "GENERATED_AT": "2026-02-21T09:00:00Z",
            }
        )
        (tmp_path / ".runtime-cache/automation").mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [sys.executable, "-c", status_writer],
            check=True,
            cwd=tmp_path,
            env=env,
            text=True,
            capture_output=True,
        )
        status_file = tmp_path / ".runtime-cache/automation/nightly-fallback-status.json"
        payload = json.loads(status_file.read_text(encoding="utf-8"))
        assert payload["primary_outcome"] == primary_outcome
        assert payload["fallback_outcome"] == fallback_outcome
        assert payload["strict_failure_enforced"] is strict_expected
        assert payload["generated_at"] == "2026-02-21T09:00:00Z"
        assert payload["session_dir"] == ""


def test_ci_required_gate_duration_artifact_contract() -> None:
    text = _workflow_text_from(CI_WORKFLOW_PATH)
    assert "name: Collect required gate durations" in text
    assert ".runtime-cache/artifacts/ci/gate-duration-report.json" in text
    required_gate_step = _step_block_from(CI_WORKFLOW_PATH, "Collect required gate durations")
    assert (
        "https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100"
        in required_gate_step
    )
    assert "required_gates = [" in required_gate_step
    assert 'with open(summary_path, "a", encoding="utf-8") as f:' in required_gate_step


def test_ci_failure_bundle_hooks_use_cancelled_or_failure_and_expected_paths() -> None:
    ci_text = _workflow_text_from(CI_WORKFLOW_PATH)
    assert "if: ${{ failure() || cancelled() }}" in ci_text
    assert "bash scripts/ci/make-failure-bundle.sh || true" in ci_text
    assert ".runtime-cache/artifacts/ci/failure-bundles/" in ci_text


def test_workspace_hygiene_documentation_contract() -> None:
    doc_text = QUALITY_GATES_DOC_PATH.read_text(encoding="utf-8")
    assert "## Workspace Hygiene Contract" in doc_text
    assert "Artifacts/reports/logs may live under `.runtime-cache/`" in doc_text
    assert "`UV_CACHE_DIR`" in doc_text
    assert "`PIP_CACHE_DIR`" in doc_text
    assert "`TMPDIR`" in doc_text
    assert "`RUNNER_TOOL_CACHE`" in doc_text
    assert "`AGENT_TOOLSDIRECTORY`" in doc_text
    assert "`PRE_COMMIT_HOME`" in doc_text
    assert "${{ runner.temp }}/pre-commit" in doc_text
    assert "${{ runner.temp }}/uv-cache" in doc_text
    assert "${{ runner.temp }}/pip-cache" in doc_text
    assert "${{ runner.tool_cache }}" in doc_text
    assert CLEAN_FALSE_ALLOW_MARKER in doc_text


def test_workspace_hygiene_forbids_shared_pre_commit_home() -> None:
    violations: list[str] = []
    for workflow_path in _workflow_paths():
        for lineno, value in _find_env_assignments(workflow_path, "PRE_COMMIT_HOME"):
            normalized = value.strip().strip("\"'")
            if normalized in FORBIDDEN_PRE_COMMIT_HOME_PATTERNS:
                violations.append(f"{workflow_path.relative_to(REPO_ROOT)}:{lineno} -> {normalized}")

    assert not violations, (
        "PRE_COMMIT_HOME must use an isolated runner-temp path such as "
        "${{ runner.temp }}/pre-commit; found forbidden shared cache paths:\n"
        + "\n".join(violations)
    )


def test_workspace_hygiene_forbids_workspace_backed_tool_tmp_and_cache_dirs() -> None:
    violations: list[str] = []
    for workflow_path in _workflow_paths():
        for variable in WORKSPACE_FORBIDDEN_CACHE_VARS:
            for lineno, value in _find_env_assignments(workflow_path, variable):
                if _path_value_is_workspace_or_repo_relative(value):
                    violations.append(
                        f"{workflow_path.relative_to(REPO_ROOT)}:{lineno} -> {variable}={value.strip()}"
                    )

    assert not violations, (
        "Tool/tmp/cache directories must stay outside the repo workspace. "
        "Use runner temp or runner tool cache paths and document any exception:\n"
        + "\n".join(violations)
    )


def test_checkout_clean_false_requires_workspace_hygiene_whitelist_marker() -> None:
    violations: list[str] = []
    for workflow_path in _workflow_paths():
        lines = _workflow_lines(workflow_path)
        for lineno, line in enumerate(lines, start=1):
            if line.strip() != "clean: false":
                continue
            context_start = max(0, lineno - 4)
            context = "\n".join(lines[context_start:lineno])
            if CLEAN_FALSE_ALLOW_MARKER not in context:
                violations.append(f"{workflow_path.relative_to(REPO_ROOT)}:{lineno}")

    assert not violations, (
        "`actions/checkout clean: false` requires an explicit workspace hygiene whitelist marker "
        f"({CLEAN_FALSE_ALLOW_MARKER}) immediately above the checkout step:\n"
        + "\n".join(violations)
    )
