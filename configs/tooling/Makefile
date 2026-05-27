.PHONY: setup run run-legacy run-midscene run-ui run-ui-midscene clean map diagnose dev-up dev-down dev-status preflight security-scan

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
	find . -type f -name "*.pyc" -delete

map:
	tree -I 'node_modules|.git|.runtime-cache|__pycache__|.venv|dist' -L 4 > .codex/repo-map.tree

diagnose:
	@echo "Checking for files > 500 lines"
	@find apps packages -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} + | awk '$$1 > 500 { print }'

dev-up:
	./scripts/dev-up.sh

dev-down:
	./scripts/dev-down.sh

dev-status:
	./scripts/dev-status.sh

preflight:
	./scripts/preflight.sh

security-scan:
	./scripts/security-scan.sh
