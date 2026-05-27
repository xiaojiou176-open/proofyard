#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-pr}"

case "$PROFILE" in
  pr)
    ./scripts/docs-gate.sh
    ./scripts/security-scan.sh
    ./scripts/preflight.sh
    ;;
  nightly)
    ./scripts/docs-gate.sh
    ./scripts/preflight.sh
    (cd apps/automation-runner && pnpm lint && pnpm check)
    ;;
  manual)
    ./scripts/docs-gate.sh
    ./scripts/security-scan.sh
    ./scripts/preflight.sh
    (cd apps/automation-runner && pnpm lint && pnpm check)
    ./scripts/run-load-k6.sh
    ;;
  *)
    echo "usage: ./scripts/gates-profile.sh [pr|nightly|manual]"
    exit 1
    ;;
esac

echo "gate profile complete: $PROFILE"
