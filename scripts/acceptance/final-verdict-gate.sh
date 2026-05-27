#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

OUT_DIR=".runtime-cache/acceptance"
OUT_FILE="$OUT_DIR/final-verdict.json"
mkdir -p "$OUT_DIR"
TMP_LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/uiq-final-verdict.XXXXXX")"
TMP_REPORT_FILE="$(mktemp "$TMP_LOG_DIR/final-verdict.XXXXXX.json")"

ROWS=""
CRITICAL_FAILED=0
HIGH_FAILED=0

cleanup() {
  rm -rf "$TMP_LOG_DIR"
}
trap cleanup EXIT

latest_run_dir() {
  find ".runtime-cache/artifacts/runs" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | while IFS= read -r dir; do
    local mtime
    mtime="$(stat -f '%m' "$dir" 2>/dev/null || stat -c '%Y' "$dir" 2>/dev/null || echo 0)"
    printf '%s\t%s\n' "$mtime" "$dir"
  done | sort -nr | head -1 | cut -f2-
}

append_row() {
  local id="$1" level="$2" status="$3" cmd="$4" evidence="$5"
  ROWS="${ROWS}
    {\"id\":\"$id\",\"level\":\"$level\",\"status\":\"$status\",\"command\":\"$cmd\",\"evidence\":\"$evidence\"},"
  if [ "$status" != "PASS" ]; then
    if [ "$level" = "CRITICAL" ]; then
      CRITICAL_FAILED=$((CRITICAL_FAILED + 1))
    elif [ "$level" = "HIGH" ]; then
      HIGH_FAILED=$((HIGH_FAILED + 1))
    fi
  fi
}

run_check() {
  local id="$1" level="$2" cmd="$3"
  local log_file
  log_file="$(mktemp "$TMP_LOG_DIR/${id}.XXXX.log")"
  if bash -lc "$cmd" >"$log_file" 2>&1; then
    append_row "$id" "$level" "PASS" "$cmd" "$log_file"
  else
    append_row "$id" "$level" "FAIL" "$cmd" "$log_file"
  fi
}

verify_profile_summary() {
  local id="$1" level="$2" cmd="$3"
  local before after summary status log_file
  log_file="$(mktemp "$TMP_LOG_DIR/${id}.XXXX.log")"
  before="$(latest_run_dir || true)"
  if ! bash -lc "$cmd" >"$log_file" 2>&1; then
    append_row "$id" "$level" "FAIL" "$cmd" "$log_file"
    return
  fi
  after="$(latest_run_dir || true)"
  summary="$after/reports/summary.json"
  if [ "$after" = "$before" ] || [ ! -f "$summary" ]; then
    append_row "$id" "$level" "FAIL" "$cmd" "missing summary.json"
    return
  fi
  status="$(node -e "const fs=require('fs');const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(j.status||''));" "$summary" 2>/dev/null)"
  if [ "$status" = "passed" ]; then
    append_row "$id" "$level" "PASS" "$cmd" "$summary"
  else
    append_row "$id" "$level" "FAIL" "$cmd" "$summary"
  fi
}

run_check "critical_typecheck" "CRITICAL" "pnpm typecheck"
run_check "high_frontend_unit" "HIGH" "pnpm --dir apps/web test"
run_check "high_ct" "HIGH" "pnpm test:ct"
run_check "high_e2e_smoke" "HIGH" "pnpm test:e2e -- --grep @smoke"
verify_profile_summary "high_pr_profile_local_quality" "HIGH" "pnpm uiq run --profile pr --target web.local"
verify_profile_summary "high_nightly_profile_local_quality" "HIGH" "pnpm uiq run --profile nightly --target web.local"

overall="FAIL"
[ "$CRITICAL_FAILED" -eq 0 ] && overall="PASS"

cat >"$TMP_REPORT_FILE" <<EOF
{
  "generatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "overall": "$overall",
  "criticalFailed": $CRITICAL_FAILED,
  "highFailed": $HIGH_FAILED,
  "checks": [${ROWS%,}
  ]
}
EOF
mv "$TMP_REPORT_FILE" "$OUT_FILE"

echo "[final-verdict] overall=$overall"
echo "[final-verdict] report=$OUT_FILE"
[ "$overall" = "PASS" ]
