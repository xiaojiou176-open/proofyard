#!/usr/bin/env node
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { extname, resolve } from "node:path"

const DEFAULT_TARGETS = ["backend", "frontend", "apps", "packages", "automation", "scripts"]
const MAX_PROXIMITY_LINES = 6
const SELF_PATH_SUFFIX = "scripts/ci/check-env-alias-ban.mjs"
const ALIAS_MATRIX_PATH = resolve("configs/env/alias-replacement-matrix.json")

const KEYWORD_RE = /\b(alias|fallback|deprecated|legacy)\b/i
const FALLBACK_CHAIN_RE = /(\|\||\?\?|:-|\bor\b)/
const ENV_ACCESS_RE =
  /process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]|import\.meta\.env\.([A-Z][A-Z0-9_]+)|import\.meta\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]|os\.(?:getenv|environ\.get)\(\s*["']([A-Z][A-Z0-9_]+)["']|os\.environ\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]|\$\{([A-Z][A-Z0-9_]+)(?::-[^}]*)?\}/g

const FALLBACK_SYNONYM_GROUPS = [
  ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  ["GEMINI_MODEL_PRIMARY", "GEMINI_MODEL"],
  ["UIQ_BASE_URL", "BASE_URL"],
  ["RUNTIME_GC_KEEP_RUNS", "RUNTIME_GC_MAX_RUNS"],
  ["RUNTIME_GC_RETENTION_DAYS", "LOG_RETENTION_DAYS"],
]

function isEnvStyleName(input) {
  return /^[A-Z][A-Z0-9_]+$/.test(input)
}

function normalizeGroup(names) {
  return Array.from(new Set(names.filter(isEnvStyleName))).sort()
}

function loadSynonymGroupsFromMatrix() {
  let matrixText
  try {
    matrixText = readFileSync(ALIAS_MATRIX_PATH, "utf8")
  } catch {
    return []
  }

  let matrix
  try {
    matrix = JSON.parse(matrixText)
  } catch {
    return []
  }

  const entries = Array.isArray(matrix?.entries) ? matrix.entries : []
  const groups = []
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const canonical = typeof entry.canonical === "string" ? entry.canonical : ""
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
    const group = normalizeGroup([canonical, ...aliases])
    if (group.length >= 2) {
      groups.push(group)
    }
  }
  return groups
}

function buildKnownSynonymGroups() {
  const matrixGroups = loadSynonymGroupsFromMatrix()
  const merged = [...matrixGroups, ...FALLBACK_SYNONYM_GROUPS.map((group) => normalizeGroup(group))]
  const unique = new Map()
  for (const group of merged) {
    if (group.length < 2) continue
    unique.set(group.join("|"), group)
  }
  return Array.from(unique.values())
}

const KNOWN_SYNONYM_GROUPS = buildKnownSynonymGroups()

function parseArgs(argv) {
  const options = {
    mode: "staged",
    paths: [],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--all") {
      options.mode = "all"
      continue
    }
    if (token === "--staged") {
      options.mode = "staged"
      continue
    }
    if (token === "--paths" && next) {
      options.paths = next
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
      i += 1
    }
  }
  return options
}

function resolveScanCandidates(options) {
  if (options.paths.length > 0) {
    return options.paths.map((item) => resolve(item))
  }
  if (options.mode === "all") {
    return DEFAULT_TARGETS.map((item) => resolve(item))
  }
  return listStagedFiles()
}

function listStagedFiles() {
  const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    encoding: "utf8",
  }).trim()
  if (!output) return []
  return output
    .split("\n")
    .map((line) => resolve(line.trim()))
    .filter(Boolean)
}

function isCodeOrScriptFile(filePath) {
  const ext = extname(filePath)
  return (
    ext === ".ts" ||
    ext === ".tsx" ||
    ext === ".js" ||
    ext === ".mjs" ||
    ext === ".cjs" ||
    ext === ".py" ||
    ext === ".sh" ||
    ext === ".bash" ||
    ext === ".zsh"
  )
}

