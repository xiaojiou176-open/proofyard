#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {
  currentGovernanceArtifactPath,
  currentGovernanceArtifactRoot,
  governanceRunId,
  loadGovernanceControlPlane,
  renderTable,
  writeRepoText,
} from "./lib/governance-control-plane.mjs"

const repoRoot = process.cwd()
const artifactRoot = path.join(repoRoot, currentGovernanceArtifactRoot())
const jsonOutput = currentGovernanceArtifactPath("governance-score-report.json")
const mdOutput = currentGovernanceArtifactPath("governance-score-report.md")

const {
  rootAllowlist,
  runtimeRegistry,
  runtimeLivePolicy,
  logSchema,
  moduleBoundaries,
  dependencyBaselines,
  upstreamRegistry,
  upstreamCompatMatrix,
  upstreamCustomizations,
} = loadGovernanceControlPlane()

const finalGateProof = readRequiredJson("governance-final-gate.json")
const backendLogSample = readRequiredJson("log-contract-backend.sample.json")
const mcpLogSample = readRequiredJson("log-contract-mcp.sample.json")
const entrypointLogSample = readRequiredJson("log-contract-entrypoint.sample.json")
const coldCacheReport = readRequiredJson("cold-cache-recovery.json")
const requiredFlowsReport = readRequiredJson("governance-required-flows.json")
const runtimeReachabilityReport = readRequiredJson("runtime-reachability.json")
const legacySurfaceScan = scanLegacySurfaces()
const gateMode = finalGateProof.mode ?? "control-plane"
const repoTruthMode = gateMode === "repo-truth"
const truthScope =
  finalGateProof.truth_scope ?? (repoTruthMode ? "overall-repo-truth" : "internal-control-plane")
const overallTruthClaimable = finalGateProof.overall_truth_claimable ?? repoTruthMode
const scoreLabel = repoTruthMode ? "repo_truth_scope_score" : "internal_control_plane_score"
const upstreamMode = readUpstreamMode()
const scoreInterpretation = repoTruthMode
  ? "This score reflects the gate-covered repo-truth scope only. It is not a final maturity score, a safe-open-source certification, or a release-grade proof claim."
  : "This score reflects the internal governance control-plane only and does not claim overall repo readiness."

ensureRunProof("governance-final-gate", finalGateProof.status === "passed")
ensureRunProof("backend-log-sample", backendLogSample.valid === true)
ensureRunProof("mcp-log-sample", mcpLogSample.valid === true)
ensureRunProof("entrypoint-log-sample", entrypointLogSample.valid === true)
ensureRunProof("cold-cache-recovery", coldCacheReport.status === "passed")
ensureRunProof("governance-required-flows", requiredFlowsReport.status === "passed")
ensureRunProof("runtime-reachability", runtimeReachabilityReport.status === "passed")

for (const stepId of [
  "root_governance",
  "worktree_hygiene",
  "runtime_governance",
  "runtime_live_inventory",
  "runtime_size_budgets",
  "path_drift_governance",
  "log_governance",
  "runtime_reachability",
  "module_boundaries",
  "public_surface_boundaries",
  "dependency_governance",
  "upstream_governance",
  "upstream_binding_local",
  "cold_cache_recovery",
  "governance_required_flows",
]) {
  ensureRunProof(
    `${stepId}-step`,
    finalGateProof.steps.some((step) => step.step_id === stepId && step.status === "passed")
  )
}

if (repoTruthMode) {
  for (const stepId of ["public_readiness", "release_supply_chain", "mainline_alignment"]) {
    ensureRunProof(`${stepId}-step`, hasPassedStep(stepId))
  }
}

const snapshots = {
  root: scoreRoot(),
  runtime: scoreRuntime(),
  logging: scoreLogging(),
  architecture: scoreArchitecture(),
  upstream: scoreUpstream(),
}

if (repoTruthMode) {
  snapshots.public_truth = scorePublicTruth()
  snapshots.execution_truth = scoreExecutionTruth()
}

const totalRaw = Object.values(snapshots).reduce((sum, item) => sum + item.score, 0)
const totalMax = Object.values(snapshots).reduce((sum, item) => sum + item.max, 0)
const normalized = Number(((totalRaw / totalMax) * 100).toFixed(1))

