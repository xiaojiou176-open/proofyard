import assert from "node:assert/strict"
import test from "node:test"

import { validateProfileConfig, validateTargetConfig } from "./run-validate.js"
import type { ProfileConfig, TargetConfig } from "./run-types.js"

function validProfile(): ProfileConfig {
  return {
    name: "pr",
    steps: ["report"],
    gates: { consoleErrorMax: 0, pageErrorMax: 0, http5xxMax: 0 },
  }
}

function validTarget(): TargetConfig {
  return {
    name: "web.ci",
    type: "web",
    driver: "web-playwright",
    baseUrl: "http://127.0.0.1:4173",
    scope: { domains: ["http://127.0.0.1:4173"] },
  }
}

test("validateProfileConfig accepts rich valid sections across profile schema", () => {
  const profile = validateProfileConfig(
    {
      ...validProfile(),
      tests: { e2eSuite: "full" },
      computerUse: { enabled: true, task: "open dashboard", maxSteps: 33, speedMode: false },
      determinism: {
        timezone: "UTC",
        locale: "en-US",
        seed: 1,
        disableAnimations: true,
        reducedMotion: "reduce",
      },
      explore: {
        budgetSeconds: 12,
        maxDepth: 3,
        maxStates: 9,
        seed: 11,
        denylist: ["drop table"],
        engine: "crawlee",
      },
      chaos: {
        seed: 3,
        budgetSeconds: 5,
        eventRatio: { click: 10, input: 20, scroll: 30, keyboard: 40 },
      },
      a11y: { standard: "wcag2aaa", maxIssues: 9, engine: "builtin" },
      perf: { preset: "mobile", engine: "lhci" },
      visual: { engine: "backstop", mode: "update", baselineDir: "base", maxDiffPixels: 42 },
      load: { vus: 2, durationSeconds: 15, requestTimeoutMs: 1000, engines: ["builtin", "k6"] },
      security: {
        engine: "semgrep",
        maxFileSizeKb: 1024,
        includeExtensions: [".ts"],
        excludeDirs: ["fixtures"],
        rulesFile: "rules.yaml",
      },
      aiReview: {
        enabled: true,
        maxArtifacts: 8,
        emitIssue: false,
        emitPrComment: true,
        severityThreshold: "critical",
      },
      desktopSoak: {
        durationSeconds: 30,
        intervalSeconds: 5,
        gates: { rssGrowthMbMax: 10, cpuAvgPercentMax: 20, crashCountMax: 1 },
      },
      desktopE2E: { keyboardInteractionRequired: true },
      enginePolicy: { required: ["crawlee", "k6"], failOnBlocked: true },
      diagnostics: { maxItems: 17 },
    },
    "pr"
  )
  assert.equal(profile.name, "pr")
})

test("validateProfileConfig rejects rich invalid profile branches", () => {
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), tests: { e2eSuite: "generic" as never } }, "pr"),
    /tests\.e2eSuite/
  )
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), computerUse: { enabled: true, maxSteps: 0 } as never }, "pr"),
    /computerUse\.maxSteps/
  )
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), determinism: { reducedMotion: "fast" as never } }, "pr"),
    /determinism\.reducedMotion/
  )
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), load: { engines: ["bad"] as never } }, "pr"),
    /load\.engines/
  )
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), security: { engine: "bad" as never } }, "pr"),
    /security\.engine/
  )
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), desktopSoak: { gates: { cpuAvgPercentMax: 101 } } }, "pr"),
    /desktopSoak\.gates\.cpuAvgPercentMax/
  )
  assert.throws(
    () => validateProfileConfig({ ...validProfile(), diagnostics: { maxItems: 0 } }, "pr"),
    /diagnostics\.maxItems/
  )
})

test("validateTargetConfig accepts and rejects rich target branches", () => {
  const target = validateTargetConfig(
    {
      ...validTarget(),
      start: {
        web: "pnpm dev",
        api: "PROJECT_PYTHON_ENV=.runtime-cache/toolchains/python/.venv UV_PROJECT_ENVIRONMENT=.runtime-cache/toolchains/python/.venv uv run uvicorn app:app",
      },
      healthcheck: { url: "http://127.0.0.1:4173/health" },
      explore: { budgetSeconds: 3, maxDepth: 2, maxStates: 4, seed: 1, denylist: ["foo"], engine: "builtin" },
      chaos: { seed: 9, budgetSeconds: 3, eventRatio: { click: 10, input: 10, scroll: 10, keyboard: 70 } },
      diagnostics: { maxItems: 10 },
      load: { vus: 1, durationSeconds: 2, requestTimeoutMs: 200, engines: ["artillery"] },
      a11y: { standard: "wcag2aa", maxIssues: 2, engine: "axe" },
      perf: { preset: "desktop", engine: "builtin" },
      visual: { engine: "lostpixel", mode: "diff", baselineDir: "base", maxDiffPixels: 2 },
      security: { engine: "builtin", maxFileSizeKb: 300, includeExtensions: [".ts"], excludeDirs: ["dist"], rulesFile: "rules.yaml" },
      aiReview: { enabled: false, maxArtifacts: 6, emitIssue: true, emitPrComment: false, severityThreshold: "low" },
      desktopSoak: { durationSeconds: 10, intervalSeconds: 2, gates: { rssGrowthMbMax: 1, crashCountMax: 0 } },
      computerUse: { enabled: true, task: "target task", maxSteps: 10, speedMode: true },
    },
    "web.ci"
  )
  assert.equal(target.name, "web.ci")

  assert.throws(
    () => validateTargetConfig({ ...validTarget(), start: { web: 1 as never } }, "web.ci"),
    /start\.web/
  )
  assert.throws(
    () => validateTargetConfig({ ...validTarget(), healthcheck: { url: 1 as never } }, "web.ci"),
    /healthcheck\.url/
  )
  assert.throws(
    () => validateTargetConfig({ ...validTarget(), scope: { domains: [123 as never] } }, "web.ci"),
    /scope\.domains/
  )
  assert.throws(
    () => validateTargetConfig({ ...validTarget(), explore: { engine: "bad" as never } }, "web.ci"),
    /explore\.engine/
  )
  assert.throws(
    () => validateTargetConfig({ ...validTarget(), load: { engines: ["bad"] as never } }, "web.ci"),
    /load\.engines/
  )
  assert.throws(
    () => validateTargetConfig({ ...validTarget(), diagnostics: { maxItems: 0 } }, "web.ci"),
    /diagnostics\.maxItems/
  )
  assert.throws(
    () => validateTargetConfig({ ...validTarget(), computerUse: { enabled: true, speedMode: "fast" as never } }, "web.ci"),
    /computerUse\.speedMode/
  )
})
