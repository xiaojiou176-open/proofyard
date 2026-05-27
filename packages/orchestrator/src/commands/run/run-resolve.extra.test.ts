import assert from "node:assert/strict"
import { rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import {
  optimizeNightlyChaosConfig,
  resolveA11yConfig,
  resolveAiReviewConfig,
  resolveChaosConfig,
  resolveComputerUseConfig,
  resolveDesktopSoakConfig,
  resolveDiagnosticsConfig,
  resolveExploreConfig,
  resolveLoadConfig,
  resolvePerfConfig,
  resolveSecurityConfig,
  resolveVisualConfig,
} from "./run-resolve.js"
import type { ProfileConfig, RunOverrides, TargetConfig } from "./run-types.js"

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

function baseProfile(): ProfileConfig {
  return {
    name: "nightly",
    steps: ["explore", "chaos", "load", "a11y", "perf", "visual"],
    gates: { consoleErrorMax: 0, pageErrorMax: 0, http5xxMax: 0 },
    explore: {
      budgetSeconds: 600,
      maxDepth: 4,
      maxStates: 30,
      seed: 42,
      denylist: ["delete account"],
      policyFile: "tmp-danger-policy.yaml",
      engine: "crawlee",
    },
    chaos: {
      budgetSeconds: 180,
      seed: 88,
      eventRatio: { click: 90, input: 30, scroll: 10, keyboard: 10 },
    },
    diagnostics: { maxItems: 9 },
    load: { vus: 12, durationSeconds: 50, requestTimeoutMs: 9000, engines: ["builtin", "k6"] },
    a11y: { standard: "wcag2aa", maxIssues: 12, engine: "axe" },
    perf: { preset: "mobile", engine: "lhci" },
    visual: { mode: "update", engine: "lostpixel", baselineDir: "visual/base", maxDiffPixels: 11 },
    aiReview: { enabled: true, maxArtifacts: 22, emitIssue: true, emitPrComment: false, severityThreshold: "medium" },
    desktopSoak: { durationSeconds: 99, intervalSeconds: 11, gates: { crashCountMax: 1 } },
    computerUse: { enabled: true, task: "profile task", maxSteps: 77, speedMode: true },
    security: { engine: "semgrep", maxFileSizeKb: 2048, includeExtensions: [".ts"], excludeDirs: ["fixtures"], rulesFile: "cfg/security.yaml" },
  }
}

function baseTarget(): TargetConfig {
  return {
    name: "web.ci",
    type: "web",
    driver: "web-playwright",
    baseUrl: "http://127.0.0.1:4173",
    scope: { domains: ["http://127.0.0.1:4173"] },
    explore: { budgetSeconds: 300, maxDepth: 2, maxStates: 10, seed: 7, denylist: ["drop table"], engine: "builtin" },
    chaos: { budgetSeconds: 90, seed: 19, eventRatio: { click: 40, input: 20, scroll: 20, keyboard: 20 } },
    diagnostics: { maxItems: 3 },
    load: { vus: 4, durationSeconds: 10, requestTimeoutMs: 2500, engines: ["artillery"] },
    a11y: { standard: "wcag2a", maxIssues: 4, engine: "builtin" },
    perf: { preset: "desktop", engine: "builtin" },
    visual: { mode: "diff", engine: "builtin", baselineDir: "target/base", maxDiffPixels: 5 },
    aiReview: { enabled: false, maxArtifacts: 5, emitIssue: false, emitPrComment: false, severityThreshold: "high" },
    desktopSoak: { durationSeconds: 20, intervalSeconds: 2, gates: { cpuAvgPercentMax: 10 } },
    computerUse: { enabled: true, task: "target task", maxSteps: 11, speedMode: false },
    security: { engine: "builtin", maxFileSizeKb: 100, includeExtensions: [".js"], excludeDirs: ["build"], rulesFile: "target/security.yaml" },
  }
}

test("run-resolve merges web configs, overrides and nightly chaos optimizations", () => {
  const policyPath = resolve(process.cwd(), "tmp-danger-policy.yaml")
  writeFileSync(
    policyPath,
    [
      "lexical:",
      "  - remove billing",
      "roles:",
      "  - button",
      "selectors:",
      "  - [data-testid='danger']",
      "urlPatterns:",
      "  - /danger",
    ].join("\n"),
    "utf8"
  )
  try {
    const profile = baseProfile()
    const target = baseTarget()
    const overrides: RunOverrides = {
      baseUrl: "http://127.0.0.1:43173",
      exploreBudgetSeconds: 700,
      exploreMaxDepth: 5,
      exploreMaxStates: 40,
      chaosBudgetSeconds: 240,
      chaosClickRatio: 95,
      loadEngine: "both",
      loadVus: 33,
      loadDurationSeconds: 77,
      loadRequestTimeoutMs: 9999,
      a11yMaxIssues: 55,
      a11yEngine: "builtin",
      perfPreset: "desktop",
      perfEngine: "builtin",
      visualMode: "diff",
      aiReview: true,
      aiReviewMaxArtifacts: 44,
      computerUseMaxSteps: 99,
      computerUseSpeedMode: false,
      soakDurationSeconds: 222,
      soakIntervalSeconds: 7,
    }

    const explore = resolveExploreConfig(target, profile, overrides)
    assert.equal(explore.engine, "crawlee")
    assert.equal(explore.baseUrl, "http://127.0.0.1:43173")
    assert.equal(explore.budgetSeconds, 700)
    assert.equal(explore.maxDepth, 5)
    assert.equal(explore.maxStates, 40)
    assert.ok(explore.denylist.includes("delete account"))
    assert.ok(explore.denylist.includes("drop table"))
    assert.ok(explore.denylist.includes("remove billing"))
    assert.ok(explore.denyStrategy.roles.includes("button"))

    const chaos = resolveChaosConfig(target, profile, overrides)
    assert.equal(chaos.baseUrl, "http://127.0.0.1:43173")
    assert.equal(chaos.budgetSeconds, 240)
    assert.equal(chaos.eventRatio.click, 95)
    const optimized = optimizeNightlyChaosConfig(chaos, profile, explore, overrides)
    assert.equal(optimized.budgetSeconds, 240)

    const diagnostics = resolveDiagnosticsConfig(target, profile, 0)
    assert.equal(diagnostics.maxItems, 1)

    const load = resolveLoadConfig(target, profile, overrides)
    assert.deepEqual(load.engines, ["builtin", "artillery", "k6"])
    assert.equal(load.vus, 33)
    assert.equal(load.durationSeconds, 77)

    const a11y = resolveA11yConfig(target, profile, overrides)
    assert.equal(a11y.engine, "builtin")
    assert.equal(a11y.maxIssues, 55)

    const perf = resolvePerfConfig(target, profile, overrides)
    assert.equal(perf.engine, "builtin")
    assert.equal(perf.preset, "desktop")

    const visual = resolveVisualConfig(target, profile, overrides)
    assert.equal(visual.mode, "diff")
    assert.equal(visual.engine, "lostpixel")

    const aiReview = resolveAiReviewConfig(target, profile, overrides)
    assert.equal(aiReview.enabled, true)
    assert.equal(aiReview.maxArtifacts, 44)
    assert.equal(aiReview.severityThreshold, "medium")

    const computerUse = withEnv({ UIQ_COMPUTER_USE_TASK: "env fallback" }, () =>
      resolveComputerUseConfig(target, profile, overrides)
    )
    assert.equal(computerUse.task, "profile task")
    assert.equal(computerUse.maxSteps, 99)
    assert.equal(computerUse.speedMode, false)

    const security = resolveSecurityConfig(target, profile)
    assert.equal(security.engine, "semgrep")
    assert.ok(security.includeExtensions.includes(".ts"))
    assert.ok(security.includeExtensions.includes(".js"))
    assert.ok(security.excludeDirs.includes("fixtures"))
    assert.ok(security.excludeDirs.includes("build"))

    const desktopSoak = resolveDesktopSoakConfig(target, profile, overrides)
    assert.equal(desktopSoak.durationSeconds, 222)
    assert.equal(desktopSoak.intervalSeconds, 7)
    assert.equal(desktopSoak.gates?.crashCountMax, 1)
  } finally {
    rmSync(policyPath, { force: true })
  }
})
