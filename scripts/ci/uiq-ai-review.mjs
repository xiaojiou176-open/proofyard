#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

function parseBoolean(value, flag) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  throw new Error(`invalid ${flag}, expected true|false`)
}

function parseArgs(argv) {
  const options = {
    profile: "pr",
    runsDir: ".runtime-cache/artifacts/runs",
    outDir: ".runtime-cache/artifacts/ci",
    runId: "",
    manifestPath: "",
    maxArtifacts: 40,
    severityThreshold: "high",
    emitIssue: false,
    emitPrComment: false,
    strict: false,
    repo: "",
    prNumber: 0,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--profile" && next) options.profile = next
    if (token === "--runs-dir" && next) options.runsDir = next
    if (token === "--out-dir" && next) options.outDir = next
    if (token === "--run-id" && next) options.runId = next
    if (token === "--manifest" && next) options.manifestPath = next
    if (token === "--max-artifacts" && next) options.maxArtifacts = Number(next)
    if (token === "--severity-threshold" && next) options.severityThreshold = next
    if (token === "--emit-issue" && next) options.emitIssue = parseBoolean(next, "--emit-issue")
    if (token === "--emit-pr-comment" && next)
      options.emitPrComment = parseBoolean(next, "--emit-pr-comment")
    if (token === "--strict" && next) options.strict = parseBoolean(next, "--strict")
    if (token === "--repo" && next) options.repo = String(next).trim()
    if (token === "--pr-number" && next) options.prNumber = Number(next)
  }

  if (
    !Number.isInteger(options.maxArtifacts) ||
    options.maxArtifacts < 1 ||
    options.maxArtifacts > 500
  ) {
    throw new Error("invalid --max-artifacts, expected integer in [1, 500]")
  }
  if (!["critical", "high", "medium", "low"].includes(String(options.severityThreshold))) {
    throw new Error("invalid --severity-threshold, expected critical|high|medium|low")
  }
  if (!Number.isInteger(options.prNumber) || options.prNumber < 0) {
    throw new Error("invalid --pr-number, expected non-negative integer")
  }
  return options
}

function findLatestManifest(runsDir) {
  const root = resolve(runsDir)
  const candidates = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifestPath = resolve(root, entry.name, "manifest.json")
    try {
      candidates.push({ manifestPath, mtimeMs: statSync(manifestPath).mtimeMs })
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates[0]?.manifestPath
}

function resolveManifestPath(options) {
  if (options.manifestPath) return resolve(options.manifestPath)
  if (options.runId) return resolve(options.runsDir, options.runId, "manifest.json")
  const latest = findLatestManifest(options.runsDir)
  if (!latest) {
    throw new Error(`no manifest found under ${options.runsDir}`)
  }
  return latest
}

function writeStepSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  writeFileSync(summaryPath, markdown, { encoding: "utf8", flag: "a" })
}

function loadGeminiUiReport(manifestPath) {
  const runDir = dirname(manifestPath)
  const reportPath = resolve(runDir, "reports/ui-ux-gemini-report.json")
  if (!existsSync(reportPath)) {
    return null
  }
  const parsed = JSON.parse(readFileSync(reportPath, "utf8"))
  return { reportPath, parsed }
}

function collectGeminiFindings(geminiUiReport) {
  const findings = Array.isArray(geminiUiReport?.findings) ? geminiUiReport.findings : []
  return findings.filter((finding) => {
    if (!finding || typeof finding !== "object") return false
    return (
      (typeof finding.title === "string" && finding.title.trim().length > 0) ||
      (typeof finding.diagnosis === "string" && finding.diagnosis.trim().length > 0) ||
      (typeof finding.recommendation === "string" && finding.recommendation.trim().length > 0)
    )
  })
}

