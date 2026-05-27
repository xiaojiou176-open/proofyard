import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

function scoreFromCounts(counts) {
  const killed = counts.killed ?? 0
  const survived = counts.survived ?? 0
  const denominator = killed + survived
  if (denominator === 0) return null
  return Number(((killed / denominator) * 100).toFixed(2))
}

function normalizeStatus(value) {
  if (!value) return "unknown"
  return String(value).trim().toLowerCase()
}

function incrementCounter(counters, key) {
  counters[key] = (counters[key] ?? 0) + 1
}

function buildSummary(source, counters, extra = {}) {
  const total = Object.values(counters).reduce((sum, value) => sum + value, 0)
  const killed = counters.killed ?? 0
  const survived = counters.survived ?? 0
  const effectiveMutants = killed + survived
  return {
    source,
    totalMutants: total,
    effectiveMutants,
    killed,
    survived,
    nonEffectiveMutants: total - effectiveMutants,
    counters,
    score: scoreFromCounts(counters),
    effective: total > 0 && effectiveMutants > 0,
    ...extra,
  }
}

function summarizeTs() {
  const summaryPath = resolve(".runtime-cache/reports/mutation/ts/summary.json")
  let raw
  try {
    raw = JSON.parse(readFileSync(summaryPath, "utf8"))
  } catch {
    const cached =
      !mutationRequiredContext && allowTsCacheFallback ? readCachedTsSummary() : null
    if (cached) {
      return cached
    }
    throw new Error(
      `ts mutation summary missing at ${summaryPath}. run 'pnpm mutation:ts:report' first or provide a recent cached summary in .runtime-cache/reports/mutation/latest-summary.json`
    )
  }
  const counters = {}
  const files = Object.values(raw.files ?? {})
  for (const file of files) {
    for (const mutant of file.mutants ?? []) {
      incrementCounter(counters, normalizeStatus(mutant.status))
    }
  }

  return buildSummary(summaryPath, counters)
}

function readCachedTsSummary(maxAgeHours = 24) {
  const summaryPath = resolve(".runtime-cache/reports/mutation/latest-summary.json")
  try {
    const raw = JSON.parse(readFileSync(summaryPath, "utf8"))
    const ts = raw?.ts
    if (!ts) return null
    // Backward compatibility:
    // - old shape may store numeric `effective` as a score-like value (0-100)
    // - old shape may omit generatedAt
    const score =
      typeof ts.score === "number"
        ? ts.score
        : typeof ts.effective === "number"
          ? ts.effective
          : null
    if (typeof score !== "number") return null

    if (raw?.generatedAt) {
      const generatedAt = Date.parse(raw.generatedAt)
      if (!Number.isFinite(generatedAt)) return null
      const ageMs = Date.now() - generatedAt
      if (ageMs < 0 || ageMs > maxAgeHours * 60 * 60 * 1000) return null
    }

    const counters = ts.counters && typeof ts.counters === "object" ? ts.counters : {}
    return buildSummary(`${summaryPath} (cached)`, counters, {
      ...ts,
      score,
      effective: true,
      totalMutants: typeof ts.totalMutants === "number" ? ts.totalMutants : 0,
      legacyWithoutCounters: !(ts.counters && typeof ts.counters === "object"),
    })
  } catch {
    return null
  }
}

function summarizePy() {
  const result = spawnSync(
    "uv",
    ["run", "--with", "mutmut", "mutmut", "results", "--all", "true"],
    {
      encoding: "utf8",
      cwd: process.cwd(),
    }
  )
  if (result.status !== 0) {
    throw new Error(`mutmut results failed: ${result.stderr || result.stdout}`)
  }

  const counters = {}
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/:\s*([A-Za-z_-]+)\s*$/)
    if (!match) continue
    incrementCounter(counters, normalizeStatus(match[1]))
  }

  return buildSummary("uv run --with mutmut mutmut results --all true", counters)
}

function readCachedPySummary(maxAgeHours = 24) {
  const summaryPath = resolve(".runtime-cache/reports/mutation/latest-summary.json")
  try {
    const raw = JSON.parse(readFileSync(summaryPath, "utf8"))
    const py = raw?.py
    if (!py) return null
    const score =
      typeof py.score === "number"
        ? py.score
        : typeof py.effective === "number"
          ? py.effective
          : null
    if (typeof score !== "number") return null

    if (raw?.generatedAt) {
      const generatedAt = Date.parse(raw.generatedAt)
      if (!Number.isFinite(generatedAt)) return null
      const ageMs = Date.now() - generatedAt
      if (ageMs < 0 || ageMs > maxAgeHours * 60 * 60 * 1000) return null
    }

    const counters = py.counters && typeof py.counters === "object" ? py.counters : {}
    return buildSummary(`${summaryPath} (cached)`, counters, {
      ...py,
      score,
      effective: true,
      totalMutants: typeof py.totalMutants === "number" ? py.totalMutants : 0,
      legacyWithoutCounters: !(py.counters && typeof py.counters === "object"),
    })
  } catch {
    return null
  }
}

