#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

resolve_scratch_root() {
  local raw="${1:-latest}"
  if [[ "$raw" == "latest" ]]; then
    local latest
    latest="$(find .runtime-cache/history-rewrite -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1 || true)"
    if [[ -z "$latest" ]]; then
      echo "error: no history rewrite scratch roots found under .runtime-cache/history-rewrite" >&2
      exit 1
    fi
    printf '%s\n' "$latest"
    return 0
  fi
  if [[ -d "$raw" ]]; then
    printf '%s\n' "$raw"
    return 0
  fi
  if [[ -d ".runtime-cache/history-rewrite/$raw" ]]; then
    printf '%s\n' ".runtime-cache/history-rewrite/$raw"
    return 0
  fi
  echo "error: scratch root not found: $raw" >&2
  exit 1
}

SCRATCH_ROOT="$(resolve_scratch_root "${1:-latest}")"
MIRROR_DIR="${SCRATCH_ROOT}/mirror.git"
REWRITE_DIR="${SCRATCH_ROOT}/rewrite-rehearsal.git"
FRESH_DIR="${SCRATCH_ROOT}/fresh-reaudit.git"
REPORT_JSON="${SCRATCH_ROOT}/rewrite-rehearsal.json"
REPORT_MD="${SCRATCH_ROOT}/rewrite-rehearsal.md"

if [[ ! -d "$MIRROR_DIR" ]]; then
  echo "error: mirror dir missing: $MIRROR_DIR" >&2
  exit 1
fi

rm -rf "$REWRITE_DIR" "$FRESH_DIR"
git clone --mirror "$MIRROR_DIR" "$REWRITE_DIR" >/dev/null

git -C "$REWRITE_DIR" filter-repo \
  --force \
  --invert-paths \
  --path-glob '.runtime-cache/*' \
  --path-glob '.lighthouseci/*' \
  --path-glob 'mutants/*' \
  --path-glob 'reports/*' \
  --path-glob 'artifacts/*' \
  --path-glob 'test-results/*' \
  --path-glob 'node_modules/*' \
  --path-glob 'dist/*' \
  --path-glob 'build/*' \
  --path-glob 'logs/*' \
  --path-glob '.agents/*' >/dev/null

git clone --mirror "$REWRITE_DIR" "$FRESH_DIR" >/dev/null

python3 - <<'PY' "$SCRATCH_ROOT" "$FRESH_DIR" "$REPORT_JSON" "$REPORT_MD"
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

scratch_root = Path(sys.argv[1])
fresh_dir = Path(sys.argv[2])
report_json = Path(sys.argv[3])
report_md = Path(sys.argv[4])

suspicious_prefixes = [
    ".runtime-cache/",
    ".lighthouseci/",
    "mutants/",
    "reports/",
    "artifacts/",
    "test-results/",
    "node_modules/",
    "dist/",
    "build/",
    "logs/",
    ".agents/",
]

def git(*args: str) -> str:
    return subprocess.check_output(
        ["git", f"--git-dir={fresh_dir}", *args],
        encoding="utf-8",
        stderr=subprocess.DEVNULL,
    )

refs = [line.strip() for line in git("for-each-ref", "--format=%(refname)").splitlines() if line.strip()]
heads = [ref for ref in refs if ref.startswith("refs/heads/")]
tags = [ref for ref in refs if ref.startswith("refs/tags/")]
remotes = [ref for ref in refs if ref.startswith("refs/remotes/")]
pull_like = [
    ref for ref in refs
    if ref.startswith("refs/pull/") or ref.startswith("refs/merge-requests/")
]

objects_raw = git("rev-list", "--objects", "--all")
paths = []
for line in objects_raw.splitlines():
    parts = line.strip().split(" ", 1)
    if len(parts) == 2 and parts[1]:
        paths.append(parts[1])

remaining_suspicious_paths = [
    path for path in paths if any(path.startswith(prefix) for prefix in suspicious_prefixes)
]

payload = {
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "scratchRoot": scratch_root.as_posix(),
    "freshMirrorDir": fresh_dir.as_posix(),
    "rewriteScope": {
        "removedPathGlobs": suspicious_prefixes,
    },
    "refs": {
        "heads": heads,
        "tags": tags,
        "remotes": remotes,
        "pullLike": pull_like,
    },
    "summary": {
        "headCount": len(heads),
        "tagCount": len(tags),
        "remoteCount": len(remotes),
        "pullLikeCount": len(pull_like),
        "remainingSuspiciousPathCount": len(remaining_suspicious_paths),
    },
    "remainingSuspiciousPaths": remaining_suspicious_paths[:50],
    "verdict": {
        "rewriteRehearsalPassed": len(pull_like) == 0 and len(remaining_suspicious_paths) == 0,
        "needsOperatorReview": True,
        "remoteRewritePerformed": False,
    },
}

report_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

lines = [
    "# History Rewrite Rehearsal",
    "",
    f"- scratch_root: `{payload['scratchRoot']}`",
    f"- fresh_mirror_dir: `{payload['freshMirrorDir']}`",
    f"- pull_like_refs: {payload['summary']['pullLikeCount']}",
    f"- remaining_suspicious_paths: {payload['summary']['remainingSuspiciousPathCount']}",
    f"- rewrite_rehearsal_passed: `{str(payload['verdict']['rewriteRehearsalPassed']).lower()}`",
    f"- remote_rewrite_performed: `{str(payload['verdict']['remoteRewritePerformed']).lower()}`",
    "",
    "## Removed Path Globs",
    "",
]
lines.extend(f"- `{item}`" for item in suspicious_prefixes)
lines.extend(["", "## Pull-like Refs", ""])
if pull_like:
    lines.extend(f"- `{ref}`" for ref in pull_like)
else:
    lines.append("- none")
lines.extend(["", "## Remaining Suspicious Paths", ""])
if remaining_suspicious_paths:
    lines.extend(f"- `{item}`" for item in remaining_suspicious_paths[:50])
else:
    lines.append("- none")
lines.extend([
    "",
    "## Operator Boundary",
    "",
    "- This rehearsal is local-only and does not rewrite any remote refs.",
    "- Treat this as rewrite-preparation evidence, not as proof that canonical remote history is already clean.",
    "",
])
report_md.write_text("\n".join(lines), encoding="utf-8")
PY

echo "[history-rewrite-rehearsal] ok scratch_root=${SCRATCH_ROOT} report_json=${REPORT_JSON} report_md=${REPORT_MD}"