function expandFiles(candidates) {
  const files = []
  for (const candidate of candidates) {
    let stat
    try {
      stat = statSync(candidate)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      const listed = execFileSync("rg", ["--files", candidate], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
      for (const file of listed) {
        const abs = resolve(file)
        if (isCodeOrScriptFile(abs) && !abs.endsWith(SELF_PATH_SUFFIX)) {
          files.push(abs)
        }
      }
      continue
    }
    if (stat.isFile() && isCodeOrScriptFile(candidate) && !candidate.endsWith(SELF_PATH_SUFFIX)) {
      files.push(candidate)
    }
  }
  return Array.from(new Set(files)).sort()
}

function collectEnvNames(line) {
  const names = []
  for (const match of line.matchAll(ENV_ACCESS_RE)) {
    for (let i = 1; i < match.length; i += 1) {
      if (match[i]) names.push(match[i])
    }
  }
  return names
}

function scanFile(filePath) {
  let content
  try {
    content = readFileSync(filePath, "utf8")
  } catch {
    return []
  }

  const violations = []
  const lines = content.split(/\r?\n/)
  const groupHits = new Map()
  for (const group of KNOWN_SYNONYM_GROUPS) {
    groupHits.set(group.join("|"), [])
  }

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]
    const envNames = collectEnvNames(line)
    if (envNames.length === 0) continue

    const hasKeyword = KEYWORD_RE.test(line)
    const hasChain = FALLBACK_CHAIN_RE.test(line)
    if (hasKeyword && (hasChain || envNames.length >= 2)) {
      violations.push({
        file: filePath,
        line: idx + 1,
        type: "keyword-chain",
        detail: line.trim().slice(0, 180),
      })
    }

    for (const group of KNOWN_SYNONYM_GROUPS) {
      const hitNames = group.filter((name) => envNames.includes(name))
      if (hitNames.length > 0) {
        const key = group.join("|")
        const bucket = groupHits.get(key) ?? []
        bucket.push({ line: idx + 1, names: hitNames })
        groupHits.set(key, bucket)
      }
      if (hitNames.length >= 2) {
        violations.push({
          file: filePath,
          line: idx + 1,
          type: "same-line-synonym-group",
          detail: `line reads synonym group together: ${group.join(" <-> ")}`,
        })
      }
    }
  }

  for (const group of KNOWN_SYNONYM_GROUPS) {
    const key = group.join("|")
    const hits = groupHits.get(key) ?? []
    if (hits.length < 2) continue
    const linesWithDistinctVars = new Map()
    for (const hit of hits) {
      for (const name of hit.names) {
        if (!linesWithDistinctVars.has(name)) linesWithDistinctVars.set(name, [])
        linesWithDistinctVars.get(name).push(hit.line)
      }
    }
    if (linesWithDistinctVars.size < 2) continue
    const allLines = hits.map((hit) => hit.line).sort((a, b) => a - b)
    const near = allLines[allLines.length - 1] - allLines[0] <= MAX_PROXIMITY_LINES
    if (near) {
      violations.push({
        file: filePath,
        line: allLines[0],
        type: "nearby-synonym-group",
        detail: `nearby alias/fallback read for synonym group: ${group.join(" <-> ")}`,
      })
    }
  }

  return violations
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const candidates = resolveScanCandidates(options)
  const files = expandFiles(candidates)
  if (files.length === 0) {
    console.log("[env-alias-ban] no candidate files to scan")
    return
  }

  const violations = []
  for (const file of files) {
    violations.push(...scanFile(file))
  }

  if (violations.length > 0) {
    console.error(`[env-alias-ban] violations=${violations.length}`)
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} [${violation.type}] ${violation.detail}`)
    }
    process.exit(2)
  }

  console.log(`[env-alias-ban] ok; scanned=${files.length}`)
}

main()
