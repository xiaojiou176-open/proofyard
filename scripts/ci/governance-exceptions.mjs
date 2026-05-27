#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolveRepoRoot()
const DEFAULT_EXCEPTIONS_PATH = resolveFromRepo("scripts/ci/governance-exceptions.json")
const DEFAULT_DEBT_REGISTER_PATH = resolveFromRepo("configs/governance/debt-register.md")
const OWNER_ROLES = new Set([
  "platform-owner",
  "automation-owner",
  "frontend-owner",
  "backend-owner",
  "docs-owner",
])
const DEBT_TYPES = new Set(["gate_failure", "doc_script_drift", "test_gap"])

function resolveRepoRoot() {
  const currentFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFile), "..", "..")
}

function resolveFromRepo(relativePath) {
  return path.resolve(repoRoot, relativePath)
}

export function normalizeRepoPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function parseDateOnly(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null
  const date = new Date(`${dateText}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date, days) {
  const next = new Date(date.getTime())
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function parseDebtRegister(markdownText) {
  const rows = new Map()
  for (const rawLine of markdownText.split(/\r?\n/)) {
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
    rows.set(id, {
      id,
      type,
      path: normalizeRepoPath(targetPath),
      risk,
      owner_role: ownerRole,
      due_date: dueDate,
      exit_criteria: exitCriteria,
      status,
    })
  }
  return rows
}

function validateDebtRegisterRows(rows) {
  const failures = []
  if (rows.size === 0) {
    failures.push("debt register must contain at least one example or active row")
    return failures
  }
  for (const row of rows.values()) {
    if (!row.id) failures.push("debt register row missing ID")
    if (!DEBT_TYPES.has(row.type)) {
      failures.push(`debt register row '${row.id}' has an invalid type '${row.type}'`)
    }
    if (!row.path) failures.push(`debt register row '${row.id}' is missing a path`)
    if (!row.risk) failures.push(`debt register row '${row.id}' is missing a risk value`)
    if (!OWNER_ROLES.has(row.owner_role)) {
      failures.push(`debt register row '${row.id}' has invalid owner_role '${row.owner_role}'`)
    }
    if (!parseDateOnly(row.due_date)) {
      failures.push(`debt register row '${row.id}' has an invalid due_date '${row.due_date}'`)
    }
    if (!row.exit_criteria) {
      failures.push(`debt register row '${row.id}' is missing exit_criteria`)
    }
    if (!row.status) failures.push(`debt register row '${row.id}' is missing status`)
  }
  return failures
}

function validateExceptionEntry(entry, index, debtRows, today, maxExpiry) {
  const prefix = `exception[${index}]`
  const requiredKeys = ["id", "gate", "path", "reason", "owner_role", "expires_on", "debt_ref"]
  const failures = []

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return [`${prefix} must be an object`]
  }

  for (const key of requiredKeys) {
    const value = entry[key]
    if (typeof value !== "string" || value.trim() === "") {
      failures.push(`${prefix}.${key} must be a non-empty string`)
    }
  }

  const ownerRole = String(entry.owner_role ?? "").trim()
  if (ownerRole && !OWNER_ROLES.has(ownerRole)) {
    failures.push(`${prefix}.owner_role must be one of ${Array.from(OWNER_ROLES).join(", ")}`)
  }

  const expiresOn = String(entry.expires_on ?? "").trim()
  const expiryDate = parseDateOnly(expiresOn)
  if (!expiryDate) {
    failures.push(`${prefix}.expires_on must use YYYY-MM-DD`)
  } else {
    if (expiryDate < today) {
      failures.push(`${prefix}.expires_on ${expiresOn} is in the past`)
    }
    if (expiryDate > maxExpiry) {
      failures.push(
        `${prefix}.expires_on ${expiresOn} exceeds 14-day window (max ${toDateOnly(maxExpiry)})`
      )
    }
  }

  const debtRef = String(entry.debt_ref ?? "").trim()
  const debtRow = debtRows.get(debtRef)
  if (debtRef && !debtRow) {
    failures.push(`${prefix}.debt_ref ${debtRef} is missing from configs/governance/debt-register.md`)
  } else if (debtRow) {
    if (!debtRow.exit_criteria) {
      failures.push(`${prefix}.debt_ref ${debtRef} must reference a row with exit_criteria`)
    }
    if (debtRow.owner_role !== ownerRole) {
      failures.push(
        `${prefix}.owner_role ${ownerRole} must match debt register owner_role ${debtRow.owner_role}`
      )
    }
  }

  return failures
}

export function loadGovernanceExceptions(options = {}) {
  const exceptionsPath = path.resolve(
    repoRoot,
    options.exceptionsPath || process.env.UIQ_GOVERNANCE_EXCEPTIONS_PATH || DEFAULT_EXCEPTIONS_PATH
  )
  const debtRegisterPath = path.resolve(
    repoRoot,
    options.debtRegisterPath || process.env.UIQ_DEBT_REGISTER_PATH || DEFAULT_DEBT_REGISTER_PATH
  )
  const today = parseDateOnly(options.today || process.env.UIQ_GOVERNANCE_TODAY || toDateOnly(new Date()))
  const maxExpiry = addDays(today, 14)
  const failures = []

  if (!fs.existsSync(exceptionsPath)) {
    failures.push(`missing governance exceptions file: ${path.relative(repoRoot, exceptionsPath)}`)
  }
  if (!fs.existsSync(debtRegisterPath)) {
    failures.push(`missing debt register file: ${path.relative(repoRoot, debtRegisterPath)}`)
  }
  if (failures.length > 0) {
    const error = new Error(failures.join("\n"))
    error.failures = failures
    throw error
  }

  const payload = readJsonFile(exceptionsPath)
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const error = new Error("governance exceptions file must be a JSON object")
    error.failures = ["governance exceptions file must be a JSON object"]
    throw error
  }
  if (payload.schemaVersion !== 1) {
    const error = new Error("governance exceptions file must declare schemaVersion=1")
    error.failures = ["governance exceptions file must declare schemaVersion=1"]
    throw error
  }
  if (!Array.isArray(payload.exceptions)) {
    const error = new Error("governance exceptions file must provide an exceptions array")
    error.failures = ["governance exceptions file must provide an exceptions array"]
    throw error
  }

  const debtRows = parseDebtRegister(fs.readFileSync(debtRegisterPath, "utf8"))
  failures.push(...validateDebtRegisterRows(debtRows))
  const seenIds = new Set()
  for (let index = 0; index < payload.exceptions.length; index += 1) {
    const entry = payload.exceptions[index]
    for (const failure of validateExceptionEntry(entry, index, debtRows, today, maxExpiry)) {
      failures.push(failure)
    }
    const id = String(entry?.id ?? "").trim()
    if (id) {
      if (seenIds.has(id)) failures.push(`duplicate governance exception id: ${id}`)
      seenIds.add(id)
    }
  }

  if (failures.length > 0) {
    const error = new Error(failures.join("\n"))
    error.failures = failures
    throw error
  }

  return payload.exceptions.map((entry) => ({
    ...entry,
    gate: String(entry.gate).trim(),
    path: normalizeRepoPath(entry.path),
    reason: String(entry.reason).trim(),
    owner_role: String(entry.owner_role).trim(),
    debt_ref: String(entry.debt_ref).trim(),
    expires_on: String(entry.expires_on).trim(),
  }))
}

export function findGovernanceException(exceptions, gate, targetPath) {
  const normalizedPath = normalizeRepoPath(targetPath)
  return (
    exceptions.find(
      (entry) => entry.gate === gate && normalizeRepoPath(entry.path) === normalizedPath
    ) || null
  )
}

function main() {
  try {
    const exceptions = loadGovernanceExceptions()
    console.log(
      `[governance-exceptions] pass: ${exceptions.length} exception(s) validated against debt register`
    )
  } catch (error) {
    const failures = Array.isArray(error?.failures)
      ? error.failures
      : String(error?.message || error).split("\n")
    console.error("[governance-exceptions] failed")
    for (const failure of failures.filter(Boolean)) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
