import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { type DesktopSoakConfig, runDesktopSoak } from "./desktop-soak.js"

type DesktopSoakDeps = NonNullable<Parameters<typeof runDesktopSoak>[2]>

function okShell(detail: string) {
  return { ok: true, detail, stdout: "", stderr: "" }
}

function createDeps(overrides: Partial<DesktopSoakDeps> = {}): DesktopSoakDeps {
  return {
    appNameFromPath: () => "MockApp",
    findAppNameByBundleId: () => undefined,
    findFirstPid: () => undefined,
    getProcessSample: () => undefined,
    getWindowCount: () => undefined,
    isProcessRunning: () => false,
    readBundleIdFromApp: () => undefined,
    runChecked: (command, args) => okShell(`${command} ${args.join(" ")} ok`),
    sleep: async () => {},
    ...overrides,
  }
}

function createBaseDir(t: { after: (fn: () => void) => void }): string {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-desktop-soak-"))
  t.after(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })
  mkdirSync(join(baseDir, "metrics"), { recursive: true })
  return baseDir
}

function swiftSoakConfig(): DesktopSoakConfig {
  return {
    targetType: "swift",
    bundleId: "com.example.desktop",
    durationSeconds: 1,
    intervalSeconds: 1,
    gates: {
      crashCountMax: 0,
    },
  }
}

test("runDesktopSoak treats open -b success as recovered when appName is missing", async (t) => {
  const baseDir = createBaseDir(t)
  const deps = createDeps()

  const result = await runDesktopSoak(baseDir, swiftSoakConfig(), deps)
  assert.equal(result.status, "passed")
  assert.equal(result.crashCount, 0)
  assert.equal(result.reasonCode, "desktop.soak.operator_manual_only")
  assert.equal(result.stabilityMetrics?.crashRecoveryAttempts, 0)
  assert.equal(result.stabilityMetrics?.crashRecoveryFailedCount, 0)
  assert.equal(result.samples.length, 0)

  const stored = JSON.parse(readFileSync(join(baseDir, "metrics/desktop-soak.json"), "utf8")) as {
    crashCount?: number
    reasonCode?: string
    status?: string
  }
  assert.equal(stored.crashCount, 0)
  assert.equal(stored.reasonCode, "desktop.soak.operator_manual_only")
  assert.equal(stored.status, "passed")
})

test("runDesktopSoak still requires process confirmation when appName is available", async (t) => {
  const baseDir = createBaseDir(t)
  const deps = createDeps({
    findAppNameByBundleId: () => "DemoDesktop",
  })

  const result = await runDesktopSoak(baseDir, swiftSoakConfig(), deps)
  assert.equal(result.status, "passed")
  assert.equal(result.reasonCode, "desktop.soak.operator_manual_only")
  assert.equal(result.crashCount, 0)
  assert.equal(result.stabilityMetrics?.crashRecoveryAttempts, 0)
  assert.equal(result.stabilityMetrics?.crashRecoveryFailedCount, 0)
  assert.equal(result.samples.length, 0)
})
