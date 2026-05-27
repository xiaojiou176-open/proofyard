import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

import { runProfile } from "./profile-runner.js"

function withEnv<T>(overrides: Record<string, string | undefined>, task: () => Promise<T>): Promise<T>
function withEnv<T>(overrides: Record<string, string | undefined>, task: () => T): T
function withEnv<T>(overrides: Record<string, string | undefined>, task: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return task()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function writeFixtureFile(dir: string, relativePath: string, content: string): string {
  const filePath = resolve(dir, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf8")
  return filePath
}

function createFakePnpmBin(prefix: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), `${prefix}-`))
  const scriptPath = resolve(dir, "pnpm")
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "case \"${1:-}\" in",
      "  test:unit|test:contract|test:ct|test:e2e)",
      "    echo \"fake-$1\"",
      "    exit 0",
      "    ;;",
      "esac",
      "echo \"unexpected pnpm invocation: $*\" >&2",
      "exit 97",
      "",
    ].join("\n"),
    "utf8"
  )
  chmodSync(scriptPath, 0o755)
  return dir
}

test("runProfile executes suite stages for web target with fake pnpm and writes manifest", async () => {
  const profileName = `tmp-profile-runner-web-${Date.now()}`
  const targetName = `tmp-target-runner-web-${Date.now()}`
  const profilePath = writeFixtureFile(
    resolve(process.cwd(), "configs/profiles"),
    `${profileName}.yaml`,
    [
      `name: ${profileName}`,
      "steps:",
      "  - unit",
      "  - contract",
      "  - ct",
      "  - e2e",
      "gates:",
      "  consoleErrorMax: 0",
      "  pageErrorMax: 0",
      "  http5xxMax: 0",
      "tests:",
      "  e2eSuite: regression",
    ].join("\n")
  )
  const targetPath = writeFixtureFile(
    resolve(process.cwd(), "configs/targets"),
    `${targetName}.yaml`,
    [
      `name: ${targetName}`,
      "type: web",
      "driver: web-playwright",
      "baseUrl: http://127.0.0.1:4173",
      "scope:",
      "  domains:",
      "    - http://127.0.0.1:4173",
    ].join("\n")
  )
  const fakeBinDir = createFakePnpmBin("uiq-profile-runner-pnpm")
  const runId = `profile-runner-web-${Date.now()}`

  try {
    const result = await withEnv(
      { PATH: `${fakeBinDir}:${process.env.PATH ?? ""}` },
      () => runProfile(profileName, targetName, runId, { autostartTarget: false })
    )
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      runId: string
      reports: Record<string, string>
      gateResults: { checks: Array<{ id: string }> }
    }
    assert.equal(result.runId, runId)
    assert.equal(manifest.runId, runId)
    assert.equal(manifest.reports.testUnit, "reports/test-unit.json")
    assert.equal(manifest.reports.testContract, "reports/test-contract.json")
    assert.equal(manifest.reports.testCt, "reports/test-ct.json")
    assert.equal(manifest.reports.testE2e, "reports/test-e2e.json")
    assert.ok(manifest.gateResults.checks.some((check) => check.id === "test.unit"))
    assert.ok(manifest.gateResults.checks.some((check) => check.id === "test.e2e"))
  } finally {
    rmSync(profilePath, { force: true })
    rmSync(targetPath, { force: true })
    rmSync(fakeBinDir, { recursive: true, force: true })
    rmSync(resolve(process.cwd(), ".runtime-cache/artifacts/runs", runId), {
      recursive: true,
      force: true,
    })
  }
})

test("runProfile records blocked web-only steps for tauri target without starting runtime", async () => {
  const profileName = `tmp-profile-runner-tauri-${Date.now()}`
  const targetName = `tmp-target-runner-tauri-${Date.now()}`
  const profilePath = writeFixtureFile(
    resolve(process.cwd(), "configs/profiles"),
    `${profileName}.yaml`,
    [
      `name: ${profileName}`,
      "steps:",
      "  - explore",
      "  - chaos",
      "  - a11y",
      "  - perf",
      "  - visual",
      "  - load",
      "gates:",
      "  consoleErrorMax: 0",
      "  pageErrorMax: 0",
      "  http5xxMax: 0",
    ].join("\n")
  )
  const targetPath = writeFixtureFile(
    resolve(process.cwd(), "configs/targets"),
    `${targetName}.yaml`,
    [
      `name: ${targetName}`,
      "type: tauri",
      "driver: tauri-webdriver",
      "app: /Applications/Fake.app",
    ].join("\n")
  )
  const runId = `profile-runner-tauri-${Date.now()}`

  try {
    const result = await runProfile(profileName, targetName, runId, { autostartTarget: false })
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      diagnostics?: { blockedSteps?: string[] }
      gateResults: { checks: Array<{ id: string; status: string }> }
    }
    const blockedSteps = manifest.diagnostics?.blockedSteps ?? []
    assert.ok(blockedSteps.some((step) => step.includes("step.explore")))
    assert.ok(blockedSteps.some((step) => step.includes("step.load")))
    assert.ok(
      manifest.gateResults.checks.some((check) => check.id === "explore.engine_ready" || check.status === "blocked")
    )
  } finally {
    rmSync(profilePath, { force: true })
    rmSync(targetPath, { force: true })
    rmSync(resolve(process.cwd(), ".runtime-cache/artifacts/runs", runId), {
      recursive: true,
      force: true,
    })
  }
})
