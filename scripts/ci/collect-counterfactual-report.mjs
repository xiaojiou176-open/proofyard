#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

function parseArgs(argv) {
  const options = {
    out: ".runtime-cache/artifacts/ci",
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--out" && next) {
      options.out = next
    }
  }
  if (!String(options.out || "").trim()) {
    throw new Error("invalid --out, expected non-empty path")
  }
  return options
}

function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function toLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
}

function normalizeGateStatus(value) {
  const raw = toLower(value)
  if (["passed", "pass", "success", "succeeded"].includes(raw)) return "passed"
  if (["failed", "fail", "error", "failure"].includes(raw)) return "failed"
  if (["blocked", "skip", "skipped", "cancelled", "canceled"].includes(raw)) return "blocked"
  return "unknown"
}

function parsePositiveNumber(raw, fallback) {
  const num = Number.parseFloat(String(raw || ""))
  if (Number.isFinite(num) && num > 0) return num
  return fallback
}

function buildReason(input) {
  if (input.reason && input.reason.length > 0) return input.reason
  if (input.requiredDirs.length === 0) {
    return "counterfactual.required_dirs.missing"
  }
  if (!input.requiredTag) {
    return "counterfactual.required_tag.missing"
  }
  if (!Number.isFinite(input.ratioThreshold) || input.ratioThreshold <= 0) {
    return "counterfactual.ratio_threshold.invalid"
  }
  if (input.gateStatus === "passed") return "counterfactual.gate.passed"
  if (input.gateStatus === "failed") return "counterfactual.gate.failed"
  if (input.gateStatus === "blocked") return "counterfactual.gate.blocked"
  return "counterfactual.gate.unknown"
}

function renderMarkdown(report) {
  const lines = []
  lines.push("## Counterfactual Gate Report")
  lines.push(`- generatedAt: \`${report.generatedAt}\``)
  lines.push(`- gateStatus: **${report.gateStatus}**`)
  lines.push(`- reason: \`${report.reason}\``)
  lines.push(`- ratioThreshold: \`${report.ratioThreshold}\``)
  lines.push(`- requiredTag: \`${report.requiredTag || "(empty)"}\``)
  lines.push(
    `- requiredDirs: ${report.requiredDirs.length > 0 ? report.requiredDirs.map((dir) => `\`${dir}\``).join(", ") : "(empty)"}`
  )
  lines.push(`- minFilesPerDir: \`${report.minFilesPerDir}\``)
  lines.push("")
  lines.push("| Field | Value |")
  lines.push("|---|---|")
  lines.push(`| gate status | \`${report.gateStatus}\` |`)
  lines.push(`| reason | \`${report.reason}\` |`)
  lines.push(`| ratio threshold | \`${report.ratioThreshold}\` |`)
  lines.push(`| required tag | \`${report.requiredTag || "(empty)"}\` |`)
  lines.push(
    `| required dirs | ${report.requiredDirs.length > 0 ? report.requiredDirs.map((dir) => `\`${dir}\``).join(", ") : "(empty)"} |`
  )
  lines.push(`| min files per dir | \`${report.minFilesPerDir}\` |`)
  return `${lines.join("\n")}\n`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const outDir = resolve(options.out)
  mkdirSync(outDir, { recursive: true })

  const requiredDirs = parseCsv(process.env.E2E_COUNTERFACTUAL_REQUIRED_DIRS)
  const requiredTag = String(process.env.E2E_COUNTERFACTUAL_REQUIRED_TAG || "").trim()
  const ratioThreshold = parsePositiveNumber(process.env.E2E_STUB_NONSTUB_MAX_RATIO, 4)
  const minFilesPerDir = parsePositiveNumber(process.env.E2E_COUNTERFACTUAL_MIN_FILES_PER_DIR, 1)
  const gateStatus = normalizeGateStatus(process.env.E2E_COUNTERFACTUAL_GATE_STATUS)
  const providedReason = String(process.env.E2E_COUNTERFACTUAL_GATE_REASON || "").trim()

  const reason = buildReason({
    requiredDirs,
    requiredTag,
    ratioThreshold,
    gateStatus,
    reason: providedReason,
  })

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gateStatus,
    reason,
    ratioThreshold,
    requiredTag,
    requiredDirs,
    minFilesPerDir,
  }

  const jsonPath = resolve(outDir, "counterfactual-report.json")
  const mdPath = resolve(outDir, "counterfactual-report.md")
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  writeFileSync(mdPath, renderMarkdown(report), "utf8")

  console.log(`[counterfactual-report] output_json=${jsonPath}`)
  console.log(`[counterfactual-report] output_md=${mdPath}`)
  console.log(`[counterfactual-report] gate_status=${gateStatus} reason=${reason}`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[counterfactual-report] error: ${message}`)
  process.exit(2)
}
