import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildAiReviewInput } from "../../../../../ai-review/src/build-input.js"
import {
  AiReviewGenerationError,
  generateAiReviewReport,
  writeAiReviewReportArtifacts,
} from "../../../../../ai-review/src/generate-findings.js"
import {
  AI_REVIEW_PROMPT_ID,
  AI_REVIEW_PROMPT_VERSION,
} from "../../../../../ai-review/src/prompt-entry.js"
import type { Manifest } from "../../../../../core/src/manifest/types.js"
import type { getDriverCapabilityContract } from "../../../../../drivers/capabilities.js"
import { buildGateChecks, type GateThresholds } from "../../report.js"
import type { loadStateModel } from "../../state-model.js"
import type { startTargetRuntime } from "../../target-runtime.js"
import {
  buildEvidenceIndex,
  deriveCacheStatsFromReports,
  gateReasonCode,
  getGitInfo,
  normalizeCheckReasonCode,
} from "../run-reporting.js"
import { PR_GATE_BUDGET_MS } from "../run-schema.js"
import type {
  BaseUrlPolicyResult,
  BlockedStepDetail,
  DiagnosticsConfig,
  ProfileConfig,
  TargetConfig,
} from "../run-types.js"
import {
  executeFixExecutor,
  type FixExecutorResult,
  resolveAiFixAllowlistFromEnv,
  resolveAiFixModeFromEnv,
} from "./fix-executor.js"
import { deriveEngineAvailabilitySummary } from "./reporting-availability.js"
import {
  resolveAiReviewGeminiMultimodalFromEnv,
  resolveAiReviewGeminiTopScreenshotsFromEnv,
  resolveAiReviewModeFromEnv,
  resolveGeminiGateCheck,
  resolveGeminiModelFromEnv,
  resolveGeminiThoughtSignatureCheck,
  runUiUxGeminiReport,
} from "./reporting-gemini.js"
import { finalizeReportingArtifacts } from "./reporting-output.js"
import type { PipelineStageState } from "./stage-execution.js"

export {
  resolveAiReviewGeminiMultimodalFromEnv,
  resolveAiReviewGeminiTopScreenshotsFromEnv,
  resolveAiReviewModeFromEnv,
  resolveGeminiGateCheck,
  resolveGeminiModelFromEnv,
  resolveGeminiThoughtSignatureCheck,
  runUiUxGeminiReport,
} from "./reporting-gemini.js"

type PipelineReportingInput = {
  baseDir: string
  resolvedRunId: string
  startedAt: string
  profile: ProfileConfig
  target: TargetConfig
  effectiveBaseUrl: string
  effectiveApp: string | undefined
  effectiveBundleId: string | undefined
  stateModel: ReturnType<typeof loadStateModel>
  runtimeStart: Awaited<ReturnType<typeof startTargetRuntime>>
  driverContract: ReturnType<typeof getDriverCapabilityContract>
  blockedStepReasons: string[]
  blockedStepDetails: BlockedStepDetail[]
  effectiveDiagnosticsConfig: DiagnosticsConfig
  maxParallelTasks: number
  stageDurationsMs: Record<string, number>
  baseUrlPolicy: BaseUrlPolicyResult
  state: PipelineStageState
}

type PipelineReportingDeps = {
  generateAiReviewReportImpl?: typeof generateAiReviewReport
  writeAiReviewReportArtifactsImpl?: typeof writeAiReviewReportArtifacts
  runUiUxGeminiReportImpl?: typeof runUiUxGeminiReport
  resolveGeminiGateCheckImpl?: typeof resolveGeminiGateCheck
  executeFixExecutorImpl?: typeof executeFixExecutor
}

export function resolveGateResultsStatus(
  checks: Array<{ status: "passed" | "failed" | "blocked" }>
): "passed" | "failed" | "blocked" {
  if (checks.some((check) => check.status === "failed")) return "failed"
  if (checks.some((check) => check.status === "blocked")) return "blocked"
  return "passed"
}

