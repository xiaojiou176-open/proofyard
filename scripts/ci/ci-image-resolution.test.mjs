import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const BUILD_SCRIPT = resolve(REPO_ROOT, "scripts/ci/build-ci-image.sh")
const RESOLVE_SCRIPT = resolve(REPO_ROOT, "scripts/ci/resolve-ci-image.sh")

test("build-ci-image --print-ref uses runtime lock hash tag", () => {
  const run = spawnSync("bash", [BUILD_SCRIPT, "--print-ref"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  })
  assert.equal(run.status, 0)
  assert.match(run.stdout.trim(), /^ghcr\.io\/local\/webaudit\/ci:[a-f0-9]{12}$/)
})

test("build-ci-image --print-hash returns the runtime lock hash only", () => {
  const run = spawnSync("bash", [BUILD_SCRIPT, "--print-hash"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  })
  assert.equal(run.status, 0)
  assert.match(run.stdout.trim(), /^[a-f0-9]{12}$/)
})

test("build-ci-image --dry-run pins linux/amd64 and docker/ci Dockerfile", () => {
  const run = spawnSync("bash", [BUILD_SCRIPT, "--dry-run"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  })
  assert.equal(run.status, 0)
  assert.match(run.stdout, /docker\/ci\/Dockerfile/)
  assert.match(run.stdout, /--platform \[dry-run\] linux\/amd64/)
})

test("build-ci-image prefers plain docker build when local platform emulation is available", () => {
  const tempDir = mkdtempSync(resolve(os.tmpdir(), "uiq-build-ci-image-"))
  const dockerStub = resolve(tempDir, "docker")
  writeFileSync(
    dockerStub,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "build" && "$2" == "--help" ]]; then
  cat <<'EOF'
Usage: docker build
      --platform stringArray          Set target platform for build
EOF
  exit 0
fi
echo "unexpected docker invocation: $*" >&2
exit 99
`,
    { mode: 0o755 }
  )

  try {
    const run = spawnSync("bash", [BUILD_SCRIPT, "--dry-run"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH}`,
      },
      encoding: "utf8",
    })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^\[dry-run\] docker \[dry-run\] build /)
    assert.doesNotMatch(run.stdout, /buildx/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("resolve-ci-image prefers explicit UIQ_CI_IMAGE_REF", () => {
  const run = spawnSync("bash", [RESOLVE_SCRIPT, "--output", "json"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      UIQ_CI_IMAGE_REF: "ghcr.io/example/repo/ci:explicit",
    },
    encoding: "utf8",
  })
  assert.equal(run.status, 0)
  const payload = JSON.parse(run.stdout)
  assert.equal(payload.ref, "ghcr.io/example/repo/ci:explicit")
  assert.equal(payload.source, "env")
})

test("resolve-ci-image prefers digest env over local build", () => {
  const run = spawnSync("bash", [RESOLVE_SCRIPT, "--output", "json"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      UIQ_CI_IMAGE_REPOSITORY: "ghcr.io/example/repo/ci",
      UIQ_CI_IMAGE_DIGEST: "sha256:abc123",
    },
    encoding: "utf8",
  })
  assert.equal(run.status, 0)
  const payload = JSON.parse(run.stdout)
  assert.equal(payload.ref, "ghcr.io/example/repo/ci@sha256:abc123")
  assert.equal(payload.source, "workflow-digest")
})
