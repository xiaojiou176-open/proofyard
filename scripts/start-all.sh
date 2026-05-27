#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OPEN_BROWSER=false
ACTION="up"

usage() {
  cat <<'EOF'
usage: ./scripts/start-all.sh [up|down|status|restart] [--open]

examples:
  ./scripts/start-all.sh
  ./scripts/start-all.sh up --open
  ./scripts/start-all.sh status
  ./scripts/start-all.sh down
  ./scripts/start-all.sh restart --open
EOF
}

while (($# > 0)); do
  case "$1" in
    up|down|status|restart)
      ACTION="$1"
      shift
      ;;
    --open)
      OPEN_BROWSER=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

case "$ACTION" in
  down)
    ./scripts/dev-down.sh
    exit 0
    ;;
  status)
    ./scripts/dev-status.sh
    exit 0
    ;;
  restart)
    ./scripts/dev-down.sh
    ;;
  up)
    ;;
  *)
    usage
    exit 1
    ;;
esac

./scripts/dev-up.sh

if [[ "$OPEN_BROWSER" != "true" ]]; then
  exit 0
fi

FRONTEND_PORT_FILE=".runtime-cache/dev/frontend.port"
FRONTEND_URL="http://127.0.0.1:5173"
if [[ -f "$FRONTEND_PORT_FILE" ]]; then
  FRONTEND_PORT="$(cat "$FRONTEND_PORT_FILE")"
  if [[ -n "$FRONTEND_PORT" ]]; then
    FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"
  fi
fi

if command -v open >/dev/null 2>&1; then
  open "$FRONTEND_URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$FRONTEND_URL" >/dev/null 2>&1 || true
fi
