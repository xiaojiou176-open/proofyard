import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { execFileSync } from "node:child_process"

const HARD_COLOR_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /\brgba?\(/g,
  /\bhsla?\(/g,
  /\boklch\(/g,
  /\boklab\(/g,
]

const TOKEN_ALLOW_PATTERNS = [
  /var\(--/g,
  /\btheme\./g,
  /\btokens?\./g,
  /\btoken\(/g,
]

const STYLE_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "border-color",
  "fill",
  "stroke",
  "box-shadow",
  "outline-color",
])

function isUiFile(path) {
  return /\.(css|scss|sass|less|ts|tsx|js|jsx)$/i.test(path)
}

function shouldCheckLine(line) {
  if (!line.trim()) return false
  if (line.includes("uiq-token-allow")) return false
  if (TOKEN_ALLOW_PATTERNS.some((pattern) => pattern.test(line))) return false
  return true
}

function looksLikeStyleLine(line) {
  const trimmed = line.trim()
  if (/^\s*(class(Name)?|style)\s*=/.test(trimmed)) return true
  if (trimmed.includes(":") && trimmed.includes(";")) return true
  for (const prop of STYLE_PROPS) {
    if (trimmed.includes(`${prop}:`)) return true
  }
  return false
}

function collectViolations(filePath) {
  const absPath = resolve(process.cwd(), filePath)
  const source = readFileSync(absPath, "utf8")
  const violations = []
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!shouldCheckLine(line) || !looksLikeStyleLine(line)) continue
    if (HARD_COLOR_PATTERNS.some((pattern) => pattern.test(line))) {
      violations.push({
        file: filePath,
        line: index + 1,
        text: line.trim().slice(0, 200),
      })
    }
  }
  return violations
}

function parseChangedLineSet(diffText) {
  const lines = String(diffText || "").split(/\r?\n/)
  const changed = new Set()
  let targetLine = 0
  for (const line of lines) {
    const header = line.match(/^@@\s*-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s*@@/)
    if (header) {
      targetLine = Number(header[1]) - 1
      continue
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      targetLine += 1
      changed.add(targetLine)
      continue
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      continue
    }
    targetLine += 1
  }
  return changed
}

function getStagedChangedLines(filePath) {
  try {
    const output = execFileSync("git", ["diff", "--cached", "--unified=0", "--", filePath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return parseChangedLineSet(output)
  } catch {
    return new Set()
  }
}

function filterViolationsByLines(violations, allowedLines) {
  if (allowedLines.size === 0) return []
  return violations.filter((item) => allowedLines.has(item.line))
}

function main(argv) {
  const files = argv.filter(isUiFile)
  if (files.length === 0) {
    process.stdout.write("[design-token-guard] skipped: no UI files\n")
    return 0
  }

  const violations = []
  let stagedCoverageFiles = 0
  for (const file of files) {
    const fileViolations = collectViolations(file)
    const changedLines = getStagedChangedLines(file)
    if (changedLines.size > 0) {
      stagedCoverageFiles += 1
      violations.push(...filterViolationsByLines(fileViolations, changedLines))
      continue
    }
    if (process.env.UIQ_TOKEN_GUARD_ALL === "true") {
      violations.push(...fileViolations)
    }
  }

  if (violations.length === 0) {
    const scope =
      stagedCoverageFiles > 0 ? `staged-line mode (${stagedCoverageFiles} file(s))` : "no staged UI diff"
    process.stdout.write(`[design-token-guard] passed: checked ${files.length} file(s), ${scope}\n`)
    return 0
  }

  process.stderr.write(
    `[design-token-guard] failed: ${violations.length} hardcoded style value(s) found\n`
  )
  for (const hit of violations.slice(0, 80)) {
    process.stderr.write(`  - ${hit.file}:${hit.line} ${hit.text}\n`)
  }
  process.stderr.write(
    "Use design tokens (`var(--token)`, `theme.*`, `tokens.*`) or annotate intentional literals with `uiq-token-allow`.\n"
  )
  return 1
}

process.exit(main(process.argv.slice(2)))
