#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

function parseArgs(argv) {
  const options = {
    layer: "",
    runId: "",
    out: "",
    decision: process.env.TRUE_GREEN_DECISION || "pending",
    reasonCodes: process.env.TRUE_GREEN_REASON_CODES || "gate.true_green.pending.manual_review",
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--layer" && next) options.layer = next
    if (token === "--run-id" && next) options.runId = next
    if (token === "--out" && next) options.out = next
    if (token === "--decision" && next) options.decision = next
    if (token === "--reason-codes" && next) options.reasonCodes = next
  }

  if (!options.layer) throw new Error("missing --layer")
  if (!options.runId) throw new Error("missing --run-id")
  if (!options.out) throw new Error("missing --out")
  return options
}

function readGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

function pickFirst(values, fallback) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return fallback
}

function parseDurationMinutes() {
  const raw =
    process.env.TRUE_GREEN_DURATION_MINUTES ||
    process.env.UIQ_DURATION_MINUTES ||
    process.env.CI_DURATION_MINUTES ||
    "0"
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

function parseReasonCodes(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (parts.length > 0) return parts
  return ["gate.true_green.pending.manual_review"]
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const absoluteOut = resolve(options.out)
  const commitSha = pickFirst(
    [
      process.env.GITHUB_SHA,
      process.env.CI_COMMIT_SHA,
      process.env.BUILD_SOURCEVERSION,
      readGit(["rev-parse", "HEAD"]),
    ],
    "unknown"
  )
  const branch = pickFirst(
    [
      process.env.GITHUB_HEAD_REF,
      process.env.GITHUB_REF_NAME,
      process.env.CI_COMMIT_REF_NAME,
      process.env.BUILD_SOURCEBRANCHNAME,
      process.env.BRANCH_NAME,
      readGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    ],
    "unknown"
  )

  const manifest = {
    schema_version: "1.0.0",
    run_id: options.runId,
    commit_sha: commitSha,
    branch,
    pipeline_layer: options.layer,
    decision: options.decision,
    reason_codes: parseReasonCodes(options.reasonCodes),
    duration_minutes: parseDurationMinutes(),
    artifacts: {
      manifest_path: absoluteOut,
      workspace_root: process.cwd(),
      related: [],
    },
    generated_at: new Date().toISOString(),
  }

  mkdirSync(dirname(absoluteOut), { recursive: true })
  writeFileSync(absoluteOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  console.log(`[generate-true-green-manifest] wrote ${absoluteOut}`)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[generate-true-green-manifest] error: ${message}`)
  process.exit(2)
}
