#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCRIPT_SETUP="./scripts/setup.sh"
SCRIPT_DEV_UP="./scripts/dev-up.sh"
SCRIPT_DEV_DOWN="./scripts/dev-down.sh"
SCRIPT_DEV_STATUS="./scripts/dev-status.sh"
SCRIPT_RUN_PIPELINE="./scripts/run-pipeline.sh"

print_line() {
  printf '%s\n' "------------------------------------------------------------"
}

print_header() {
  clear || true
  print_line
  printf '%s\n' "Dev Menu - Proofyard"
  print_line
}

pause_enter() {
  printf '\n%s' "Press Enter to continue..."
  read -r _
}

run_cmd() {
  local desc="$1"
  shift
  print_line
  printf 'Run: %s\n' "$desc"
  print_line
  "$@"
}

ensure_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    printf 'Error: missing file %s\n' "$file"
    return 1
  fi
}

copy_env_file() {
  local src=".env.example"
  local dst=".env"

  if [[ ! -f "$src" ]]; then
    printf 'Error: %s does not exist\n' "$src"
    return 1
  fi

  if [[ -f "$dst" ]]; then
    printf '.env already exists. Overwrite? (y/N): '
    read -r answer
    case "$answer" in
      y|Y|yes|YES) ;;
      *) printf 'Overwrite cancelled\n'; return 0 ;;
    esac
  fi

  cp "$src" "$dst"
  printf 'Generated %s\n' "$dst"
}

run_first_time_desktop_flow() {
  local frontend_port="${TM_FRONTEND_PORT:-17373}"
  local backend_port="${TM_BACKEND_PORT:-17380}"
  local runtime_dir=".runtime-cache/dev"
  local frontend_port_file="$runtime_dir/frontend.port"
  local backend_port_file="$runtime_dir/backend.port"

  print_line
  printf '%s\n' "First-time desktop flow"
  printf '%s\n' "Goal: finish local bootstrap once and open the desktop/browser integration environment."
  printf '%s\n' "Terminology: keep the same wording as the Web path for tasks and OTP prompts."
  printf '%s\n' "Default ports: frontend=$frontend_port backend=$backend_port"
  print_line

  if [[ ! -f ".env" ]]; then
    printf '[1/4] .env is missing. Creating it from .env.example...\n'
    copy_env_file || {
      printf 'First-time flow stopped: failed to create .env.\n'
      printf 'Next action: use menu item 9 to copy .env.example to .env, then rerun option 13.\n'
      printf 'Debug entry: confirm that .env.example exists at %s/.env.example\n' "$ROOT_DIR"
      return 1
    }
    printf 'Success signal: terminal prints "Generated .env" and the repo root now contains .env.\n'
  else
    printf '[1/4] .env already exists. Skipping creation.\n'
    printf 'Success signal: the repo root already contains .env.\n'
  fi

  printf '[2/4] Installing dependencies and bootstrapping the runtime...\n'
  if ! "$SCRIPT_SETUP"; then
    printf 'First-time flow stopped: setup failed.\n'
    printf 'Next action: verify that python3 and pnpm are available, then rerun ./scripts/setup.sh directly.\n'
    printf 'Debug entry: python3 --version; pnpm --version; inspect the setup output above.\n'
    return 1
  fi
  printf 'Success signal: terminal output includes "setup complete".\n'

  printf '[3/4] Starting the local development stack (frontend + backend)...\n'
  if ! TM_BACKEND_PORT="$backend_port" TM_FRONTEND_PORT="$frontend_port" "$SCRIPT_DEV_UP"; then
    printf 'First-time flow stopped: dev-up failed.\n'
    printf 'Next action: run ./scripts/dev-down.sh to clear leftovers, then retry option 13.\n'
    printf 'Debug entry: .runtime-cache/logs/runtime/backend.dev.log and .runtime-cache/logs/runtime/frontend.dev.log\n'
    return 1
  fi
  printf 'Success signal: terminal output includes "dev stack up", "frontend ready:", and "backend ready:".\n'

  printf '[4/4] Verifying service status...\n'
  "$SCRIPT_DEV_STATUS"
  if [[ -f "$frontend_port_file" ]]; then
    frontend_port="$(cat "$frontend_port_file")"
  fi
  if [[ -f "$backend_port_file" ]]; then
    backend_port="$(cat "$backend_port_file")"
  fi

  print_line
  printf '%s\n' "Success signal: dev-status shows both apps/api and frontend as running."
  printf '%s\n' "Next actions:"
  printf '%s\n' "1) Open the frontend at http://127.0.0.1:${frontend_port} and go to the task execution page."
  printf '%s\n' "2) If the flow asks for an OTP, complete it on the target site and continue."
  printf '%s\n' "3) Check API health at http://127.0.0.1:${backend_port}/health/"
  printf '%s\n' "Debug entry:"
  printf '%s\n' "- Page does not load: ./scripts/dev-status.sh + frontend log"
  printf '%s\n' "- API issue: backend log + /health/"
  printf '%s\n' "- Shut down with: ./scripts/dev-down.sh"
}

