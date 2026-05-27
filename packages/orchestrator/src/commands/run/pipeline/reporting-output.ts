import { resolve } from "node:path"
import { writeManifest } from "../../../../../core/src/manifest/io.js"
import type { Manifest } from "../../../../../core/src/manifest/types.js"
import type { getDriverCapabilityContract } from "../../../../../drivers/capabilities.js"
import { type GateThresholds, writeSummaryReportWithContext } from "../../report.js"
import type { loadStateModel } from "../../state-model.js"
import type { startTargetRuntime } from "../../target-runtime.js"
import { buildStateModelSummary } from "../config.js"
import { buildAndWriteProofBundle } from "../proof-bundle.js"
import {
  buildLogIndex,
  buildEvidenceIndex,
  collectFailureLocations,
  getGitInfo,
  normalizeCheckReasonCode,
  normalizeDiagnosticsSection,
  normalizeList,
  writeDiagnosticsIndex,
  writeLogIndex,
} from "../run-reporting.js"
import { TOOLCHAIN_VERSION } from "../run-schema.js"
import type {
  BaseUrlPolicyResult,
  BlockedStepDetail,
  DiagnosticsConfig,
  ProfileConfig,
  TargetConfig,
} from "../run-types.js"
import type { FixExecutorResult } from "./fix-executor.js"
import type { EngineAvailabilitySummary } from "./reporting-availability.js"
import type { PipelineStageState } from "./stage-execution.js"

type CacheStatsResolution = {
  hits: number
  misses: number
  hitRate: number
  reason?: string
  sourceCount?: number
  sourcePaths?: string[]
  parseErrors?: number
  missingReports?: number
}

type SummaryBase = {
  consoleError: number
  pageError: number
  http5xx: number
} & Record<string, unknown>

type FinalizeReportingArtifactsInput = {
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
  generatedReports: PipelineStageState["generatedReports"]
  checks: Manifest["gateResults"]["checks"]
  status: "passed" | "failed" | "blocked"
  baseSummary: SummaryBase
  thresholds: GateThresholds
  cacheStatsResolution: CacheStatsResolution
  aiReviewPromptId: string
  aiReviewPromptVersion: string
  aiReviewActualModel: string
  aiReviewMode: "llm" | "rule_fallback"
  fixResult: FixExecutorResult | undefined
  availability: EngineAvailabilitySummary
}

