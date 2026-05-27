#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const args = new Set(process.argv.slice(2))

const SOURCE_CONFIG_PATH = "configs/upstream/source.yaml"
const PACKAGE_JSON_PATH = "package.json"
const PR_WORKFLOW_PATH = ".github/workflows/pr.yml"
const DRIFT_WORKFLOW_PATH = ".github/workflows/upstream-drift-audit.yml"
const SCORE_REPORT_PATH = "scripts/ci/governance-score-report.mjs"

const failures = []
const sourceConfig = readRepoText(SOURCE_CONFIG_PATH)
const repoUpstreamMode = readYamlScalar(sourceConfig, "mode") ?? ""
const repoUpstreamBranch = readYamlScalar(sourceConfig, "branch") ?? "main"
const repoUpstreamApplicability = repoUpstreamMode === "none" ? "n/a" : "enabled"

if (!["explicit", "none"].includes(repoUpstreamMode)) {
  failures.push(`unsupported repo-level upstream mode: ${JSON.stringify(repoUpstreamMode)}`)
}

const packageJson = readRepoJson(PACKAGE_JSON_PATH)
if (packageJson.scripts?.["upstream:mode:check"] !== "node scripts/ci/check-upstream-mode-consistency.mjs") {
  failures.push("package.json must register upstream:mode:check -> node scripts/ci/check-upstream-mode-consistency.mjs")
}

const prWorkflow = readRepoText(PR_WORKFLOW_PATH)
requireIncludes(
  PR_WORKFLOW_PATH,
  prWorkflow,
  "upstream-mode-check:",
  "PR workflow must define an upstream-mode-check job"
)
requireIncludes(
  PR_WORKFLOW_PATH,
  prWorkflow,
  "node scripts/ci/check-upstream-mode-consistency.mjs --github-output",
  "PR workflow must run the upstream mode consistency checker"
)
requireIncludes(
  PR_WORKFLOW_PATH,
  prWorkflow,
  "needs.upstream-mode-check.outputs.repo_upstream_mode != 'none'",
  "PR workflow must skip upstream-binding-check when repo-level upstream mode is none"
)

const driftWorkflow = readRepoText(DRIFT_WORKFLOW_PATH)
requireIncludes(
  DRIFT_WORKFLOW_PATH,
  driftWorkflow,
  "node scripts/ci/check-upstream-mode-consistency.mjs --github-output --summary",
  "upstream drift audit must derive applicability from the shared mode consistency checker"
)
requireIncludes(
  DRIFT_WORKFLOW_PATH,
  driftWorkflow,
  "steps.applicability.outputs.repo_upstream_mode != 'none'",
  "upstream drift audit must skip repo-level drift blocking when mode is none"
)

const scoreReport = readRepoText(SCORE_REPORT_PATH)
requireIncludes(
  SCORE_REPORT_PATH,
  scoreReport,
  "const upstreamMode = readUpstreamMode()",
  "governance score report must read the repo-level upstream mode from source-of-truth"
)
requireIncludes(
  SCORE_REPORT_PATH,
  scoreReport,
  "repo-level upstream binding is intentionally N/A because configs/upstream/source.yaml sets mode:none",
  "governance score report must mark repo-level upstream binding as N/A when mode is none"
)
requireIncludes(
  SCORE_REPORT_PATH,
  scoreReport,
  "repo_upstream_binding_applicability",
  "governance score report payload must expose repo-level upstream applicability"
)

if (failures.length > 0) {
  console.error("[upstream-mode-consistency] failed:")
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

if (args.has("--github-output")) {
  writeGithubOutput("repo_upstream_mode", repoUpstreamMode)
  writeGithubOutput("repo_upstream_applicability", repoUpstreamApplicability)
  writeGithubOutput("repo_upstream_branch", repoUpstreamBranch)
}

if (args.has("--summary")) {
  writeSummary(repoUpstreamMode, repoUpstreamApplicability)
}

console.log(
  `[upstream-mode-consistency] ok mode=${repoUpstreamMode} applicability=${repoUpstreamApplicability} branch=${repoUpstreamBranch}`
)

function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function readRepoJson(relativePath) {
  return JSON.parse(readRepoText(relativePath))
}

function readYamlScalar(raw, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = raw.match(new RegExp(`^${escapedKey}\\s*:\\s*(.+)$`, "m"))
  return match?.[1]?.trim() ?? null
}

function requireIncludes(relativePath, content, needle, failure) {
  if (!content.includes(needle)) {
    failures.push(`${failure} (${relativePath} missing ${JSON.stringify(needle)})`)
  }
}

function writeGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) return
  fs.appendFileSync(outputPath, `${name}=${value}\n`, "utf8")
}

function writeSummary(mode, applicability) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  const lines =
    mode === "none"
      ? [
          "## Repo-Level Upstream Mode",
          "- repo-level upstream applicability: `N/A`",
          "- reason: `configs/upstream/source.yaml` is set to `mode: none`",
          "- result: repo-level upstream binding and drift blocking stay skipped; third-party upstream governance remains active",
        ]
      : [
          "## Repo-Level Upstream Mode",
          `- repo-level upstream applicability: \`${applicability}\``,
          `- mode: \`${mode}\``,
          "- result: repo-level upstream binding remains required",
        ]
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`, "utf8")
}
