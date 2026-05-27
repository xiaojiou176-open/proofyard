#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { findGovernanceException, loadGovernanceExceptions } from "./governance-exceptions.mjs"

const CONFIG_PATH = resolve(
  process.env.UIQ_COVERAGE_CONFIG_PATH || "scripts/ci/coverage-sources.json"
)

function parseBooleanEnv(name, defaultValue) {
  const raw = process.env[name]
  if (raw === undefined || raw === null || raw === "") return defaultValue
  const normalized = String(raw).trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  console.error(`[coverage-gate] invalid ${name}=${raw}; expected true|false`)
  process.exit(2)
}

function pctFromMetrics({ pct, total, covered }) {
  const parsedTotal = Number(total)
  if (Number.isFinite(parsedTotal) && parsedTotal === 0) return 100
  const parsedPct = Number(pct)
  if (Number.isFinite(parsedPct)) return parsedPct
  const parsedCovered = Number(covered)
  if (Number.isFinite(parsedTotal) && Number.isFinite(parsedCovered) && parsedTotal > 0) {
    return (parsedCovered / parsedTotal) * 100
  }
  return 0
}

function normalizeRepoRelativePath(pathname) {
  const normalized = String(pathname || "").replaceAll("\\", "/")
  if (!normalized) return ""
  if (normalized.startsWith("/")) {
    return relative(process.cwd(), normalized).replaceAll("\\", "/")
  }
  return normalized.replace(/^\.\//, "")
}

function ensureExists(pathname, label) {
  if (!existsSync(pathname)) {
    console.error(`[coverage-gate] missing ${label}: ${pathname}`)
    process.exit(2)
  }
}

function loadConfig() {
  ensureExists(CONFIG_PATH, "coverage config")
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
}

function normalizeSourceNames(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []
}

function sourcePath(source) {
  const envName = String(source.env || "").trim()
  if (envName && process.env[envName]) {
    return resolve(process.env[envName])
  }
  return resolve(process.cwd(), source.path)
}

function matchesPathPatterns(pathname, patterns = []) {
  return patterns.some((pattern) => pathname === pattern || pathname.startsWith(pattern))
}

function matchesSource(pathname, source) {
  const prefixes = Array.isArray(source?.prefixes) ? source.prefixes : []
  const excludes = Array.isArray(source?.excludes) ? source.excludes : []
  return matchesPathPatterns(pathname, prefixes) && !matchesPathPatterns(pathname, excludes)
}

function parsePytestJson(pathname, source) {
  const raw = JSON.parse(readFileSync(pathname, "utf8"))
  const files = {}
  let totalStatements = 0
  let coveredStatements = 0
  let totalBranches = 0
  let coveredBranches = 0

  for (const [filePath, metrics] of Object.entries(raw?.files ?? {})) {
    const rel = normalizeRepoRelativePath(filePath)
    if (!matchesSource(rel, source)) continue
    files[rel] = metrics
    const summary = metrics?.summary ?? {}
    totalStatements += Number(summary?.num_statements ?? 0)
    coveredStatements += Number(summary?.covered_lines ?? 0)
    totalBranches += Number(summary?.num_branches ?? 0)
    coveredBranches += Number(summary?.covered_branches ?? 0)
  }

  return {
    files,
    global: {
      lines: pctFromMetrics({ total: totalStatements, covered: coveredStatements }),
      branches: pctFromMetrics({ total: totalBranches, covered: coveredBranches }),
    },
  }
}

function parseSummaryJson(pathname, source) {
  const raw = JSON.parse(readFileSync(pathname, "utf8"))
  const files = {}
  let totalLines = 0
  let coveredLines = 0
  let totalBranches = 0
  let coveredBranches = 0

  for (const [filePath, metrics] of Object.entries(raw ?? {})) {
    if (filePath === "total") continue
    const rel = normalizeRepoRelativePath(filePath)
    if (!matchesSource(rel, source)) continue
    files[rel] = metrics
    totalLines += Number(metrics?.lines?.total ?? 0)
    coveredLines += Number(metrics?.lines?.covered ?? 0)
    totalBranches += Number(metrics?.branches?.total ?? 0)
    coveredBranches += Number(metrics?.branches?.covered ?? 0)
  }

  return {
    files,
    global: {
      lines: pctFromMetrics({ total: totalLines, covered: coveredLines }),
      branches: pctFromMetrics({ total: totalBranches, covered: coveredBranches }),
    },
  }
}

function loadSourceCoverage(source) {
  const pathname = sourcePath(source)
  ensureExists(pathname, `${source.name} coverage`)
  if (source.kind === "pytest-json") {
    return parsePytestJson(pathname, source)
  }
  if (source.kind === "summary-json") {
    return parseSummaryJson(pathname, source)
  }
  console.error(`[coverage-gate] unsupported source kind '${source.kind}' for ${source.name}`)
  process.exit(2)
}

function findCoverage(result, target, sourceKind) {
  const relTarget = normalizeRepoRelativePath(target)
  for (const [filePath, metrics] of Object.entries(result.files)) {
    if (filePath !== relTarget && !filePath.endsWith(`/${relTarget}`)) continue
    if (sourceKind === "pytest-json") {
      const summary = metrics?.summary ?? {}
      return {
        file: filePath,
        lines: pctFromMetrics({
          pct: summary?.percent_covered ?? summary?.percent_statements_covered,
          total: summary?.num_statements,
          covered: summary?.covered_lines,
        }),
        branches: pctFromMetrics({
          pct: summary?.percent_branches_covered ?? summary?.percent_covered_branch,
          total: summary?.num_branches,
          covered: summary?.covered_branches,
        }),
        linesTotal: Number(summary?.num_statements ?? 0),
        branchesTotal: Number(summary?.num_branches ?? 0),
      }
    }
    return {
      file: filePath,
      lines: pctFromMetrics({
        pct: metrics?.lines?.pct,
        total: metrics?.lines?.total,
        covered: metrics?.lines?.covered,
      }),
      branches: pctFromMetrics({
        pct: metrics?.branches?.pct,
        total: metrics?.branches?.total,
        covered: metrics?.branches?.covered,
      }),
      linesTotal: Number(metrics?.lines?.total ?? 0),
      branchesTotal: Number(metrics?.branches?.total ?? 0),
    }
  }
  return null
}

function inferPreferredSource(target, config) {
  const relTarget = normalizeRepoRelativePath(target)
  return config.sources.find((source) => matchesSource(relTarget, source))?.name ?? null
}

function maybeExceptedFailure(failures, exception, failureText) {
  if (!exception) {
    failures.push(failureText)
    return
  }
  console.log(
    `[coverage-gate][excepted] ${failureText} debt_ref=${exception.debt_ref} expires_on=${exception.expires_on}`
  )
}

const config = loadConfig()
const governanceExceptions = loadGovernanceExceptions()
const GLOBAL_MIN = Number(process.env.UIQ_COVERAGE_GLOBAL_MIN ?? config.thresholds?.globalMin ?? 85)
const CORE_MIN = Number(process.env.UIQ_COVERAGE_CORE_MIN ?? config.thresholds?.coreMin ?? 95)
const GLOBAL_BRANCHES_MIN = Number(
  process.env.UIQ_COVERAGE_GLOBAL_BRANCHES_MIN ?? config.thresholds?.globalBranchesMin ?? 80
)
const COMPARISON_EPSILON = Number(
  process.env.UIQ_COVERAGE_COMPARISON_EPSILON ?? config.thresholds?.comparisonEpsilon ?? 0.05
)
const REQUIRE_CORE_NONZERO_BASIS = parseBooleanEnv("UIQ_COVERAGE_REQUIRE_CORE_NONZERO_BASIS", true)
const REQUIRE_CORE_BRANCH_DATA = parseBooleanEnv("UIQ_COVERAGE_REQUIRE_CORE_BRANCH_DATA", true)
const ENFORCE_GLOBAL_BRANCHES = parseBooleanEnv("UIQ_COVERAGE_ENFORCE_GLOBAL_BRANCHES", true)

if (!Number.isFinite(GLOBAL_MIN) || GLOBAL_MIN < 85) {
  console.error(`[coverage-gate] invalid UIQ_COVERAGE_GLOBAL_MIN=${GLOBAL_MIN}; must be >= 85`)
  process.exit(2)
}
if (!Number.isFinite(CORE_MIN) || CORE_MIN < 95) {
  console.error(`[coverage-gate] invalid UIQ_COVERAGE_CORE_MIN=${CORE_MIN}; must be >= 95`)
  process.exit(2)
}
if (!Number.isFinite(COMPARISON_EPSILON) || COMPARISON_EPSILON < 0 || COMPARISON_EPSILON > 1) {
  console.error(
    `[coverage-gate] invalid UIQ_COVERAGE_COMPARISON_EPSILON=${COMPARISON_EPSILON}; must be between 0 and 1`
  )
  process.exit(2)
}

const coverageSources = config.sources.map((source) => ({
  ...source,
  result: loadSourceCoverage(source),
}))

const globalGateSources = coverageSources.filter((item) => item.includeInGlobalGate === true)
if (globalGateSources.length === 0) {
  console.error("[coverage-gate] no coverage sources participate in the global gate")
  process.exit(2)
}
const expectedGlobalGateSources = normalizeSourceNames(
  config.globalBlockingSources ?? globalGateSources.map((item) => item.name)
)
const actualGlobalGateSources = globalGateSources.map((item) => item.name)
if (expectedGlobalGateSources.join("|") !== actualGlobalGateSources.join("|")) {
  console.error(
    `[coverage-gate] global source drift: expected=${expectedGlobalGateSources.join(",")} actual=${actualGlobalGateSources.join(",")}`
  )
  process.exit(2)
}

const blockingGlobalGateSources = globalGateSources.filter(
  (item) => !findGovernanceException(governanceExceptions, "coverage-global-source", item.name)
)
if (blockingGlobalGateSources.length === 0) {
  console.error("[coverage-gate] all global coverage sources are excepted; at least one blocking source is required")
  process.exit(2)
}

const globalLines = Math.min(...blockingGlobalGateSources.map((item) => item.result.global.lines))
const globalBranches = Math.min(...blockingGlobalGateSources.map((item) => item.result.global.branches))

const coreResults = []
for (const target of config.coreTargets ?? []) {
  const preferredSourceName = inferPreferredSource(target, config)
  const candidates = preferredSourceName
    ? coverageSources.filter((item) => item.name === preferredSourceName)
    : coverageSources
  let hit = null
  for (const source of candidates) {
    hit = findCoverage(source.result, target, source.kind)
    if (hit) break
  }
  if (!hit) {
    coreResults.push({
      file: target,
      missing: true,
      lines: 0,
      branches: 0,
      linesTotal: 0,
      branchesTotal: 0,
    })
    continue
  }
  coreResults.push({ ...hit, missing: false })
}

const failures = []

for (const source of coverageSources) {
  console.log(
    `[coverage-gate][source] ${source.name} lines=${source.result.global.lines.toFixed(2)}% branches=${source.result.global.branches.toFixed(2)}%`
  )
}
console.log(
  `[coverage-gate] configured global sources=${actualGlobalGateSources.join(",") || "<none>"}`
)
for (const source of globalGateSources) {
  const exception = findGovernanceException(governanceExceptions, "coverage-global-source", source.name)
  if (exception) {
    console.log(
      `[coverage-gate][source-exception] ${source.name} debt_ref=${exception.debt_ref} expires_on=${exception.expires_on}`
    )
  }
}
console.log(`[coverage-gate] global lines=${globalLines.toFixed(2)}% min=${GLOBAL_MIN}%`)
console.log(
  `[coverage-gate] global branches=${globalBranches.toFixed(2)}% min=${GLOBAL_BRANCHES_MIN}% epsilon=${COMPARISON_EPSILON.toFixed(2)} enforcement=${ENFORCE_GLOBAL_BRANCHES ? "strict" : "relaxed"}`
)
console.log(`[coverage-gate] core min=${CORE_MIN}% targets=${coreResults.length}`)

for (const source of globalGateSources) {
  const sourceException = findGovernanceException(
    governanceExceptions,
    "coverage-global-source",
    source.name
  )
  if (source.result.global.lines < GLOBAL_MIN - COMPARISON_EPSILON) {
    maybeExceptedFailure(
      failures,
      sourceException,
      `[coverage-gate] failed: source lines ${source.name} ${source.result.global.lines.toFixed(2)}% < required ${GLOBAL_MIN}%`
    )
  }
  if (
    ENFORCE_GLOBAL_BRANCHES &&
    source.result.global.branches < GLOBAL_BRANCHES_MIN - COMPARISON_EPSILON
  ) {
    maybeExceptedFailure(
      failures,
      sourceException,
      `[coverage-gate] failed: source branches ${source.name} ${source.result.global.branches.toFixed(2)}% < required ${GLOBAL_BRANCHES_MIN}%`
    )
  }
}

if (globalLines < GLOBAL_MIN - COMPARISON_EPSILON) {
  failures.push(
    `[coverage-gate] failed: blocking global lines ${globalLines.toFixed(2)}% < required ${GLOBAL_MIN}%`
  )
}
if (ENFORCE_GLOBAL_BRANCHES && globalBranches < GLOBAL_BRANCHES_MIN - COMPARISON_EPSILON) {
  failures.push(
    `[coverage-gate] failed: blocking global branches ${globalBranches.toFixed(2)}% < required ${GLOBAL_BRANCHES_MIN}%`
  )
}

for (const item of coreResults) {
  if (item.missing) {
    console.log(`[coverage-gate][core] MISSING ${item.file}`)
    failures.push(`[coverage-gate] failed: core file missing ${item.file}`)
    continue
  }
  console.log(
    `[coverage-gate][core] ${item.file} lines=${item.lines.toFixed(2)}% branches=${item.branches.toFixed(2)}% lineTotal=${item.linesTotal} branchTotal=${item.branchesTotal}`
  )
  const coreException = findGovernanceException(governanceExceptions, "coverage-core-target", item.file)
  if (item.lines < CORE_MIN - COMPARISON_EPSILON) {
    maybeExceptedFailure(
      failures,
      coreException,
      `[coverage-gate] failed: core file lines ${item.file} ${item.lines.toFixed(2)}% < required ${CORE_MIN}%`
    )
  }
  if (item.branches < CORE_MIN - COMPARISON_EPSILON) {
    maybeExceptedFailure(
      failures,
      coreException,
      `[coverage-gate] failed: core file branches ${item.file} ${item.branches.toFixed(2)}% < required ${CORE_MIN}%`
    )
  }
  if (REQUIRE_CORE_NONZERO_BASIS && item.linesTotal <= 0) {
    maybeExceptedFailure(
      failures,
      coreException,
      `[coverage-gate] failed: core file lines basis is zero ${item.file}; refusing vacuous coverage`
    )
  }
  if (REQUIRE_CORE_BRANCH_DATA && item.branchesTotal <= 0) {
    maybeExceptedFailure(
      failures,
      coreException,
      `[coverage-gate] failed: core file branches basis is zero ${item.file}; refusing vacuous branch coverage`
    )
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure)
  process.exit(1)
}

console.log("[coverage-gate] pass")