const payload = {
  run_id: governanceRunId,
  generatedAt: new Date().toISOString(),
  scope: {
    mode: gateMode,
    truth_scope: truthScope,
    repo_upstream_mode: upstreamMode,
    repo_upstream_binding_applicability: upstreamMode === "none" ? "n/a" : "required",
    required_flows_profile:
      finalGateProof.required_flows_profile ?? requiredFlowsReport.profile ?? null,
    overall_truth_claimable: overallTruthClaimable,
    score_label: scoreLabel,
    score_interpretation: scoreInterpretation,
  },
  total: {
    raw: totalRaw,
    max: totalMax,
    normalized,
    label: scoreLabel,
  },
  dimensions: snapshots,
  layers: finalGateProof.layers ?? null,
  proof: {
    finalGatePassed: finalGateProof.status === "passed",
    backendLogSampleValid: backendLogSample.valid === true,
    mcpLogSampleValid: mcpLogSample.valid === true,
    entrypointLogSampleValid: entrypointLogSample.valid === true,
    coldCacheRecoveryPassed: coldCacheReport?.status === "passed",
    requiredFlowsPassed: requiredFlowsReport?.status === "passed",
    runtimeReachabilityPassed: runtimeReachabilityReport?.status === "passed",
    legacySurfaceCount: legacySurfaceScan.count,
    legacySurfaceSample: legacySurfaceScan.sample,
    repoTruthLayersIncluded: repoTruthMode,
  },
}

fs.mkdirSync(artifactRoot, { recursive: true })
fs.writeFileSync(path.join(repoRoot, jsonOutput), `${JSON.stringify(payload, null, 2)}\n`, "utf8")
writeRepoText(mdOutput, renderMarkdownReport(payload))

console.log(`[governance-score-report] run_id=${governanceRunId}`)
console.log(`[governance-score-report] wrote ${jsonOutput}`)
console.log(`[governance-score-report] normalized=${normalized}`)

if (normalized !== 100) {
  process.exitCode = 1
}

function readRequiredJson(fileName) {
  const absPath = path.join(artifactRoot, fileName)
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"))
  } catch {
    throw new Error(`missing fresh governance proof: ${currentGovernanceArtifactPath(fileName)}`)
  }
}

function ensureRunProof(name, ok) {
  if (!ok) {
    throw new Error(`governance proof invalid for current run (${governanceRunId}): ${name}`)
  }
}

function hasPassedStep(stepId) {
  return finalGateProof.steps.some((step) => step.step_id === stepId && step.status === "passed")
}

function layerPassed(layerId) {
  return finalGateProof.layers?.[layerId]?.status === "passed"
}

function scoreRoot() {
  const ok =
    rootAllowlist.mode === "strict-hallway" &&
    !(rootAllowlist.allowedLocalRuntimeRoots ?? []).includes(".venv") &&
    !(rootAllowlist.allowedLocalRuntimeRoots ?? []).includes("node_modules") &&
    (rootAllowlist.requiredDocs?.length ?? 0) >= 10 &&
    hasPassedStep("root_governance") &&
    hasPassedStep("worktree_hygiene")
  return finalizeDimension(ok ? 10 : 0, 10, [
    "strict hallway contract enabled",
    "root local runtime roots exclude .venv and node_modules",
    "required governance docs are exhaustive",
    "current-run root governance proof exists",
    "current-run worktree hygiene proof exists",
  ])
}

function scoreRuntime() {
  const ok =
    runtimeRegistry.managedBuckets.length === (runtimeLivePolicy.allowedBuckets?.length ?? -1) &&
    hasPassedStep("runtime_governance") &&
    hasPassedStep("runtime_live_inventory") &&
    hasPassedStep("runtime_size_budgets") &&
    coldCacheReport?.status === "passed"
  return finalizeDimension(ok ? 20 : 0, 20, [
    "runtime registry and live policy are aligned",
    "current-run runtime governance proof exists",
    "current-run runtime live inventory proof exists",
    "current-run runtime size budget proof exists",
    "current-run cold-cache recovery proof exists",
  ])
}

