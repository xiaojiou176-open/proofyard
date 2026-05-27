import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT = resolve(REPO_ROOT, "scripts/ci/run-in-container.sh")

function runDry(task) {
  return spawnSync("bash", [SCRIPT, "--task", task, "--gate", "local-required", "--dry-run"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  })
}

test("run-in-container exposes the canonical task list", () => {
  const run = spawnSync("bash", [SCRIPT, "--list-tasks"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  })
  assert.equal(run.status, 0)
  const tasks = run.stdout.trim().split("\n")
  for (const task of [
    "contract",
    "security-scan",
    "preflight-minimal",
    "backend-smoke",
    "backend-full",
    "frontend-full",
    "core-static-gates",
    "orchestrator-contract",
    "test-truth-gate",
    "root-web-typecheck",
    "root-web-unit",
    "root-web-ct",
    "root-web-e2e",
    "frontend-authenticity",
    "frontend-critical",
    "functional-regression-matrix",
    "functional-regression-targeted",
    "pr-static-gate",
    "pr-frontend-e2e-behavior-shard",
    "pr-run-profile",
    "pr-quality-gate",
    "nightly-frontend-e2e-shard",
    "nightly-backend-tests-shard",
    "nightly-integration-full",
    "nightly-core-run",
    "nightly-hard-gates",
    "manual-core-run",
    "release-docs-gate",
    "release-typecheck",
    "release-candidate-gate",
  ]) {
    assert.ok(tasks.includes(task), `expected task list to include ${task}`)
  }
})

test("run-in-container dry-run resolves repo-owned CI image", () => {
  const run = runDry("lint")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /image=ghcr\.io\/local\/webaudit\/ci:/)
  assert.doesNotMatch(run.stdout, /mcr\.microsoft\.com\/devcontainers/)
  assert.match(run.stdout, /runtime_lock=configs\/ci\/runtime\.lock\.json/)
})

test("run-in-container contract does not require pulling the local placeholder image", () => {
  const tempDir = mkdtempSync(resolve(os.tmpdir(), "uiq-contract-docker-"))
  const dockerLog = resolve(tempDir, "docker.log")
  const dockerStub = resolve(tempDir, "docker")
  writeFileSync(
    dockerStub,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(dockerLog)}
if [[ "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  exit 0
fi
if [[ "$1" == "info" ]]; then
  printf 'amd64\\n'
  exit 0
fi
if [[ "$1" == "image" && "$2" == "inspect" ]]; then
  echo "contract path must not inspect image" >&2
  exit 99
fi
if [[ "$1" == "pull" ]]; then
  echo "contract path must not pull image" >&2
  exit 98
fi
echo "unexpected docker invocation: $*" >&2
exit 97
`,
    { mode: 0o755 }
  )

  try {
    const run = spawnSync("bash", [SCRIPT, "--task", "contract", "--gate", "local-required"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH}`,
      },
      encoding: "utf8",
    })

    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /passed: container baseline contract verified/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("run-in-container supports mutation-ts task routing", () => {
  const run = runDry("mutation-ts")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=mutation-ts/)
  assert.match(run.stdout, /pnpm mutation:ts:strict/)
})

test("run-in-container supports mutation-py task routing", () => {
  const run = runDry("mutation-py")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=mutation-py/)
  assert.match(run.stdout, /pnpm mutation:py:strict/)
})

test("run-in-container supports mutation-effective task routing", () => {
  const run = runDry("mutation-effective")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=mutation-effective/)
  assert.match(run.stdout, /pnpm mutation:effective/)
})

test("run-in-container supports frontend-authenticity task routing", () => {
  const run = runDry("frontend-authenticity")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=frontend-authenticity/)
  assert.match(run.stdout, /pnpm gate:e2e:authenticity/)
})

test("run-in-container supports frontend-nonstub task routing", () => {
  const run = runDry("frontend-nonstub")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=frontend-nonstub/)
  assert.match(run.stdout, /bash scripts\/run-frontend-e2e-nonstub\.sh/)
})

test("run-in-container supports frontend-critical task routing", () => {
  const run = runDry("frontend-critical")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=frontend-critical/)
  assert.match(run.stdout, /pnpm test:e2e:frontend:critical/)
})

test("run-in-container supports backend-smoke workflow task routing", () => {
  const run = runDry("backend-smoke")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=backend-smoke/)
  assert.match(run.stdout, /uv lock --check/)
  assert.match(run.stdout, /apps\/api\/tests\/test_health\.py/)
})

test("run-in-container supports preflight minimal workflow task routing", () => {
  const run = runDry("preflight-minimal")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /packages\/orchestrator\/src\/commands\/run\.test\.ts/)
  assert.match(run.stdout, /pnpm mcp:check/)
})

test("run-in-container supports core-static-gates workflow task routing", () => {
  const run = runDry("core-static-gates")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /bash scripts\/ci\/self-proof-suite\.sh/)
  assert.match(run.stdout, /pnpm audit:prod/)
  assert.match(run.stdout, /pnpm env:check/)
  assert.match(run.stdout, /node scripts\/ci\/check-gemini-sdk-versions\.mjs/)
})

test("run-in-container supports frontend-full workflow task routing", () => {
  const run = runDry("frontend-full")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /pnpm --dir apps\/web lint/)
  assert.match(run.stdout, /pnpm --dir apps\/web test/)
  assert.match(run.stdout, /pnpm --dir apps\/web build/)
  assert.match(run.stdout, /pnpm --dir apps\/web audit:ui/)
})