export function finalizeReportingArtifacts(
  input: FinalizeReportingArtifactsInput
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
    generatedReports,
    checks,
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
  } = input

  const {
    states,
    captureDiagnostics,
    exploreDiagnostics,
    chaosDiagnostics,
    loadSummary,
    a11yResultData,
    perfResultData,
    visualResultData,
    securityResult,
    highVulnCount,
    mediumVulnCount,
    lowVulnCount,
    securityBlocked,
    securityBlockedReason,
    securityFailed,
    securityFailedReason,
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
    effectiveExploreConfig,
    effectiveChaosConfig,
    effectiveLoadConfig,
    effectiveA11yConfig,
    effectivePerfConfig,
    effectiveVisualConfig,
    effectiveSecurityConfig,
    effectiveAiReviewConfig,
    postFixRegression,
  } = state

  const summary = {
    ...baseSummary,
    promptId: aiReviewPromptId,
    promptVersion: aiReviewPromptVersion,
    actualModel: aiReviewActualModel,
    aiModel: aiReviewActualModel,
    ...(typeof state.aiReviewFindingCount === "number"
      ? { aiReviewFindings: state.aiReviewFindingCount }
      : {}),
    ...(typeof state.aiReviewHighOrAbove === "number"
      ? { aiReviewHighOrAbove: state.aiReviewHighOrAbove }
      : {}),
    ...(typeof postFixRegression?.iterationsExecuted === "number"
      ? { fixIterations: postFixRegression.iterationsExecuted }
      : {}),
    ...(typeof postFixRegression?.converged === "boolean"
      ? { fixConverged: postFixRegression.converged }
      : {}),
    ...(availability.startupAvailable !== undefined
      ? { startupAvailable: availability.startupAvailable }
      : {}),
    ...(availability.interactionPassRatio !== undefined
      ? { interactionPassRatio: availability.interactionPassRatio }
      : {}),
    ...(typeof desktopSoakResult?.crashCount === "number"
      ? { crashCount: desktopSoakResult.crashCount }
      : {}),
    ...(typeof desktopSoakResult?.rssGrowthMb === "number"
      ? { rssGrowthMb: desktopSoakResult.rssGrowthMb }
      : {}),
    ...(typeof desktopSoakResult?.cpuAvgPercent === "number"
      ? { cpuAvg: desktopSoakResult.cpuAvgPercent }
      : {}),
    ...(Object.keys(availability.engineAvailability).length > 0
      ? { engineAvailability: availability.engineAvailability }
      : {}),
    ...(availability.blockedByMissingEngineCount > 0
      ? { blockedByMissingEngineCount: availability.blockedByMissingEngineCount }
      : { blockedByMissingEngineCount: 0 }),
    ...(availability.keyGatePassRatio !== undefined
      ? { keyGatePassRatio: availability.keyGatePassRatio }
      : {}),
    ...(!postFixRegression && fixResult
      ? {
          fixIterations: fixResult.summary.totalTasks,
          fixConverged: fixResult.gate.status !== "failed",
        }
      : {}),
  }

  const normalizedCaptureDiagnostics = normalizeDiagnosticsSection(
    captureDiagnostics,
    effectiveDiagnosticsConfig.maxItems
  )
  const normalizedExploreDiagnostics = normalizeDiagnosticsSection(
    exploreDiagnostics,
    effectiveDiagnosticsConfig.maxItems
  )
  const normalizedChaosDiagnostics = normalizeDiagnosticsSection(
    chaosDiagnostics,
    effectiveDiagnosticsConfig.maxItems
  )
  const aggregateHttp5xx = normalizeList(
    [
      ...captureDiagnostics.http5xxUrls,
      ...exploreDiagnostics.http5xxUrls,
      ...chaosDiagnostics.http5xxUrls,
    ],
    effectiveDiagnosticsConfig.maxItems
  )
  const executionCriticalPath = Object.entries(stageDurationsMs)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([stageId]) => stageId)
  const failureLocations = collectFailureLocations(checks)
  const diagnostics = {
    capture: normalizedCaptureDiagnostics,
    explore: {
      ...normalizedExploreDiagnostics,
      engineUsed: state.exploreResultData?.engineUsed ?? effectiveExploreConfig?.engine,
    },
    chaos: normalizedChaosDiagnostics,
    load: loadSummary,
    tests: {
      unit: unitTestResult,
      contract: contractTestResult,
      ct: ctTestResult,
      e2e: e2eTestResult,
    },
    runtime: runtimeStart,
    a11y:
      a11yResultData !== undefined
        ? {
            engine: a11yResultData.engine,
            standard: a11yResultData.standard,
            counts: a11yResultData.counts,
          }
        : undefined,
    perf:
      perfResultData !== undefined
        ? {
            engine: perfResultData.engine,
            preset: perfResultData.preset,
            metrics: perfResultData.metrics,
          }
        : undefined,
    visual:
      visualResultData !== undefined
        ? {
            engine: visualResultData.engine,
            engineUsed: visualResultData.engineUsed,
            mode: visualResultData.mode,
            baselineCreated: visualResultData.baselineCreated,
            diffPixels: visualResultData.diffPixels,
            totalPixels: visualResultData.totalPixels,
            diffRatio: visualResultData.diffRatio,
            baselinePath: visualResultData.baselinePath,
            currentPath: visualResultData.currentPath,
            diffPath: visualResultData.diffPath,
          }
        : undefined,
    aiReview:
      state.aiReviewReportPath !== undefined
        ? {
            enabled: effectiveAiReviewConfig?.enabled ?? false,
            mode: aiReviewMode,
            promptId: aiReviewPromptId,
            promptVersion: aiReviewPromptVersion,
            actualModel: aiReviewActualModel,
            maxArtifacts: effectiveAiReviewConfig?.maxArtifacts ?? 0,
            severityThreshold: effectiveAiReviewConfig?.severityThreshold ?? "high",
            findings: state.aiReviewFindingCount ?? 0,
            highOrAbove: state.aiReviewHighOrAbove ?? 0,
            reportPath: state.aiReviewReportPath,
            markdownPath: state.aiReviewReportMarkdownPath,
          }
        : undefined,
    computerUse:
      computerUseResult !== undefined
        ? {
            status: computerUseResult.status,
            reason: computerUseResult.reason,
            exitCode: computerUseResult.exitCode,
            command: computerUseResult.command,
            args: computerUseResult.args,
            scriptPath: computerUseResult.scriptPath,
            computerUseSafetyConfirmations,
            safetyConfirmationEvidence: computerUseSafetyConfirmationEvidence,
            error: computerUseResult.error,
          }
        : undefined,
    security:
      securityReportPath !== undefined
        ? {
            executionStatus: (securityBlocked ? "blocked" : securityFailed ? "failed" : "ok") as
              | "ok"
              | "failed"
              | "blocked",
            blockedReason: securityBlockedReason,
            errorMessage: securityFailedReason,
            totalIssueCount: securityResult?.totalIssueCount,
            dedupedIssueCount: securityResult?.dedupedIssueCount,
            ticketCount: securityResult?.tickets.length,
            topTickets: securityResult?.tickets.slice(0, 10).map((ticket) => ({
              ticketId: ticket.ticketId,
              severity: ticket.severity,
              impactScope: ticket.impactScope,
              affectedFileCount: ticket.affectedFiles.length,
            })),
            highVulnCount,
            mediumVulnCount,
            lowVulnCount,
            clusters: securityResult
              ? {
                  byRule: securityResult.clusters.byRule.slice(0, 10),
                  byComponent: securityResult.clusters.byComponent.slice(0, 10),
                }
              : undefined,
          }
        : undefined,
    desktopReadiness: desktopReadinessResult,
    desktopSmoke: desktopSmokeResult,
    desktopE2E: desktopE2EResult,
    desktopBusiness: desktopBusinessResult,
    desktopSoak: desktopSoakResult,
    crossTarget: {
      startupAvailable: availability.startupAvailable,
      interactionPassed: availability.interactionPassed,
      interactionTotal: availability.interactionTotal,
      interactionPassRatio: availability.interactionPassRatio,
      keyGatePassed: availability.keyGatePassed,
      keyGateTotal: availability.keyGateTotal,
      keyGatePassRatio: availability.keyGatePassRatio,
      crashCount: desktopSoakResult?.crashCount,
      rssGrowthMb: desktopSoakResult?.rssGrowthMb,
      cpuAvg: desktopSoakResult?.cpuAvgPercent,
    },
    postFixRegression,
    http5xxUrls: aggregateHttp5xx.items,
    truncation: {
      http5xxUrls: aggregateHttp5xx.truncation,
    },
    execution: {
      maxParallelTasks,
      stagesMs: stageDurationsMs,
      criticalPath: executionCriticalPath,
    },
    cacheStats: {
      hits: cacheStatsResolution.hits,
      misses: cacheStatsResolution.misses,
      hitRate: cacheStatsResolution.hitRate,
      reason: cacheStatsResolution.reason,
      sourceCount: cacheStatsResolution.sourceCount,
      sourcePaths: cacheStatsResolution.sourcePaths,
      parseErrors: cacheStatsResolution.parseErrors,
      missingReports: cacheStatsResolution.missingReports,
    },
    blockedSteps: blockedStepReasons,
    blockedStepDetails,
    failureLocations,
    engineAvailability: availability.engineAvailability,
  }

  const reportPath = writeSummaryReportWithContext(baseDir, {
    status,
    checks,
    summary,
    thresholds,
    diagnostics,
    effectiveConfig: {
      explore: effectiveExploreConfig,
      chaos: effectiveChaosConfig,
      a11y: effectiveA11yConfig,
      perf: effectivePerfConfig,
      visual: effectiveVisualConfig,
      load: effectiveLoadConfig,
      security: effectiveSecurityConfig,
      diagnostics: effectiveDiagnosticsConfig,
      baseUrlPolicy,
      runtimeStart,
    },
  })
  const diagnosticsIndexPath = writeDiagnosticsIndex(baseDir, {
    runId: resolvedRunId,
    status,
    profile: profile.name,
    target: { type: target.type, name: target.name },
    reports: {
      summary: reportPath,
      ...(a11yReportPath ? { a11y: a11yReportPath } : {}),
      ...(perfReportPath ? { perf: perfReportPath } : {}),
      ...(visualReportPath ? { visual: visualReportPath } : {}),
      ...(state.aiReviewReportPath ? { aiReview: state.aiReviewReportPath } : {}),
      ...(securityReportPath ? { security: securityReportPath } : {}),
      ...(loadReportPath ? { load: loadReportPath } : {}),
    },
    diagnostics: {
      capture: {
        consoleErrors: normalizedCaptureDiagnostics.consoleErrors.length,
        pageErrors: normalizedCaptureDiagnostics.pageErrors.length,
        http5xxUrls: normalizedCaptureDiagnostics.http5xxUrls.length,
      },
      explore: {
        consoleErrors: normalizedExploreDiagnostics.consoleErrors.length,
        pageErrors: normalizedExploreDiagnostics.pageErrors.length,
        http5xxUrls: normalizedExploreDiagnostics.http5xxUrls.length,
      },
      chaos: {
        consoleErrors: normalizedChaosDiagnostics.consoleErrors.length,
        pageErrors: normalizedChaosDiagnostics.pageErrors.length,
        http5xxUrls: normalizedChaosDiagnostics.http5xxUrls.length,
      },
      aggregateHttp5xx: aggregateHttp5xx.items.length,
      execution: {
        maxParallelTasks,
        stagesMs: stageDurationsMs,
        criticalPath: executionCriticalPath,
      },
      blockedSteps: blockedStepReasons,
      blockedStepDetails,
      failureLocations,
    },
  })
  const logIndexPath = writeLogIndex(
    baseDir,
    buildLogIndex({
      runId: resolvedRunId,
      status,
      profile: profile.name,
      target: { type: target.type, name: target.name },
      states,
      reports: {
        summary: reportPath,
        ...(a11yReportPath ? { a11y: a11yReportPath } : {}),
        ...(perfReportPath ? { perf: perfReportPath } : {}),
        ...(visualReportPath ? { visual: visualReportPath } : {}),
        ...(state.aiReviewReportPath ? { aiReview: state.aiReviewReportPath } : {}),
        ...(state.aiReviewReportMarkdownPath ? { aiReviewMarkdown: state.aiReviewReportMarkdownPath } : {}),
        ...(securityReportPath ? { security: securityReportPath } : {}),
        ...(loadReportPath ? { load: loadReportPath } : {}),
        diagnosticsIndex: diagnosticsIndexPath,
      },
      checks,
    })
  )

  const finishedAt = new Date().toISOString()
  const timing = {
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
  }
  const stateModelSummary = buildStateModelSummary(target.type, profile.steps, stateModel, states, {
    desktopReadinessResult,
    desktopSmokeResult,
    desktopE2EResult,
    desktopSoakResult,
  })
  const runEnvironment = {
    autostart: runtimeStart.autostart,
    started: runtimeStart.started,
    healthcheckPassed: runtimeStart.healthcheckPassed,
    healthcheckUrl: runtimeStart.healthcheckUrl ?? "",
    host: process.platform,
    node: process.version,
    ci: Boolean(process.env.CI),
  }
  const toolVersions = {
    node: process.version,
    a11y: effectiveA11yConfig?.engine ?? "axe",
    perf: effectivePerfConfig?.engine ?? "lhci",
    load: effectiveLoadConfig?.engines ?? ["builtin", "artillery", "k6"],
    security: effectiveSecurityConfig?.engine ?? "builtin",
  }
  const proof = buildAndWriteProofBundle({
    baseDir,
    runId: resolvedRunId,
    profile: profile.name,
    target: { type: target.type, name: target.name },
    timing,
    stateModel: stateModelSummary,
    states,
    summary,
    gateResults: { status, checks: checks.map(normalizeCheckReasonCode) },
    blockedSteps: blockedStepReasons,
    failureLocations,
    criticalPath: executionCriticalPath,
    reportPath,
    diagnosticsIndexPath,
    runEnvironment,
    toolVersions,
  })

  const reportEntries: Record<string, string> = {
    report: reportPath,
    ...generatedReports,
    ...(a11yReportPath ? { a11y: a11yReportPath } : {}),
    ...(perfReportPath ? { perf: perfReportPath } : {}),
    ...(visualReportPath ? { visual: visualReportPath } : {}),
    ...(securityReportPath ? { security: securityReportPath } : {}),
    ...(securityTicketsPath ? { securityTickets: securityTicketsPath } : {}),
    ...(desktopReadinessPath ? { desktopReadiness: desktopReadinessPath } : {}),
    ...(desktopSmokePath ? { desktopSmoke: desktopSmokePath } : {}),
    ...(desktopE2EPath ? { desktopE2E: desktopE2EPath } : {}),
    ...(desktopBusinessPath ? { desktopBusiness: desktopBusinessPath } : {}),
    ...(desktopSoakPath ? { desktopSoak: desktopSoakPath } : {}),
    ...(loadReportPath ? { load: loadReportPath } : {}),
    proofCoverage: proof.coveragePath,
    proofStability: proof.stabilityPath,
    proofGaps: proof.gapsPath,
    proofRepro: proof.reproPath,
    diagnosticsIndex: diagnosticsIndexPath,
    logIndex: logIndexPath,
  }

  const execution = {
    maxParallelTasks,
    stagesMs: stageDurationsMs,
    criticalPath: executionCriticalPath,
  }

  const evidenceIndex = buildEvidenceIndex(
    states,
    reportEntries,
    checks.map(normalizeCheckReasonCode)
  )
  const manifest: Manifest = {
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
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    },
    execution,
    states,
    evidenceIndex,
    reports: reportEntries,
    stateModel: stateModelSummary,
    summary,
    diagnostics,
    runEnvironment,
    toolVersions,
    proof,
    ...(() => {
      const provenance = {
        source: "canonical" as const,
        ...(process.env.UIQ_RUN_CORRELATION_ID?.trim()
          ? { correlationId: process.env.UIQ_RUN_CORRELATION_ID.trim() }
          : {}),
        ...(process.env.UIQ_LINKED_RUN_ID?.trim()
          ? { linkedRunIds: [process.env.UIQ_LINKED_RUN_ID.trim()] }
          : {}),
        ...(process.env.UIQ_LINKED_TASK_ID?.trim()
          ? { linkedTaskIds: [process.env.UIQ_LINKED_TASK_ID.trim()] }
          : {}),
      }
      return provenance.correlationId || provenance.linkedRunIds || provenance.linkedTaskIds
        ? { provenance }
        : {}
    })(),
    gateResults: {
      status,
      checks: checks.map(normalizeCheckReasonCode),
    },
    toolchain: {
      toolchainVersion: TOOLCHAIN_VERSION,
      node: process.version,
      driver: target.driver,
      playwright: "installed",
      driverCapabilities: driverContract.capabilities,
      config: {
        explore: effectiveExploreConfig,
        chaos: effectiveChaosConfig,
        load: effectiveLoadConfig,
        security: effectiveSecurityConfig,
        aiReview: effectiveAiReviewConfig,
        diagnostics: effectiveDiagnosticsConfig,
        baseUrlPolicy,
      },
    },
  }

  const manifestPath = writeManifest(baseDir, manifest)
  return { manifestPath }
}
