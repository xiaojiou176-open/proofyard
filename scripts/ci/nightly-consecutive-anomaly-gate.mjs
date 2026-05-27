#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_DAYS = 3
const DEFAULT_INPUT = ".runtime-cache/artifacts/ci/nightly-trend-aggregate.json"

function parseArgs(argv) {
  const options = {
    days: DEFAULT_DAYS,
    input: DEFAULT_INPUT,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]
    if (token === "--days" && next) {
      options.days = Number.parseInt(next, 10)
      index += 1
      continue
    }
    if (token === "--input" && next) {
      options.input = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  if (!Number.isInteger(options.days) || options.days < 1) {
    throw new Error(`--days must be >= 1, received: ${String(options.days)}`)
  }
  return options
}

function parseIsoDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function diffDaysUtc(newer, older) {
  const ms = newer.getTime() - older.getTime()
  return Math.round(ms / 86400000)
}

function buildConsecutiveStreak(timeline) {
  let previousDate = null
  const streak = []

  for (const item of timeline) {
    if (!item || typeof item !== "object") break
    const day = parseIsoDay(item.date)
    if (!day) break
    if (!item.present || !item.anomalous) break

    if (previousDate) {
      const delta = diffDaysUtc(previousDate, day)
      if (delta !== 1) {
        break
      }
    }

    streak.push(item)
    previousDate = day
  }
  return streak
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const inputPath = path.resolve(options.input)
  const raw = await fs.readFile(inputPath, "utf8")
  const payload = JSON.parse(raw)

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.timeline)) {
    throw new Error("input JSON must contain `timeline` array")
  }

  const streak = buildConsecutiveStreak(payload.timeline)
  const blocked = streak.length >= options.days
  const streakDays = streak.map((item) => item.date)
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {}
  const missingDays = Number(summary.missingDays || 0)

  if (blocked) {
    console.error(
      `[nightly-consecutive-anomaly-gate] BLOCKED: found ${streak.length} consecutive anomalous day(s) (threshold=${options.days}) days=${streakDays.join(",")}`
    )
    process.exit(1)
  }

  console.log(
    `[nightly-consecutive-anomaly-gate] OK: consecutive anomalous days=${streak.length}/${options.days} latestStreakDays=${streakDays.join(",") || "none"} missingDays=${missingDays}`
  )
}

try {
  await main()
} catch (error) {
  console.error("[nightly-consecutive-anomaly-gate] FAILED")
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
