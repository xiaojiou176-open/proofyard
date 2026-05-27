import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { ensureRunDirectories, sanitizeRunId } from "../../../../core/src/artifacts/runtimePaths.js"
import {
  getDriverCapabilityContract,
  isStepSupportedByDriver,
} from "../../../../drivers/capabilities.js"
import {
  type ComputerUseExecutionResult,
  type ComputerUseOptions,
  runComputerUse,
} from "../computer-use.js"
import { loadStateModel } from "../state-model.js"
import { persistRuntimeStartResult, startTargetRuntime } from "../target-runtime.js"
import type { TestSuiteResult } from "../test-suite.js"
import { finalizePipelineReporting } from "./pipeline/reporting.js"
import {
  createInitialPipelineStageState,
  executePipelineStages,
  type PipelineStageState,
  type PostFixRegressionReport,
} from "./pipeline/stage-execution.js"
import { assertBaseUrlAllowed, loadProfileConfig, loadTargetConfig } from "./run-config.js"
import { gateReasonCode } from "./run-reporting.js"
import { resolveDiagnosticsConfig } from "./run-resolve.js"
import { DEFAULT_MAX_PARALLEL_TASKS } from "./run-schema.js"
import type { BlockedStepDetail, RunOverrides } from "./run-types.js"

export type RunProfileDependencies = {
  runComputerUse?: (options: ComputerUseOptions) => ComputerUseExecutionResult
}

export function resolveMaxParallelTasks(): number {
  const parallelEnabled = process.env.UIQ_ORCHESTRATOR_PARALLEL !== "0"
  if (!parallelEnabled) {
    return 1
  }
  const raw = process.env.UIQ_ORCHESTRATOR_MAX_PARALLEL_TASKS
  if (!raw) {
    return DEFAULT_MAX_PARALLEL_TASKS
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_PARALLEL_TASKS
  }
  return Math.max(1, parsed)
}

export function resolveAiFixMaxIterations(): number {
  const raw = process.env.AI_FIX_MAX_ITERATIONS
  if (!raw || raw.trim().length === 0) {
    return 2
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return 2
  }
  return Math.max(0, parsed)
}

export function tailCommandOutput(text: string, maxLines = 60): string {
  return text.split("\n").slice(-maxLines).join("\n").trim()
}

export function argsForSuite(
  suite: "unit" | "ct" | "e2e" | "contract",
  e2eSuite: "smoke" | "regression" | "full"
): string[] {
  if (suite === "unit") return ["test:unit"]
  if (suite === "contract") return ["test:contract"]
  if (suite === "ct") return ["test:ct"]
  if (e2eSuite === "smoke") return ["test:e2e", "--grep", "@smoke"]
  if (e2eSuite === "regression") return ["test:e2e", "--grep", "@regression"]
  return ["test:e2e"]
}

export function computeIsolatedCtPort(baseDir: string): number {
  let hash = 0
  for (const ch of baseDir) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return 4300 + (hash % 200)
}

type AiPreflightReport = {
  generatedAt: string
  status: "passed" | "blocked" | "skipped"
  reasonCode: string
  requiresAi: boolean
  aiProvider: string
  hasGeminiKey: boolean
  profileName: string
  policySnapshot?: ProviderPolicySnapshot
}

type ProviderPolicySnapshot = {
  sourcePath: string
  provider: string
  primary: string
  fallback: string
  fallbackMode: string
  strictNoFallback: boolean
}

const DEFAULT_PROVIDER_POLICY: Omit<ProviderPolicySnapshot, "sourcePath"> = {
  provider: "gemini",
  primary: "gemini",
  fallback: "none",
  fallbackMode: "strict",
  strictNoFallback: true,
}

export function parseProviderPolicyValue(raw: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf(":")
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, "")
    if (key) values[key] = value
  }
  return values
}

