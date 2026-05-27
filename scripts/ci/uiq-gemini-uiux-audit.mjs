import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { setDefaultResultOrder } from "node:dns"
import {
  callGeminiWithFallback,
  classifyStrictFailure,
  DEFAULT_MODEL,
  DEFAULT_RUNS_DIR,
  discoverUiFiles,
  evaluateUiFoundation,
  extractJsonObject,
  GENERATED_RUN_REPORT_REL_PATH,
  normalizeModel,
  parseArgs,
  resolveGeminiApiKey,
  validateAuditPayload,
  writeArtifacts,
  buildInputChunks,
} from "./uiq-gemini-uiux-audit-support.mjs"

setDefaultResultOrder("ipv4first")
export {
  discoverUiFiles,
  evaluateUiFoundation,
  extractJsonObject,
  resolveGeminiApiKey,
  validateAuditPayload,
  writeArtifacts,
} from "./uiq-gemini-uiux-audit-support.mjs"

function isCliUiFile(filePath) {
  return /\.(css|scss|sass|less|ts|tsx|js|jsx|html)$/i.test(filePath)
}

function hasErrorIssue(issues) {
  return issues.some((item) => String(item?.severity || "").toLowerCase() === "error")
}

function resolveLatestRunId(runsDir = DEFAULT_RUNS_DIR) {
  const root = resolve(process.cwd(), runsDir)
  if (!existsSync(root)) return ""
  const candidates = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = resolve(root, entry.name, "manifest.json")
    if (!existsSync(manifestPath)) continue
    candidates.push({ runId: entry.name, mtimeMs: statSync(manifestPath).mtimeMs })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  return candidates[0]?.runId ?? ""
}

function mapMultimodalFinding(finding) {
  const evidencePath = Array.isArray(finding?.evidence) && finding.evidence[0] ? finding.evidence[0] : ""
  return {
    file: evidencePath || "reports/ui-ux-gemini-report.json",
    line: 1,
    severity: ["critical", "high"].includes(String(finding?.severity || "").toLowerCase())
      ? "error"
      : "warning",
    category: finding?.category || "ux",
    message: finding?.title || finding?.diagnosis || "Gemini UI/UX finding",
    suggestion: finding?.recommendation || "Review the multimodal evidence and apply the suggested fix.",
  }
}

function buildRunBackedReport(multimodalReport, options, apiKeyResolved, foundation) {
  const findings = Array.isArray(multimodalReport?.findings) ? multimodalReport.findings : []
  const issues = findings.map(mapMultimodalFinding)
  const verdict = String(multimodalReport?.summary?.verdict || "").toLowerCase()
  const failed = verdict === "critical_issues" || hasErrorIssue(issues)
  const screenshots = Array.isArray(multimodalReport?.input_context?.screenshots)
    ? multimodalReport.input_context.screenshots
    : []
  return {
    checkId: "uiq_gemini_uiux_audit",
    strict: options.strict,
    status: failed ? "failed" : "passed",
    reasonCode:
      multimodalReport?.reason_code ||
      (failed ? "gate.uiux.gemini.failed.error_issues_found" : "gate.uiux.gemini.passed.no_error_issues"),
    message:
      findings.length > 0
        ? `Gemini multimodal UI/UX audit analyzed ${screenshots.length || 1} visual artifact(s) and produced ${findings.length} finding(s).`
        : "Gemini multimodal UI/UX audit found no actionable UI issues.",
    model: multimodalReport?.model || normalizeModel(options.model || DEFAULT_MODEL),
    apiKeySource: apiKeyResolved.source,
    coverage: {
      discovered_files: screenshots.length,
      analyzed_files: screenshots.length,
      skipped_files: 0,
      skipped_reasons: [],
    },
    issues,
    httpStatus: 200,
    durationMs: null,
    rawPreviewTruncated: JSON.stringify(
      {
        runId: multimodalReport?.runId,
        verdict: multimodalReport?.summary?.verdict,
        total_findings: multimodalReport?.summary?.total_findings,
      },
      null,
      2
    ),
    runId: multimodalReport?.runId || "",
    evidencePath: multimodalReport?.output || GENERATED_RUN_REPORT_REL_PATH,
    foundation,
  }
}

