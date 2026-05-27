#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/load-env.sh"
source "$ROOT_DIR/scripts/lib/python-runtime.sh"
load_env_files "$ROOT_DIR"
ensure_project_python_env_exports

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm not found"
  exit 1
fi

if [[ ! -x "$(project_python_bin)" ]]; then
  echo "error: missing managed python runtime; run 'just setup' first"
  exit 1
fi

read -r -p "Initial URL (example: https://target.site/register): " START_URL
if [[ -z "${START_URL:-}" ]]; then
  echo "error: START_URL required"
  exit 1
fi

read -r -p "Success selector (optional): " SUCCESS_SELECTOR

echo
echo "[Phase 1] Manual teaching recording starts."
echo "In the opened browser, complete the whole flow: enter email/password -> pass email verification -> finish the redirect."
(
  cd apps/automation-runner
  UIQ_BASE_URL="${UIQ_BASE_URL:-http://127.0.0.1:17380}" \
  START_URL="$START_URL" \
  SUCCESS_SELECTOR="$SUCCESS_SELECTOR" \
  HEADLESS=false \
  pnpm record:manual
)

echo
echo "[Phase 2] Enter the account information for the next automated signup run."
read -r -p "New email: " FLOW_INPUT
if [[ -z "${FLOW_INPUT:-}" ]]; then
  echo "error: email required"
  exit 1
fi
read -r -s -p "New password: " FLOW_SECRET_INPUT
echo
if [[ -z "${FLOW_SECRET_INPUT:-}" ]]; then
  echo "error: password required"
  exit 1
fi

echo
echo "OTP will be read automatically from Gmail (IMAP). Make sure these are configured:"
echo "  GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD"
echo "Optional filters: FLOW_OTP_SENDER_FILTER / FLOW_OTP_SUBJECT_FILTER"
echo
echo "[Phase 3] AI auto-replay starts."
(
  cd apps/automation-runner
  START_URL="$START_URL" \
  FLOW_INPUT="$FLOW_INPUT" \
  FLOW_SECRET_INPUT="$FLOW_SECRET_INPUT" \
  FLOW_OTP_PROVIDER="${FLOW_OTP_PROVIDER:-gmail}" \
  FLOW_OTP_TIMEOUT_SECONDS="${FLOW_OTP_TIMEOUT_SECONDS:-180}" \
  FLOW_OTP_POLL_INTERVAL_SECONDS="${FLOW_OTP_POLL_INTERVAL_SECONDS:-5}" \
  HEADLESS="${HEADLESS:-false}" \
  pnpm replay-flow
)

echo
echo "done"
echo "artifacts: .runtime-cache/automation/<latest-session>/"
