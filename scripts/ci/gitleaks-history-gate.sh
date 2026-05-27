#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ARTIFACT_DIR="${UIQ_GITLEAKS_ARTIFACT_DIR:-.runtime-cache/artifacts/ci}"
REPORT_FORMAT="${UIQ_GITLEAKS_REPORT_FORMAT:-json}"
REPORT_PATH="${UIQ_GITLEAKS_REPORT_PATH:-$ARTIFACT_DIR/gitleaks-history.${REPORT_FORMAT}}"
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/proofyard-gitleaks.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

gitleaks_version="$(python3 - <<'PY'
import json
from pathlib import Path

payload = json.loads(Path("configs/ci/runtime.lock.json").read_text(encoding="utf-8"))
print(payload["security_tools"]["gitleaks"])
PY
)"

ensure_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    command -v gitleaks
    return 0
  fi

  local archive="$tmpdir/gitleaks.tar.gz"
  local bin_dir="$tmpdir/bin"
  mkdir -p "$bin_dir"
  curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/gitleaks_${gitleaks_version}_linux_x64.tar.gz" -o "$archive"
  tar -xzf "$archive" -C "$bin_dir" gitleaks
  chmod +x "$bin_dir/gitleaks"
  printf '%s\n' "$bin_dir/gitleaks"
}

mkdir -p "$ARTIFACT_DIR"
gitleaks_bin="$(ensure_gitleaks)"

"$gitleaks_bin" git . \
  --log-opts="--all" \
  --config="configs/security/gitleaks.toml" \
  --exit-code=1 \
  --report-format="$REPORT_FORMAT" \
  --report-path="$REPORT_PATH"

echo "gitleaks history gate passed"
