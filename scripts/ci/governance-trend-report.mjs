#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const OUTPUT_JSON = path.join(repoRoot, ".runtime-cache/artifacts/ci/governance-trend-report.json")
const OUTPUT_MD = path.join(repoRoot, ".runtime-cache/artifacts/ci/governance-trend-report.md")
const EXCEPTIONS_PATH = path.join(repoRoot, "scripts/ci/governance-exceptions.json")
const DEBT_REGISTER_PATH = path.join(repoRoot, "configs/governance/debt-register.md")
const PRECOMMIT_HISTORY_PATH = path.join(
  repoRoot,
  ".runtime-cache/artifacts/ci/precommit-required-gates-metrics-history.jsonl"
)
const GENERATED_DOCS_DIR = path.join(repoRoot, "docs/reference/generated")

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function parseJson(pathname, fallback) {
  try {
    return JSON.parse(fs.readFileSync(pathname, "utf8"))
  } catch {
    return fallback
  }
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseDebtRegister() {
  const rows = []
  const content = fs.readFileSync(DEBT_REGISTER_PATH, "utf8")
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith("|")) continue
    if (/^\|\s*-+\s*\|/.test(line)) continue
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length !== 8) continue
    if (cells[0] === "ID") continue
    const [id, type, targetPath, risk, ownerRole, dueDate, exitCriteria, status] = cells
    rows.push({
      id,
      type,
      path: targetPath,
      risk,
      ownerRole,
      dueDate,
      exitCriteria,
      status,
    })
  }
  return rows
}

function loadPrecommitSummary() {
  if (!fs.existsSync(PRECOMMIT_HISTORY_PATH)) return null
  const records = fs
    .readFileSync(PRECOMMIT_HISTORY_PATH, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  if (records.length === 0) return null
  const strictRecords = records.filter((record) => record.mode === "strict")
  const target = strictRecords.length > 0 ? strictRecords : records
  const failed = target.filter((record) => record.status === "failed")
  return {
    totalRuns: target.length,
    failedRuns: failed.length,
    failedRate: target.length === 0 ? 0 : Number((failed.length / target.length).toFixed(4)),
    lastRun: target[target.length - 1] ?? null,
  }
}

function listGeneratedDocs() {
  if (!fs.existsSync(GENERATED_DOCS_DIR)) return []
  return fs
    .readdirSync(GENERATED_DOCS_DIR)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
}

function buildReport() {
  const today = new Date()
  const exceptionsPayload = parseJson(EXCEPTIONS_PATH, { exceptions: [] })
  const exceptions = Array.isArray(exceptionsPayload.exceptions) ? exceptionsPayload.exceptions : []
  const debtRows = parseDebtRegister()
  const generatedDocs = listGeneratedDocs()
  const precommitSummary = loadPrecommitSummary()
  const unresolvedDebt = debtRows.filter((row) => row.status !== "resolved")
  const dueSoon = unresolvedDebt.filter((row) => {
    const dueDate = parseDateOnly(row.dueDate)
    if (!dueDate) return false
    const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
    return diffDays >= 0 && diffDays <= 14
  })

  return {
    generated_at: today.toISOString(),
    governance_exceptions: {
      active_count: exceptions.length,
      ids: exceptions.map((entry) => entry.id),
    },
    debt_register: {
      total_rows: debtRows.length,
      unresolved_count: unresolvedDebt.length,
      due_within_14_days: dueSoon.map((row) => ({
        id: row.id,
        path: row.path,
        due_date: row.dueDate,
        status: row.status,
      })),
    },
    generated_docs: {
      count: generatedDocs.length,
      files: generatedDocs,
    },
    precommit_strict: precommitSummary,
  }
}

function toMarkdown(report) {
  const lines = [
    "# Governance Trend Report",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Active governance exceptions: ${report.governance_exceptions.active_count}`,
    `- Debt register rows: ${report.debt_register.total_rows}`,
    `- Unresolved debt rows: ${report.debt_register.unresolved_count}`,
    `- Generated docs tracked: ${report.generated_docs.count}`,
    "",
    "## Generated Docs",
    "",
    ...report.generated_docs.files.map((file) => `- \`docs/reference/generated/${file}\``),
    "",
    "## Debt Due Within 14 Days",
    "",
  ]

  if (report.debt_register.due_within_14_days.length === 0) {
    lines.push("No unresolved debt due within 14 days.")
  } else {
    lines.push("| ID | Path | Due Date | Status |")
    lines.push("| --- | --- | --- | --- |")
    for (const row of report.debt_register.due_within_14_days) {
      lines.push(`| \`${row.id}\` | \`${row.path}\` | \`${row.due_date}\` | \`${row.status}\` |`)
    }
  }

  lines.push("")
  lines.push("## Pre-commit Strict Trend")
  lines.push("")
  if (!report.precommit_strict) {
    lines.push("No pre-commit strict metrics history available.")
  } else {
    lines.push(`- Total runs: ${report.precommit_strict.totalRuns}`)
    lines.push(`- Failed runs: ${report.precommit_strict.failedRuns}`)
    lines.push(`- Failed rate: ${(report.precommit_strict.failedRate * 100).toFixed(2)}%`)
    if (report.precommit_strict.lastRun) {
      lines.push(`- Last run timestamp: ${report.precommit_strict.lastRun.timestamp}`)
      lines.push(`- Last run status: ${report.precommit_strict.lastRun.status}`)
    }
  }

  lines.push("")
  return `${lines.join("\n")}`
}

function main() {
  const report = buildReport()
  ensureParent(OUTPUT_JSON)
  ensureParent(OUTPUT_MD)
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(OUTPUT_MD, `${toMarkdown(report)}\n`, "utf8")
  console.log(`[governance-trend-report] wrote ${OUTPUT_JSON} and ${OUTPUT_MD}`)
}

main()
