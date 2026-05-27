#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[doctor] target discovery"
cd apps/automation-runner
pnpm detect:targets || true
cd "$ROOT_DIR"

echo "[doctor] webdriver status"
if curl -fsS "http://127.0.0.1:4444/status" >/dev/null 2>&1; then
  echo "  - webdriver: reachable (127.0.0.1:4444)"
else
  echo "  - webdriver: not reachable (127.0.0.1:4444)"
fi

echo "[doctor] xcodebuild status"
if command -v xcodebuild >/dev/null 2>&1; then
  echo "  - xcodebuild: $(xcodebuild -version | head -n 1)"
else
  echo "  - xcodebuild: not found"
fi

echo "[doctor] recommended next commands"
echo "  1) start webdriver endpoint (for tauri smoke)"
echo "  2) run: cd apps/automation-runner && pnpm smoke:tauri"
echo "  3) configure swift xcode scheme/project then run: cd apps/automation-runner && pnpm smoke:swift"
