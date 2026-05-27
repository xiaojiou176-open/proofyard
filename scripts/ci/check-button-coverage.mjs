#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { extname, resolve } from "node:path"

const ROOT = process.cwd()
const MANIFEST_FILE = resolve(ROOT, "apps/web/src/testing/button-manifest.ts")
const TEST_ROOTS = [resolve(ROOT, "tests/frontend-e2e"), resolve(ROOT, "apps/web/tests/e2e")]
const CODE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"])
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".runtime-cache",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
])
const WEAK_ASSERTION_PATTERNS = [
  /\btoBeTruthy\s*\(/g,
  /\btoBe\s*\(\s*true\s*\)/g,
  /\btoBe\s*\(\s*false\s*\)/g,
  /\btoEqual\s*\(\s*true\s*\)/g,
  /\btoEqual\s*\(\s*false\s*\)/g,
]
const ALLOWED_VIEWS = new Set([
  "QuickLaunch",
  "TaskCenter",
  "FlowWorkshop",
  "CommandGrid",
  "HelpTour",
  "Params",
])
const ALLOWED_CRITICALITY = new Set(["critical", "high", "medium"])
const ALLOWED_OWNER_SUITES = new Set([
  "critical-buttons",
  "first-use",
  "command-grid",
  "task-center",
  "flow-workshop",
  "params",
  "help-tour",
  "nonstub",
])
const OWNER_SUITE_FILE_PATTERNS = {
  "critical-buttons": [/critical-buttons\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
  "first-use": [
    /button-behavior\.quick-launch\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/,
    /first-use-guardrails\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/,
  ],
  "command-grid": [/button-behavior\.command-grid\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
  "task-center": [/button-behavior\.task-center\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
  "flow-workshop": [/button-behavior\.flow-workshop\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
  params: [/button-behavior\.params\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
  "help-tour": [/button-behavior\.help-tour\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
  nonstub: [/non-stub.*\.spec\.(ts|tsx|js|jsx|mjs|cjs)$/],
}

function collectFiles(inputPath) {
  if (!existsSync(inputPath)) return []
  const info = statSync(inputPath)
  if (info.isFile()) return [inputPath]
  if (!info.isDirectory()) return []
  const files = []
  const stack = [inputPath]
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
      if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(nextPath)
      }
    }
  }
  return files
}

function toRelative(inputPath) {
  return inputPath.replace(`${ROOT}/`, "")
}

function readStringField(block, fieldName) {
  const fieldIndex = block.indexOf(fieldName)
  if (fieldIndex < 0) return ""
  const colonIndex = block.indexOf(":", fieldIndex + fieldName.length)
  if (colonIndex < 0) return ""
  const tail = block.slice(colonIndex + 1)
  const single = tail.indexOf("'")
  const double = tail.indexOf('"')
  let quoteIndex = -1
  let quote = ""
  if (single >= 0 && (double < 0 || single < double)) {
    quoteIndex = single
    quote = "'"
  } else if (double >= 0) {
    quoteIndex = double
    quote = '"'
  }
  if (quoteIndex < 0) return ""
  const start = quoteIndex + 1
  const end = tail.indexOf(quote, start)
  if (end < 0) return ""
  return tail.slice(start, end).trim()
}

function parseManifestEntries(source) {
  const arrayMatch = source.match(
    /export const\s+BUTTON_BEHAVIOR_MANIFEST\s*=\s*\[([\s\S]*?)\]\s*as const/
  )
  if (!arrayMatch) {
    throw new Error("apps/web/src/testing/button-manifest.ts 缺少 BUTTON_BEHAVIOR_MANIFEST 导出。")
  }

  const objectPattern = /\{([\s\S]*?)\}/g
  const entries = []
  let objectMatch = objectPattern.exec(arrayMatch[1])
  while (objectMatch) {
    const block = objectMatch[1]
    if (block.includes("id:")) {
      const entry = {
        id: readStringField(block, "id"),
        view: readStringField(block, "view"),
        selector: readStringField(block, "selector"),
        owner_suite: readStringField(block, "owner_suite"),
        criticality: readStringField(block, "criticality"),
        expected_effect: readStringField(block, "expected_effect"),
        assertion_type: readStringField(block, "assertion_type"),
        case_id: readStringField(block, "case_id"),
      }
      entries.push(entry)
    }
    objectMatch = objectPattern.exec(arrayMatch[1])
  }

  if (entries.length === 0) {
    throw new Error("BUTTON_BEHAVIOR_MANIFEST 不能为空。")
  }
  return entries
}

function validateManifestEntries(entries) {
  const errors = []
  const idSeen = new Set()
  const caseSeen = new Set()

  for (const entry of entries) {
    const missingFields = Object.entries(entry)
      .filter(([, value]) => !value)
      .map(([key]) => key)
    if (missingFields.length > 0) {
      errors.push(
        `- manifest 条目缺少字段: ${missingFields.join(", ")} (id=${entry.id || "unknown"})`
      )
      continue
    }

    if (!ALLOWED_VIEWS.has(entry.view)) {
      errors.push(`- manifest 条目 view 非法: ${entry.id} -> ${entry.view}`)
    }
    if (!ALLOWED_CRITICALITY.has(entry.criticality)) {
      errors.push(`- manifest 条目 criticality 非法: ${entry.id} -> ${entry.criticality}`)
    }
    if (!ALLOWED_OWNER_SUITES.has(entry.owner_suite)) {
      errors.push(`- manifest 条目 owner_suite 非法: ${entry.id} -> ${entry.owner_suite}`)
    }
    if (idSeen.has(entry.id)) {
      errors.push(`- manifest 条目 id 重复: ${entry.id}`)
    }
    if (caseSeen.has(entry.case_id)) {
      errors.push(`- manifest 条目 case_id 重复: ${entry.case_id}`)
    }

    idSeen.add(entry.id)
    caseSeen.add(entry.case_id)
  }

  return errors
}

function checkWeakAssertions(testFiles) {
  const findings = []
  for (const file of testFiles) {
    const source = readFileSync(file, "utf8")
    for (const pattern of WEAK_ASSERTION_PATTERNS) {
      const hasWeakAssertion = pattern.test(source)
      pattern.lastIndex = 0
      if (hasWeakAssertion) {
        findings.push(`- ${toRelative(file)} 命中弱断言: ${pattern}`)
      }
    }
  }
  return findings
}

function collectCaseMarkers(testFiles) {
  const markerPattern =
    /buttonBehaviorCase\s*\(\s*\{\s*case_id\s*:\s*['"]([^'"]+)['"]\s*,\s*assertion_type\s*:\s*['"]([^'"]+)['"]/gs
  const caseMap = new Map()
  const markerErrors = []

  for (const file of testFiles) {
    const source = readFileSync(file, "utf8")
    let markerMatch = markerPattern.exec(source)
    while (markerMatch) {
      const caseId = markerMatch[1]
      const assertionType = markerMatch[2]
      if (!caseMap.has(caseId)) {
        caseMap.set(caseId, {
          assertionType,
          files: new Set([file]),
          count: 1,
        })
      } else {
        const current = caseMap.get(caseId)
        current.files.add(file)
        current.count += 1
        if (current.assertionType !== assertionType) {
          markerErrors.push(
            `- case_id ${caseId} 的 assertion_type 不一致: ${current.assertionType} vs ${assertionType} (${toRelative(file)})`
          )
        }
      }
      markerMatch = markerPattern.exec(source)
    }
  }

  return { caseMap, markerErrors }
}

function matchesOwnerSuite(ownerSuite, filePath) {
  const relativePath = toRelative(filePath)
  const rules = OWNER_SUITE_FILE_PATTERNS[ownerSuite] ?? []
  return rules.some((rule) => rule.test(relativePath))
}

function collectBehaviorFiles(testFiles) {
  return testFiles.filter((file) => {
    const source = readFileSync(file, "utf8")
    return source.includes("buttonBehaviorCase(")
  })
}

function readArgValue(flagName) {
  const index = process.argv.indexOf(flagName)
  if (index < 0) return ""
  return process.argv[index + 1] ?? ""
}

function runManifestLint() {
  if (!existsSync(MANIFEST_FILE)) {
    console.error(`[button-coverage] missing file: ${toRelative(MANIFEST_FILE)}`)
    process.exit(2)
  }

  const source = readFileSync(MANIFEST_FILE, "utf8")
  const entries = parseManifestEntries(source)
  const manifestErrors = validateManifestEntries(entries)
  if (manifestErrors.length > 0) {
    console.error("[button-coverage] manifest lint failed:")
    for (const error of manifestErrors) console.error(error)
    process.exit(1)
  }

  console.log(`[button-coverage] manifest lint pass: ${entries.length} entries`)
}

function runCoverageGate() {
  const source = readFileSync(MANIFEST_FILE, "utf8")
  const entries = parseManifestEntries(source)

  const manifestErrors = validateManifestEntries(entries)
  if (manifestErrors.length > 0) {
    console.error("[button-coverage] manifest lint failed:")
    for (const error of manifestErrors) console.error(error)
    process.exit(1)
  }

  const testFiles = TEST_ROOTS.flatMap((dir) => collectFiles(dir))
  if (testFiles.length === 0) {
    console.error(
      "[button-coverage] no test files found in tests/frontend-e2e or apps/web/tests/e2e"
    )
    process.exit(2)
  }

  const behaviorFiles = collectBehaviorFiles(testFiles)
  if (behaviorFiles.length === 0) {
    console.error("[button-coverage] no behavior files found with buttonBehaviorCase markers.")
    process.exit(2)
  }

  const weakAssertionFindings = checkWeakAssertions(behaviorFiles)
  if (weakAssertionFindings.length > 0) {
    console.error("[button-coverage] weak assertions are forbidden in behavior gate:")
    for (const finding of weakAssertionFindings) console.error(finding)
    process.exit(1)
  }

  const { caseMap, markerErrors } = collectCaseMarkers(behaviorFiles)
  if (markerErrors.length > 0) {
    console.error("[button-coverage] case marker conflicts:")
    for (const error of markerErrors) console.error(error)
    process.exit(1)
  }

  const missingCaseIds = []
  const assertionTypeMismatch = []
  const ownerSuiteMismatch = []
  const duplicateCaseMarkers = []
  for (const entry of entries) {
    const marker = caseMap.get(entry.case_id)
    if (!marker) {
      missingCaseIds.push(entry)
      continue
    }
    if (!marker.assertionType) {
      assertionTypeMismatch.push(`- ${entry.case_id}: 缺失 assertion_type`)
      continue
    }
    if (marker.assertionType !== entry.assertion_type) {
      assertionTypeMismatch.push(
        `- ${entry.case_id}: manifest=${entry.assertion_type}, tests=${marker.assertionType}`
      )
    }
    if (marker.count !== 1) {
      duplicateCaseMarkers.push(
        `- ${entry.case_id}: 发现 ${marker.count} 个 buttonBehaviorCase 声明，要求恰好 1 个`
      )
    }
    const ownerSuiteMatched = Array.from(marker.files).every((filePath) =>
      matchesOwnerSuite(entry.owner_suite, filePath)
    )
    if (!ownerSuiteMatched) {
      const files = Array.from(marker.files).map((filePath) => toRelative(filePath)).join(", ")
      ownerSuiteMismatch.push(
        `- ${entry.case_id}: owner_suite=${entry.owner_suite}, tests=${files}`
      )
    }
  }

  if (missingCaseIds.length > 0) {
    console.error("[button-coverage] missing e2e behavior cases for manifest entries:")
    for (const item of missingCaseIds) {
      console.error(`- ${item.id} (${item.case_id})`)
    }
    process.exit(1)
  }

  if (assertionTypeMismatch.length > 0) {
    console.error("[button-coverage] assertion_type markers mismatch:")
    for (const mismatch of assertionTypeMismatch) console.error(mismatch)
    process.exit(1)
  }
  if (duplicateCaseMarkers.length > 0) {
    console.error("[button-coverage] each case_id must have exactly one buttonBehaviorCase:")
    for (const mismatch of duplicateCaseMarkers) console.error(mismatch)
    process.exit(1)
  }
  if (ownerSuiteMismatch.length > 0) {
    console.error("[button-coverage] owner_suite mismatch:")
    for (const mismatch of ownerSuiteMismatch) console.error(mismatch)
    process.exit(1)
  }

  const inventoryScript = resolve(ROOT, "scripts/ci/check-button-inventory.mjs")
  const inventoryResult = spawnSync(process.execPath, [inventoryScript], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  })
  if (inventoryResult.status !== 0) {
    console.error("[button-coverage] inventory alignment failed:")
    const output = [inventoryResult.stdout, inventoryResult.stderr]
      .filter((item) => Boolean(item && item.trim()))
      .join("\n")
    if (output) console.error(output)
    process.exit(inventoryResult.status ?? 1)
  }

  console.log(
    `[button-coverage] pass: ${entries.length} manifest entries aligned across behavior and inventory gates.`
  )
}

function main() {
  const mode = readArgValue("--mode") || "coverage"

  if (!existsSync(MANIFEST_FILE)) {
    console.error(`[button-coverage] missing file: ${toRelative(MANIFEST_FILE)}`)
    process.exit(2)
  }

  if (mode === "manifest-lint") {
    runManifestLint()
    return
  }

  runCoverageGate()
}

main()