export function finalizePipelineReporting(
  input: PipelineReportingInput,
  deps: PipelineReportingDeps = {}
): { manifestPath: string } {
  const {
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
    state,
  } = input

  const {
    states,
    pageErrorFromChaos,
    consoleErrorFromChaos,
    http5xxFromChaos,
    dangerousActionHitsFromChaos,
    pageErrorFromExplore,
    consoleErrorFromExplore,
    http5xxFromExplore,
    dangerousActionHitsFromExplore,
    effectiveExploreConfig,
    effectiveChaosConfig,
    effectiveLoadConfig,
    effectiveA11yConfig,
    effectivePerfConfig,
    effectiveVisualConfig,
    effectiveSecurityConfig,
    effectiveAiReviewConfig,
    exploreResultData,
    exploreEngineBlockedReasonCode,
    visualEngineBlockedReasonCode,
    captureSummary,
    captureDiagnostics,
    exploreDiagnostics,
    chaosDiagnostics,
    highVulnCount,
    mediumVulnCount,
    lowVulnCount,
    securityResult,
    securityBlocked,
    securityBlockedReason,
    securityFailed,
    securityFailedReason,
    loadSummary,
    a11ySummary,
    a11yResultData,
    perfSummary,
    perfResultData,
    visualSummary,
    visualResultData,
    securityReportPath,
    securityTicketsPath,
    loadReportPath,
    desktopReadinessPath,
    desktopReadinessResult,
    desktopSmokePath,
    desktopSmokeResult,
    desktopE2EPath,
    desktopE2EResult,
    desktopBusinessPath,
    desktopBusinessResult,
    desktopSoakPath,
    desktopSoakResult,
    a11yReportPath,
    perfReportPath,
    visualReportPath,
    unitTestResult,
    contractTestResult,
    ctTestResult,
    e2eTestResult,
    computerUseSafetyConfirmations,
    computerUseSafetyConfirmationEvidence,
    computerUseResult,
    generatedReports,
  } = state
  const generateAiReviewReportImpl = deps.generateAiReviewReportImpl ?? generateAiReviewReport
  const writeAiReviewReportArtifactsImpl =
    deps.writeAiReviewReportArtifactsImpl ?? writeAiReviewReportArtifacts
  const runUiUxGeminiReportImpl = deps.runUiUxGeminiReportImpl ?? runUiUxGeminiReport
  const resolveGeminiGateCheckImpl = deps.resolveGeminiGateCheckImpl ?? resolveGeminiGateCheck
  const executeFixExecutorImpl = deps.executeFixExecutorImpl ?? executeFixExecutor

  const cacheStatsResolution = deriveCacheStatsFromReports(baseDir, [
    ...Object.values(generatedReports),
    ...(loadReportPath ? [loadReportPath] : []),
    ...(a11yReportPath ? [a11yReportPath] : []),
    ...(perfReportPath ? [perfReportPath] : []),
    ...(visualReportPath ? [visualReportPath] : []),
    ...(securityReportPath ? [securityReportPath] : []),
    ...(securityTicketsPath ? [securityTicketsPath] : []),
    ...(state.aiReviewReportPath ? [state.aiReviewReportPath] : []),
    ...(state.aiReviewReportMarkdownPath ? [state.aiReviewReportMarkdownPath] : []),
    ...(desktopReadinessPath ? [desktopReadinessPath] : []),
    ...(desktopSmokePath ? [desktopSmokePath] : []),
    ...(desktopE2EPath ? [desktopE2EPath] : []),
    ...(desktopBusinessPath ? [desktopBusinessPath] : []),
    ...(desktopSoakPath ? [desktopSoakPath] : []),
  ])
  const configuredAiModel = resolveGeminiModelFromEnv()
  let aiReviewPromptId = AI_REVIEW_PROMPT_ID
  let aiReviewPromptVersion = AI_REVIEW_PROMPT_VERSION
  let aiReviewActualModel = configuredAiModel
  let aiReviewMode = resolveAiReviewModeFromEnv()
  let aiReviewGeminiMultimodalPath: string | undefined
  let aiReviewGeminiMultimodalReasonCode: string | undefined
  let aiReviewGeminiMultimodalHighOrAbove: number | undefined
  let fixResult: FixExecutorResult | undefined
  const baseSummary = {
    consoleError: captureSummary.consoleError + consoleErrorFromExplore + consoleErrorFromChaos,
    pageError: captureSummary.pageError + pageErrorFromChaos + pageErrorFromExplore,
    http5xx: captureSummary.http5xx + http5xxFromExplore + http5xxFromChaos,
    dangerousActionHits: dangerousActionHitsFromExplore + dangerousActionHitsFromChaos,
    highVuln: securityReportPath !== undefined ? highVulnCount : undefined,
    a11ySerious: a11ySummary?.serious,
    perfLcpMs: perfSummary?.lcpMs,
    perfFcpMs: perfSummary?.fcpMs,
    visualDiffPixels: visualSummary?.diffPixels,
    loadFailedRequests: loadSummary?.failedRequests,
    loadP95Ms: loadSummary?.latencyP95Ms,
    loadP99Ms: loadSummary?.latencyP99Ms,
    loadRps: loadSummary?.requestsPerSecond,
    loadErrorBudgetRate: loadSummary?.errorBudgetRate,
    loadStageFailedCount: loadSummary?.stageFailedCount,
    loadEngineReady: loadSummary?.engineReady,
    aiModel: configuredAiModel,
    promptVersion: AI_REVIEW_PROMPT_VERSION,
    cacheStats: {
      hits: cacheStatsResolution.hits,
      misses: cacheStatsResolution.misses,
      hitRate: cacheStatsResolution.hitRate,
    },
    computerUseSafetyConfirmations,
  }
  const thresholds: GateThresholds = {
    consoleErrorMax: profile.gates?.consoleErrorMax ?? 0,
    pageErrorMax: profile.gates?.pageErrorMax ?? 0,
    http5xxMax: profile.gates?.http5xxMax ?? 0,
    dangerousActionHitsMax: profile.gates?.dangerousActionHitsMax ?? 0,
    contractStatus: contractTestResult ? (profile.gates?.contractStatus ?? "passed") : undefined,
    securityHighVulnMax: profile.gates?.securityHighVulnMax,
    a11ySeriousMax: a11ySummary ? profile.gates?.a11ySeriousMax : undefined,
    perfLcpMsMax: perfSummary ? profile.gates?.perfLcpMsMax : undefined,
    perfFcpMsMax: perfSummary ? profile.gates?.perfFcpMsMax : undefined,
    visualDiffPixelsMax: visualSummary ? profile.gates?.visualDiffPixelsMax : undefined,
    loadFailedRequestsMax: loadSummary ? profile.gates?.loadFailedRequestsMax : undefined,
    loadP95MsMax: loadSummary ? profile.gates?.loadP95MsMax : undefined,
    loadP99MsMax: loadSummary ? profile.gates?.loadP99MsMax : undefined,
    loadErrorBudgetMax: loadSummary ? profile.gates?.loadErrorBudgetMax : undefined,
    loadStageFailureMax: loadSummary ? profile.gates?.loadStageFailureMax : undefined,
    loadEngineReadyRequired: loadSummary ? profile.gates?.loadEngineReadyRequired : undefined,
    loadRpsMin: loadSummary ? profile.gates?.loadRpsMin : undefined,
  }
  const primaryCapturedStateId = states[0]?.id ?? "home_default"
  const fallbackEvidencePath =
    desktopBusinessPath ??
    desktopE2EPath ??
    desktopSmokePath ??
    desktopReadinessPath ??
    runtimeStart.reportPath
  const checks = buildGateChecks(
    baseSummary,
    thresholds,
    {
      consoleError:
        consoleErrorFromExplore > 0
          ? "logs/explore.log"
          : states.length > 0
            ? `logs/${primaryCapturedStateId}.log`
            : fallbackEvidencePath,
      pageError:
        pageErrorFromChaos > 0
          ? "reports/chaos.json"
          : pageErrorFromExplore > 0
            ? "logs/explore.log"
            : states.length > 0
              ? `logs/${primaryCapturedStateId}.log`
              : fallbackEvidencePath,
      http5xx:
        http5xxFromChaos > 0
          ? "network/chaos.har"
          : http5xxFromExplore > 0
            ? "network/explore.har"
            : states.length > 0
              ? "network/capture.har"
              : fallbackEvidencePath,
      highVuln: "security/report.json",
      a11y: a11yReportPath ?? "a11y/axe.json",
      perf: perfReportPath ?? "perf/lighthouse.json",
      visual: visualReportPath ?? "visual/report.json",
      load: "metrics/load-summary.json",
    },
    {
      securityBlocked,
      securityBlockedReason,
      securityFailed,
      securityFailedReason,
    }
  ).map(normalizeCheckReasonCode)
  if (exploreEngineBlockedReasonCode) {
    checks.push({
      id: "explore.engine",
      expected: effectiveExploreConfig?.engine ?? "builtin",
      actual: "blocked",
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: exploreEngineBlockedReasonCode,
      evidencePath: "reports/explore.json",
    })
  }
  if (visualEngineBlockedReasonCode) {
    checks.push({
      id: "visual.engine",
      expected: effectiveVisualConfig?.engine ?? "builtin",
      actual: "blocked",
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: visualEngineBlockedReasonCode,
      evidencePath: "visual/report.json",
    })
  }
  if (runtimeStart.started) {
    checks.push({
      id: "runtime.healthcheck",
      expected: "passed",
      actual: runtimeStart.healthcheckPassed ? "passed" : "failed",
      severity: "BLOCKER",
      status: runtimeStart.healthcheckPassed ? "passed" : "blocked",
      reasonCode: runtimeStart.healthcheckPassed
        ? gateReasonCode("runtime.healthcheck", "passed", "healthy")
        : gateReasonCode("runtime.healthcheck", "blocked", "runtime_unreachable"),
      evidencePath: runtimeStart.reportPath,
    })
  }
  if (unitTestResult) {
    checks.push({
      id: "test.unit",
      expected: "passed",
      actual: unitTestResult.status,
      severity: "BLOCKER",
      status: unitTestResult.status,
      reasonCode:
        unitTestResult.status === "passed"
          ? gateReasonCode("test.unit", "passed", "suite_passed")
          : gateReasonCode("test.unit", "failed", "suite_failed"),
      evidencePath: unitTestResult.reportPath,
    })
  }
  if (contractTestResult) {
    const expectedStatus = profile.gates?.contractStatus ?? "passed"
    checks.push({
      id: "test.contract",
      expected: expectedStatus,
      actual: contractTestResult.status,
      severity: "BLOCKER",
      status: contractTestResult.status === expectedStatus ? "passed" : "failed",
      reasonCode:
        contractTestResult.status === expectedStatus
          ? gateReasonCode("test.contract", "passed", "suite_passed")
          : gateReasonCode("test.contract", "failed", "suite_failed"),
      evidencePath: contractTestResult.reportPath,
    })
  }
  if (ctTestResult) {
    checks.push({
      id: "test.ct",
      expected: "passed",
      actual: ctTestResult.status,
      severity: "MAJOR",
      status: ctTestResult.status,
      reasonCode:
        ctTestResult.status === "passed"
          ? gateReasonCode("test.ct", "passed", "suite_passed")
          : gateReasonCode("test.ct", "failed", "suite_failed"),
      evidencePath: ctTestResult.reportPath,
    })
  }
  if (e2eTestResult) {
    checks.push({
      id: "test.e2e",
      expected: "passed",
      actual: e2eTestResult.status,
      severity: "BLOCKER",
      status: e2eTestResult.status,
      reasonCode:
        e2eTestResult.status === "passed"
          ? gateReasonCode("test.e2e", "passed", "suite_passed")
          : gateReasonCode("test.e2e", "failed", "suite_failed"),
      evidencePath: e2eTestResult.reportPath,
    })
  }
  const blockedComputerUse = blockedStepDetails.find((detail) => detail.stepId === "computer_use")
  if (computerUseResult) {
    checks.push({
      id: "scenario.computer_use",
      expected: "ok",
      actual: computerUseResult.status,
      severity: "BLOCKER",
      status: computerUseResult.status === "ok" ? "passed" : "failed",
      reasonCode:
        computerUseResult.status === "ok"
          ? gateReasonCode("scenario.computer_use", "passed", "task_completed")
          : computerUseResult.reason,
      evidencePath: generatedReports.computerUse ?? "reports/computer-use.json",
    })
  } else if (profile.steps.includes("computer_use") && blockedComputerUse) {
    checks.push({
      id: "scenario.computer_use",
      expected: "ok",
      actual: blockedComputerUse.detail,
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: blockedComputerUse.reasonCode,
      evidencePath: blockedComputerUse.artifactPath,
    })
  } else if (profile.steps.includes("computer_use")) {
    checks.push({
      id: "scenario.computer_use",
      expected: "report_present",
      actual: "missing",
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: gateReasonCode("scenario.computer_use", "blocked", "report_missing"),
      evidencePath: "reports/computer-use.json",
    })
  }
  if (state.postFixRegression && state.postFixRegression.status === "failed") {
    checks.push({
      id: "post_fix.regression",
      expected: "converged",
      actual: `iterations=${state.postFixRegression.iterationsExecuted};remaining=${state.postFixRegression.remainingFailedSuites.join(",") || "none"}`,
      severity: "BLOCKER",
      status: "failed",
      reasonCode: state.postFixRegression.reasonCode,
      evidencePath: generatedReports.postFixRegression ?? "reports/post-fix-regression.json",
    })
  }
  if (blockedStepReasons.length > 0) {
    checks.push({
      id: "driver.capability",
      expected: "all_requested_steps_supported",
      actual: blockedStepReasons.join("; "),
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: gateReasonCode("driver.capability", "blocked", "unsupported_steps"),
      evidencePath: "reports/summary.json",
    })
  }
  if (desktopReadinessResult) {
    checks.push({
      id: "desktop.readiness",
      expected: "passed",
      actual: desktopReadinessResult.status,
      severity: "BLOCKER",
      status: desktopReadinessResult.status === "passed" ? "passed" : "blocked",
      reasonCode:
        desktopReadinessResult.status === "passed"
          ? gateReasonCode("desktop.readiness", "passed", "requirement_satisfied")
          : gateReasonCode("desktop.readiness", "blocked", "requirement_unsatisfied"),
      evidencePath: desktopReadinessResult.reportPath,
    })
  }
  if (desktopSmokeResult) {
    checks.push({
      id: "desktop.smoke",
      expected: "passed",
      actual: desktopSmokeResult.status,
      severity: "BLOCKER",
      status: desktopSmokeResult.status === "passed" ? "passed" : "blocked",
      reasonCode:
        desktopSmokeResult.status === "passed"
          ? gateReasonCode("desktop.smoke", "passed", "requirement_satisfied")
          : gateReasonCode("desktop.smoke", "blocked", "requirement_unsatisfied"),
      evidencePath: desktopSmokeResult.reportPath,
    })
  }
  if (desktopE2EResult) {
    checks.push({
      id: "desktop.e2e",
      expected: "passed",
      actual: desktopE2EResult.status,
      severity: "BLOCKER",
      status: desktopE2EResult.status === "passed" ? "passed" : "blocked",
      reasonCode:
        desktopE2EResult.status === "passed"
          ? gateReasonCode("desktop.e2e", "passed", "requirement_satisfied")
          : gateReasonCode("desktop.e2e", "blocked", "requirement_unsatisfied"),
      evidencePath: desktopE2EResult.reportPath,
    })
  }
  if (desktopBusinessResult) {
    checks.push({
      id: "desktop.business_regression",
      expected: "passed",
      actual: desktopBusinessResult.status,
      severity: "BLOCKER",
      status: desktopBusinessResult.status === "passed" ? "passed" : "blocked",
      reasonCode:
        desktopBusinessResult.status === "passed"
          ? gateReasonCode("desktop.business_regression", "passed", "requirement_satisfied")
          : gateReasonCode("desktop.business_regression", "blocked", "requirement_unsatisfied"),
      evidencePath: desktopBusinessResult.reportPath,
    })
  } else if (profile.steps.includes("desktop_business_regression")) {
    checks.push({
      id: "desktop.business_regression",
      expected: "report_present",
      actual: "missing",
      severity: "BLOCKER",
      status: "blocked",
      reasonCode: gateReasonCode("desktop.business_regression", "blocked", "report_missing"),
      evidencePath: "reports/summary.json",
    })
  }
  if (desktopSoakResult) {
    checks.push({
      id: "desktop.soak",
      expected: "passed",
      actual: desktopSoakResult.status,
      severity: "BLOCKER",
      status: desktopSoakResult.status === "passed" ? "passed" : "blocked",
      reasonCode:
        desktopSoakResult.status === "passed"
          ? gateReasonCode("desktop.soak", "passed", "requirement_satisfied")
          : gateReasonCode("desktop.soak", "blocked", "requirement_unsatisfied"),
      evidencePath: desktopSoakResult.reportPath,
    })
  }
  if (profile.name === "pr") {
    const elapsedMs = Date.now() - new Date(startedAt).getTime()
    checks.push({
      id: "execution.pr_budget_ms",
      expected: PR_GATE_BUDGET_MS,
      actual: elapsedMs,
      severity: "MAJOR",
      status: elapsedMs <= PR_GATE_BUDGET_MS ? "passed" : "failed",
      reasonCode: gateReasonCode(
        "execution.pr_budget_ms",
        elapsedMs <= PR_GATE_BUDGET_MS ? "passed" : "failed",
        elapsedMs <= PR_GATE_BUDGET_MS ? "within_budget" : "threshold_exceeded"
      ),
      evidencePath: "reports/summary.json",
    })
  }

  if (effectiveAiReviewConfig?.enabled) {
    const aiReviewReports: Record<string, string> = {
      ...generatedReports,
      ...(a11yReportPath ? { a11y: a11yReportPath } : {}),
      ...(perfReportPath ? { perf: perfReportPath } : {}),
      ...(visualReportPath ? { visual: visualReportPath } : {}),
      ...(securityReportPath ? { security: securityReportPath } : {}),
      ...(loadReportPath ? { load: loadReportPath } : {}),
    }
    const nowIso = new Date().toISOString()
    const aiSnapshotChecks = checks.map(normalizeCheckReasonCode)
    const aiManifestSnapshot = {
      schemaVersion: "1.1",
      runId: resolvedRunId,
      target: {
        type: target.type,
        name: target.name,
        baseUrl: effectiveBaseUrl,
        app: effectiveApp ?? "",
        bundleId: effectiveBundleId ?? "",
      },
      profile: profile.name,
      git: getGitInfo(),
      timing: {
        startedAt,
        finishedAt: nowIso,
        durationMs: new Date(nowIso).getTime() - new Date(startedAt).getTime(),
      },
      execution: {
        maxParallelTasks,
        stagesMs: stageDurationsMs,
        criticalPath: [],
      },
      states,
      evidenceIndex: buildEvidenceIndex(states, aiReviewReports, aiSnapshotChecks),
      reports: aiReviewReports,
      summary: baseSummary,
      gateResults: {
        status: resolveGateResultsStatus(aiSnapshotChecks),
        checks: aiSnapshotChecks,
      },
      toolchain: {
        node: process.version,
      },
    } as Manifest
    const aiReviewInput = buildAiReviewInput(aiManifestSnapshot, {
      maxArtifacts: effectiveAiReviewConfig.maxArtifacts,
    })
    writeFileSync(
      resolve(baseDir, "manifest.json"),
      `${JSON.stringify(aiManifestSnapshot, null, 2)}\n`,
      "utf8"
    )
    const aiReviewReport = (() => {
      try {
        return generateAiReviewReportImpl(aiReviewInput, {
          severityThreshold: effectiveAiReviewConfig.severityThreshold,
          mode: aiReviewMode,
        })
      } catch (error) {
        if (error instanceof AiReviewGenerationError) {
          throw new Error(`AI review generation failed (${error.reasonCode}): ${error.message}`)
        }
        throw error
      }
    })()
    aiReviewPromptId = aiReviewReport.generation.promptId
    aiReviewPromptVersion = aiReviewReport.generation.promptVersion
    aiReviewActualModel = aiReviewReport.generation.model
    aiReviewMode = aiReviewReport.generation.mode
    const aiArtifacts = writeAiReviewReportArtifactsImpl(
      baseDir,
      aiReviewReport,
      "reports/ai-review.json",
      "reports/ai-review.md"
    )
    state.aiReviewReportPath = aiArtifacts.jsonPath
    state.aiReviewReportMarkdownPath = aiArtifacts.markdownPath
    state.aiReviewFindingCount = aiReviewReport.summary.totalFindings
    state.aiReviewHighOrAbove = aiReviewReport.summary.highOrAbove
    generatedReports.aiReview = aiArtifacts.jsonPath
    generatedReports.aiReviewMarkdown = aiArtifacts.markdownPath
    checks.push({
      id: "ai_review.severity_threshold",
      expected: `severity<${effectiveAiReviewConfig.severityThreshold}`,
      actual: `findings=${aiReviewReport.summary.totalFindings};high_or_above=${aiReviewReport.summary.highOrAbove}`,
      severity: "MAJOR",
      status: aiReviewReport.gate.status,
      reasonCode: aiReviewReport.gate.reasonCode,
      evidencePath: aiArtifacts.jsonPath,
    })
    if (resolveAiReviewGeminiMultimodalFromEnv()) {
      const multimodal = runUiUxGeminiReportImpl({
        resolvedRunId,
        speedMode: (process.env.AI_SPEED_MODE ?? "").trim().toLowerCase() === "true",
      })
      const highOrAbove = Number(multimodal.report.summary?.high_or_above ?? 0)
      aiReviewGeminiMultimodalPath = multimodal.reportPath
      aiReviewGeminiMultimodalReasonCode =
        (multimodal.report.reason_code ?? "").trim() || "ai.gemini.ui_ux.report.generated"
      aiReviewGeminiMultimodalHighOrAbove = highOrAbove
      generatedReports.uiUxGemini = multimodal.reportPath
      checks.push({
        id: "ai_review.gemini_multimodal",
        expected: "high_or_above=0",
        actual: `findings=${Number(multimodal.report.summary?.total_findings ?? 0)};high_or_above=${highOrAbove};score=${Number(multimodal.report.summary?.overall_score ?? 0)}`,
        severity: "MAJOR",
        status: highOrAbove > 0 ? "failed" : "passed",
        reasonCode:
          highOrAbove > 0
            ? aiReviewGeminiMultimodalReasonCode
            : "gate.ai_review.passed.gemini_multimodal_threshold_met",
        evidencePath: multimodal.reportPath,
      })
      checks.push(
        resolveGeminiThoughtSignatureCheck({
          report: multimodal.report,
          evidencePath: multimodal.reportPath,
        })
      )

      const geminiAccuracyReportPath =
        generatedReports.geminiAccuracyGate ??
        generatedReports.geminiAccuracy ??
        `reports/uiq-gemini-accuracy-gate-${profile.name}.json`
      const accuracyGate = resolveGeminiGateCheckImpl({
        baseDir,
        checkId: "ai_review.gemini_accuracy",
        expectedCheckId: "gemini_accuracy_min",
        reportPath: geminiAccuracyReportPath,
        metricField: "accuracy",
        thresholdField: "accuracyMin",
        missingReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_missing",
        parseErrorReasonCode: "gate.ai_review.gemini_accuracy.blocked.report_parse_error",
        invalidPayloadReasonCode: "gate.ai_review.gemini_accuracy.blocked.invalid_report_payload",
      })
      if (accuracyGate.reportExists) {
        generatedReports.geminiAccuracyGate = geminiAccuracyReportPath
      }
      checks.push(accuracyGate.check)

      const geminiConcurrencyReportPath =
        generatedReports.geminiConcurrencyGate ??
        generatedReports.geminiConcurrency ??
        `reports/uiq-gemini-concurrency-gate-${profile.name}.json`
      const concurrencyGate = resolveGeminiGateCheckImpl({
        baseDir,
        checkId: "ai_review.gemini_concurrency",
        expectedCheckId: "gemini_parallel_consistency_min",
        reportPath: geminiConcurrencyReportPath,
        metricField: "parallelConsistency",
        thresholdField: "parallelConsistencyMin",
        missingReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_missing",
        parseErrorReasonCode: "gate.ai_review.gemini_concurrency.blocked.report_parse_error",
        invalidPayloadReasonCode:
          "gate.ai_review.gemini_concurrency.blocked.invalid_report_payload",
      })
      if (concurrencyGate.reportExists) {
        generatedReports.geminiConcurrencyGate = geminiConcurrencyReportPath
      }
      checks.push(concurrencyGate.check)
    }
    fixResult = executeFixExecutorImpl({
      baseDir,
      findings: aiReviewReport.findings,
      mode: resolveAiFixModeFromEnv(),
      allowlist: resolveAiFixAllowlistFromEnv(),
      reportPath: "reports/fix-result.json",
    })
    generatedReports.fixResult = fixResult.reportPath
    checks.push({
      id: "ai_fix.execution",
      expected: fixResult.mode === "auto" ? "all_eligible_fixes_applied" : "report_only",
      actual: `mode=${fixResult.mode};tasks=${fixResult.summary.totalTasks};applied=${fixResult.summary.applied};failed=${fixResult.summary.failed};planned=${fixResult.summary.planned}`,
      severity: "MAJOR",
      status: fixResult.gate.status,
      reasonCode: fixResult.gate.reasonCode,
      evidencePath: fixResult.reportPath,
    })
  }

  const normalizedChecks = checks.map(normalizeCheckReasonCode)
  const availability = deriveEngineAvailabilitySummary({
    checks: normalizedChecks,
    profile,
    state,
  })
  if (profile.enginePolicy?.failOnBlocked === true && profile.enginePolicy.required?.length) {
    normalizedChecks.push(
      normalizeCheckReasonCode({
        id: "engine.policy.required",
        expected: "all_required_available",
        actual:
          availability.missingRequiredEngines.length > 0
            ? `missing:${availability.missingRequiredEngines.join(",")}`
            : "all_required_available",
        severity: "BLOCKER",
        status: availability.missingRequiredEngines.length > 0 ? "failed" : "passed",
        reasonCode:
          availability.missingRequiredEngines.length > 0
            ? gateReasonCode("engine.policy.required", "failed", "missing_required_engine")
            : gateReasonCode("engine.policy.required", "passed", "all_required_available"),
        evidencePath: "reports/summary.json",
      })
    )
  }
  const status = resolveGateResultsStatus(normalizedChecks)
  return finalizeReportingArtifacts({
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
    state,
    generatedReports,
    checks: normalizedChecks,
    status,
    baseSummary,
    thresholds,
    cacheStatsResolution,
    aiReviewPromptId,
    aiReviewPromptVersion,
    aiReviewActualModel,
    aiReviewMode,
    fixResult,
    availability,
  })
}
