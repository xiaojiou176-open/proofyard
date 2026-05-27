#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: scripts/ci/with-heartbeat.sh <interval_sec> <label> <command>" >&2
  exit 2
fi

INTERVAL_SEC="$1"
LABEL="$2"
COMMAND="$3"

if ! [[ "$INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_SEC" -lt 1 ]]; then
  echo "error: interval_sec must be a positive integer" >&2
  exit 2
fi

START_TS="$(date +%s)"

echo "[stage][${LABEL}] START"
bash -lc "$COMMAND" &
CMD_PID="$!"

heartbeat() {
  local now elapsed
  now="$(date +%s)"
  elapsed=$((now - START_TS))
  echo "[heartbeat][${LABEL}] running for ${elapsed}s (pid=${CMD_PID})"
}

while kill -0 "$CMD_PID" >/dev/null 2>&1; do
  sleep "$INTERVAL_SEC"
  if kill -0 "$CMD_PID" >/dev/null 2>&1; then
    heartbeat
  fi
done

set +e
wait "$CMD_PID"
rc=$?
set -e

if [[ "$rc" -eq 0 ]]; then
  END_TS="$(date +%s)"
  echo "[stage][${LABEL}] PASS (duration=$((END_TS - START_TS))s)"
  exit 0
fi

END_TS="$(date +%s)"
echo "[stage][${LABEL}] FAIL (exit ${rc}, duration=$((END_TS - START_TS))s)" >&2
exit "$rc"