function runMultimodalAudit(options, apiKeyResolved, foundation) {
  const runId = resolveLatestRunId()
  if (!runId) {
    return null
  }
  const runReportPath = resolve(process.cwd(), DEFAULT_RUNS_DIR, runId, GENERATED_RUN_REPORT_REL_PATH)
  const args = [
    "exec",
    "tsx",
    "apps/automation-runner/scripts/generate-ui-ux-gemini-report.ts",
    `--run_id=${runId}`,
    `--runs_dir=${DEFAULT_RUNS_DIR}`,
    `--output=${GENERATED_RUN_REPORT_REL_PATH}`,
    `--speed_mode=${options.strict ? "false" : "true"}`,
  ]
  const child = spawnSync("pnpm", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GEMINI_API_KEY: apiKeyResolved.key,
    },
    encoding: "utf8",
  })
  if (child.status !== 0) {
    const detail = [child.stdout, child.stderr].filter(Boolean).join("\n").trim()
    const error = new Error(detail || "multimodal Gemini UI/UX audit failed")
    error.name = "GeminiMultimodalAuditError"
    throw error
  }
  if (!existsSync(runReportPath)) {
    throw new Error(`multimodal audit report missing: ${runReportPath}`)
  }
  const multimodalReport = JSON.parse(readFileSync(runReportPath, "utf8"))
  return buildRunBackedReport(multimodalReport, options, apiKeyResolved, foundation)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const explicitFiles = process.argv
    .slice(2)
    .filter((token) => !token.startsWith("--"))
    .filter(isCliUiFile)
  const files = explicitFiles.length > 0 ? explicitFiles : discoverUiFiles()
  if (files.length === 0) {
    const failure = classifyStrictFailure(options, "no_ui_files")
    const report = {
      checkId: "uiq_gemini_uiux_audit",
      strict: options.strict,
      status: failure.status,
      reasonCode: failure.reasonCode,
      message: "no UI files discovered for Gemini UI/UX audit",
      model: normalizeModel(options.model || DEFAULT_MODEL),
      apiKeySource: "missing",
      coverage: {
        discovered_files: 0,
        analyzed_files: 0,
        skipped_files: 0,
        skipped_reasons: [],
      },
      issues: [],
      httpStatus: null,
      durationMs: null,
      rawPreviewTruncated: "",
    }
    const artifacts = writeArtifacts(report)
    process.stdout.write(
      `[uiq-gemini-uiux-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    if (options.strict) process.exit(1)
    return
  }

  const apiKeyResolved = resolveGeminiApiKey()
  const model = normalizeModel(options.model || DEFAULT_MODEL)
  const canUseRunBackedAudit = explicitFiles.length === 0 && Boolean(resolveLatestRunId())
  const report = {
    checkId: "uiq_gemini_uiux_audit",
    strict: options.strict,
    status: "passed",
    reasonCode: "gate.uiux.gemini.passed.no_findings",
    message: "",
    model,
    apiKeySource: apiKeyResolved.source,
    coverage: {
      discovered_files: files.length,
      analyzed_files: 0,
      skipped_files: 0,
      skipped_reasons: [],
    },
    issues: [],
    httpStatus: null,
    durationMs: null,
    rawPreviewTruncated: "",
    foundation: null,
  }

  const shouldEnforceFoundation = explicitFiles.length === 0 && files.length >= 5
  const foundation =
    !shouldEnforceFoundation
      ? {
          passed: true,
          summary: "UI foundation checks skipped for targeted/sparse scan mode.",
          checks: [
            {
              id: "foundation_scope",
              status: "passed",
              detail: `enforcement disabled (explicitFiles=${explicitFiles.length}, discoveredFiles=${files.length})`,
            },
          ],
          issues: [],
          evidence: {
            frontendUiImportFiles: [],
            appsWebUiImportFiles: [],
          },
        }
      : evaluateUiFoundation({ uiFiles: files })
  report.foundation = foundation
  if (foundation.issues.length > 0) {
    report.issues = [...foundation.issues]
  }

  if (!foundation.passed) {
    report.status = "failed"
    report.reasonCode = "gate.uiux.gemini.failed.foundation_integrity"
    report.message = foundation.summary
    const artifacts = writeArtifacts(report)
    process[options.strict ? "stderr" : "stdout"].write(
      `[uiq-gemini-uiux-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    if (options.strict) process.exit(1)
    return
  }

  if (!apiKeyResolved.key) {
    const failure = classifyStrictFailure(options, "missing_api_key")
    report.status = failure.status
    report.reasonCode = failure.reasonCode
    report.message =
      "Gemini API key missing (expected GEMINI_API_KEY or LIVE_GEMINI_API_KEY from process env or .env)"
    const artifacts = writeArtifacts(report)
    process.stdout.write(
      `[uiq-gemini-uiux-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    if (options.strict) process.exit(1)
    return
  }

  if (canUseRunBackedAudit) {
    try {
      const runBackedReport = runMultimodalAudit(options, apiKeyResolved, foundation)
      if (runBackedReport) {
        const artifacts = writeArtifacts(runBackedReport)
        process.stdout.write(
          `[uiq-gemini-uiux-audit] status=${runBackedReport.status} multimodal=true issues=${runBackedReport.issues.length}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
        )
        if (options.strict && runBackedReport.status === "failed") {
          process.exit(1)
        }
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failure = classifyStrictFailure(options, "multimodal_request_exception")
      report.status = failure.status
      report.reasonCode = failure.reasonCode
      report.message = message
      const artifacts = writeArtifacts(report)
      process[options.strict ? "stderr" : "stdout"].write(
        `[uiq-gemini-uiux-audit] ${message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
      )
      if (options.strict) process.exit(1)
      return
    }
  }

  const { selected, chunks, skipped, truncated } = buildInputChunks(
    files,
    options.maxFiles,
    options.maxFileChars
  )
  const skippedReasons = [...skipped, ...truncated]
  const fullyAnalyzedFiles = Math.max(0, selected.length - truncated.length)
  report.coverage.analyzed_files = fullyAnalyzedFiles
  report.coverage.skipped_files = skippedReasons.length
  report.coverage.skipped_reasons = skippedReasons
  if (chunks.length === 0) {
    const failure = classifyStrictFailure(options, "empty_payload")
    report.status = failure.status
    report.reasonCode = failure.reasonCode
    report.message = "no readable files found for audit"
    const artifacts = writeArtifacts(report)
    process.stdout.write(
      `[uiq-gemini-uiux-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    if (options.strict) process.exit(1)
    return
  }

  if (options.strict && skippedReasons.length > 0) {
    report.status = "failed"
    report.reasonCode = "gate.uiux.gemini.failed.partial_analysis"
    report.message =
      truncated.length > 0
        ? `Gemini UI/UX audit truncated ${truncated.length} file(s) at max-file-chars=${options.maxFileChars}; strict mode requires full untruncated coverage`
        : `Gemini UI/UX audit analyzed ${selected.length}/${files.length} files; strict mode requires full coverage`
    const artifacts = writeArtifacts(report)
    process.stderr.write(
      `[uiq-gemini-uiux-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    process.exit(1)
  }

  const prompt = [
    "You are a senior UI/UX and frontend quality auditor.",
    "Audit only these files and return STRICT JSON only.",
    "Focus on: accessibility (WCAG 2.2 AA), design-token consistency, visual hierarchy, responsive safety, and maintainability.",
    "Output schema:",
    "{",
    '  "passed": boolean,',
    '  "summary": "string",',
    '  "issues": [',
    '    { "file": "string", "line": number, "severity": "error|warning", "category": "a11y|token|layout|ux|maintainability", "message": "string", "suggestion": "string" }',
    "  ]",
    "}",
    "If no issue, return passed=true and issues=[].",
    "Hard constraints: at most 3 issues, concise wording, JSON only, no markdown.",
    "",
    "Deterministic foundation signals (must be respected):",
    `- foundationSummary: ${foundation.summary}`,
    `- frontendUiImportFiles: ${foundation.evidence.frontendUiImportFiles.length}`,
    `- appsWebUiImportFiles: ${foundation.evidence.appsWebUiImportFiles.length}`,
    ...foundation.checks.map((check) => `- ${check.id}: ${check.status} (${check.detail})`),
    "",
    ...chunks,
  ].join("\n")

  try {
    const testRawResponse = process.env.UIQ_GEMINI_UIUX_TEST_RAW_RESPONSE
    const call = testRawResponse
      ? {
          ok: true,
          httpStatus: 200,
          durationMs: 0,
          rawText: testRawResponse,
          json: { candidates: [{ content: { parts: [{ text: testRawResponse }] } }] },
          resolvedModel: model,
          attempts: [{ model, httpStatus: 200, ok: true }],
        }
      : await callGeminiWithFallback({
          endpoint: options.endpoint,
          model,
          apiKey: apiKeyResolved.key,
          prompt,
          timeoutMs: options.timeoutMs,
        })
    report.httpStatus = call.httpStatus
    report.durationMs = call.durationMs
    report.model = call.resolvedModel || model

    const textParts = []
    const candidates = Array.isArray(call.json?.candidates) ? call.json.candidates : []
    for (const candidate of candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
      for (const part of parts) {
        if (typeof part?.text === "string" && part.text.trim()) textParts.push(part.text.trim())
      }
    }
    const raw = textParts.join("\n").trim() || call.rawText
    report.rawPreviewTruncated = String(raw || "").slice(0, 5000)

    if (!call.ok) {
      report.status = "failed"
      report.reasonCode = "gate.uiux.gemini.failed.http_error"
      report.message = `gemini request failed with http ${call.httpStatus}`
      report.attempts = call.attempts || []
      const artifacts = writeArtifacts(report)
      process.stderr.write(
        `[uiq-gemini-uiux-audit] ${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
      )
      if (options.strict) process.exit(1)
      return
    }

    const parsed = extractJsonObject(raw)
    const payloadCheck = validateAuditPayload(parsed)
    if (!payloadCheck.ok) {
      const failure = classifyStrictFailure(options, payloadCheck.reason)
      report.status = failure.status
      report.reasonCode = failure.reasonCode
      report.message = `gemini response failed validation: ${payloadCheck.reason}`
      const artifacts = writeArtifacts(report)
      process[options.strict ? "stderr" : "stdout"].write(
        `[uiq-gemini-uiux-audit] ${options.strict ? "" : "warning: "}${report.message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
      )
      if (options.strict) process.exit(1)
      return
    }

    const truncatedFileSet = new Set(truncated.map((item) => item.file))
    const normalizedModelIssues = parsed.issues.map((issue) => {
      const issueFile = String(issue?.file || "")
      if (!truncatedFileSet.has(issueFile)) return issue
      const message = String(issue?.message || "Issue detected on truncated context")
      return {
        ...issue,
        severity: "warning",
        message: `${message} (confidence reduced: source file snippet was truncated)`,
      }
    })

    report.issues = [...foundation.issues, ...normalizedModelIssues]
    report.message = String(parsed.summary || foundation.summary || "")
    if (hasErrorIssue(report.issues)) {
      report.status = "failed"
      report.reasonCode = "gate.uiux.gemini.failed.error_issues_found"
    } else {
      report.status = "passed"
      report.reasonCode = "gate.uiux.gemini.passed.no_error_issues"
      if (/audit failed/i.test(report.message)) {
        report.message = `Gemini UI/UX audit returned ${report.issues.length} warning(s) and no error-level findings.`
      }
    }

    const artifacts = writeArtifacts(report)
    process.stdout.write(
      `[uiq-gemini-uiux-audit] status=${report.status} issues=${report.issues.length} analyzed=${report.coverage.analyzed_files} skipped=${report.coverage.skipped_files}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )

    if (options.strict && report.status === "failed") {
      for (const issue of report.issues.slice(0, 30)) {
        process.stderr.write(
          `  - ${issue.file || "unknown"}:${issue.line || 0} [${issue.severity || "warning"}] ${issue.message || "issue"}\n`
        )
      }
      process.exit(1)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    report.status = options.strict ? "failed" : "blocked"
    report.reasonCode = options.strict
      ? "gate.uiux.gemini.failed.request_exception"
      : "gate.uiux.gemini.blocked.request_exception"
    report.message = message
    const artifacts = writeArtifacts(report)
    process.stderr.write(
      `[uiq-gemini-uiux-audit] ${message}\nartifact=${artifacts.jsonPath}\nartifact_md=${artifacts.mdPath}\n`
    )
    if (options.strict) process.exit(1)
  }
}

main().catch((error) => {
  process.stderr.write(
    `[uiq-gemini-uiux-audit] fatal: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(1)
})
