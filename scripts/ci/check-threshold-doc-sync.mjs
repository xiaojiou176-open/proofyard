#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const PROFILE_SCHEMA_PATH = resolve(process.cwd(), "configs/schemas/profile.v1.schema.json")

function loadThresholdKeysFromSchema() {
  const schema = JSON.parse(readFileSync(PROFILE_SCHEMA_PATH, "utf8"))
  const topLevelKeys = ["geminiAccuracyMin", "geminiParallelConsistencyMin", "geminiSampleSizeMin"]
  const gateKeys = Object.keys(schema?.properties?.gates?.properties ?? {})
  return [...new Set([...topLevelKeys, ...gateKeys])]
}

const THRESHOLD_KEYS = loadThresholdKeysFromSchema()

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim()
  } catch (error) {
    if (allowFailure) return ""
    throw error
  }
}

function appendSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { encoding: "utf8" })
  } catch {
    // ignore summary rendering failures
  }
}

function main() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    console.log("[threshold-doc-sync] skipped: not a pull_request event")
    process.exit(0)
  }

  const baseRef = process.env.GITHUB_BASE_REF || "main"
  const baseRemoteRef = `origin/${baseRef}`
  runGit(["fetch", "--no-tags", "--depth=200", "origin", baseRef])

  const changedFiles = runGit(["diff", "--name-only", `${baseRemoteRef}...HEAD`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const profileYamlFiles = changedFiles.filter(
    (file) => file.startsWith("configs/profiles/") && file.endsWith(".yaml")
  )
  if (profileYamlFiles.length === 0) {
    console.log("[threshold-doc-sync] no profile yaml changed")
    appendSummary([
      "### Threshold Governance",
      "- Status: pass",
      "- Detail: No `configs/profiles/*.yaml` changes detected.",
    ])
    process.exit(0)
  }

  const profileDiff = runGit(
    ["diff", "--unified=0", `${baseRemoteRef}...HEAD`, "--", ...profileYamlFiles],
    { allowFailure: true }
  )
  const thresholdChanged = profileDiff
    .split("\n")
    .filter((line) => /^[+-](?![+-])/.test(line))
    .some((line) => THRESHOLD_KEYS.some((key) => line.includes(`${key}:`)))

  if (!thresholdChanged) {
    console.log("[threshold-doc-sync] profile yaml changed, but no gate threshold key changed")
    appendSummary([
      "### Threshold Governance",
      "- Status: pass",
      "- Detail: Profile changes detected but no gate-threshold key updates.",
    ])
    process.exit(0)
  }

  const docsTouched = changedFiles.includes("docs/quality-gates.md")
  if (!docsTouched) {
    console.error(
      "[threshold-doc-sync] failed: threshold keys changed but docs/quality-gates.md was not updated"
    )
    appendSummary([
      "### Threshold Governance",
      "- Status: fail",
      "- Detail: Gate threshold keys changed in `configs/profiles/*.yaml` but `docs/quality-gates.md` was not updated.",
    ])
    process.exit(2)
  }

  console.log("[threshold-doc-sync] pass: threshold keys changed and docs/quality-gates.md updated")
  appendSummary([
    "### Threshold Governance",
    "- Status: pass",
    "- Detail: Threshold keys changed and `docs/quality-gates.md` was updated.",
  ])
}

main()
