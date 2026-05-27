#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { listTrackedFiles } from "./lib/tracked-sensitive-rules.mjs"

const repoRoot = process.cwd()
const failures = []
const ignoredExactFiles = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "uv.lock",
  "scripts/ci/check-repo-high-signal-pii.mjs",
  "scripts/ci/check-repo-high-signal-pii.test.mjs",
])
const ignoredPathFragments = [
  "/__snapshots__/",
]
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g
const creditCardPattern = /\b(?:\d[ -]?){13,19}\b/g

for (const relativePath of listTrackedFiles()) {
  if (ignoredExactFiles.has(relativePath)) continue
  if (ignoredPathFragments.some((fragment) => relativePath.includes(fragment))) continue

  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) continue

  const buffer = fs.readFileSync(absolutePath)
  if (buffer.includes(0)) continue

  const content = buffer.toString("utf8")
  collectPatternFailures(relativePath, content, emailPattern, isAllowedEmail, "email-like")
  collectPatternFailures(relativePath, content, ssnPattern, isAllowedSsn, "ssn-like")
  collectPatternFailures(relativePath, content, creditCardPattern, isAllowedCardLike, "credit-card-like")
}

if (failures.length > 0) {
  console.error("[repo-high-signal-pii] failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("[repo-high-signal-pii] ok")

function isAllowedEmail(value) {
  const lowered = value.toLowerCase()
  if (
    lowered.endsWith(".txt") ||
    lowered.endsWith(".md") ||
    lowered.endsWith(".json") ||
    lowered.endsWith(".yaml") ||
    lowered.endsWith(".yml") ||
    lowered.endsWith(".prompt")
  ) {
    return true
  }
  if (
    lowered.endsWith("@example.com") ||
    lowered.endsWith("@example.test") ||
    lowered.endsWith("@example.invalid")
  ) {
    return true
  }
  if (
    lowered.startsWith("support@") ||
    lowered.startsWith("security@") ||
    lowered.startsWith("contributors@") ||
    lowered.startsWith("maintainers@")
  ) {
    return true
  }
  if (lowered.includes("noreply")) {
    return true
  }
  return false
}

function isAllowedSsn(value) {
  return value === "000-00-0000"
}

function isAllowedCardLike(value) {
  const compact = value.replace(/[ -]/g, "")
  if (!/^\d{13,19}$/.test(compact)) {
    return true
  }
  if (
    compact === "4111111111111111" ||
    compact === "4242424242424242"
  ) {
    return true
  }
  return !passesLuhn(compact)
}

function collectPatternFailures(relativePath, content, pattern, isAllowed, label) {
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(content)) !== null) {
    const value = match[0]
    if (isAllowed(value)) continue
    const prefix = content.slice(0, match.index)
    const line = prefix.split(/\r?\n/).length
    failures.push(`${relativePath}:${line} contains high-signal ${label} value ${JSON.stringify(value)}`)
  }
}

function passesLuhn(value) {
  let sum = 0
  let doubleDigit = false
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index])
    if (Number.isNaN(digit)) return false
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}
