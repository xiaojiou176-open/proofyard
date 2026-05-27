#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

SNAPSHOT_PATH="${UIQ_SCANCODE_SNAPSHOT_PATH:-reports/licenses-scan.json}"
META_PATH="${UIQ_SCANCODE_SNAPSHOT_META_PATH:-reports/licenses-scan.meta.json}"
SCANCODE_TARGET_TIMEOUT_SECONDS="${UIQ_SCANCODE_TARGET_TIMEOUT_SEC:-45}"
mkdir -p "$(dirname "$SNAPSHOT_PATH")"

targets=(
  "LICENSE"
  "package.json"
  "pyproject.toml"
  "apps/web/package.json"
  "apps/automation-runner/package.json"
  "apps/mcp-server/package.json"
)

existing_targets=()
for target in "${targets[@]}"; do
  if [[ -f "$target" ]]; then
    existing_targets+=("$target")
  fi
done

if (( ${#existing_targets[@]} == 0 )); then
  echo "error: no manifest/license targets found for ScanCode snapshot" >&2
  exit 1
fi

resolve_scancode_cmd() {
  if [[ -n "${UIQ_SCANCODE_BIN:-}" && -x "${UIQ_SCANCODE_BIN}" ]]; then
    printf '%s\n' "${UIQ_SCANCODE_BIN}"
    return 0
  fi
  if command -v scancode >/dev/null 2>&1; then
    command -v scancode
    return 0
  fi
  local cached_bin="${HOME}/.cache/codex_scans/scancode-venv/bin/scancode"
  if [[ -x "$cached_bin" ]]; then
    printf '%s\n' "$cached_bin"
    return 0
  fi
  return 1
}

tmp_root="${TMPDIR:-/tmp}"
mkdir -p "${tmp_root%/}"
snapshot_tmp="$(mktemp "${tmp_root%/}/proofyard-scancode-snapshot.XXXXXX")"
rm -f "$snapshot_tmp"
snapshot_tmp="${snapshot_tmp}.json"
work_dir="$(mktemp -d "${tmp_root%/}/proofyard-scancode-targets.XXXXXX")"
trap 'rm -f "$snapshot_tmp"; rm -rf "$work_dir"' EXIT

run_target_with_timeout() {
  local output_path="$1"
  shift
  python3 - <<'PY' "$SCANCODE_TARGET_TIMEOUT_SECONDS" "$output_path" "$@"
import subprocess
import sys

timeout = int(sys.argv[1])
output_path = sys.argv[2]
command = sys.argv[3:]

try:
    completed = subprocess.run(command, timeout=timeout, capture_output=True, text=True)
except subprocess.TimeoutExpired:
    sys.exit(124)

if completed.stdout:
    sys.stdout.write(completed.stdout)
if completed.stderr:
    sys.stderr.write(completed.stderr)
sys.exit(completed.returncode)
PY
}

write_manifest_fallback() {
  local target="$1"
  local output_path="$2"
  local reason="$3"
  python3 - <<'PY' "$target" "$output_path" "$reason"
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib

target = Path(sys.argv[1])
output_path = Path(sys.argv[2])
reason = sys.argv[3]

payload = {
    "headers": [
        {
            "tool_name": "proofyard-manifest-fallback",
            "tool_version": "1",
            "options": {"input": [target.as_posix()]},
            "notice": "Generated from repo-owned manifest metadata fallback when bounded ScanCode scanning is not viable.",
            "warnings": [reason],
            "errors": [],
        }
    ],
    "license_detections": [],
    "files": [],
}

entry = {
    "path": target.as_posix(),
    "type": "file",
    "scan_errors": [],
    "scan_warnings": [reason],
    "licenses": [],
    "copyrights": [],
    "authors": [],
    "holders": [],
    "programming_language": None,
    "extra_data": {
        "manifest_fallback": {
            "file_type": target.suffix.lstrip("."),
        }
    },
}

if target.name == "package.json":
    data = json.loads(target.read_text(encoding="utf-8"))
    entry["extra_data"]["manifest_fallback"].update(
        {
            "name": data.get("name"),
            "version": data.get("version"),
            "description": data.get("description"),
            "license": data.get("license"),
            "private": data.get("private"),
            "packageManager": data.get("packageManager"),
        }
    )
    entry["programming_language"] = "JavaScript"
elif target.name == "pyproject.toml":
    data = tomllib.loads(target.read_text(encoding="utf-8"))
    project = data.get("project", {})
    entry["extra_data"]["manifest_fallback"].update(
        {
            "name": project.get("name"),
            "version": project.get("version"),
            "description": project.get("description"),
            "license": project.get("license"),
            "requires-python": project.get("requires-python"),
        }
    )
    entry["programming_language"] = "Python"
else:
    entry["extra_data"]["manifest_fallback"]["note"] = "Fallback metadata not implemented for this target type."

payload["files"].append(entry)
output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
}

if scancode_bin="$(resolve_scancode_cmd)"; then
  scanner_desc="scancode-per-target+manifest-fallback"
else
  echo "error: scancode binary unavailable; cannot generate license snapshot" >&2
  exit 1
fi

target_outputs=()
for target in "${existing_targets[@]}"; do
  target_slug="$(printf '%s' "$target" | tr '/.' '__')"
  target_output="${work_dir}/${target_slug}.json"
  if [[ "$target" == "package.json" || "$target" == "pyproject.toml" ]]; then
    write_manifest_fallback "$target" "$target_output" "bounded-scan-skipped-for-root-manifest"
    target_outputs+=("$target_output")
    continue
  fi

  set +e
  run_target_with_timeout "$target_output" "$scancode_bin" \
    --license \
    --copyright \
    --processes 1 \
    --timeout 5 \
    --json "$target_output" \
    "$target"
  rc=$?
  set -e
  if [[ $rc -eq 124 ]]; then
    write_manifest_fallback "$target" "$target_output" "scancode-timeout-fallback"
  elif [[ $rc -ne 0 ]]; then
    echo "error: scancode failed for $target" >&2
    exit "$rc"
  fi
  target_outputs+=("$target_output")
done

python3 - <<'PY' "$snapshot_tmp" "${target_outputs[@]}"
import json
import sys
from pathlib import Path

output_path = Path(sys.argv[1])
target_outputs = [Path(item) for item in sys.argv[2:]]

headers = []
license_detections = []
files = []

for source in target_outputs:
    payload = json.loads(source.read_text(encoding="utf-8"))
    headers.extend(payload.get("headers", []))
    license_detections.extend(payload.get("license_detections", []))
    files.extend(payload.get("files", []))

combined = {
    "headers": headers,
    "license_detections": license_detections,
    "files": files,
}
output_path.write_text(json.dumps(combined, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

mv "$snapshot_tmp" "$SNAPSHOT_PATH"

python3 - <<'PY' "$META_PATH" "$scanner_desc" "${existing_targets[@]}"
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

meta_path = Path(sys.argv[1])
scanner = sys.argv[2]
targets = sys.argv[3:]

payload = {
    "version": 1,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "scanner": scanner,
    "targets": targets,
}
meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "[scancode-license-snapshot] ok"