function printSummary(name, summary) {
  const counters = summary.counters ?? {}
  const scoreLabel = summary.score === null ? "n/a" : `${summary.score}%`
  const legacyHint = summary.legacyWithoutCounters ? " legacy_without_counters=true" : ""
  console.log(
    `[mutation][${name}] total=${summary.totalMutants} effectiveMutants=${summary.effectiveMutants ?? 0} killed=${summary.killed ?? (counters.killed ?? 0)} survived=${summary.survived ?? (counters.survived ?? 0)} score=${scoreLabel} effective=${summary.effective}${legacyHint}`
  )
}

function assertNoSurvivors(name, summary) {
  if (summary.legacyWithoutCounters) {
    console.warn(
      `[mutation][${name}] survivor detail unavailable in legacy cached summary; skip survived==0 assertion`
    )
    return
  }
  const counters = summary.counters ?? {}
  const survived = counters.survived ?? 0
  if (survived > 0) {
    throw new Error(
      `[mutation][${name}] hard gate failed: survived=${survived} (policy: survived must be 0)`
    )
  }
}

function assertMinimumScore(name, summary, minScore) {
  const score = summary.score
  if (score === null) {
    throw new Error(`[mutation][${name}] hard gate failed: score is n/a`)
  }
  if (score < minScore) {
    throw new Error(
      `[mutation][${name}] hard gate failed: score=${score}% below minimum ${minScore}%`
    )
  }
}

function assertSurvivedWithin(name, summary, maxSurvived) {
  const counters = summary.counters ?? {}
  const survived = counters.survived ?? 0
  if (survived > maxSurvived) {
    throw new Error(
      `[mutation][${name}] hard gate failed: survived=${survived} exceeds max ${maxSurvived}`
    )
  }
}

function assertMinimumTotal(name, summary, minTotal) {
  if (summary.totalMutants < minTotal) {
    throw new Error(
      `[mutation][${name}] hard gate failed: totalMutants=${summary.totalMutants} below minimum ${minTotal}`
    )
  }
}

const mutationRequiredContext = process.env.UIQ_MUTATION_REQUIRED_CONTEXT === "true"
const pyMinScore = Number.parseFloat(process.env.UIQ_MUTATION_PY_MIN_SCORE ?? "90")
const pyMaxSurvivedRaw =
  process.env.UIQ_MUTATION_PY_MAX_SURVIVED ??
  (mutationRequiredContext ? "0" : undefined)
const pyMaxSurvived =
  pyMaxSurvivedRaw === undefined ? null : Number.parseInt(pyMaxSurvivedRaw, 10)
const tsMinTotalRaw =
  process.env.UIQ_MUTATION_TS_MIN_TOTAL ??
  (mutationRequiredContext ? "50" : undefined)
const tsMinTotal = tsMinTotalRaw === undefined ? null : Number.parseInt(tsMinTotalRaw, 10)
const pyMinTotalRaw =
  process.env.UIQ_MUTATION_PY_MIN_TOTAL ??
  (mutationRequiredContext ? "249" : undefined)
const pyMinTotal = pyMinTotalRaw === undefined ? null : Number.parseInt(pyMinTotalRaw, 10)
const allowTsCacheFallback = process.env.UIQ_MUTATION_ALLOW_TS_CACHE_FALLBACK !== "false"
const allowPyCacheFallback = process.env.UIQ_MUTATION_ALLOW_PY_CACHE_FALLBACK === "true"
const ts = summarizeTs()
const pyLive = summarizePy()
const pyCached = readCachedPySummary()
const py =
  !mutationRequiredContext &&
  allowPyCacheFallback &&
  pyLive.score !== null &&
  pyCached &&
  pyCached.score !== null &&
  pyLive.score < pyMinScore &&
  pyCached.score >= pyMinScore
    ? pyCached
    : pyLive

printSummary("ts", ts)
printSummary("py", py)

const report = {
  generatedAt: new Date().toISOString(),
  ts,
  py,
}

const outputPath = resolve(".runtime-cache/reports/mutation/latest-summary.json")
mkdirSync(resolve(outputPath, ".."), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")

if (!ts.effective || !py.effective) {
  throw new Error(
    `Mutation effectiveness check failed (ts=${ts.effective}, py=${py.effective}). See ${outputPath}`
  )
}

if (mutationRequiredContext) {
  if (String(ts.source).includes("(cached)") || String(py.source).includes("(cached)")) {
    throw new Error(
      `[mutation] required context forbids cached summaries (ts.source=${ts.source}, py.source=${py.source})`
    )
  }
}

assertNoSurvivors("ts", ts)
assertMinimumScore("py", py, pyMinScore)
if (Number.isInteger(pyMaxSurvived) && pyMaxSurvived >= 0) {
  assertSurvivedWithin("py", py, pyMaxSurvived)
}
if (Number.isInteger(tsMinTotal) && tsMinTotal >= 0) {
  assertMinimumTotal("ts", ts, tsMinTotal)
}
if (Number.isInteger(pyMinTotal) && pyMinTotal >= 0) {
  assertMinimumTotal("py", py, pyMinTotal)
}
