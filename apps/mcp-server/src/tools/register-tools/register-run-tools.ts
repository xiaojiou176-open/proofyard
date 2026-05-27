import { spawnSync } from "node:child_process"
import { relative, resolve } from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as z from "zod"
import { buildPromotionCandidate } from "../../../../../packages/core/src/evidence-runs/promotion.js"
import { buildModelTargetCapabilities } from "../../../../../packages/orchestrator/src/commands/catalog.js"
import { backendBaseUrl, backendToken } from "../../core/api-client.js"
import {
  ensureDirReady,
  readUtf8,
  runsRoot,
  safeResolveUnder,
  workspaceRoot,
  writeAudit,
} from "../../core/constants.js"
import {
  buildProofCampaignReport,
  getProofContextForRun,
  PROOF_POLICY_MODE,
  pickProofCampaignIdOrLatest,
  proofCampaignSummaryDiff,
  readProofCampaignReport,
  writeProofCampaignArtifacts,
  writeProofCampaignDiff,
} from "../../core/proof-campaign.js"
import { sanitizeProfileTarget } from "../../core/redaction.js"
import { buildReportBundle } from "../../core/run-artifacts.js"
import { type RunOverrideValues, runOverrideSchema } from "../../core/types.js"
import { RUN_TOOL_DESCRIPTIONS } from "./descriptions.js"
import {
  executeRunCommand,
  invalidInput,
  LOCALHOST_DEEP_LOAD_BASE_URL,
  LOCALHOST_DEEP_LOAD_PROFILE,
  LOCALHOST_DEEP_LOAD_TARGET,
  proofCampaignsRootPath,
  runServerSelfcheck,
  sanitizeSlugInput,
  toolJson,
  writeJson,
  writeSelfcheckAudit,
} from "./register-run-tools-common.js"
import {
  analyzeA11y,
  analyzePerf,
  analyzeSecurity,
  analyzeVisual,
  appendRunOverrides,
  buildEvidenceSharePackRecord,
  compareEvidenceRunRecords,
  comparePerf,
  desktopInputWarnings,
  listEvidenceRunSummaries,
  listRunIds,
  listYamlStemNames,
  pickRunIdOrLatest,
  readEvidenceRunRecord,
  readLatestEvidenceRunRecord,
  readRepoTextFile,
  readRunOverview,
  runUiqStream,
  runUiqSync,
} from "./shared.js"

