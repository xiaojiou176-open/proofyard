#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const SUMMARY_PATH = resolve(".runtime-cache/reports/mutation/latest-summary.json")

function fail(message) {
  console.error(`[release-mutation-sampling] ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const result = { scope: "core", threshold: 0.8 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--scope") {
      const value = argv[i + 1]
      if (!value) fail("Missing value for --scope.")
      result.scope = value
      i += 1
      continue
    }
    if (arg === "--threshold") {
      const value = argv[i + 1]
      if (!value) fail("Missing value for --threshold.")
      result.threshold = Number(value)
      i += 1
      continue
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/ci/release-mutation-sampling.mjs --scope core --threshold <0-1>"
      )
      process.exit(0)
    }
    fail(`Unknown argument: ${arg}`)
  }
  if (result.scope !== "core") {
    fail(`Unsupported scope '${result.scope}'. Only --scope core is supported.`)
  }
  if (!Number.isFinite(result.threshold) || result.threshold < 0 || result.threshold > 1) {
    fail("Invalid --threshold. Expect a number between 0 and 1.")
  }
  return result
}

function normalizeScore(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  if (raw < 0) return null
  if (raw <= 1) return raw
  if (raw <= 100) return raw / 100
  return null
}

function pickNormalizedFromObject(value) {
  if (!value || typeof value !== "object") return null
  const candidates = [value.effective, value.score]
  for (const candidate of candidates) {
    const normalized = normalizeScore(candidate)
    if (normalized !== null) return normalized
  }
  return null
}

function pickCoreScore(summary) {
  const directCandidates = [
    summary?.core,
    summary?.mutation?.core,
    summary?.coreScore,
  ]
  for (const candidate of directCandidates) {
    const normalized =
      typeof candidate === "object" ? pickNormalizedFromObject(candidate) : normalizeScore(candidate)
    if (normalized !== null) return normalized
  }

  const tsScore = pickNormalizedFromObject(summary?.ts)
  const pyScore = pickNormalizedFromObject(summary?.py)
  const values = [tsScore, pyScore].filter((value) => value !== null)
  if (values.length === 0) return null
  return Math.min(...values)
}

const { scope, threshold } = parseArgs(process.argv.slice(2))

if (!existsSync(SUMMARY_PATH)) {
  fail(`Mutation summary missing: ${SUMMARY_PATH}`)
}

let summary
try {
  summary = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"))
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  fail(`Mutation summary parse failed: ${reason}`)
}

const score = pickCoreScore(summary)
if (score === null) {
  fail(`No usable '${scope}' mutation score found in ${SUMMARY_PATH}`)
}

const scoreText = score.toFixed(3)
const thresholdText = threshold.toFixed(3)
if (score < threshold) {
  fail(
    `Gate failed for scope=${scope}: score=${scoreText} threshold=${thresholdText} summary=${SUMMARY_PATH}`
  )
}

console.log(
  `[release-mutation-sampling] Gate passed for scope=${scope}: score=${scoreText} threshold=${thresholdText}`
)
