#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

tmp_dir="$(mktemp -d ".runtime-cache/test-matrix-failfast.XXXXXX")"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

child_pid_file="$tmp_dir/child.pid"
long_runner="$tmp_dir/long-runner.sh"
fast_fail="$tmp_dir/fast-fail.sh"

cat >"$long_runner" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import os
import signal
import subprocess

child = subprocess.Popen([
    "python3",
    "-c",
    "import signal,time\n"
    "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
    "signal.signal(signal.SIGINT, signal.SIG_IGN)\n"
    "while True:\n"
    "    time.sleep(0.2)\n",
])
pid_file = os.environ["UIQ_TEST_CHILD_PID_FILE"]
with open(pid_file, "w", encoding="utf-8") as handle:
    handle.write(str(child.pid))
child.wait()
PY
SH
chmod +x "$long_runner"

cat >"$fast_fail" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
sleep 0.2
exit 1
SH
chmod +x "$fast_fail"

export UIQ_TEST_CHILD_PID_FILE="$child_pid_file"
export UIQ_TEST_MATRIX_ALLOW_CMD_OVERRIDE=1
export UIQ_TEST_MATRIX_ALLOW_UNSAFE_OVERRIDE=1
export UIQ_SUITE_WEB_E2E=1
export UIQ_SUITE_FRONTEND_E2E=0
export UIQ_SUITE_FRONTEND_UNIT=1
export UIQ_SUITE_BACKEND=0
export UIQ_SUITE_AUTOMATION_CHECK=0
export UIQ_SUITE_ORCHESTRATOR_MCP=0
export UIQ_FAILFAST_TERM_GRACE_SEC=1
export UIQ_TEST_LOG_DIR="$tmp_dir/logs"
export UIQ_TEST_MATRIX_CMD_APPS_WEB_E2E="$long_runner"
export UIQ_TEST_MATRIX_CMD_FRONTEND_UNIT="$fast_fail"

set +e
output="$(bash scripts/test-matrix.sh parallel 2>&1)"
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "expected test-matrix to fail fast, but it succeeded" >&2
  exit 1
fi

if grep -Fq "[spawn] apps-web-e2e" <<<"$output"; then
  echo "did not expect long suite apps-web-e2e to spawn when short phase failed first" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

if ! grep -Fq "[phase] short-tests" <<<"$output"; then
  echo "expected short phase banner in output" >&2
  printf '%s\n' "$output" >&2
  exit 1
fi

echo "test-matrix short-first fail-fast passed"