function createGeminiBackedGenerator(geminiUiReport) {
  return () => {
    const findings = collectGeminiFindings(geminiUiReport)
    return {
      model: geminiUiReport?.model || "gemini-ui-ux-report",
      output: {
        summary:
          findings.length > 0
            ? `Imported ${findings.length} Gemini multimodal UI findings`
            : "Imported Gemini multimodal report with no findings",
        findings: findings.map((finding, index) => ({
          issue_id:
            finding?.id ||
            `AI-${String(index + 1).padStart(3, "0")}-${String(finding?.reason_code || "gemini-uiux").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          severity: finding?.severity || "medium",
          impact: finding?.diagnosis || finding?.title || "Gemini multimodal UI review finding.",
          recommendation:
            finding?.recommendation || "Review the Gemini multimodal evidence and apply the fix.",
          reason_code: finding?.reason_code || "ai.gemini.review.finding.generated",
          file_path:
            (Array.isArray(finding?.evidence) && finding.evidence[0]) ||
            "reports/ui-ux-gemini-report.json",
          patch_hint:
            finding?.recommendation || "Align implementation with the Gemini multimodal finding.",
          acceptance_check:
            finding?.title || "Re-run Gemini multimodal UI audit and ensure the finding disappears.",
          risk_level: finding?.severity || "medium",
        })),
      },
    }
  }
}

function hasGeminiFindings(geminiUiReport) {
  return collectGeminiFindings(geminiUiReport).length > 0
}

export function shouldUseGeminiFindingsOverride(geminiUiReportEnvelope) {
  const report =
    geminiUiReportEnvelope && typeof geminiUiReportEnvelope === "object"
      ? geminiUiReportEnvelope.parsed ?? geminiUiReportEnvelope
      : null
  return hasGeminiFindings(report)
}

function runFailureTicketingIfNeeded(options) {
  if (!options.emitIssue && !options.emitPrComment) return
  const args = [
    "scripts/ci/uiq-failure-ticketing.mjs",
    "--runs-dir",
    options.runsDir,
    "--out-dir",
    options.outDir,
    "--emit-gh-issues",
    String(options.emitIssue),
    "--emit-pr-comment",
    String(options.emitPrComment),
  ]
  if (options.repo) {
    args.push("--repo", options.repo)
  }
  if (options.prNumber > 0) {
    args.push("--pr-number", String(options.prNumber))
  }
  const child = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  })
  if (child.status !== 0) {
    throw new Error(`uiq-failure-ticketing failed with exit code ${child.status ?? 1}`)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const manifestPath = resolveManifestPath(options)
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const runId = String(manifest.runId || options.runId || "unknown-run")
  const geminiUiReport = loadGeminiUiReport(manifestPath)

  const { buildAiReviewInput } = await import("../../packages/ai-review/src/build-input.ts")
  const { generateAiReviewReport, writeAiReviewReportArtifacts, renderAiReviewMarkdown } =
    await import("../../packages/ai-review/src/generate-findings.ts")

  const input = buildAiReviewInput(manifest, { maxArtifacts: options.maxArtifacts })
  const report = generateAiReviewReport(input, {
    severityThreshold: options.severityThreshold,
    ...(geminiUiReport && shouldUseGeminiFindingsOverride(geminiUiReport)
      ? { llmGenerate: createGeminiBackedGenerator(geminiUiReport.parsed) }
      : {}),
  })

  mkdirSync(resolve(options.outDir), { recursive: true })
  const jsonFile = `uiq-ai-review-${options.profile}.json`
  const mdFile = `uiq-ai-review-${options.profile}.md`
  const artifacts = writeAiReviewReportArtifacts(options.outDir, report, jsonFile, mdFile)

  const summaryLines = [
    "## UIQ AI Review Gate",
    `- Profile: \`${options.profile}\``,
    `- Run ID: \`${runId}\``,
    `- Manifest: \`${manifestPath}\``,
    `- Gate: **${report.gate.status}**`,
    `- reasonCode: \`${report.gate.reasonCode}\``,
    `- Findings: **${report.summary.totalFindings}**`,
    `- HighOrAbove: **${report.summary.highOrAbove}**`,
    `- Candidate Artifacts: **${report.summary.candidateArtifacts}**`,
    `- Gemini UI Report: \`${geminiUiReport?.reportPath ?? "n/a"}\``,
    `- Report JSON: \`${resolve(options.outDir, artifacts.jsonPath)}\``,
    `- Report MD: \`${resolve(options.outDir, artifacts.markdownPath)}\``,
    "",
    renderAiReviewMarkdown(report),
  ]
  writeStepSummary(`${summaryLines.join("\n")}\n`)

  runFailureTicketingIfNeeded(options)

  console.log(
    `[uiq-ai-review] gate_status=${report.gate.status} reason_code=${report.gate.reasonCode} findings=${report.summary.totalFindings} high_or_above=${report.summary.highOrAbove}`
  )
  console.log(`[uiq-ai-review] artifact_json=${resolve(options.outDir, artifacts.jsonPath)}`)
  console.log(`[uiq-ai-review] artifact_md=${resolve(options.outDir, artifacts.markdownPath)}`)

  if (options.strict && report.gate.status !== "passed") {
    process.exit(2)
  }
}

const invokedAsScript =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedAsScript) {
  main().catch((error) => {
    console.error(`[uiq-ai-review] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