start_dev_up_with_ports() {
  local backend_port frontend_port
  printf 'Preferred backend port (default 17380): '
  read -r backend_port
  printf 'Preferred frontend port (default 17373): '
  read -r frontend_port

  backend_port="${backend_port:-17380}"
  frontend_port="${frontend_port:-17373}"

  TM_BACKEND_PORT="$backend_port" TM_FRONTEND_PORT="$frontend_port" "$SCRIPT_DEV_UP"
}

start_backend_only() {
  local backend_port
  printf 'Preferred backend port (default 17380): '
  read -r backend_port
  backend_port="${backend_port:-17380}"
  run_cmd "Start backend (uvicorn)" env TM_BACKEND_PORT="$backend_port" just dev-backend
}

start_frontend_only() {
  local frontend_port
  printf 'Frontend port (default 17373): '
  read -r frontend_port
  frontend_port="${frontend_port:-17373}"
  run_cmd "Start frontend (vite dev)" bash -lc "cd apps/web && pnpm dev --host 127.0.0.1 --port $frontend_port"
}

check_prerequisites() {
  ensure_file "$SCRIPT_SETUP"
  ensure_file "$SCRIPT_DEV_UP"
  ensure_file "$SCRIPT_DEV_DOWN"
  ensure_file "$SCRIPT_DEV_STATUS"
  ensure_file "$SCRIPT_RUN_PIPELINE"
}

main_menu() {
  while true; do
    print_header
    cat <<'MENU'
1) Bootstrap environment (setup)
2) Start frontend + backend (dev-up)
3) Show frontend + backend status (dev-status)
4) Stop frontend + backend (dev-down)
5) Run full manual flow
6) Run full midscene flow
7) Run UI-only manual flow
8) Run UI-only midscene flow
9) Copy .env.example to .env
10) Start frontend + backend with custom ports
11) Start backend only
12) Start frontend only
13) First-time desktop flow
0) Exit
MENU
    print_line
    printf 'Enter menu option: '
    read -r choice

    case "$choice" in
      1) run_cmd "Bootstrap environment" "$SCRIPT_SETUP"; pause_enter ;;
      2) run_cmd "Start frontend + backend" "$SCRIPT_DEV_UP"; pause_enter ;;
      3) run_cmd "Show service status" "$SCRIPT_DEV_STATUS"; pause_enter ;;
      4) run_cmd "Stop frontend + backend" "$SCRIPT_DEV_DOWN"; pause_enter ;;
      5) run_cmd "Run full manual flow" "$SCRIPT_RUN_PIPELINE" manual; pause_enter ;;
      6) run_cmd "Run full midscene flow" "$SCRIPT_RUN_PIPELINE" midscene; pause_enter ;;
      7) run_cmd "Run UI-only manual flow" "$SCRIPT_RUN_PIPELINE" manual ui-only; pause_enter ;;
      8) run_cmd "Run UI-only midscene flow" "$SCRIPT_RUN_PIPELINE" midscene ui-only; pause_enter ;;
      9) copy_env_file; pause_enter ;;
      10) run_cmd "Start frontend + backend with custom ports" start_dev_up_with_ports; pause_enter ;;
      11) start_backend_only ;;
      12) start_frontend_only ;;
      13) run_first_time_desktop_flow; pause_enter ;;
      0) printf 'Exited\n'; exit 0 ;;
      *) printf 'Invalid option: %s\n' "$choice"; pause_enter ;;
    esac
  done
}

check_prerequisites
main_menu
