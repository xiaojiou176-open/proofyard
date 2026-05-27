import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT = resolve(REPO_ROOT, "scripts/ci/check-lockfile-sync.mjs")

function writeJson(pathname, value) {
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "check-lockfile-sync-"))
  mkdirSync(join(root, "frontend"), { recursive: true })
  mkdirSync(join(root, "automation"), { recursive: true })
  mkdirSync(join(root, "apps/mcp-server"), { recursive: true })
  mkdirSync(join(root, "packages/ui"), { recursive: true })
  mkdirSync(join(root, "packages/ai-prompts"), { recursive: true })
  mkdirSync(join(root, "configs/ci"), { recursive: true })
  mkdirSync(join(root, "docker/ci"), { recursive: true })
  mkdirSync(join(root, "backend"), { recursive: true })

  const manifest = {
    name: "fixture",
    private: true,
    packageManager: "pnpm@10.22.0",
    dependencies: { react: "19.1.1" },
  }
  writeJson(join(root, "package.json"), manifest)
  writeJson(join(root, "apps/web/package.json"), { name: "frontend", private: true, dependencies: { react: "19.1.1" } })
  writeJson(join(root, "apps/automation-runner/package.json"), { name: "automation", private: true, devDependencies: { "@google/genai": "1.42.0" } })
  writeJson(join(root, "apps/mcp-server/package.json"), { name: "mcp", private: true, dependencies: { zod: "4.3.6" } })
  writeJson(join(root, "packages/ui/package.json"), { name: "ui", private: true, peerDependencies: { react: "19.1.1" } })
  writeJson(join(root, "packages/ai-prompts/package.json"), { name: "prompts", private: true })

  writeFileSync(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      react:\n        specifier: 19.1.1\n        version: 19.1.1\n  frontend:\n    dependencies:\n      react:\n        specifier: 19.1.1\n        version: 19.1.1\n  automation:\n    devDependencies:\n      '@google/genai':\n        specifier: 1.42.0\n        version: 1.42.0\n  apps/mcp-server:\n    dependencies:\n      zod:\n        specifier: 4.3.6\n        version: 4.3.6\n  packages/ui:\n    peerDependencies:\n      react:\n        specifier: 19.1.1\n        version: 19.1.1\n`,
    "utf8"
  )
  writeFileSync(join(root, "uv.lock"), "version = 1\n", "utf8")
  writeFileSync(
    join(root, "pyproject.toml"),
    '[project]\ndependencies = ["fastapi==0.131.0"]\n[project.optional-dependencies]\ndev = ["google-genai==1.42.0"]\n',
    "utf8"
  )
  writeFileSync(
    join(root, "configs/ci/runtime.lock.json"),
    `${JSON.stringify({
      platform: "linux/amd64",
      base_images: {
        node: { reference: "docker.io/library/node:20-bookworm-slim@sha256:abc" },
        python: { reference: "docker.io/library/python:3.11-slim-bookworm@sha256:def" },
      },
    }, null, 2)}\n`,
    "utf8"
  )
  writeFileSync(join(root, "docker/ci/Dockerfile"), "ARG NODE_IMAGE=docker.io/library/node:20@sha256:abc\nFROM ${NODE_IMAGE}\n", "utf8")
  writeFileSync(join(root, "apps/api/Dockerfile"), "FROM docker.io/library/python:3.11@sha256:def\n", "utf8")
  writeFileSync(join(root, "apps/web/Dockerfile"), "FROM docker.io/library/nginx:1.27@sha256:ghi\n", "utf8")
  writeFileSync(join(root, "docker-compose.yml"), "services:\n  redis:\n    image: docker.io/library/redis:7-alpine@sha256:xyz\n", "utf8")
  return root
}

test("check-lockfile-sync passes for a pinned single-lockfile fixture", () => {
  const root = makeFixture()
  try {
    const run = spawnSync("node", [SCRIPT], {
      cwd: root,
      encoding: "utf8",
    })
    assert.equal(run.status, 0)
    assert.match(run.stdout, /root pnpm lockfile present/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("check-lockfile-sync rejects range versions and child lockfiles", () => {
  const root = makeFixture()
  try {
    writeJson(join(root, "apps/web/package.json"), {
      name: "frontend",
      private: true,
      dependencies: { react: "^19.1.1" },
    })
    writeFileSync(join(root, "apps/web/pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8")
    const run = spawnSync("node", [SCRIPT], {
      cwd: root,
      encoding: "utf8",
    })
    assert.equal(run.status, 1)
    assert.match(run.stderr, /must be pinned exactly/)
    assert.match(run.stderr, /unexpected child pnpm lockfile/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
