#!/usr/bin/env bash
set -euo pipefail

threshold="${UIQ_JSCPD_THRESHOLD:-3}"
strict_mode="${UIQ_JSCPD_STRICT:-false}"
tmp_log="$(mktemp -t jscpd.XXXXXX.log)"
trap 'rm -f "$tmp_log"' EXIT

set +e
npx --yes jscpd \
  --threshold "${threshold}" \
  --reporters console \
  --format "typescript,javascript,python,jsx,tsx,css,scss,html,sh" \
  --ignore "**/node_modules/**,**/.venv/**,**/dist/**,**/build/**,**/coverage/**,**/.runtime-cache/**,**/artifacts/**,**/mutants/**,**/__tests__/**,**/tests/**,**/*.test.*,**/*.spec.*" \
  apps packages scripts configs contracts 2>&1 | tee "$tmp_log"
status="${PIPESTATUS[0]}"
set -e

if [[ "$status" -eq 0 ]]; then
  echo "[jscpd-gate] pass: duplication threshold <= ${threshold}%"
  exit 0
fi

if [[ "${strict_mode}" == "true" ]]; then
  echo "[jscpd-gate] fail: strict mode enabled (UIQ_JSCPD_STRICT=true)" >&2
  exit 1
fi

echo "[jscpd-gate] warning: duplication exceeded ${threshold}% (non-blocking, set UIQ_JSCPD_STRICT=true to enforce)" >&2
exit 0
