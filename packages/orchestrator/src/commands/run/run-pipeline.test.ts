import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import type { TestSuiteResult } from "../test-suite.js"
import { createInitialPipelineStageState } from "./pipeline/stage-execution.js"
import {
  failedCriticalSuites,
  isFixResultExecutable,
  readExecutableFixResult,
  runAiPreflight,
  runProfile,
  runPostFixRegressionLoop,
} from "./run-pipeline.js"

type SuiteResultResolver = (result: TestSuiteResult) => void

function withEnv<T>(overrides: Record<string, string | undefined>, task: () => T): T {
  const previous = new Map<string, string | undefined>()
  for (const key of Object.keys(overrides)) {
    previous.set(key, process.env[key])
    const value = overrides[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    return task()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test("runAiPreflight blocks strict no-fallback when gemini key is missing", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-ai-preflight-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    assert.throws(
      () =>
        withEnv(
          {
            AI_PROVIDER: undefined,
            GEMINI_API_KEY: undefined,
          },
          () => runAiPreflight("pr", { aiReview: { enabled: true } } as never, baseDir)
        ),
      /ai\.gemini\.strict_policy_violation/i
    )
    const report = JSON.parse(
      readFileSync(resolve(baseDir, "reports/ai-preflight.json"), "utf8")
    ) as {
      status: string
      reasonCode: string
      policySnapshot?: {
        sourcePath: string
        provider: string
        primary: string
        fallback: string
        fallbackMode: string
        strictNoFallback: boolean
      }
    }
    assert.equal(report.status, "blocked")
    assert.equal(report.reasonCode, "ai.gemini.strict_policy_violation")
    assert.ok(report.policySnapshot)
    assert.equal(report.policySnapshot?.provider, "gemini")
    assert.equal(report.policySnapshot?.primary, "gemini")
    assert.equal(report.policySnapshot?.fallback, "none")
    assert.equal(report.policySnapshot?.fallbackMode, "strict")
    assert.equal(report.policySnapshot?.strictNoFallback, true)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("runAiPreflight blocks strict policy when policy primary is non-gemini", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-ai-preflight-policy-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  const policyPath = resolve(baseDir, "provider-policy.yaml")
  writeFileSync(
    policyPath,
    "provider: unsupported\nprimary: unsupported\nfallback: none\nfallbackMode: strict\n",
    "utf8"
  )
  try {
    assert.throws(
      () =>
        withEnv(
          {
            PROVIDER_POLICY_PATH: policyPath,
            AI_PROVIDER: undefined,
            GEMINI_API_KEY: "dummy-key",
          },
          () => runAiPreflight("pr", { aiReview: { enabled: true } } as never, baseDir)
        ),
      /ai\.gemini\.strict_policy_violation/i
    )
    const report = JSON.parse(
      readFileSync(resolve(baseDir, "reports/ai-preflight.json"), "utf8")
    ) as {
      status: string
      reasonCode: string
    }
    assert.equal(report.status, "blocked")
    assert.equal(report.reasonCode, "ai.gemini.strict_policy_violation")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("runAiPreflight blocks provider mismatch under strict no-fallback policy", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-ai-preflight-blocked-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    assert.throws(
      () =>
        withEnv(
          {
            AI_PROVIDER: "unsupported",
            GEMINI_API_KEY: undefined,
          },
          () => runAiPreflight("pr", { aiReview: { enabled: true } } as never, baseDir)
        ),
      /ai\.gemini\.strict_policy_violation/i
    )
    const report = JSON.parse(
      readFileSync(resolve(baseDir, "reports/ai-preflight.json"), "utf8")
    ) as {
      status: string
      reasonCode: string
    }
    assert.equal(report.status, "blocked")
    assert.equal(report.reasonCode, "ai.gemini.strict_policy_violation")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("runAiPreflight handles ai-not-required, non-gemini provider, and local no-key pass branches", () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-ai-preflight-misc-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const skippedPath = withEnv(
      {
        AI_PROVIDER: undefined,
        GEMINI_API_KEY: undefined,
      },
      () => runAiPreflight("pr", { aiReview: { enabled: false } } as never, baseDir)
    )
    assert.equal(skippedPath, "reports/ai-preflight.json")
    const skipped = JSON.parse(readFileSync(resolve(baseDir, skippedPath), "utf8")) as { status: string; reasonCode: string }
    assert.equal(skipped.status, "skipped")
    assert.equal(skipped.reasonCode, "ai.gemini.preflight.skipped.ai_not_required")

    assert.throws(
      () =>
        withEnv(
          {
            AI_PROVIDER: "legacy-provider",
            GEMINI_API_KEY: "dummy-key",
            PROVIDER_POLICY_PATH: undefined,
          },
          () => runAiPreflight("pr", { aiReview: { enabled: true } } as never, baseDir)
        ),
      /strict policy requires AI provider 'gemini'/
    )

    const localPassPath = withEnv(
      {
        AI_PROVIDER: "gemini",
        GEMINI_API_KEY: undefined,
        PROVIDER_POLICY_PATH: resolve(baseDir, "provider-policy.yaml"),
      },
      () => {
        writeFileSync(
          resolve(baseDir, "provider-policy.yaml"),
          "provider: gemini\nprimary: gemini\nfallback: gemini\nfallbackMode: permissive\n",
          "utf8"
        )
        return runAiPreflight("pr", { aiReview: { enabled: true } } as never, baseDir)
      }
    )
    const localPass = JSON.parse(readFileSync(resolve(baseDir, localPassPath), "utf8")) as {
      status: string
      reasonCode: string
    }
    assert.equal(localPass.status, "passed")
    assert.equal(localPass.reasonCode, "ai.gemini.preflight.passed.local_review_without_api_key")
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

function failedSuiteResult(suite: "unit" | "contract" | "ct" | "e2e"): TestSuiteResult {
  return {
    suite,
    status: "failed",
    exitCode: 1,
    durationMs: 1,
    command: "pnpm",
    args: [],
    reportPath: `reports/test-${suite}.json`,
    stdoutTail: "",
    stderrTail: "",
  }
}

function passedSuiteResult(suite: "unit" | "contract" | "ct" | "e2e"): TestSuiteResult {
  return {
    ...failedSuiteResult(suite),
    status: "passed",
    exitCode: 0,
  }
}

test("fix result helpers cover executable detection, missing files and failed suite aggregation", () => {
  assert.equal(isFixResultExecutable({ executable: true }), true)
  assert.equal(isFixResultExecutable({ canExecute: true }), true)
  assert.equal(isFixResultExecutable({ hasExecutableFixes: true }), true)
  assert.equal(isFixResultExecutable({ actions: [{}] }), true)
  assert.equal(isFixResultExecutable({ status: "ready" }), true)
  assert.equal(isFixResultExecutable({ status: "noop" }), false)
  assert.equal(isFixResultExecutable(null), false)

  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-fix-result-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    assert.deepEqual(readExecutableFixResult(baseDir, state), { executable: false })

    writeFileSync(resolve(baseDir, "reports/fix-result.json"), "{invalid-json", "utf8")
    state.generatedReports.fixResult = "reports/fix-result.json"
    assert.deepEqual(readExecutableFixResult(baseDir, state), {
      executable: false,
      path: "reports/fix-result.json",
    })

    writeFileSync(
      resolve(baseDir, "reports/fix-result.json"),
      JSON.stringify({ status: "completed" }),
      "utf8"
    )
    assert.deepEqual(readExecutableFixResult(baseDir, state), {
      executable: true,
      path: "reports/fix-result.json",
    })

    state.unitTestResult = failedSuiteResult("unit")
    state.contractTestResult = passedSuiteResult("contract")
    state.ctTestResult = failedSuiteResult("ct")
    state.e2eTestResult = failedSuiteResult("e2e")
    assert.deepEqual(failedCriticalSuites(state), ["unit", "ct", "e2e"])
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("post-fix regression loop fails immediately when max iterations is 0", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-post-fix-0-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  writeFileSync(
    resolve(baseDir, "reports/fix-result.json"),
    JSON.stringify({ executable: true }),
    "utf8"
  )
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.unitTestResult = failedSuiteResult("unit")
    const report = await runPostFixRegressionLoop(
      baseDir,
      state,
      async () => passedSuiteResult("unit"),
      0
    )
    assert.equal(report.status, "failed")
    assert.equal(report.iterationsExecuted, 0)
    assert.equal(report.converged, false)
    assert.deepEqual(report.remainingFailedSuites, ["unit"])
    const persisted = JSON.parse(
      readFileSync(resolve(baseDir, "reports/post-fix-regression.json"), "utf8")
    ) as {
      status: string
      iterationsExecuted: number
    }
    assert.equal(persisted.status, "failed")
    assert.equal(persisted.iterationsExecuted, 0)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("post-fix regression loop converges within one iteration", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-post-fix-1-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  writeFileSync(
    resolve(baseDir, "reports/fix-result.json"),
    JSON.stringify({ executable: true }),
    "utf8"
  )
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.unitTestResult = failedSuiteResult("unit")
    let called = 0
    const report = await runPostFixRegressionLoop(
      baseDir,
      state,
      async (suite) => {
        called += 1
        return passedSuiteResult(suite)
      },
      1
    )
    assert.equal(called, 1)
    assert.equal(report.status, "passed")
    assert.equal(report.iterationsExecuted, 1)
    assert.equal(report.converged, true)
    assert.deepEqual(report.remainingFailedSuites, [])
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("post-fix regression loop can converge on second iteration", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-post-fix-2-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  writeFileSync(
    resolve(baseDir, "reports/fix-result.json"),
    JSON.stringify({ executable: true }),
    "utf8"
  )
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.unitTestResult = failedSuiteResult("unit")
    let call = 0
    const report = await runPostFixRegressionLoop(
      baseDir,
      state,
      async (suite) => {
        call += 1
        return call === 1 ? failedSuiteResult(suite) : passedSuiteResult(suite)
      },
      2
    )
    assert.equal(report.status, "passed")
    assert.equal(report.iterationsExecuted, 2)
    assert.equal(report.converged, true)
    assert.equal(report.iterations.length, 2)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("post-fix regression loop hard-fails when not converged after max iterations", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-post-fix-fail-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  writeFileSync(
    resolve(baseDir, "reports/fix-result.json"),
    JSON.stringify({ executable: true }),
    "utf8"
  )
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.unitTestResult = failedSuiteResult("unit")
    const report = await runPostFixRegressionLoop(
      baseDir,
      state,
      async (suite) => failedSuiteResult(suite),
      2
    )
    assert.equal(report.status, "failed")
    assert.equal(report.reasonCode, "gate.post_fix_regression.failed.not_converged")
    assert.equal(report.iterationsExecuted, 2)
    assert.equal(report.converged, false)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("post-fix regression loop reruns unit/contract/ct concurrently and keeps e2e serialized", async () => {
  const baseDir = mkdtempSync(resolve(tmpdir(), "uiq-post-fix-grouped-"))
  mkdirSync(resolve(baseDir, "reports"), { recursive: true })
  writeFileSync(
    resolve(baseDir, "reports/fix-result.json"),
    JSON.stringify({ executable: true }),
    "utf8"
  )
  try {
    const state = createInitialPipelineStageState("reports/runtime.json")
    state.unitTestResult = failedSuiteResult("unit")
    state.contractTestResult = failedSuiteResult("contract")
    state.ctTestResult = failedSuiteResult("ct")
    state.e2eTestResult = failedSuiteResult("e2e")

    const pendingResolves: Record<"unit" | "contract" | "ct", SuiteResultResolver> = {
      unit: () => undefined,
      contract: () => undefined,
      ct: () => undefined,
    }
    let groupReleased = false
    let e2eStarted = false
    let e2eStartedAfterGroupRelease = false
    const startedSuites: Array<"unit" | "contract" | "ct" | "e2e"> = []

    const loopPromise = runPostFixRegressionLoop(
      baseDir,
      state,
      async (suite) => {
        startedSuites.push(suite)
        if (suite === "e2e") {
          e2eStarted = true
          e2eStartedAfterGroupRelease = groupReleased
          return passedSuiteResult("e2e")
        }
        return await new Promise<TestSuiteResult>((resolvePromise) => {
          pendingResolves[suite] = resolvePromise
        })
      },
      1
    )

    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, 0)
    })
    assert.ok(startedSuites.includes("unit"))
    assert.ok(startedSuites.includes("contract"))
    assert.ok(startedSuites.includes("ct"))
    assert.equal(e2eStarted, false)

    groupReleased = true
    pendingResolves.unit(passedSuiteResult("unit"))
    pendingResolves.contract(passedSuiteResult("contract"))
    pendingResolves.ct(passedSuiteResult("ct"))

    const report = await loopPromise
    assert.equal(report.status, "passed")
    assert.equal(e2eStarted, true)
    assert.equal(e2eStartedAfterGroupRelease, true)
  } finally {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("runProfile completes minimal tauri profile without starting web runtime", async () => {
  const profilePath = resolve(process.cwd(), "configs", "profiles", "tauri.smoke.yaml")
  const targetPath = resolve(process.cwd(), "configs", "targets", "tauri.macos.yaml")
  const originalProfile = readFileSync(profilePath, "utf8")
  const originalTarget = readFileSync(targetPath, "utf8")
  try {
    writeFileSync(
      profilePath,
      ["name: tauri.smoke", "steps: []", "aiReview:", "  enabled: false"].join("\n"),
      "utf8"
    )
    writeFileSync(
      targetPath,
      [
        "name: tauri.macos",
        "type: tauri",
        "driver: tauri-webdriver",
        "app: /Applications/Fake.app",
      ].join("\n"),
      "utf8"
    )

    const result = await runProfile(
      "tauri.smoke",
      "tauri.macos",
      "run-pipeline-minimal-tauri",
      { autostartTarget: false }
    )
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      runId: string
      profile: string
      target: { type: string; name: string }
      gateResults: { status: string }
      proof?: { coveragePath: string; stabilityPath: string; gapsPath: string; reproPath: string }
      reports?: { proofCoverage?: string; proofStability?: string; proofGaps?: string; proofRepro?: string }
    }
    assert.equal(result.runId, "run-pipeline-minimal-tauri")
    assert.equal(manifest.runId, "run-pipeline-minimal-tauri")
    assert.equal(manifest.profile, "tauri.smoke")
    assert.equal(manifest.target.type, "tauri")
    assert.equal(manifest.target.name, "tauri.macos")
    assert.equal(["passed", "failed", "blocked"].includes(manifest.gateResults.status), true)
    assert.equal(manifest.proof?.coveragePath, "reports/proof.coverage.json")
    assert.equal(manifest.proof?.stabilityPath, "reports/proof.stability.json")
    assert.equal(manifest.reports?.proofCoverage, "reports/proof.coverage.json")
    assert.equal(manifest.reports?.proofStability, "reports/proof.stability.json")
  } finally {
    writeFileSync(profilePath, originalProfile, "utf8")
    writeFileSync(targetPath, originalTarget, "utf8")
    rmSync(resolve(process.cwd(), ".runtime-cache/artifacts/runs/run-pipeline-minimal-tauri"), {
      recursive: true,
      force: true,
    })
  }
})