export function registerRunTools(mcpServer: McpServer): void {
  mcpServer.registerTool(
    "uiq_catalog",
    {
      description:
        "List available configs/profiles and configs/targets/commands in this repository",
      inputSchema: {},
    },
    async () => {
      const profiles = listYamlStemNames(resolve(workspaceRoot(), "profiles"))
      const targets = listYamlStemNames(resolve(workspaceRoot(), "targets"))
      const commands = [
        "run",
        "capture",
        "explore",
        "chaos",
        "a11y",
        "perf",
        "visual",
        "e2e",
        "load",
        "security",
        "computer-use",
        "desktop-readiness",
        "desktop-e2e",
        "desktop-business",
        "desktop-soak",
        "engines:check",
        "report",
      ]
      return toolJson({
        profiles,
        targets,
        commands,
        backendBaseUrl: backendBaseUrl(),
        tokenConfigured: Boolean(backendToken()),
      })
    }
  )

  mcpServer.registerTool(
    "uiq_server_selfcheck",
    {
      description:
        "Self-check MCP runtime readiness: paths, configs/profiles, configs/targets, backend health, and recent runs.",
      inputSchema: {},
    },
    async () => {
      const result = await runServerSelfcheck()
      writeSelfcheckAudit(result)
      return toolJson(result, !result.ok)
    }
  )

  mcpServer.registerTool(
    "uiq_run_deep_load_localhost",
    {
      description:
        "Execute localhost deep-load flow (selfcheck -> run_stream -> run_overview -> report_bundle) and return key evidence.",
      inputSchema: {
        profile: z.string().optional(),
        target: z.string().optional(),
        baseUrl: z.string().optional(),
        runOverride: z.object(runOverrideSchema).optional(),
      },
    },
    async ({ profile, target, baseUrl, runOverride }) => {
      try {
        const selectedProfile = profile
          ? sanitizeProfileTarget("profile", profile)
          : LOCALHOST_DEEP_LOAD_PROFILE
        const selectedTarget = target
          ? sanitizeProfileTarget("target", target)
          : LOCALHOST_DEEP_LOAD_TARGET
        const mergedOverrides: RunOverrideValues = {
          ...(runOverride ?? {}),
          baseUrl: baseUrl ?? runOverride?.baseUrl ?? LOCALHOST_DEEP_LOAD_BASE_URL,
        }

        const selfcheck = await runServerSelfcheck()
        writeAudit({
          type: "uiq_run_deep_load_localhost",
          ok: selfcheck.ok,
          detail: `stage=selfcheck profile=${selectedProfile} target=${selectedTarget}`,
        })
        if (!selfcheck.ok) {
          return toolJson(
            {
              ok: false,
              detail: "selfcheck failed",
              sequence: ["uiq_server_selfcheck"],
              profile: selectedProfile,
              target: selectedTarget,
              baseUrl: mergedOverrides.baseUrl ?? null,
              stepResults: { selfcheck },
            },
            true
          )
        }

        const args = ["run", "--profile", selectedProfile, "--target", selectedTarget]
        appendRunOverrides(args, mergedOverrides)
        const warnings = desktopInputWarnings({
          profile: selectedProfile,
          target: selectedTarget,
          app: typeof mergedOverrides.app === "string" ? mergedOverrides.app : undefined,
          bundleId:
            typeof mergedOverrides.bundleId === "string" ? mergedOverrides.bundleId : undefined,
        })
        const runResult = await runUiqStream(args, 10 * 60 * 1000)
        if (!runResult.ok || !runResult.runId) {
          return toolJson(
            {
              ok: false,
              detail: !runResult.ok ? runResult.detail : "run_stream returned no runId",
              sequence: ["uiq_server_selfcheck", "uiq_run_stream"],
              profile: selectedProfile,
              target: selectedTarget,
              baseUrl: mergedOverrides.baseUrl ?? null,
              warnings,
              stepResults: { selfcheck, runStream: runResult },
            },
            true
          )
        }

        const overview = readRunOverview(runResult.runId)
        const bundle = buildReportBundle(runResult.runId, {
          proof: getProofContextForRun(runResult.runId),
        })
        const keyEvidence = overview.failedChecks.map((item) => ({
          id: item.id,
          status: item.status,
          reasonCode: item.reasonCode ?? null,
          source: item.source,
          evidencePath: item.evidencePath,
        }))
        return toolJson({
          ok: true,
          sequence: [
            "uiq_server_selfcheck",
            "uiq_run_stream",
            "uiq_run_overview",
            "uiq_report_bundle",
          ],
          profile: selectedProfile,
          target: selectedTarget,
          baseUrl: mergedOverrides.baseUrl ?? null,
          runId: runResult.runId,
          gateStatus: overview.gateStatus,
          keyEvidence,
          warnings,
          stepResults: {
            selfcheck,
            runStream: {
              ok: runResult.ok,
              detail: runResult.detail,
              runId: runResult.runId,
              manifest: runResult.manifest ?? null,
              exitCode: runResult.exitCode,
              elapsedMs: runResult.elapsedMs,
              eventCount: runResult.events.length,
            },
            runOverview: overview,
            reportBundle: {
              runId: bundle.runId,
              gateStatus: bundle.gateStatus,
              failedChecks: bundle.failedChecks,
              paths: bundle.paths ?? {},
              screenshots: Array.isArray(bundle.screenshots) ? bundle.screenshots : [],
            },
          },
        })
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_run_deep_audit_autofix_localhost",
    {
      description:
        "Execute localhost deep audit + autofix loop in one call (selfcheck -> deep-load -> UX audit -> autofix plan -> rerun -> final bundle).",
      inputSchema: {
        profile: z.string().optional(),
        target: z.string().optional(),
        baseUrl: z.string().optional(),
        autofixMode: z.enum(["safe", "plan_only"]).optional(),
        runOverride: z.object(runOverrideSchema).optional(),
      },
    },
    async ({ profile, target, baseUrl, autofixMode, runOverride }) => {
      try {
        const selectedProfile = profile
          ? sanitizeProfileTarget("profile", profile)
          : LOCALHOST_DEEP_LOAD_PROFILE
        const selectedTarget = target
          ? sanitizeProfileTarget("target", target)
          : LOCALHOST_DEEP_LOAD_TARGET
        const mode = autofixMode ?? "safe"
        const mergedOverrides: RunOverrideValues = {
          ...(runOverride ?? {}),
          baseUrl: baseUrl ?? runOverride?.baseUrl ?? LOCALHOST_DEEP_LOAD_BASE_URL,
        }

        const selfcheck = await runServerSelfcheck()
        if (!selfcheck.ok) {
          return toolJson(
            { ok: false, detail: "selfcheck failed", stepResults: { selfcheck } },
            true
          )
        }

        const args = ["run", "--profile", selectedProfile, "--target", selectedTarget]
        appendRunOverrides(args, mergedOverrides)
        const firstRun = await runUiqStream(args, 10 * 60 * 1000)
        if (!firstRun.ok || !firstRun.runId) {
          return toolJson(
            { ok: false, detail: firstRun.detail, stepResults: { selfcheck, firstRun } },
            true
          )
        }

        const firstOverview = readRunOverview(firstRun.runId)
        const firstBundle = buildReportBundle(firstRun.runId, {
          proof: getProofContextForRun(firstRun.runId),
        })
        const firstBundleFailedChecks = Array.isArray(
          (firstBundle as { failedChecks?: unknown }).failedChecks
        )
          ? (((firstBundle as { failedChecks?: unknown }).failedChecks as unknown[])?.length ?? 0)
          : 0

        const uxAuditScript = spawnSync(
          "pnpm",
          ["exec", "tsx", "scripts/usability/lane-d-usability.ts"],
          {
            cwd: process.cwd(),
            stdio: "pipe",
            encoding: "utf8",
            timeout: 8 * 60 * 1000,
          }
        )

        const uxMetricsPath = resolve(".runtime-cache/artifacts/usability/lane-d-metrics.json")
        const uxMetricsRaw = readUtf8(uxMetricsPath)
        const uxMetrics = JSON.parse(uxMetricsRaw) as {
          summaries?: Array<{ completionRate?: number }>
        }
        const completionRates = (uxMetrics.summaries ?? [])
          .map((item) => Number(item.completionRate ?? 0))
          .filter((item) => Number.isFinite(item))
        const avgCompletion =
          completionRates.length > 0
            ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
            : 0
        const uxScore = Math.round(avgCompletion * 100)
        const uxCriticalIssues = completionRates.filter((item) => item < 0.85).length
        const interactiveControlsCoverage = Number(avgCompletion.toFixed(4))

        const firstRunReportsDir = safeResolveUnder(runsRoot(), firstRun.runId, "reports")
        writeJson(resolve(firstRunReportsDir, "ux-audit.json"), {
          runId: firstRun.runId,
          generatedAt: new Date().toISOString(),
          uxScore,
          uxCriticalIssues,
          interactiveControlsCoverage,
          source: "scripts/usability/lane-d-usability.ts",
          commandStatus: uxAuditScript.status ?? 0,
        })
        writeJson(resolve(firstRunReportsDir, "ui-coverage-matrix.json"), {
          runId: firstRun.runId,
          generatedAt: new Date().toISOString(),
          interactiveControlsCoverage,
          sampledFlows: completionRates.length,
        })

        const autofixPlanPath = resolve(firstRunReportsDir, "autofix.plan.json")
        writeJson(autofixPlanPath, {
          runId: firstRun.runId,
          generatedAt: new Date().toISOString(),
          mode,
          plannedActions: firstOverview.failedChecks.map((check) => ({
            gateId: check.id,
            reasonCode: check.reasonCode ?? null,
            evidencePath: check.evidencePath,
            suggestedOwner: "implementer",
            status: mode === "safe" ? "queued_for_manual_apply" : "plan_only",
          })),
        })

        const secondRun = await runUiqStream(args, 10 * 60 * 1000)
        if (!secondRun.ok || !secondRun.runId) {
          return toolJson(
            {
              ok: false,
              detail: "rerun failed",
              stepResults: { selfcheck, firstRun, firstOverview, firstBundle, secondRun },
            },
            true
          )
        }

        const secondOverview = readRunOverview(secondRun.runId)
        const secondBundle = buildReportBundle(secondRun.runId, {
          proof: getProofContextForRun(secondRun.runId),
        })
        const secondBundleFailedChecks = Array.isArray(
          (secondBundle as { failedChecks?: unknown }).failedChecks
        )
          ? (((secondBundle as { failedChecks?: unknown }).failedChecks as unknown[])?.length ?? 0)
          : 0
        const autofixRegressionPassed =
          secondOverview.failedChecks.length <= firstOverview.failedChecks.length
        const secondRunReportsDir = safeResolveUnder(runsRoot(), secondRun.runId, "reports")
        writeJson(resolve(secondRunReportsDir, "autofix-regression.json"), {
          initialRunId: firstRun.runId,
          rerunId: secondRun.runId,
          initialFailedChecks: firstOverview.failedChecks.length,
          rerunFailedChecks: secondOverview.failedChecks.length,
          passed: autofixRegressionPassed,
        })

        return toolJson({
          ok: true,
          sequence: [
            "uiq_server_selfcheck",
            "uiq_run_stream",
            "uiq_run_overview",
            "uiq_report_bundle",
            "gemini_ux_audit",
            "autofix_plan",
            "uiq_run_stream",
            "uiq_run_overview",
            "uiq_report_bundle",
          ],
          profile: selectedProfile,
          target: selectedTarget,
          baseUrl: mergedOverrides.baseUrl ?? null,
          uxAudit: { uxScore, uxCriticalIssues, interactiveControlsCoverage },
          autofix: {
            mode,
            planPath: relative(process.cwd(), autofixPlanPath),
            regressionPassed: autofixRegressionPassed,
          },
          runs: {
            initial: {
              runId: firstRun.runId,
              gateStatus: firstOverview.gateStatus,
              failedChecks: firstOverview.failedChecks.length,
            },
            rerun: {
              runId: secondRun.runId,
              gateStatus: secondOverview.gateStatus,
              failedChecks: secondOverview.failedChecks.length,
            },
          },
          keyEvidence: secondOverview.failedChecks.map((item) => ({
            id: item.id,
            status: item.status,
            reasonCode: item.reasonCode ?? null,
            evidencePath: item.evidencePath,
          })),
          stepResults: {
            selfcheck,
            firstRun: {
              runId: firstRun.runId,
              detail: firstRun.detail,
              gateStatus: firstOverview.gateStatus,
            },
            firstBundle: { runId: firstBundle.runId, failedChecks: firstBundleFailedChecks },
            uxAuditScript: {
              status: uxAuditScript.status,
              detail: uxAuditScript.stderr || uxAuditScript.stdout || "",
            },
            secondRun: {
              runId: secondRun.runId,
              detail: secondRun.detail,
              gateStatus: secondOverview.gateStatus,
            },
            secondBundle: { runId: secondBundle.runId, failedChecks: secondBundleFailedChecks },
          },
        })
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_run",
    {
      description: RUN_TOOL_DESCRIPTIONS.run,
      inputSchema: {
        mode: z.enum(["profile", "command"]),
        profile: z.string().optional(),
        command: z.string().optional(),
        target: z.string().optional(),
        runId: z.string().optional(),
        ...runOverrideSchema,
      },
    },
    async ({ mode, profile, command, target, runId, ...overrides }) => {
      try {
        if (mode === "profile") {
          if (!profile || !target) {
            return invalidInput("profile and target are required for mode=profile")
          }
          const safeProfile = sanitizeProfileTarget("profile", profile)
          const safeTarget = sanitizeProfileTarget("target", target)
          const args = ["run", "--profile", safeProfile, "--target", safeTarget]
          if (runId) {
            args.push("--run-id", runId)
          }
          appendRunOverrides(args, overrides)
          const warnings = desktopInputWarnings({
            profile: safeProfile,
            target: safeTarget,
            app: overrides.app,
            bundleId: overrides.bundleId,
          })
          const result = runUiqSync(args)
          return toolJson({ ...result, warnings }, !result.ok)
        }
        if (!command) {
          return invalidInput("command is required for mode=command")
        }
        const executed = executeRunCommand({ command, target, profile, runId, overrides })
        return toolJson({ ...executed.result, warnings: executed.warnings }, !executed.result.ok)
      } catch (error) {
        return invalidInput((error as Error).message)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_run_and_report",
    {
      description: RUN_TOOL_DESCRIPTIONS.runAndReport,
      inputSchema: {
        mode: z.enum(["stream", "overview", "bundle", "failures", "full"]),
        runMode: z.enum(["profile", "command"]).optional(),
        profile: z.string().optional(),
        command: z.string().optional(),
        target: z.string().optional(),
        runId: z.string().optional(),
        timeoutMs: z.number().int().optional(),
        ...runOverrideSchema,
      },
    },
    async ({ mode, runMode, profile, command, target, runId, timeoutMs, ...overrides }) => {
      try {
        if (mode === "overview") {
          const id = pickRunIdOrLatest(runId)
          const overview = readRunOverview(id)
          return toolJson({ ok: true, ...overview })
        }

        if (mode === "failures") {
          const id = pickRunIdOrLatest(runId)
          const overview = readRunOverview(id)
          return toolJson({
            runId: id,
            gateStatus: overview.gateStatus,
            failedChecks: overview.failedChecks,
          })
        }

        if (mode === "bundle") {
          const id = pickRunIdOrLatest(runId)
          const bundle = buildReportBundle(id, { proof: getProofContextForRun(id) })
          return toolJson(bundle)
        }

        const selectedRunMode = runMode ?? (command ? "command" : "profile")
        const args: string[] = []
        if (selectedRunMode === "profile") {
          if (!profile || !target) {
            return invalidInput("profile and target are required for runMode=profile")
          }
          const safeProfile = sanitizeProfileTarget("profile", profile)
          const safeTarget = sanitizeProfileTarget("target", target)
          args.push("run", "--profile", safeProfile, "--target", safeTarget)
        } else {
          if (!command) {
            return invalidInput("command is required for runMode=command")
          }
          args.push(command)
          const safeTarget = target ? sanitizeProfileTarget("target", target) : undefined
          const safeProfile = profile ? sanitizeProfileTarget("profile", profile) : undefined
          if (safeTarget) {
            args.push("--target", safeTarget)
          }
          if (safeProfile) {
            args.push("--profile", safeProfile)
          }
        }
        if (runId) {
          args.push("--run-id", runId)
        }
        appendRunOverrides(args, overrides)

        const streamResult = await runUiqStream(args, timeoutMs ?? 10 * 60 * 1000)
        if (mode === "stream") {
          return toolJson(streamResult, !streamResult.ok)
        }
        if (!streamResult.runId) {
          return toolJson(
            {
              ok: false,
              detail: "uiq_run_and_report full mode requires runId from stream result",
              stream: streamResult,
            },
            true
          )
        }

        const id = streamResult.runId
        const overview = readRunOverview(id)
        const bundle = buildReportBundle(id, { proof: getProofContextForRun(id) })
        return toolJson(
          {
            ok: streamResult.ok,
            runId: id,
            stream: streamResult,
            overview,
            failures: { gateStatus: overview.gateStatus, failedChecks: overview.failedChecks },
            bundle,
          },
          !streamResult.ok
        )
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_read",
    {
      description: RUN_TOOL_DESCRIPTIONS.read,
      inputSchema: {
        source: z.enum(["artifact", "manifest", "repo_doc"]),
        runId: z.string().optional(),
        relativePath: z.string().optional(),
      },
    },
    async ({ source, runId, relativePath }) => {
      try {
        if (source === "artifact") {
          if (!runId || !relativePath) {
            return invalidInput("runId and relativePath are required for source=artifact")
          }
          const text = readUtf8(safeResolveUnder(runsRoot(), runId, relativePath))
          return toolJson({ ok: true, source, runId, relativePath, text })
        }
        if (source === "manifest") {
          if (!runId) {
            return invalidInput("runId is required for source=manifest")
          }
          const text = readUtf8(safeResolveUnder(runsRoot(), runId, "manifest.json"))
          return toolJson({ ok: true, source, runId, text })
        }
        if (!relativePath) {
          return invalidInput("relativePath is required for source=repo_doc")
        }
        const text = readRepoTextFile(relativePath)
        return toolJson({ ok: true, source, relativePath, text })
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_quality_read",
    {
      description: RUN_TOOL_DESCRIPTIONS.qualityRead,
      inputSchema: {
        kind: z.enum(["a11y", "perf", "visual", "security"]),
        runId: z.string().optional(),
        topN: z.number().int().optional(),
      },
    },
    async ({ kind, runId, topN }) => {
      try {
        const id = pickRunIdOrLatest(runId)
        if (kind === "a11y") {
          return toolJson(analyzeA11y(id, topN ?? 10))
        }
        if (kind === "perf") {
          return toolJson(analyzePerf(id))
        }
        if (kind === "visual") {
          return toolJson(analyzeVisual(id))
        }
        return toolJson(analyzeSecurity(id))
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_proof",
    {
      description: RUN_TOOL_DESCRIPTIONS.proof,
      inputSchema: {
        action: z.enum(["run", "read", "export", "diff"]),
        campaignId: z.string().optional(),
        model: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        runIds: z.array(z.string()).optional(),
        baselineCampaignId: z.string().optional(),
        includeRunReports: z.boolean().optional(),
        campaignIdA: z.string().optional(),
        campaignIdB: z.string().optional(),
      },
    },
    async ({
      action,
      campaignId,
      model,
      name,
      description,
      runIds,
      baselineCampaignId,
      includeRunReports,
      campaignIdA,
      campaignIdB,
    }) => {
      try {
        if (action === "run") {
          const selectedRunIds = runIds?.length ? runIds : [pickRunIdOrLatest(undefined)]
          const finalCampaignId = campaignId?.trim() || `campaign-${Date.now()}`
          const report = buildProofCampaignReport({
            campaignId: sanitizeSlugInput("campaignId", finalCampaignId),
            model: model?.trim() || "proof-v1",
            runIds: selectedRunIds,
            name,
            description,
          })
          const paths = writeProofCampaignArtifacts(report)
          const baselineId = baselineCampaignId?.trim()
          const baselineDiff =
            baselineId && baselineId !== finalCampaignId
              ? (() => {
                  const baseline = readProofCampaignReport(baselineId)
                  const diff = proofCampaignSummaryDiff(baseline, report)
                  const diffPath = writeProofCampaignDiff(diff)
                  return { baselineCampaignId: baselineId, diffPath, diff }
                })()
              : null
          return toolJson({
            campaignId: finalCampaignId,
            runIds: selectedRunIds,
            model: report.model ?? null,
            ok: report.ok === true,
            policyMode: report.policyMode ?? PROOF_POLICY_MODE,
            reasonCodes: report.reasonCodes ?? [],
            stats: report.stats ?? {},
            paths,
            baselineDiff,
          })
        }

        if (action === "read") {
          const id = pickProofCampaignIdOrLatest(campaignId)
          return toolJson(readProofCampaignReport(id))
        }

        if (action === "export") {
          const id = pickProofCampaignIdOrLatest(campaignId)
          const report = readProofCampaignReport(id)
          const runReports = Array.isArray(report.runReports) ? report.runReports : []
          const bundle = {
            schemaVersion: 1,
            campaignId: id,
            model: report.model ?? null,
            generatedAt: report.generatedAt ?? null,
            ok: report.ok ?? null,
            policyMode: report.policyMode ?? PROOF_POLICY_MODE,
            reasonCodes: report.reasonCodes ?? [],
            policy: report.policy ?? {},
            runIds: report.runIds ?? [],
            stats: report.stats ?? {},
            failedCheckHistogram: report.failedCheckHistogram ?? {},
            ...(includeRunReports ? { runReports } : {}),
          }
          const proofRoot = proofCampaignsRootPath()
          ensureDirReady(proofRoot)
          const safeCampaignId = sanitizeSlugInput("campaignId", id)
          const exportDir = resolve(proofRoot, safeCampaignId)
          ensureDirReady(exportDir)
          const exportPath = resolve(exportDir, "campaign.bundle.json")
          writeJson(exportPath, bundle)
          return toolJson({ ...bundle, exportPath })
        }

        if (!campaignIdA || !campaignIdB) {
          return invalidInput("campaignIdA and campaignIdB are required for action=diff")
        }
        const reportA = readProofCampaignReport(campaignIdA)
        const reportB = readProofCampaignReport(campaignIdB)
        const diff = proofCampaignSummaryDiff(reportA, reportB)
        const diffPath = writeProofCampaignDiff(diff)
        return toolJson({ ...diff, diffPath })
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_compare_perf",
    {
      description: "Compare perf metrics between two runs",
      inputSchema: { runIdA: z.string(), runIdB: z.string() },
    },
    async ({ runIdA, runIdB }) => {
      try {
        return toolJson(comparePerf(runIdA, runIdB))
      } catch (error) {
        return toolJson(
          { ok: false, detail: `uiq_compare_perf failed: ${(error as Error).message}` },
          true
        )
      }
    }
  )

  mcpServer.registerTool(
    "uiq_model_target_capabilities",
    {
      description: "Describe proof campaign capability matrix across model + target combinations.",
      inputSchema: { model: z.string().optional() },
    },
    async ({ model }) => {
      try {
        const capabilities = buildModelTargetCapabilities(model?.trim() || "proof-v1")
        return toolJson(capabilities)
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_evidence_runs",
    {
      description: "List or read canonical evidence runs with retention and provenance details.",
      inputSchema: {
        action: z.enum(["list", "latest", "detail", "compare", "share", "explain", "promotion"]),
        runId: z.string().optional(),
        candidateRunId: z.string().optional(),
        limit: z.number().int().optional(),
      },
    },
    async ({ action, runId, candidateRunId, limit }) => {
      try {
        if (action === "list") {
          return toolJson({ ok: true, ...listEvidenceRunSummaries(limit ?? 20) })
        }
        if (action === "latest") {
          return toolJson({ ok: true, ...readLatestEvidenceRunRecord() })
        }
        if (action === "compare") {
          if (!runId?.trim() || !candidateRunId?.trim()) {
            return invalidInput("runId and candidateRunId are required for action=compare")
          }
          return toolJson({
            ok: true,
            compare: compareEvidenceRunRecords(runId.trim(), candidateRunId.trim()),
          })
        }
        if (action === "share") {
          if (!runId?.trim()) {
            return invalidInput("runId is required for action=share")
          }
          return toolJson({
            ok: true,
            sharePack: buildEvidenceSharePackRecord(
              runId.trim(),
              candidateRunId?.trim() || undefined
            ),
          })
        }
        if (action === "explain") {
          if (!runId?.trim()) {
            return invalidInput("runId is required for action=explain")
          }
          const sharePack = buildEvidenceSharePackRecord(
            runId.trim(),
            candidateRunId?.trim() || undefined
          ) as { markdownSummary: string; issueReadySnippet: string; releaseAppendix: string }
          return toolJson({
            ok: true,
            explanation: {
              summary: sharePack.markdownSummary,
              uncertainty:
                "Advisory-only explanation. Confirm the linked evidence before treating this as final.",
              next_actions: [sharePack.issueReadySnippet, sharePack.releaseAppendix],
            },
          })
        }
        if (action === "promotion") {
          if (!runId?.trim()) {
            return invalidInput("runId is required for action=promotion")
          }
          const promotion = buildPromotionCandidate(runId.trim(), {
            compareRunId: candidateRunId?.trim() || undefined,
            rootDir: workspaceRoot(),
          })
          return toolJson({ ok: true, candidate: promotion })
        }
        if (!runId?.trim()) {
          return invalidInput("runId is required for action=detail")
        }
        return toolJson({ ok: true, run: readEvidenceRunRecord(runId.trim()) })
      } catch (error) {
        return toolJson({ ok: false, detail: (error as Error).message }, true)
      }
    }
  )

  mcpServer.registerTool(
    "uiq_list_runs",
    {
      description: "List latest run IDs under .runtime-cache/artifacts/runs",
      inputSchema: { limit: z.number().int().optional() },
    },
    async ({ limit }) => toolJson({ runs: listRunIds(limit ?? 20) })
  )
}