export function loadProviderPolicySnapshot(): ProviderPolicySnapshot {
  const configuredPath =
    process.env.PROVIDER_POLICY_PATH?.trim() || "configs/ai/provider-policy.yaml"
  try {
    const raw = readFileSync(resolve(process.cwd(), configuredPath), "utf8")
    const parsed = parseProviderPolicyValue(raw)
    const provider = (parsed.provider || DEFAULT_PROVIDER_POLICY.provider).trim().toLowerCase()
    const primary = (parsed.primary || provider || DEFAULT_PROVIDER_POLICY.primary)
      .trim()
      .toLowerCase()
    const fallback = (parsed.fallback || DEFAULT_PROVIDER_POLICY.fallback).trim().toLowerCase()
    const fallbackMode = (parsed.fallbackMode || DEFAULT_PROVIDER_POLICY.fallbackMode)
      .trim()
      .toLowerCase()
    return {
      sourcePath: configuredPath,
      provider: provider || DEFAULT_PROVIDER_POLICY.provider,
      primary: primary || DEFAULT_PROVIDER_POLICY.primary,
      fallback: fallback || DEFAULT_PROVIDER_POLICY.fallback,
      fallbackMode: fallbackMode || DEFAULT_PROVIDER_POLICY.fallbackMode,
      strictNoFallback: fallbackMode === "strict" && fallback === "none",
    }
  } catch {
    return {
      sourcePath: configuredPath,
      ...DEFAULT_PROVIDER_POLICY,
    }
  }
}

export function resolveAiProvider(policy: ProviderPolicySnapshot): string {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase()
  if (raw && raw.length > 0) return raw
  if (policy.primary) return policy.primary
  return policy.provider || "gemini"
}

function resolveFixResultPath(baseDir: string, state: PipelineStageState): string | undefined {
  const fromGenerated = state.generatedReports.fixResult
  if (fromGenerated && existsSync(resolve(baseDir, fromGenerated))) {
    return fromGenerated
  }
  const fallback = "reports/fix-result.json"
  if (existsSync(resolve(baseDir, fallback))) {
    return fallback
  }
  return undefined
}

export function isFixResultExecutable(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false
  }
  const record = payload as Record<string, unknown>
  if (typeof record.executable === "boolean") {
    return record.executable
  }
  if (typeof record.canExecute === "boolean") {
    return record.canExecute
  }
  if (typeof record.hasExecutableFixes === "boolean") {
    return record.hasExecutableFixes
  }
  if (Array.isArray(record.actions)) {
    return record.actions.length > 0
  }
  if (typeof record.status === "string") {
    const normalized = record.status.trim().toLowerCase()
    if (normalized === "applied" || normalized === "ready" || normalized === "completed") {
      return true
    }
  }
  return false
}

export function readExecutableFixResult(
  baseDir: string,
  state: PipelineStageState
): { executable: boolean; path?: string } {
  const fixResultPath = resolveFixResultPath(baseDir, state)
  if (!fixResultPath) {
    return { executable: false }
  }
  try {
    const parsed = JSON.parse(readFileSync(resolve(baseDir, fixResultPath), "utf8")) as unknown
    return { executable: isFixResultExecutable(parsed), path: fixResultPath }
  } catch {
    return { executable: false, path: fixResultPath }
  }
}

export function failedCriticalSuites(
  state: PipelineStageState
): Array<"unit" | "contract" | "ct" | "e2e"> {
  const failed: Array<"unit" | "contract" | "ct" | "e2e"> = []
  if (state.unitTestResult?.status === "failed") failed.push("unit")
  if (state.contractTestResult?.status === "failed") failed.push("contract")
  if (state.ctTestResult?.status === "failed") failed.push("ct")
  if (state.e2eTestResult?.status === "failed") failed.push("e2e")
  return failed
}

