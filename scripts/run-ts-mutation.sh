#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_TARGET_SPEC="apps/mcp-server/src/core/{registry.ts,constants.ts,types.ts}"
TARGET_SPEC="${UIQ_TS_MUTATE_TARGET:-$DEFAULT_TARGET_SPEC}"
TARGET_FILE="${TARGET_SPEC%%:*}"
DEFAULT_TEST_CMD="pnpm -s exec node --import tsx --test apps/mcp-server/tests/core.registry.test.ts apps/mcp-server/tests/core.constants.test.ts apps/mcp-server/tests/core.types.test.ts apps/mcp-server/tests/mcp-timeout-semantic.test.ts"
MUTATION_TEST_CMD="${UIQ_TS_MUTATION_TEST_CMD:-$DEFAULT_TEST_CMD}"
LOCK_DIR="$ROOT_DIR/.runtime-cache/locks"
LOCK_FILE="$LOCK_DIR/ts-mutation.lock"

if [[ "$TARGET_FILE" == "$ROOT_DIR/"* ]]; then
  TARGET_FILE="${TARGET_FILE#"$ROOT_DIR"/}"
  TARGET_SPEC="$TARGET_FILE"
fi

if [[ "$TARGET_FILE" == *"*"* || "$TARGET_FILE" == *"?"* || "$TARGET_FILE" == *"{"* || "$TARGET_FILE" == *"}"* || "$TARGET_FILE" == *"["* || "$TARGET_FILE" == *"]"* || "$TARGET_FILE" == *"!"* || "$TARGET_FILE" == *"("* || "$TARGET_FILE" == *")"* ]]; then
  :
elif [[ ! -f "$ROOT_DIR/$TARGET_FILE" ]]; then
  echo "Mutation target file not found: $TARGET_FILE (from: $TARGET_SPEC)" >&2
  exit 1
fi

if [[ "$TARGET_SPEC" == *":"* ]]; then
  echo "[mutation] UIQ_TS_MUTATE_TARGET contains line range; Stryker mutate uses file-level globs only. Using '$TARGET_FILE'." >&2
  TARGET_SPEC="$TARGET_FILE"
fi

# Equivalent lint guard: catches obvious conditional expect and expect-less test files
# used by the mutation suite to reduce false-green risk.
if [[ "${UIQ_SKIP_EXPECT_GUARD:-0}" != "1" ]]; then
  node - "$ROOT_DIR" <<'NODE'
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = process.argv[2];
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const testCmd = process.env.UIQ_TS_MUTATION_TEST_CMD || pkg?.scripts?.["mcp:test:mutation"] || "";
const testFiles = testCmd
  .split(/\s+/)
  .filter((token) => token.endsWith(".test.ts"))
  .map((file) => resolve(root, file));

if (testFiles.length === 0) {
  throw new Error("Expect guard failed: no *.test.ts files found in scripts.mcp:test:mutation");
}

const conditionalExpectPatterns = [
  /\bif\s*\([^)]*\)\s*{[^{}]*\bassert\.[A-Za-z_]\w*\s*\(/s,
  /\bif\s*\([^)]*\)\s*\bassert\.[A-Za-z_]\w*\s*\(/s,
  /\bif\s*\([^)]*\)\s*{[^{}]*\bexpect\s*\(/s,
  /\bif\s*\([^)]*\)\s*\bexpect\s*\(/s,
  /\?.{0,120}\bexpect\s*\(/s,
  /\?.{0,120}\bassert\.[A-Za-z_]\w*\s*\(/s
];

for (const file of testFiles) {
  const content = readFileSync(file, "utf8");
  if (!/\bexpect\s*\(/.test(content) && !/\bassert\.[A-Za-z_]\w*\s*\(/.test(content)) {
    throw new Error(`Expect guard failed: missing assertion (expect/assert) in ${file}`);
  }
  if (conditionalExpectPatterns.some((pattern) => pattern.test(content))) {
    throw new Error(
      `Expect guard failed: detected conditional expect() pattern in ${file}. ` +
        "Refactor to unconditional assertions."
    );
  }
}

console.log(`[mutation][guard] assertion lint passed for ${testFiles.length} file(s).`);
NODE
fi

cd "$ROOT_DIR"
export UIQ_TS_MUTATE_TARGET="$TARGET_SPEC"
export UIQ_TS_MUTATION_TEST_CMD="$MUTATION_TEST_CMD"
mkdir -p "$LOCK_DIR"
if [[ -f "$LOCK_FILE" ]]; then
  stale_pid="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [[ -n "${stale_pid:-}" ]] && kill -0 "$stale_pid" 2>/dev/null; then
    echo "[mutation][ts] another mutation process is active (pid=$stale_pid). Abort to prevent deadlock." >&2
    exit 1
  fi
fi
echo "$$" > "$LOCK_FILE"
cleanup_lock() {
  rm -f "$LOCK_FILE"
}
trap cleanup_lock EXIT INT TERM

mutation_timeout="${UIQ_MUTATION_TIMEOUT_SECONDS:-900}"
run_stryker_with_timeout() {
  if [[ "$mutation_timeout" =~ ^[0-9]+$ ]] && [[ "$mutation_timeout" -gt 0 ]]; then
    if command -v timeout >/dev/null 2>&1; then
      timeout "${mutation_timeout}"s pnpm exec stryker run configs/ci/stryker.config.mjs --typescript-checker-config-file configs/ci/tsconfig.mutation.json
      return $?
    fi
    if command -v gtimeout >/dev/null 2>&1; then
      gtimeout "${mutation_timeout}"s pnpm exec stryker run configs/ci/stryker.config.mjs --typescript-checker-config-file configs/ci/tsconfig.mutation.json
      return $?
    fi
  fi
  pnpm exec stryker run configs/ci/stryker.config.mjs --typescript-checker-config-file configs/ci/tsconfig.mutation.json
}

set +e
run_stryker_with_timeout
stryker_status=$?
set -e
if [[ "$stryker_status" -eq 124 ]]; then
  echo "[mutation][ts] timeout after ${mutation_timeout}s; fail fast to avoid indefinite hang." >&2
  exit 124
fi
if [[ "$stryker_status" -ne 0 ]]; then
  exit "$stryker_status"
fi

node - "$ROOT_DIR" <<'NODE'
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const root = process.argv[2];
const summaryPath = resolve(root, ".runtime-cache/reports/mutation/ts/summary.json");
const raw = JSON.parse(readFileSync(summaryPath, "utf8"));
let killed = 0;
let survived = 0;
for (const file of Object.values(raw.files ?? {})) {
  for (const mutant of file.mutants ?? []) {
    if (mutant.status === "Killed") killed += 1;
    if (mutant.status === "Survived") survived += 1;
  }
}
const effective = killed + survived > 0;
if (!effective) {
  throw new Error(`[mutation][ts] hard gate failed: no effective mutants in ${summaryPath}`);
}
if (survived > 0) {
  throw new Error(`[mutation][ts] hard gate failed: survived=${survived} (must be 0)`);
}
console.log(`[mutation][ts] hard gate passed (killed=${killed}, survived=${survived}).`);
NODE