function scoreLogging() {
  const ok =
    logSchema.required.includes("service") &&
    logSchema.required.includes("source_kind") &&
    backendLogSample.valid === true &&
    mcpLogSample.valid === true &&
    entrypointLogSample.valid === true &&
    hasPassedStep("log_governance")
  return finalizeDimension(ok ? 20 : 0, 20, [
    "log envelope schema includes service and source_kind",
    "backend sample matches current schema",
    "mcp sample matches current schema",
    "entrypoint sample matches current schema",
    "current-run logging governance proof exists",
  ])
}

function scoreArchitecture() {
  const ok =
    moduleBoundaries.responsibilityMap.length >= 6 &&
    (moduleBoundaries.publicSurfacePackages?.length ?? 0) >= 2 &&
    hasPassedStep("module_boundaries") &&
    hasPassedStep("public_surface_boundaries") &&
    hasPassedStep("dependency_governance") &&
    (dependencyBaselines.manifests?.length ?? 0) >= 4
  return finalizeDimension(ok ? 30 : 0, 30, [
    "root responsibility map is explicit",
    "public surface packages are explicit",
    "current-run module-boundary proof exists",
    "current-run public-surface proof exists",
    "current-run dependency governance proof exists",
  ])
}

function scoreUpstream() {
  const registryOk =
    upstreamRegistry.entries.length >= 10 &&
    upstreamRegistry.entries.every(
      (entry) => entry.contract_kind && entry.required_proof && entry.status === "active"
    ) &&
    upstreamCompatMatrix.groups.every((group) => group.requiredProofArtifact) &&
    hasPassedStep("upstream_governance") &&
    Array.isArray(upstreamCustomizations.customizations) &&
    legacySurfaceScan.count === 0
  if (upstreamMode === "none") {
    return finalizeDimension(registryOk ? 10 : 0, 10, [
      "repo-level upstream binding is intentionally N/A because configs/upstream/source.yaml sets mode:none",
      "third-party upstream registry governance remains active",
      "compat groups declare proof artifacts",
      "current-run upstream governance proof exists",
      "upstream customization registry is machine-owned",
      "no active legacy governance surfaces detected",
    ])
  }
  const ok = registryOk && hasPassedStep("upstream_binding_local")
  return finalizeDimension(ok ? 20 : 0, 20, [
    "active external surfaces are registered",
    "compat groups declare proof artifacts",
    "current-run upstream governance proof exists",
    "current-run upstream binding proof exists",
    "upstream customization registry is machine-owned",
    "no active legacy governance surfaces detected",
  ])
}

function scorePublicTruth() {
  const ok = layerPassed("public_readiness") && layerPassed("release_truth")
  return finalizeDimension(ok ? 20 : 0, 20, [
    "public/open-source readiness layer passed",
    "release truth layer passed",
    "public collaboration surface is checked",
    "public redaction surface is checked",
    "public history-sensitive surface is checked",
    "tracked heavy public artifacts are checked",
    "contribution rights policy surface is checked",
    "deep public-preview readiness surface is checked",
  ])
}

function scoreExecutionTruth() {
  const ok =
    requiredFlowsReport?.status === "passed" &&
    requiredFlowsReport?.profile === "full" &&
    requiredFlowsReport?.profile_kind === "repo-truth" &&
    requiredFlowsReport?.overall_truth_claimable === true &&
    requiredFlowsReport?.steps?.some(
      (step) => step.step_id === "mainline_alignment" && step.status === "passed"
    ) &&
    finalGateProof.required_flows_profile === "full" &&
    layerPassed("mainline_alignment") &&
    finalGateProof.layers?.required_flows?.profile_kind === "repo-truth"
  return finalizeDimension(ok ? 20 : 0, 20, [
    "required flows report passed",
    "required flows profile is full",
    "required flows report is marked as repo-truth",
    "required flows report is claimable for overall truth",
    "required flows report includes mainline alignment proof",
    "final gate required-flows profile is full",
    "final gate mainline alignment layer passed",
  ])
}

