import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { basename, extname, resolve } from "node:path"

export const outputPrefix = "uiq-test-truth-gate"
export const DEFAULT_OUT_DIR = ".runtime-cache/artifacts/ci"
export const DEFAULT_ROOTS = [
  "apps/web",
  "frontend",
  "automation",
  "packages",
  "tests",
  "apps/mcp-server/tests",
  "packages/orchestrator/src/commands",
]
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".runtime-cache",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".next",
  ".turbo",
])

const REASON_CODE = {
  passed: "gate.test_truthiness.passed.no_weak_patterns",
  passedNoTestsInScope: "gate.test_truthiness.passed.no_test_files_in_changed_scope",
  failed: "gate.test_truthiness.failed.weak_patterns_detected",
  blocked: "gate.test_truthiness.blocked.no_test_files",
}

function parseBoolean(value, key) {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`invalid ${key}, expected true|false`)
}

function parsePathsCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function parseArgs(argv) {
  const options = {
    profile: "pr",
    strict: false,
    outDir: DEFAULT_OUT_DIR,
    scope: "auto",
    writeArtifacts: true,
    paths: [],
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === "--profile" && next) options.profile = next
    if (token === "--strict" && next) options.strict = parseBoolean(next, "--strict")
    if (token === "--out-dir" && next) options.outDir = next
    if (token === "--scope" && next) options.scope = next
    if (token === "--write-artifacts" && next) {
      options.writeArtifacts = parseBoolean(next, "--write-artifacts")
    }
    if (token === "--paths" && next) options.paths = parsePathsCsv(next)
  }
  if (!String(options.profile || "").trim()) {
    throw new Error("invalid --profile, expected non-empty value")
  }
  if (!String(options.outDir || "").trim()) {
    throw new Error("invalid --out-dir, expected non-empty value")
  }
  if (!["auto", "all", "staged", "staged-or-changed"].includes(options.scope)) {
    throw new Error("invalid --scope, expected auto|all|staged|staged-or-changed")
  }
  return options
}

export function normalizePath(path) {
  return String(path || "").replaceAll("\\", "/")
}

function isCodeFile(path) {
  return [".js", ".jsx", ".cjs", ".mjs", ".ts", ".tsx", ".cts", ".mts"].includes(
    extname(path).toLowerCase()
  )
}

export function isLikelyTestFile(path) {
  if (!isCodeFile(path)) return false
  const normalized = normalizePath(path)
  const name = basename(normalized)
  if (
    /playwright\.config\.[cm]?[jt]sx?$/i.test(name) ||
    /vitest\.config\.[cm]?[jt]sx?$/i.test(name)
  ) {
    return false
  }
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(name)) return true
  if (/\/__tests__\//i.test(normalized)) return true
  if (/\/tests?\//i.test(normalized) && !/config\.[cm]?[jt]sx?$/i.test(name)) return true
  return false
}

function collectFiles(inputPath) {
  const absPath = resolve(inputPath)
  if (!existsSync(absPath)) return []
  const info = statSync(absPath)
  if (info.isFile()) return [absPath]
  if (!info.isDirectory()) return []
  const files = []
  const stack = [absPath]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const nextPath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue
        stack.push(nextPath)
        continue
      }
      if (entry.isFile()) files.push(nextPath)
    }
  }
  return files
}

function collectGitFileList(args) {
  try {
    const output = execFileSync("git", args, { encoding: "utf8" })
    return String(output || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  } catch {
    return []
  }
}

function collectChangedFiles() {
  const files = new Set()
  const groups = [
    ["diff", "--name-only", "--diff-filter=ACMR"],
    ["ls-files", "--others", "--exclude-standard"],
  ]
  for (const args of groups) {
    for (const file of collectGitFileList(args)) {
      files.add(normalizePath(file))
    }
  }
  return Array.from(files)
}

function collectStagedFiles() {
  const files = new Set()
  for (const file of collectGitFileList(["diff", "--name-only", "--cached", "--diff-filter=ACMR"])) {
    files.add(normalizePath(file))
  }
  return Array.from(files)
}

export function resolveScopeMode(options) {
  if (options.scope !== "auto") return options.scope
  if (String(options.profile || "").startsWith("pre-commit")) return "staged"
  return "all"
}

export function collectCandidateFiles(options) {
  const scopeMode = resolveScopeMode(options)
  const roots = options.paths.length > 0 ? options.paths : DEFAULT_ROOTS
  const resolvedRoots = Array.from(new Set(roots.map((root) => resolve(root))))

  if (scopeMode === "staged" || scopeMode === "staged-or-changed") {
    const changedFiles =
      scopeMode === "staged-or-changed"
        ? Array.from(new Set([...collectStagedFiles(), ...collectChangedFiles()]))
        : collectStagedFiles()
    const files = Array.from(
      new Set(changedFiles.map((file) => resolve(file)).filter((file) => existsSync(file)))
    ).filter((file) => {
      try {
        return statSync(file).isFile()
      } catch {
        return false
      }
    })
    return { scopeMode, resolvedRoots, candidateFiles: files }
  }

  const candidateFiles = []
  for (const root of resolvedRoots) {
    candidateFiles.push(...collectFiles(root))
  }
  return {
    scopeMode,
    resolvedRoots,
    candidateFiles: Array.from(new Set(candidateFiles)),
  }
}

export function buildGate(testFileCount, findingCount, scopeMode) {
  if (testFileCount === 0) {
    if (scopeMode === "staged" || scopeMode === "staged-or-changed") {
      return {
        status: "passed",
        reasonCode: REASON_CODE.passedNoTestsInScope,
      }
    }
    return {
      status: "blocked",
      reasonCode: REASON_CODE.blocked,
    }
  }
  if (findingCount > 0) {
    return {
      status: "failed",
      reasonCode: REASON_CODE.failed,
    }
  }
  return {
    status: "passed",
    reasonCode: REASON_CODE.passed,
  }
}

export function renderMarkdown(report) {
  const lines = []
  lines.push("## UIQ Test Truthiness Gate")
  lines.push(`- Profile: \`${report.profile}\``)
  lines.push(`- Strict Mode: ${report.strict ? "true" : "false"}`)
  lines.push(`- Scope Mode: \`${report.scan.scopeMode}\``)
  lines.push(`- Gate Status: **${report.gate.status}**`)
  lines.push(`- reasonCode: \`${report.gate.reasonCode}\``)
  lines.push(
    `- Scan Roots: ${report.scan.roots.map((root) => `\`${root}\``).join(", ") || "(none)"}`
  )
  lines.push(`- Candidate Files: ${report.scan.candidateFiles}`)
  lines.push(`- Test Files: ${report.scan.testFiles}`)
  lines.push(`- Findings: ${report.findings.length}`)
  lines.push("")
  lines.push("| # | Rule | File | Line | Message |")
  lines.push("|---:|---|---|---:|---|")
  if (report.findings.length === 0) {
    lines.push("| 1 | `none` | `n/a` | 0 | No weak patterns detected. |")
  } else {
    for (let i = 0; i < report.findings.length; i += 1) {
      const finding = report.findings[i]
      lines.push(
        `| ${i + 1} | \`${finding.ruleId}\` | \`${finding.file}\` | ${finding.line} | ${String(finding.message).replaceAll("|", "\\|")} |`
      )
    }
  }
  return `${lines.join("\n")}\n`
}