function assignSuiteResult(
  state: PipelineStageState,
  suite: "unit" | "contract" | "ct" | "e2e",
  result: TestSuiteResult
): void {
  if (suite === "unit") {
    state.unitTestResult = result
    state.generatedReports.testUnit = result.reportPath
    return
  }
  if (suite === "contract") {
    state.contractTestResult = result
    state.generatedReports.testContract = result.reportPath
    return
  }
  if (suite === "ct") {
    state.ctTestResult = result
    state.generatedReports.testCt = result.reportPath
    return
  }
  state.e2eTestResult = result
  state.generatedReports.testE2e = result.reportPath
}

export async function runPostFixRegressionLoop(
  baseDir: string,
  state: PipelineStageState,
  runTestSuite: (suite: "unit" | "contract" | "ct" | "e2e") => Promise<TestSuiteResult>,
  maxIterations: number
): Promise<PostFixRegressionReport> {
  const fixSignal = readExecutableFixResult(baseDir, state)
  let failedSuites = failedCriticalSuites(state)
  const initialFailedSuites = [...failedSuites]
  const iterations: PostFixRegressionReport["iterations"] = []
  let iterationsExecuted = 0
  let status: PostFixRegressionReport["status"] = "skipped"
  let reasonCode = gateReasonCode("post_fix.regression", "passed", "no_executable_fix_result")
  let converged = true

  if (fixSignal.executable) {
    status = "passed"
    reasonCode = gateReasonCode("post_fix.regression", "passed", "no_failed_critical_suites")
    converged = failedSuites.length === 0
    while (failedSuites.length > 0 && iterationsExecuted < maxIterations) {
      const rerunSuites = [...failedSuites]
      const iterationResultBySuite = new Map<
        "unit" | "contract" | "ct" | "e2e",
        PostFixRegressionReport["iterations"][number]["results"][number]
      >()
      const parallelSuites = rerunSuites.filter((suite) => suite !== "e2e")
      await Promise.all(
        parallelSuites.map(async (suite) => {
          const result = await runTestSuite(suite)
          assignSuiteResult(state, suite, result)
          iterationResultBySuite.set(suite, {
            suite,
            status: result.status,
            reportPath: result.reportPath,
            exitCode: result.exitCode,
          })
        })
      )
      if (rerunSuites.includes("e2e")) {
        const result = await runTestSuite("e2e")
        assignSuiteResult(state, "e2e", result)
        iterationResultBySuite.set("e2e", {
          suite: "e2e",
          status: result.status,
          reportPath: result.reportPath,
          exitCode: result.exitCode,
        })
      }
      const iterationResults = rerunSuites
        .map((suite) => iterationResultBySuite.get(suite))
        .filter(
          (result): result is PostFixRegressionReport["iterations"][number]["results"][number] =>
            result !== undefined
        )
      iterationsExecuted += 1
      failedSuites = failedCriticalSuites(state)
      iterations.push({
        iteration: iterationsExecuted,
        rerunSuites,
        results: iterationResults,
      })
      if (failedSuites.length === 0) {
        converged = true
        status = "passed"
        reasonCode = gateReasonCode("post_fix.regression", "passed", "converged")
        break
      }
      converged = false
    }

    if (!converged || failedSuites.length > 0) {
      status = "failed"
      converged = false
      reasonCode = gateReasonCode("post_fix.regression", "failed", "not_converged")
    }
  }

  const report: PostFixRegressionReport = {
    generatedAt: new Date().toISOString(),
    status,
    reasonCode,
    maxIterations,
    iterationsExecuted,
    fixResultPath: fixSignal.path,
    fixResultExecutable: fixSignal.executable,
    converged,
    initialFailedSuites,
    remainingFailedSuites: failedSuites,
    iterations,
  }
  const reportPath = "reports/post-fix-regression.json"
  writeFileSync(resolve(baseDir, reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  state.postFixRegression = report
  state.generatedReports.postFixRegression = reportPath
  return report
}

function writeAiPreflightReport(baseDir: string, report: AiPreflightReport): string {
  const reportPath = "reports/ai-preflight.json"
  writeFileSync(resolve(baseDir, reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8")
  return reportPath
}

export function runAiPreflight(
  profileName: string,
  profile: ReturnType<typeof loadProfileConfig>,
  baseDir: string
): string {
  const requiresAi = profile.aiReview?.enabled === true
  const policySnapshot = loadProviderPolicySnapshot()
  const aiProvider = resolveAiProvider(policySnapshot)
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY?.trim())
  if (!requiresAi) {
    return writeAiPreflightReport(baseDir, {
      generatedAt: new Date().toISOString(),
      status: "skipped",
      reasonCode: "ai.gemini.preflight.skipped.ai_not_required",
      requiresAi,
      aiProvider,
      hasGeminiKey,
      profileName,
      policySnapshot,
    })
  }
  if (policySnapshot.strictNoFallback && aiProvider !== policySnapshot.primary) {
    writeAiPreflightReport(baseDir, {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      reasonCode: "ai.gemini.strict_policy_violation",
      requiresAi,
      aiProvider,
      hasGeminiKey,
      profileName,
      policySnapshot,
    })
    throw new Error(
      `[ai.gemini.strict_policy_violation] strict policy requires AI provider '${policySnapshot.primary}', received '${aiProvider}'`
    )
  }
  if (policySnapshot.strictNoFallback && aiProvider !== "gemini") {
    writeAiPreflightReport(baseDir, {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      reasonCode: "ai.gemini.strict_policy_violation",
      requiresAi,
      aiProvider,
      hasGeminiKey,
      profileName,
      policySnapshot,
    })
    throw new Error(
      `[ai.gemini.strict_policy_violation] strict policy requires AI provider 'gemini', received '${aiProvider}'`
    )
  }
  if (policySnapshot.strictNoFallback && !hasGeminiKey) {
    writeAiPreflightReport(baseDir, {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      reasonCode: "ai.gemini.strict_policy_violation",
      requiresAi,
      aiProvider,
      hasGeminiKey,
      profileName,
      policySnapshot,
    })
    throw new Error("[ai.gemini.strict_policy_violation] GEMINI_API_KEY is required")
  }
  if (aiProvider !== "gemini") {
    writeAiPreflightReport(baseDir, {
      generatedAt: new Date().toISOString(),
      status: "blocked",
      reasonCode: "ai.gemini.unavailable.provider_not_gemini",
      requiresAi,
      aiProvider,
      hasGeminiKey,
      profileName,
      policySnapshot,
    })
    throw new Error("[ai.gemini.unavailable] AI_PROVIDER must be set to 'gemini' for AI review")
  }
  if (!hasGeminiKey) {
    return writeAiPreflightReport(baseDir, {
      generatedAt: new Date().toISOString(),
      status: "passed",
      reasonCode: "ai.gemini.preflight.passed.local_review_without_api_key",
      requiresAi,
      aiProvider,
      hasGeminiKey,
      profileName,
      policySnapshot,
    })
  }
  return writeAiPreflightReport(baseDir, {
    generatedAt: new Date().toISOString(),
    status: "passed",
    reasonCode: "ai.gemini.preflight.passed.ready",
    requiresAi,
    aiProvider,
    hasGeminiKey,
    profileName,
    policySnapshot,
  })
}

async function runTestSuiteAsync(
  baseDir: string,
  suite: "unit" | "contract" | "ct" | "e2e",
  baseUrl?: string,
  e2eSuite: "smoke" | "regression" | "full" = "smoke"
): Promise<TestSuiteResult> {
  const started = Date.now()
  const args = argsForSuite(suite, e2eSuite)
  const reportPath = `reports/test-${suite}.json`
  const ctPort = suite === "ct" ? computeIsolatedCtPort(baseDir) : undefined
  const env = {
    ...process.env,
    ...(baseUrl ? { UIQ_BASE_URL: baseUrl } : {}),
    ...(ctPort ? { UIQ_CT_PORT: String(ctPort), UIQ_CT_HOST: "127.0.0.1" } : {}),
  }

  const result = await new Promise<TestSuiteResult>((resolvePromise) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", (error) => {
      const failed: TestSuiteResult = {
        suite,
        status: "failed",
        exitCode: 1,
        durationMs: Date.now() - started,
        command: "pnpm",
        args,
        reportPath,
        stdoutTail: tailCommandOutput(stdout),
        stderrTail: tailCommandOutput(`${stderr}\n${error.message}`),
      }
      resolvePromise(failed)
    })
    child.on("close", (code) => {
      const done: TestSuiteResult = {
        suite,
        status: code === 0 ? "passed" : "failed",
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
        command: "pnpm",
        args,
        reportPath,
        stdoutTail: tailCommandOutput(stdout),
        stderrTail: tailCommandOutput(stderr),
      }
      resolvePromise(done)
    })
  })

  writeFileSync(resolve(baseDir, reportPath), JSON.stringify(result, null, 2), "utf8")
  return result
}

