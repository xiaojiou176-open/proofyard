import assert from "node:assert/strict"
import test from "node:test"
import { assertDesktopOperatorManualGate, parseArgs, validateRunOverrides } from "./cli.js"
import { listCatalogCommands } from "./commands/catalog.js"

test("parseArgs keeps invalid load-engine but drops filtered enum values", () => {
  const args = parseArgs(["run", "--load-engine", "invalid-engine", "--perf-preset", "tablet"])
  assert.equal(args.loadEngine, "invalid-engine")
  assert.equal(args.perfPreset, undefined)
})

test("validateRunOverrides rejects invalid load-engine", () => {
  const args = parseArgs(["run", "--load-engine", "invalid-engine"])
  assert.throws(() => validateRunOverrides(args), /Invalid --load-engine/)
})

test("parseArgs drops invalid a11y/perf/visual enums before validate stage", () => {
  const args = parseArgs([
    "run",
    "--a11y-engine",
    "other",
    "--perf-engine",
    "other",
    "--visual-mode",
    "other",
  ])
  assert.equal(args.a11yEngine, undefined)
  assert.equal(args.perfEngine, undefined)
  assert.equal(args.visualMode, undefined)
  assert.doesNotThrow(() => validateRunOverrides(args))
})

test("parseArgs and validateRunOverrides accept gemini strategy overrides", () => {
  const args = parseArgs([
    "run",
    "--gemini-model",
    "gemini-3.1-pro-preview",
    "--gemini-thinking-level",
    "high",
    "--gemini-tool-mode",
    "validated",
    "--gemini-context-cache-mode",
    "api",
    "--gemini-media-resolution",
    "high",
  ])
  assert.equal(args.geminiModel, "gemini-3.1-pro-preview")
  assert.equal(args.geminiThinkingLevel, "high")
  assert.equal(args.geminiToolMode, "validated")
  assert.equal(args.geminiContextCacheMode, "api")
  assert.equal(args.geminiMediaResolution, "high")
  assert.doesNotThrow(() => validateRunOverrides(args))
})

test("catalog commands include desktop-smoke and web command set", () => {
  const commands = listCatalogCommands()
  assert.ok(commands.includes("desktop-smoke"))
  assert.ok(commands.includes("run"))
  assert.ok(commands.includes("capture"))
  assert.ok(commands.includes("report"))
})

test("desktop operator-manual gate blocks desktop commands without env", () => {
  const previousMode = process.env.UIQ_DESKTOP_AUTOMATION_MODE // uiq-env-allow test-only env guard coverage
  const previousReason = process.env.UIQ_DESKTOP_AUTOMATION_REASON // uiq-env-allow test-only env guard coverage
  delete process.env.UIQ_DESKTOP_AUTOMATION_MODE // uiq-env-allow test-only env guard coverage
  delete process.env.UIQ_DESKTOP_AUTOMATION_REASON // uiq-env-allow test-only env guard coverage
  try {
    assert.throws(
      () => assertDesktopOperatorManualGate(parseArgs(["desktop-smoke"])),
      /UIQ_DESKTOP_AUTOMATION_MODE=operator-manual/
    )

    process.env.UIQ_DESKTOP_AUTOMATION_MODE = "operator-manual" // uiq-env-allow test-only env guard coverage
    assert.throws(
      () => assertDesktopOperatorManualGate(parseArgs(["desktop-smoke"])),
      /UIQ_DESKTOP_AUTOMATION_REASON=<auditable reason>/
    )

    process.env.UIQ_DESKTOP_AUTOMATION_REASON = "ci desktop regression" // uiq-env-allow test-only env guard coverage
    assert.doesNotThrow(() => assertDesktopOperatorManualGate(parseArgs(["desktop-smoke"])))
  } finally {
    if (previousMode === undefined) {
      delete process.env.UIQ_DESKTOP_AUTOMATION_MODE // uiq-env-allow test-only env guard coverage
    } else {
      process.env.UIQ_DESKTOP_AUTOMATION_MODE = previousMode // uiq-env-allow test-only env guard coverage
    }
    if (previousReason === undefined) {
      delete process.env.UIQ_DESKTOP_AUTOMATION_REASON // uiq-env-allow test-only env guard coverage
    } else {
      process.env.UIQ_DESKTOP_AUTOMATION_REASON = previousReason // uiq-env-allow test-only env guard coverage
    }
  }
})

test("desktop operator-manual gate blocks run profiles with desktop steps without env", () => {
  const previousMode = process.env.UIQ_DESKTOP_AUTOMATION_MODE // uiq-env-allow test-only env guard coverage
  const previousReason = process.env.UIQ_DESKTOP_AUTOMATION_REASON // uiq-env-allow test-only env guard coverage
  delete process.env.UIQ_DESKTOP_AUTOMATION_MODE // uiq-env-allow test-only env guard coverage
  delete process.env.UIQ_DESKTOP_AUTOMATION_REASON // uiq-env-allow test-only env guard coverage
  try {
    assert.throws(
      () =>
        assertDesktopOperatorManualGate(parseArgs(["run", "--profile", "tauri.regression"]), [
          "desktop_readiness",
          "desktop_smoke",
          "desktop_e2e",
        ]),
      /UIQ_DESKTOP_AUTOMATION_MODE=operator-manual/
    )
  } finally {
    if (previousMode === undefined) {
      delete process.env.UIQ_DESKTOP_AUTOMATION_MODE // uiq-env-allow test-only env guard coverage
    } else {
      process.env.UIQ_DESKTOP_AUTOMATION_MODE = previousMode // uiq-env-allow test-only env guard coverage
    }
    if (previousReason === undefined) {
      delete process.env.UIQ_DESKTOP_AUTOMATION_REASON // uiq-env-allow test-only env guard coverage
    } else {
      process.env.UIQ_DESKTOP_AUTOMATION_REASON = previousReason // uiq-env-allow test-only env guard coverage
    }
  }
})
