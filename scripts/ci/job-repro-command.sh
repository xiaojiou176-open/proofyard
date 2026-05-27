#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/ci/job-repro-command.sh <job-name>

Print a minimal local reproduction command for a CI job.
USAGE
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_job_name() {
  local raw
  raw="$(trim "$1")"
  case "$raw" in
    *" / "*) raw="${raw##* / }" ;;
  esac
  printf '%s' "$raw"
}

emit_default() {
  local job_name="$1"
  cat <<GUIDE
# Unknown CI job: ${job_name}
# Try one of: backend core_contract_load external_tooling_precheck mcp_tests orchestrator_tests
#             root_web_typecheck root_web_unit root_web_ct root_web_e2e root_web_gate
#             frontend automation required_ci_gate nightly-gate
# Guidance: inspect .github/workflows/ci.yml (or nightly.yml), then run the matching local gate command.
GUIDE
}

job_raw="${1:-}"
if [[ -z "$job_raw" ]]; then
  usage >&2
  exit 2
fi

job_name="$(normalize_job_name "$job_raw")"

case "$job_name" in
  backend)
    cat <<'CMD'
python -m pip install --upgrade pip uv && uv sync --frozen --all-extras && uv run ruff check apps/api/app apps/api/tests && uv run pytest && bash scripts/check-db-migrations.sh
CMD
    ;;
  core_contract_load)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm contracts:check-openapi-coverage && pnpm audit:prod && pnpm audit:tooling && ./scripts/run-contract-scan.sh && ./scripts/run-load-k6-smoke.sh
CMD
    ;;
  external_tooling_precheck)
    cat <<'CMD'
TMP_HAR="$(mktemp "${TMPDIR:-/tmp}/uiq-har-smoke.XXXXXX.har")" && trap 'rm -f "$TMP_HAR"' EXIT && python -m pip install --upgrade pip uv && uv sync --frozen --all-extras && pnpm install --frozen-lockfile && printf '%s\n' '{"log":{"entries":[{"request":{"url":"http://127.0.0.1:8080/health","method":"GET"},"response":{"status":200}}]}}' > "$TMP_HAR" && pnpm run automation:convert:curl -- --curl "curl http://127.0.0.1:8080/health" -- --language python && pnpm run automation:har:k6 -- --input "$TMP_HAR" -- --stdout && pnpm run test:schemathesis -- --help
CMD
    ;;
  mcp_tests)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm mcp:smoke && pnpm mcp:test
CMD
    ;;
  orchestrator_tests)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm test:orchestrator
CMD
    ;;
  root_web_typecheck)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm typecheck
CMD
    ;;
  root_web_unit)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm test:unit
CMD
    ;;
  root_web_ct)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium && pnpm test:ct
CMD
    ;;
  root_web_e2e)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm exec playwright install --with-deps chromium && pnpm test:e2e
CMD
    ;;
  root_web_gate)
    cat <<'CMD'
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test:unit && pnpm exec playwright install --with-deps chromium && pnpm test:ct && pnpm test:e2e
CMD
    ;;
  frontend)
    cat <<'CMD'
cd apps/web && pnpm install --frozen-lockfile && pnpm lint && pnpm audit --audit-level=high && pnpm test && pnpm build && pnpm exec playwright install --with-deps chromium && pnpm audit:ui
CMD
    ;;
  automation)
    cat <<'CMD'
python -m pip install --upgrade pip uv && uv sync --frozen --all-extras && cd apps/automation-runner && pnpm install --frozen-lockfile && pnpm lint && pnpm audit --audit-level=high && pnpm check && pnpm test
CMD
    ;;
  required_ci_gate|required-ci-gate)
    cat <<'CMD'
bash scripts/ci/job-repro-command.sh <failed-upstream-job>
CMD
    ;;
  nightly-gate|nightly_gate)
    cat <<'CMD'
bash scripts/ci/build-ci-image.sh && UIQ_CI_IMAGE_REF="$(bash scripts/ci/build-ci-image.sh --print-ref)" bash scripts/ci/run-in-container.sh --task nightly-core-run --gate nightly-core-run
CMD
    ;;
  *)
    emit_default "$job_name"
    ;;
esac
