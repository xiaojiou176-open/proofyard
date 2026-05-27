#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_INPUT_DIR = ".runtime-cache/artifacts/nightly"
const DEFAULT_OUTPUT = ".runtime-cache/artifacts/ci/nightly-trend-aggregate.json"
const DEFAULT_LOOKBACK_DAYS = 7

function parseArgs(argv) {
  const options = {
    inputDir: DEFAULT_INPUT_DIR,
    output: DEFAULT_OUTPUT,
    lookbackDays: DEFAULT_LOOKBACK_DAYS,
    now: "",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]
    if (token === "--input-dir" && next) {
      options.inputDir = next
      index += 1
      continue
    }
    if (token === "--output" && next) {
      options.output = next
      index += 1
      continue
    }
    if (token === "--lookback-days" && next) {
      options.lookbackDays = Number.parseInt(next, 10)
      index += 1
      continue
    }
    if (token === "--now" && next) {
      options.now = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  if (!Number.isInteger(options.lookbackDays) || options.lookbackDays < 1) {
    throw new Error(`--lookback-days must be >= 1, received: ${String(options.lookbackDays)}`)
  }
  if (options.now) {
    const nowDate = new Date(options.now)
    if (Number.isNaN(nowDate.getTime())) {
      throw new Error(`--now must be a valid ISO date/time, received: ${JSON.stringify(options.now)}`)
    }
  }
  return options
}

function toIsoDay(date) {
  return date.toISOString().slice(0, 10)
}

function parseIsoDay(raw) {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return null
  }
  const parsed = new Date(`${raw.trim()}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return raw.trim()
}

function isAnomalousSignal(payload) {
  if (!payload || typeof payload !== "object") return false
  if (typeof payload.anomalous === "boolean") return payload.anomalous
  const status = String(payload.status || "").toLowerCase()
  if (status === "anomalous" || status === "failed") return true
  if (status === "normal" || status === "ok" || status === "passed") return false
  if (Array.isArray(payload.anomalyReasons)) return payload.anomalyReasons.length > 0
  return false
}

function extractReasons(payload) {
  if (!payload || typeof payload !== "object") return []
  if (Array.isArray(payload.anomalyReasons)) {
    return payload.anomalyReasons.map((item) => String(item)).filter(Boolean)
  }
  if (Array.isArray(payload.reasons)) {
    return payload.reasons.map((item) => String(item)).filter(Boolean)
  }
  return []
}

function parseSignalFile(content, filename) {
  const payload = JSON.parse(content)
  if (!payload || typeof payload !== "object") {
    throw new Error("JSON payload is not an object")
  }

  const isoFromPayload = parseIsoDay(payload.date)
  const isoFromFilename = parseIsoDay(path.basename(filename, path.extname(filename)))
  const date = isoFromPayload || isoFromFilename
  if (!date) {
    throw new Error("cannot infer signal date from `date` field or filename(YYYY-MM-DD.json)")
  }

  return {
    date,
    anomalous: isAnomalousSignal(payload),
    anomalyReasons: extractReasons(payload),
    sourceFile: filename,
    raw: payload,
  }
}

function computeExpectedDays(now, lookbackDays) {
  const days = []
  const cursor = new Date(`${toIsoDay(now)}T00:00:00.000Z`)
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const day = new Date(cursor)
    day.setUTCDate(cursor.getUTCDate() - offset)
    days.push(toIsoDay(day))
  }
  return days
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const now = options.now ? new Date(options.now) : new Date()
  const inputDir = path.resolve(options.inputDir)
  const outputPath = path.resolve(options.output)
  const expectedDays = computeExpectedDays(now, options.lookbackDays)
  const records = []
  const parseWarnings = []
  let sourceFileCount = 0

  try {
    const entries = await fs.readdir(inputDir, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))

    sourceFileCount = files.length
    for (const file of files) {
      const absolute = path.join(inputDir, file)
      try {
        const content = await fs.readFile(absolute, "utf8")
        const record = parseSignalFile(content, file)
        if (!expectedDays.includes(record.date)) {
          continue
        }
        records.push(record)
      } catch (error) {
        parseWarnings.push({
          file,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      parseWarnings.push({
        file: "<input-dir>",
        reason: `directory not found: ${inputDir}`,
      })
    } else {
      throw error
    }
  }

  const byDate = new Map()
  for (const record of records) {
    if (!byDate.has(record.date)) {
      byDate.set(record.date, record)
      continue
    }
    const existing = byDate.get(record.date)
    if (existing && !existing.anomalous && record.anomalous) {
      byDate.set(record.date, record)
    }
  }

  const timeline = expectedDays.map((day) => {
    const hit = byDate.get(day)
    if (hit) {
      return {
        date: day,
        present: true,
        anomalous: hit.anomalous,
        anomalyReasons: hit.anomalyReasons,
        sourceFile: hit.sourceFile,
      }
    }
    return {
      date: day,
      present: false,
      anomalous: false,
      anomalyReasons: [],
      sourceFile: "",
      missingReason: "signal file missing for this day",
    }
  })

  const output = {
    generatedAt: new Date().toISOString(),
    lookbackDays: options.lookbackDays,
    inputDir,
    sourceFileCount,
    expectedDays,
    parseWarnings,
    summary: {
      daysExpected: expectedDays.length,
      daysWithSignals: timeline.filter((item) => item.present).length,
      anomalousDays: timeline.filter((item) => item.present && item.anomalous).length,
      missingDays: timeline.filter((item) => !item.present).length,
    },
    timeline,
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8")

  console.log(
    `[nightly-trend-aggregate] generated=${outputPath} daysWithSignals=${output.summary.daysWithSignals}/${output.summary.daysExpected} anomalousDays=${output.summary.anomalousDays} missingDays=${output.summary.missingDays}`
  )
}

try {
  await main()
} catch (error) {
  console.error("[nightly-trend-aggregate] FAILED")
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
