#!/usr/bin/env node

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import {
  findGovernanceException,
  loadGovernanceExceptions,
  normalizeRepoPath,
} from "./governance-exceptions.mjs"

const LINE_LIMIT = 800
const CODE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".jsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
])
const LOCKFILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "uv.lock",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
])
const GENERATED_DIR_NAMES = new Set([
  ".runtime-cache",
  "artifacts",
  "dist",
  "build",
  "coverage",
  "node_modules",
  ".next",
  "out",
  "api-gen",
])

function normalizeToPosix(filePath) {
  return filePath.replaceAll(path.sep, "/")
}

function listTrackedFiles() {
  try {
    const output = execSync("git ls-files -z", {
      stdio: ["ignore", "pipe", "ignore"],
    })
    return output
      .toString("utf8")
      .split("\u0000")
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function shouldSkip(filePath) {
  const normalized = normalizeToPosix(filePath)
  const baseName = path.basename(normalized)
  const ext = path.extname(normalized).toLowerCase()
  const parts = normalized.split("/")

  if (!CODE_EXTENSIONS.has(ext)) {
    return true
  }
  if (LOCKFILES.has(baseName)) {
    return true
  }
  if (normalized.startsWith(".codex/") || normalized.includes("/.codex/")) {
    return true
  }
  if (normalized.startsWith("docs/") || normalized.includes("/docs/")) {
    return true
  }
  if (normalized.includes("/tests/") || normalized.startsWith("tests/")) {
    return true
  }
  if (/\.test\.[^/]+$/i.test(baseName)) {
    return true
  }
  if (normalized.includes("/styles/css/") || normalized.endsWith(".css")) {
    return true
  }
  if (/openapi\/.*\.ya?ml$/i.test(normalized) || /openapi.*\.ya?ml$/i.test(baseName)) {
    return true
  }
  if (normalized.includes("/api-gen/") || normalized.startsWith("api-gen/")) {
    return true
  }
  for (const part of parts) {
    if (GENERATED_DIR_NAMES.has(part)) {
      return true
    }
  }
  return false
}

function countLines(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  return content.split(/\r?\n/).length
}

function main() {
  const governanceExceptions = loadGovernanceExceptions()
  const trackedFiles = listTrackedFiles()
  if (trackedFiles.length === 0) {
    console.error("[firstparty-file-length] failed: unable to read tracked files via git")
    process.exit(1)
  }

  const violations = []
  const waived = []

  for (const filePath of trackedFiles) {
    if (shouldSkip(filePath)) {
      continue
    }
    const normalized = normalizeRepoPath(filePath)
    const exception = findGovernanceException(
      governanceExceptions,
      "firstparty-file-length",
      normalized
    )
    if (exception) {
      waived.push({ file: normalized, debtRef: exception.debt_ref, expiresOn: exception.expires_on })
      continue
    }
    const lines = countLines(filePath)
    if (lines > LINE_LIMIT) {
      violations.push({ file: normalized, lines })
    }
  }

  if (violations.length === 0) {
    console.log(
      `[firstparty-file-length] pass: no first-party business code file exceeds ${LINE_LIMIT} lines`
    )
    if (waived.length > 0) {
      console.log(`[firstparty-file-length] active exceptions=${waived.length}`)
    }
    process.exit(0)
  }

  violations.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
  console.error(
    `[firstparty-file-length] failed: ${violations.length} file(s) exceed ${LINE_LIMIT} lines (active_exceptions=${waived.length})`
  )
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.lines} lines`)
  }
  for (const entry of waived) {
    console.log(
      `[firstparty-file-length][excepted] ${entry.file} debt_ref=${entry.debtRef} expires_on=${entry.expiresOn}`
    )
  }
  process.exit(1)
}

main()