export async function runProfile(
  profileName: string,
  targetName: string,
  runId?: string,
  overrides?: RunOverrides,
  dependencies: RunProfileDependencies = {}
): Promise<{ runId: string; manifestPath: string }> {
  const profile = loadProfileConfig(profileName)
  const target = loadTargetConfig(targetName)
  const isWebTarget = target.type === "web"
  const driverContract = getDriverCapabilityContract(target.driver, target.type)

  const resolvedRunId = sanitizeRunId(runId ?? new Date().toISOString().replace(/[:.]/g, "-"))
  const startedAt = new Date().toISOString()
  const baseDir = ensureRunDirectories(resolvedRunId)
  const effectiveApp = overrides?.app ?? target.app
  const effectiveBundleId = overrides?.bundleId ?? target.bundleId
  const effectiveBaseUrl = overrides?.baseUrl ?? target.baseUrl ?? "http://localhost:4173"
  const baseUrlPolicy = assertBaseUrlAllowed(target, effectiveBaseUrl)
  const stateModel = loadStateModel()
  const autostartEnabled = overrides?.autostartTarget ?? true
  const startConfig = {
    enabled: isWebTarget && autostartEnabled,
    baseDir,
    startCommands: target.start,
    apiEnvOverrides: isWebTarget
      ? { AUTOMATION_ALLOW_LOCAL_NO_TOKEN: "true", APP_ENV: "test" }
      : undefined,
    healthcheckUrl: target.healthcheck?.url ?? effectiveBaseUrl,
  }
  const healthcheckUrl = startConfig.healthcheckUrl ?? effectiveBaseUrl
  let runtimeStart = await startTargetRuntime(startConfig)

  const blockedStepReasons: string[] = []
  const blockedStepDetails: BlockedStepDetail[] = []
  const recordBlockedStep = (
    stepId: string,
    detail: string,
    options?: {
      reasonCode?: string
      artifactPath?: string
    }
  ): void => {
    blockedStepReasons.push(`step.${stepId} ${detail}`)
    blockedStepDetails.push({
      stepId,
      reasonCode:
        options?.reasonCode ??
        gateReasonCode("driver.capability", "blocked", "unsupported_target_type"),
      detail,
      artifactPath: options?.artifactPath ?? "reports/summary.json",
    })
  }

  const unsupportedSteps = new Set(
    profile.steps.filter((stepId) => !isStepSupportedByDriver(stepId, target.type, driverContract))
  )
  const stepRequested = (stepId: string): boolean =>
    profile.steps.includes(stepId) && !unsupportedSteps.has(stepId)
  for (const stepId of unsupportedSteps) {
    recordBlockedStep(stepId, `unsupported by driver=${target.driver} target.type=${target.type}`)
  }

  const stageState = createInitialPipelineStageState(runtimeStart.reportPath)
  const aiPreflightPath = runAiPreflight(profileName, profile, baseDir)
  stageState.generatedReports.aiPreflight = aiPreflightPath
  const effectiveDiagnosticsConfig = resolveDiagnosticsConfig(
    target,
    profile,
    overrides?.diagnosticsMaxItems
  )
  const e2eSuite = profile.tests?.e2eSuite ?? "smoke"
  const maxParallelTasks = resolveMaxParallelTasks()
  const maxFixIterations = resolveAiFixMaxIterations()
  const stageDurationsMs: Record<string, number> = {}
  const runStage = async (stageId: string, task: () => Promise<void>): Promise<void> => {
    const startedAtMs = Date.now()
    await task()
    stageDurationsMs[stageId] = Date.now() - startedAtMs
  }

  const waitForRuntimeReady = async (timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const response = await fetch(healthcheckUrl, { method: "GET" })
        if (response.status < 500) {
          return true
        }
      } catch {
        // keep polling until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return false
  }

  const ensureRuntimeReady = async (stepId: string): Promise<void> => {
    if (!isWebTarget) return
    if (await waitForRuntimeReady(8_000)) {
      if (!runtimeStart.healthcheckPassed) {
        runtimeStart.healthcheckPassed = true
        persistRuntimeStartResult(baseDir, runtimeStart)
      }
      return
    }
    if (
      !startConfig.enabled ||
      (!startConfig.startCommands?.web && !startConfig.startCommands?.api)
    ) {
      throw new Error(`[${stepId}] runtime_unreachable url=${healthcheckUrl}`)
    }
    runtimeStart.teardown()
    runtimeStart = await startTargetRuntime(startConfig)
    stageState.generatedReports.runtime = runtimeStart.reportPath
    if (!runtimeStart.healthcheckPassed) {
      throw new Error(`[${stepId}] runtime_restart_failed url=${healthcheckUrl}`)
    }
  }

  let runtimeReadyLock = Promise.resolve()
  const ensureRuntimeReadySerialized = async (stepId: string): Promise<void> => {
    const ensured = runtimeReadyLock.then(async () => ensureRuntimeReady(stepId))
    runtimeReadyLock = ensured.then(
      () => undefined,
      () => undefined
    )
    await ensured
  }

  try {
    if (isWebTarget) {
      await ensureRuntimeReadySerialized("bootstrap")
    }

    const runProfileTestSuite = async (
      suite: "unit" | "contract" | "ct" | "e2e"
    ): Promise<TestSuiteResult> => {
      if (isWebTarget && suite === "e2e") {
        await ensureRuntimeReadySerialized("test.e2e")
      }
      return runTestSuiteAsync(baseDir, suite, effectiveBaseUrl, e2eSuite)
    }

    await executePipelineStages(
      {
        baseDir,
        profile,
        target,
        overrides,
        isWebTarget,
        effectiveBaseUrl,
        effectiveApp,
        effectiveBundleId,
        unsupportedSteps,
        maxParallelTasks,
        stateModel,
        stepRequested,
        recordBlockedStep,
        runStage,
        ensureRuntimeReady,
        ensureRuntimeReadySerialized,
        runTestSuite: runProfileTestSuite,
        runComputerUse: dependencies.runComputerUse ?? runComputerUse,
      },
      stageState
    )
    await runPostFixRegressionLoop(baseDir, stageState, runProfileTestSuite, maxFixIterations)

    const { manifestPath } = finalizePipelineReporting({
      baseDir,
      resolvedRunId,
      startedAt,
      profile,
      target,
      effectiveBaseUrl,
      effectiveApp,
      effectiveBundleId,
      stateModel,
      runtimeStart,
      driverContract,
      blockedStepReasons,
      blockedStepDetails,
      effectiveDiagnosticsConfig,
      maxParallelTasks,
      stageDurationsMs,
      baseUrlPolicy,
      state: stageState,
    })

    return { runId: resolvedRunId, manifestPath }
  } finally {
    runtimeStart.teardown()
  }
}
