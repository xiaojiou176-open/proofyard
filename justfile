set shell := ["zsh", "-cu"]

setup:
    ./scripts/setup.sh

run:
    pnpm uiq run --profile pr --target web.local

run-legacy:
    ./scripts/run-pipeline.sh manual

run-midscene:
    @echo "legacy/manual helper path; canonical public mainline is: pnpm uiq run --profile pr --target web.local" >&2
    ./scripts/run-pipeline.sh midscene

run-ui:
    @echo "legacy/manual pipeline helper; canonical public mainline is: pnpm uiq run --profile pr --target web.local" >&2
    ./scripts/run-pipeline.sh manual ui-only

run-ui-midscene:
    @echo "legacy/manual pipeline helper; canonical public mainline is: pnpm uiq run --profile pr --target web.local" >&2
    ./scripts/run-pipeline.sh midscene ui-only

clean:
    mkdir -p .runtime-cache/temp
    find .runtime-cache/temp -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    find . -type d -name "__pycache__" -prune -exec rm -rf {} +
    find apps tests -type d -name ".runtime-cache" -prune -exec rm -rf {} +
    find . -type f -name "*.pyc" -delete

map:
    tree -I 'node_modules|.git|.runtime-cache|__pycache__|.venv|dist' -L 4 > .codex/repo-map.tree

diagnose:
    @echo "Checking for files > 500 lines"
    @find apps packages -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} + | awk '$1 > 500 { print }'

dev-backend:
    zsh -lc 'source scripts/lib/python-runtime.sh; ensure_project_python_env_exports; p=${TM_BACKEND_PORT:-17380}; while lsof -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; do p=$((p+1)); done; echo "api on :$p"; "$(project_uvicorn_bin)" apps.api.app.main:app --reload --port $p'

dev-up:
    ./scripts/dev-up.sh

dev-down:
    ./scripts/dev-down.sh

dev-status:
    ./scripts/dev-status.sh

dev-frontend:
    cd apps/web && pnpm dev

lint-frontend:
    cd apps/web && pnpm lint

automation-install:
    cd apps/automation-runner && pnpm install

automation-lint:
    cd apps/automation-runner && pnpm lint

automation-record:
    cd apps/automation-runner && pnpm record

automation-record-manual:
    cd apps/automation-runner && pnpm record:manual

automation-record-midscene:
    cd apps/automation-runner && pnpm record:midscene

automation-extract:
    cd apps/automation-runner && pnpm extract

automation-generate-case:
    cd apps/automation-runner && pnpm generate-case

automation-replay:
    cd apps/automation-runner && pnpm replay

train-and-auto-replay:
    ./scripts/train-and-auto-replay.sh

automation-test:
    cd apps/automation-runner && pnpm test

backup-runtime:
    ./scripts/backup-runtime.sh

rollback-runtime backup_file:
    ./scripts/rollback-runtime.sh {{backup_file}}

space-report:
    PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/space-report.py --pretty

space-clean-safe *args='':
    PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/space-clean-safe.py {{args}}

space-clean-reclaim *args='':
    PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/space-clean-reclaim.py {{args}}

runtime-gc *args='':
    ./scripts/runtime-gc.sh {{args}}

compose-up:
    docker compose up -d --build

compose-down:
    docker compose down

preflight:
    ./scripts/preflight.sh

security-scan:
    ./scripts/security-scan.sh

github-closure-report:
    PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/github/collect-closure-evidence.py --pretty

github-closure-social-preview-template:
    PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/github/write-social-preview-manual-evidence-template.py

github-closure-social-preview-pass:
    PYTHONDONTWRITEBYTECODE=1 python3 -B scripts/github/write-social-preview-manual-evidence-template.py --status pass