function scanLegacySurfaces() {
  const scanRoots = [
    "SECURITY.md",
    "docs",
    "scripts",
    "packages",
    "apps",
    "justfile",
    "package.json",
    ".github",
  ]
  const lines = []
  for (const relativeRoot of scanRoots) {
    const absRoot = path.join(repoRoot, relativeRoot)
    if (!fs.existsSync(absRoot)) {
      continue
    }
    walk(absRoot)
  }
  return { count: lines.length, sample: lines.slice(0, 10) }

  function walk(absPath) {
    let stat
    try {
      stat = fs.statSync(absPath)
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return
      }
      throw error
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absPath)) {
        if (entry === ".runtime-cache" || entry === "node_modules" || entry === "__pycache__") {
          continue
        }
        walk(path.join(absPath, entry))
      }
      return
    }
    const relative = path.relative(repoRoot, absPath).replaceAll(path.sep, "/")
    if (
      relative.startsWith("docs/archive/") ||
      relative.includes("/node_modules/") ||
      relative.includes("/__pycache__/") ||
      relative.endsWith(".pyc") ||
      relative === "configs/governance/repo-map.json" ||
      relative === "docs/reference/generated/governance/repo-map.md" ||
      relative === "scripts/ci/governance-score-report.mjs" ||
      relative === "scripts/ci/check-runtime-governance.mjs" ||
      relative === "scripts/ci/check-upstream-governance.mjs"
    ) {
      return
    }
    let content = ""
    try {
      content = fs.readFileSync(absPath, "utf8")
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return
      }
      throw error
    }
    const patterns = [
      { label: "legacy-root frontend/", pattern: /(^|[\s`"'(=:])frontend\//gm },
      { label: "legacy-root backend/", pattern: /(^|[\s`"'(=:])backend\//gm },
      { label: "legacy-root automation/", pattern: /(^|[\s`"'(=:])automation\//gm },
      { label: "pnpm dlx curlconverter", pattern: /\bpnpm dlx curlconverter\b/gm },
      { label: "pnpm dlx har-to-k6", pattern: /\bpnpm dlx har-to-k6\b/gm },
      { label: ".runtime-cache/test_output", pattern: /\.runtime-cache\/test_output\b/gm },
      { label: ".runtime-cache/driver-smoke", pattern: /\.runtime-cache\/driver-smoke\b/gm },
      { label: ".runtime-cache/tmp", pattern: /\.runtime-cache\/tmp\b/gm },
    ]
    for (const entry of patterns) {
      entry.pattern.lastIndex = 0
      if (entry.pattern.test(content)) {
        lines.push(`${relative}: ${entry.label}`)
      }
    }
  }
}

function finalizeDimension(score, max, details) {
  return { score: Math.min(score, max), max, details }
}

function readUpstreamMode() {
  const raw = fs.readFileSync(path.join(repoRoot, "configs/upstream/source.yaml"), "utf8")
  const match = raw.match(/^mode:\s*(.+)$/m)
  return match?.[1]?.trim() ?? "explicit"
}

function renderMarkdownReport(payload) {
  const rows = Object.entries(payload.dimensions).map(([name, item]) => [
    `\`${name}\``,
    `${item.score} / ${item.max}`,
    item.details.join("; "),
  ])
  const layerRows = Object.entries(payload.layers ?? {}).map(([name, item]) => [
    `\`${name}\``,
    `\`${item.status}\``,
    item.profile
      ? `profile=${item.profile}; profile_kind=${item.profile_kind}`
      : (item.step_ids ?? []).join(", "),
  ])
  const title = payload.scope.overall_truth_claimable
    ? "# Repo Truth Scope Score Report"
    : "# Governance Control-Plane Score Report"
  const scopeNote = payload.scope.overall_truth_claimable
    ? "> This score only speaks for the gate-covered repo-truth scope in the current run. It must not be marketed as a final maturity score, a safe-open-source certification, or a release-grade proof claim."
    : "> This score only measures the internal governance control-plane. It must not be read as overall repo readiness."
  return [
    title,
    "",
    `Run ID: \`${payload.run_id}\``,
    `Generated at: \`${payload.generatedAt}\``,
    "",
    `Scope: \`${payload.scope.truth_scope}\``,
    `Repo Upstream Mode: \`${payload.scope.repo_upstream_mode}\``,
    `Repo Upstream Binding Applicability: \`${payload.scope.repo_upstream_binding_applicability}\``,
    `Score Label: \`${payload.total.label}\``,
    scopeNote,
    "",
    `Scoped Score: **${payload.total.normalized} / 100** (${payload.total.raw} / ${payload.total.max})`,
    "",
    renderTable(["Dimension", "Score", "Evidence"], rows),
    "",
    renderTable(["Layer", "Status", "Evidence"], layerRows),
    "",
  ].join("\n")
}
