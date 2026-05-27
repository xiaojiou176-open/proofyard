#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const DEFAULT_HISTORY = ".runtime-cache/artifacts/ci/precommit-required-gates-metrics-history.jsonl"
const DEFAULT_LATEST = ".runtime-cache/artifacts/ci/precommit-required-gates-metrics.json"
const DEFAULT_OUTPUT_JSON = ".runtime-cache/artifacts/ci/precommit-strict-manual-summary.json"
const DEFAULT_OUTPUT_MD = ".runtime-cache/artifacts/ci/precommit-strict-manual-summary.md"

function parseArgs(argv) {
  const result = {
    windowDays: 7,
    topN: 5,
    mode: "strict",
    history: DEFAULT_HISTORY,
    latest: DEFAULT_LATEST,
    outJson: DEFAULT_OUTPUT_JSON,
    outMd: DEFAULT_OUTPUT_MD,
  }
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === "--window-days" && value) {
      result.windowDays = Number(value)
      i += 1
    } else if (key === "--top-n" && value) {
      result.topN = Number(value)
      i += 1
    } else if (key === "--mode" && value) {
      result.mode = value
      i += 1
    } else if (key === "--history" && value) {
      result.history = value
      i += 1
    } else if (key === "--latest" && value) {
      result.latest = value
      i += 1
    } else if (key === "--out-json" && value) {
      result.outJson = value
      i += 1
    } else if (key === "--out-md" && value) {
      result.outMd = value
      i += 1
    }
  }
  if (!Number.isFinite(result.windowDays) || result.windowDays <= 0) {
    throw new Error("--window-days must be a positive number")
  }
  if (!Number.isFinite(result.topN) || result.topN <= 0) {
    throw new Error("--top-n must be a positive number")
  }
  return result
}

function parseJsonLine(line, lineNo) {
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(`invalid JSON in history at line ${lineNo}`)
  }
}

function loadRecords(historyPath, latestPath) {
  const records = []
  if (fs.existsSync(historyPath)) {
    const lines = fs.readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean)
    lines.forEach((line, index) => {
      records.push(parseJsonLine(line, index + 1))
    })
  } else if (fs.existsSync(latestPath)) {
    records.push(JSON.parse(fs.readFileSync(latestPath, "utf8")))
  }
  return records
}

function asTime(value) {
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

function summarize(records, options) {
  const now = Date.now()
  const windowStart = now - options.windowDays * 24 * 60 * 60 * 1000
  const filtered = records.filter((r) => {
    if (options.mode !== "all" && r.mode !== options.mode) {
      return false
    }
    const t = asTime(r.timestamp)
    if (t == null) {
      return false
    }
    return t >= windowStart
  })

  const totalRuns = filtered.length
  const blockedRuns = filtered.filter((r) => r.status === "failed").length
  const blockedRate = totalRuns === 0 ? 0 : blockedRuns / totalRuns

  const failedCounts = new Map()
  const statusBreakdown = { passed: 0, failed: 0 }
  filtered.forEach((r) => {
    if (r.status === "failed") {
      statusBreakdown.failed += 1
      const reason = r.failed_step || "unknown"
      failedCounts.set(reason, (failedCounts.get(reason) || 0) + 1)
    } else {
      statusBreakdown.passed += 1
    }
  })

  const topFailedSteps = [...failedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, options.topN)
    .map(([step, count]) => ({
      step,
      count,
      ratio_in_failures: blockedRuns === 0 ? 0 : count / blockedRuns,
    }))

  const durationMsList = filtered
    .map((r) => Number(r.duration_ms))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b)
  const avgDurationMs =
    durationMsList.length === 0
      ? 0
      : Math.round(durationMsList.reduce((a, b) => a + b, 0) / durationMsList.length)

  const lastRun =
    filtered.slice().sort((a, b) => (asTime(b.timestamp) || 0) - (asTime(a.timestamp) || 0))[0] ||
    null

  return {
    generated_at: new Date().toISOString(),
    window_days: options.windowDays,
    mode: options.mode,
    total_runs: totalRuns,
    blocked_runs: blockedRuns,
    blocked_rate: Number(blockedRate.toFixed(4)),
    status_breakdown: statusBreakdown,
    average_duration_ms: avgDurationMs,
    top_failed_steps: topFailedSteps,
    last_run: lastRun,
    source_files: {
      history: options.history,
      latest: options.latest,
    },
  }
}

function toMarkdown(summary) {
  const pct = (summary.blocked_rate * 100).toFixed(2)
  const lines = []
  lines.push("# Pre-commit Strict Manual Summary")
  lines.push("")
  lines.push(`- Generated at: ${summary.generated_at}`)
  lines.push(`- Window days: ${summary.window_days}`)
  lines.push(`- Mode: ${summary.mode}`)
  lines.push(`- Total runs: ${summary.total_runs}`)
  lines.push(`- Blocked runs: ${summary.blocked_runs}`)
  lines.push(`- Blocked rate: ${pct}%`)
  lines.push(`- Average duration: ${summary.average_duration_ms} ms`)
  lines.push("")
  lines.push("## Top Failed Steps")
  if (summary.top_failed_steps.length === 0) {
    lines.push("")
    lines.push("No failed steps in this window.")
  } else {
    lines.push("")
    lines.push("| Step | Count | Share in failures |\n|---|---:|---:|")
    summary.top_failed_steps.forEach((item) => {
      lines.push(`| ${item.step} | ${item.count} | ${(item.ratio_in_failures * 100).toFixed(2)}% |`)
    })
  }
  return `${lines.join("\n")}\n`
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function main() {
  const options = parseArgs(process.argv)
  const records = loadRecords(options.history, options.latest)
  const summary = summarize(records, options)

  ensureParent(options.outJson)
  ensureParent(options.outMd)
  fs.writeFileSync(options.outJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  fs.writeFileSync(options.outMd, toMarkdown(summary), "utf8")

  process.stdout.write(
    `[precommit-strict-metrics-aggregate] wrote ${options.outJson} and ${options.outMd}\n`
  )
}

main()