test("run-in-container supports functional regression matrix workflow task routing", () => {
  const run = runDry("functional-regression-matrix")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /UIQ_TEST_MODE=serial/)
  assert.match(run.stdout, /bash scripts\/test-matrix\.sh serial/)
})

test("run-in-container supports pr-run-profile workflow task routing", () => {
  const run = runDry("pr-run-profile")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /pnpm uiq run --profile pr --target web\.ci/)
  assert.match(run.stdout, /node scripts\/ci\/verify-run-evidence\.mjs --profile pr/)
  assert.doesNotMatch(run.stdout, /uiq-gemini-live-smoke-gate/)
  assert.doesNotMatch(run.stdout, /test:gemini:web-audit/)
  assert.doesNotMatch(run.stdout, /uiq-gemini-concurrency-gate/)
})

test("run-in-container supports pr-static-gate workflow task routing", () => {
  const run = runDry("pr-static-gate")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /bash scripts\/ci\/self-proof-suite\.sh/)
  assert.match(run.stdout, /pnpm commitlint:ci/)
  assert.match(run.stdout, /bash scripts\/docs-gate\.sh/)
})

test("run-in-container supports pr frontend behavior shard workflow task routing", () => {
  const run = runDry("pr-frontend-e2e-behavior-shard")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /SHARD_INDEX="\$\{UIQ_SHARD_INDEX:-1\}"/)
  assert.match(run.stdout, /counterfactual-report/)
  assert.match(run.stdout, /bash scripts\/run-frontend-e2e-nonstub\.sh -- --shard=/)
})

test("run-in-container supports nightly backend shard workflow task routing", () => {
  const run = runDry("nightly-backend-tests-shard")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /SHARD_INDEX="\$\{UIQ_SHARD_INDEX:-1\}"/)
  assert.match(run.stdout, /backend-tests-nightly-shard-\$\{SHARD_INDEX\}\.sqlite3/)
  assert.match(run.stdout, /find apps\/api\/tests -type f -name "test_\*\.py"/)
})

test("run-in-container supports manual core workflow task routing", () => {
  const run = runDry("manual-core-run")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /command -v k6 >/)
  assert.match(run.stdout, /command -v semgrep >/)
  assert.match(run.stdout, /pnpm uiq engines:check --profile manual-core/)
  assert.match(run.stdout, /pnpm uiq run --profile manual-core --target web\.ci/)
  assert.doesNotMatch(run.stdout, /GEMINI_API_KEY/)
})

test("run-in-container supports nightly core workflow task routing", () => {
  const run = runDry("nightly-core-run")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /pnpm uiq engines:check --profile nightly-core/)
  assert.match(run.stdout, /pnpm uiq run --profile nightly-core --target web\.ci/)
  assert.doesNotMatch(run.stdout, /GEMINI_API_KEY/)
})

test("run-in-container supports release docs gate routing", () => {
  const run = runDry("release-docs-gate")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=release-docs-gate/)
  assert.match(run.stdout, /bash scripts\/docs-gate\.sh/)
})

test("run-in-container supports release typecheck routing", () => {
  const run = runDry("release-typecheck")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=release-typecheck/)
  assert.match(run.stdout, /pnpm typecheck/)
})

test("run-in-container supports release candidate routing", () => {
  const run = runDry("release-candidate-gate")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /task=release-candidate-gate/)
  assert.match(run.stdout, /nightly-release-e2e-gate\.mjs --mode=release/)
  assert.match(run.stdout, /pnpm release:gate/)
  assert.match(run.stdout, /release-mutation-sampling\.mjs --scope core --threshold 0\.8/)
})

test("run-in-container dry-run uses current host uid gid and prepares artifact directory", () => {
  const run = runDry("coverage")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /mkdir -p .*\.runtime-cache\/artifacts\/ci/)
  assert.match(run.stdout, /--user \[dry-run\] \d+:\d+/)
})

test("run-in-container dry-run pins writable home for non-root bootstrap", () => {
  const run = runDry("mutation-ts")
  assert.equal(run.status, 0)
  assert.match(run.stdout, /--user/)
  assert.match(run.stdout, /HOME=\/workspace\/\.runtime-cache\/container-home/)
  assert.match(run.stdout, /XDG_CACHE_HOME=\/workspace\/\.runtime-cache\/container-home\/\.cache/)
  assert.match(
    run.stdout,
    /UV_PROJECT_ENVIRONMENT=\/workspace\/\.runtime-cache\/container-home\/\.local\/share\/uv\/project-venv/
  )
  assert.match(run.stdout, /UIQ_HOST_ARCH=/)
  assert.match(
    run.stdout,
    /UIQ_TRUSTED_BIN_DIRS=\/workspace\/\.runtime-cache\/container-home\/\.local\/bin\\,\/usr\/bin\\,\/bin\\,\/usr\/local\/bin\\,\/opt\/homebrew\/bin/
  )
  assert.match(run.stdout, /mkdir -p "\$HOME\/\.local\/bin"/)
})

test("run-in-container rejects non repo-owned image overrides", () => {
  const run = spawnSync(
    "bash",
    [
      SCRIPT,
      "--task",
      "lint",
      "--gate",
      "local-required",
      "--dry-run",
      "--image",
      "node:20-bookworm-slim",
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf8",
    }
  )
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /repo-owned ci image required/)
})
