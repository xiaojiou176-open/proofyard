#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildGate,
  collectCandidateFiles,
  isLikelyTestFile,
  normalizePath,
  outputPrefix,
  parseArgs,
  renderMarkdown,
} from "./uiq-test-truth-gate-support.mjs"

const INTERACTION_KEYWORDS = [
  "click(",
  "fill(",
  "type(",
  "press(",
  "selectOption(",
  "check(",
  "uncheck(",
  "dragTo(",
]
const TO_BE_DEFINED_ALLOW_TAG = "uiq-allow-toBeDefined"
const TO_BE_TRUTHY_ALLOW_TAG = "uiq-allow-toBeTruthy"

function lineAt(source, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

function normalizeLiteralToken(token) {
  const raw = stripWrappingParens(String(token || "").trim())
  if (/^(true|false|null)$/i.test(raw)) return raw.toLowerCase()
  if (/^undefined$/i.test(raw)) return "undefined"
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return String(Number(raw))
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("`") && raw.endsWith("`"))
  ) {
    const inner = raw.slice(1, -1)
    return `str:${inner}`
  }
  return raw
}

function stripWrappingParens(token) {
  let raw = String(token || "").trim()
  while (raw.startsWith("(") && raw.endsWith(")")) {
    let depth = 0
    let balanced = true
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i]
      if (ch === "(") depth += 1
      if (ch === ")") depth -= 1
      if (depth < 0) {
        balanced = false
        break
      }
      if (depth === 0 && i < raw.length - 1) {
        balanced = false
        break
      }
    }
    if (!balanced || depth !== 0) break
    raw = raw.slice(1, -1).trim()
  }
  return raw
}

function findLiteralAssertionFindings(source, file) {
  const findings = []
  const literal =
    "(?:\\(+\\s*)?(true|false|null|undefined|-?(?:0|[1-9]\\\\d*)(?:\\\\.\\\\d+)?|'(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)(?:\\s*\\)+)?"
  const matcher = "(?:toBe|toEqual|toStrictEqual)"
  const pattern = new RegExp(
    `expect\\\\s*\\\\(\\\\s*${literal}\\\\s*\\\\)\\\\s*\\\\.\\\\s*${matcher}\\\\s*\\\\(\\\\s*${literal}\\\\s*\\\\)`,
    "g"
  )
  let match = pattern.exec(source)
  while (match) {
    const left = normalizeLiteralToken(match[1])
    const right = normalizeLiteralToken(match[2])
    if (left === right) {
      findings.push({
        ruleId: "weak.literal_assertion_same_literal",
        file,
        line: lineAt(source, match.index),
        message: "Detected trivial literal assertion with identical expected/actual values.",
        snippet: match[0],
      })
    }
    match = pattern.exec(source)
  }
  return findings
}

function hasAllowCommentForToBeDefined(source, index) {
  const lines = source.split(/\r?\n/)
  const lineNumber = lineAt(source, index)
  const current = lines[lineNumber - 1] ?? ""
  const prev = lines[lineNumber - 2] ?? ""
  return current.includes(TO_BE_DEFINED_ALLOW_TAG) || prev.includes(TO_BE_DEFINED_ALLOW_TAG)
}

function findToBeDefinedFindings(source, file) {
  const findings = []
  const pattern = /\.\s*toBeDefined\s*\(\s*\)/g
  let match = pattern.exec(source)
  while (match) {
    if (hasAllowCommentForToBeDefined(source, match.index)) {
      match = pattern.exec(source)
      continue
    }
    findings.push({
      ruleId: "weak.to_be_defined",
      file,
      line: lineAt(source, match.index),
      message: `Detected weak assertion matcher toBeDefined(). If unavoidable, annotate with // ${TO_BE_DEFINED_ALLOW_TAG}: <reason>.`,
      snippet: match[0],
    })
    match = pattern.exec(source)
  }
  return findings
}

function hasAllowCommentForToBeTruthy(source, index) {
  const lines = source.split(/\r?\n/)
  const lineNumber = lineAt(source, index)
  const current = lines[lineNumber - 1] ?? ""
  const prev = lines[lineNumber - 2] ?? ""
  return current.includes(TO_BE_TRUTHY_ALLOW_TAG) || prev.includes(TO_BE_TRUTHY_ALLOW_TAG)
}

function findToBeTruthyFindings(source, file) {
  const findings = []
  const pattern = /\.\s*toBeTruthy\s*\(\s*\)/g
  let match = pattern.exec(source)
  while (match) {
    if (hasAllowCommentForToBeTruthy(source, match.index)) {
      match = pattern.exec(source)
      continue
    }
    findings.push({
      ruleId: "weak.to_be_truthy",
      file,
      line: lineAt(source, match.index),
      message: `Detected weak assertion matcher toBeTruthy(). If unavoidable, annotate with // ${TO_BE_TRUTHY_ALLOW_TAG}: <reason>.`,
      snippet: match[0],
    })
    match = pattern.exec(source)
  }
  return findings
}

function findSkipFindings(source, file) {
  const findings = []
  const patterns = [/\b(?:test|it|describe)\s*\.\s*skip\s*\(/g, /\bt\s*\.\s*skip\s*\(/g]
  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match) {
      findings.push({
        ruleId: "weak.skip_usage",
        file,
        line: lineAt(source, match.index),
        message:
          "Detected skip marker; test/it/describe.skip() and node:test t.skip() are forbidden in this gate.",
        snippet: match[0],
      })
      match = pattern.exec(source)
    }
  }
  return findings
}

function findOnlyFindings(source, file) {
  const findings = []
  const patterns = [/\b(?:test|it|describe)\s*\.\s*only\s*\(/g, /\b(?:fit|fdescribe)\s*\(/g]
  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match) {
      findings.push({
        ruleId: "weak.only_usage",
        file,
        line: lineAt(source, match.index),
        message:
          "Detected focused test marker; test/it/describe.only() and fit/fdescribe() are forbidden in this gate.",
        snippet: match[0],
      })
      match = pattern.exec(source)
    }
  }
  return findings
}

function findE2ERealismFindings(source, file) {
  const normalized = normalizePath(file).toLowerCase()
  if (!normalized.includes("/e2e/")) return []
  const lower = source.toLowerCase()
  const hasInteraction = INTERACTION_KEYWORDS.some((keyword) =>
    lower.includes(keyword.toLowerCase())
  )
  const hasExpect = /\bexpect\s*\(/.test(source)
  const findings = []
  if (!hasInteraction) {
    findings.push({
      ruleId: "weak.e2e_missing_interaction",
      file,
      line: 1,
      message: "E2E realism violation: missing required user interaction keyword.",
      snippet: INTERACTION_KEYWORDS.join(" | "),
    })
  }
  if (!hasExpect) {
    findings.push({
      ruleId: "weak.e2e_missing_expect",
      file,
      line: 1,
      message: "E2E realism violation: missing at least one expect(...) assertion.",
      snippet: "expect(...)",
    })
  }
  return findings
}

function hasAssertionToken(source) {
  return /\bexpect\s*\(|\bexpect\.\s*assertions\s*\(|\bassert\s*\(|\bassert\.\w+\s*\(/.test(source)
}

function isNodeAssertStyleTestFile(source) {
  const usesNodeTest = /from\s+["']node:test["']/.test(source)
  const usesNodeAssert = /from\s+["']node:assert(?:\/strict)?["']/.test(source)
  return usesNodeTest && usesNodeAssert
}

function findMatchingBracket(source, startIndex, openChar, closeChar) {
  let depth = 0
  let quote = ""
  let escaped = false
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      continue
    }
    if (ch === openChar) depth += 1
    if (ch === closeChar) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevelArguments(source) {
  const args = []
  let start = 0
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "(") parenDepth += 1
    if (ch === ")") parenDepth -= 1
    if (ch === "{") braceDepth += 1
    if (ch === "}") braceDepth -= 1
    if (ch === "[") bracketDepth += 1
    if (ch === "]") bracketDepth -= 1
    if (ch === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      args.push(source.slice(start, i).trim())
      start = i + 1
    }
  }
  const tail = source.slice(start).trim()
  if (tail) args.push(tail)
  return args
}

function findTopLevelArrow(source) {
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length - 1; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "(") parenDepth += 1
    if (ch === ")") parenDepth -= 1
    if (ch === "{") braceDepth += 1
    if (ch === "}") braceDepth -= 1
    if (ch === "[") bracketDepth += 1
    if (ch === "]") bracketDepth -= 1
    if (
      ch === "=" &&
      source[i + 1] === ">" &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      bracketDepth === 0
    ) {
      return i
    }
  }
  return -1
}

function extractCallbackBody(callbackSource, absoluteOffset) {
  const trimmed = callbackSource.trim()
  if (!trimmed) return null
  const normalized = trimmed.startsWith("async ") ? trimmed.slice(6).trim() : trimmed
  if (normalized.startsWith("function")) {
    const localBodyStart = normalized.indexOf("{")
    if (localBodyStart < 0) return null
    const bodyStart = absoluteOffset + callbackSource.indexOf("{", callbackSource.indexOf(normalized))
    const bodyEnd = findMatchingBracket(callbackSource, callbackSource.indexOf("{", callbackSource.indexOf(normalized)), "{", "}")
    if (bodyEnd < 0) return null
    return {
      start: bodyStart,
      end: absoluteOffset + bodyEnd,
      body: callbackSource.slice(callbackSource.indexOf("{", callbackSource.indexOf(normalized)), bodyEnd + 1),
    }
  }
  const arrowIndex = findTopLevelArrow(normalized)
  if (arrowIndex < 0) return null
  const callbackOffset = callbackSource.indexOf(normalized)
  const bodyText = normalized.slice(arrowIndex + 2).trim()
  const bodyStartInNormalized = arrowIndex + 2 + normalized.slice(arrowIndex + 2).indexOf(bodyText)
  if (bodyText.startsWith("{")) {
    const localBodyStart = bodyStartInNormalized
    const bodyEnd = findMatchingBracket(normalized, localBodyStart, "{", "}")
    if (bodyEnd < 0) return null
    return {
      start: absoluteOffset + callbackOffset + localBodyStart,
      end: absoluteOffset + callbackOffset + bodyEnd,
      body: normalized.slice(localBodyStart, bodyEnd + 1),
    }
  }
  return {
    start: absoluteOffset + callbackOffset + bodyStartInNormalized,
    end: absoluteOffset + callbackOffset + bodyStartInNormalized + bodyText.length - 1,
    body: bodyText,
  }
}

function collectTestCases(source, file) {
  const cases = []
  const matcher = /\b(?:it|test)\s*(?:\.\s*\w+)?\s*\(/g
  let match = matcher.exec(source)
  while (match) {
    const openParenIdx = source.indexOf("(", match.index)
    if (openParenIdx < 0) {
      match = matcher.exec(source)
      continue
    }
    const closeParenIdx = findMatchingBracket(source, openParenIdx, "(", ")")
    if (closeParenIdx < 0) {
      match = matcher.exec(source)
      continue
    }
    const argsText = source.slice(openParenIdx + 1, closeParenIdx)
    const args = splitTopLevelArguments(argsText)
    const callbackArg = args.at(-1)
    if (!callbackArg) {
      match = matcher.exec(source)
      continue
    }
    const callbackOffset = source.lastIndexOf(callbackArg, closeParenIdx)
    if (callbackOffset < 0) {
      match = matcher.exec(source)
      continue
    }
    const callback = extractCallbackBody(callbackArg, callbackOffset)
    if (callback) {
      cases.push({
        file,
        line: lineAt(source, match.index),
        start: callback.start,
        end: callback.end,
        body: callback.body,
      })
    }
    match = matcher.exec(source)
  }
  return cases
}

function findNoAssertionFindings(source, file) {
  const findings = []
  const testCases = collectTestCases(source, file)
  const allowNodeAssertFileLevelBypass =
    isNodeAssertStyleTestFile(source) && hasAssertionToken(source)
  for (const item of testCases) {
    if (hasAssertionToken(item.body)) continue
    if (allowNodeAssertFileLevelBypass) continue
    findings.push({
      ruleId: "weak.no_assertion_in_test_case",
      file,
      line: item.line,
      message: "Detected test case without assertions (expect/assert).",
      snippet: "test()/it() callback has no assertion",
    })
  }
  return findings
}

function findStatementEnd(source, startIndex) {
  let quote = ""
  let escaped = false
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "(") parenDepth += 1
    if (ch === ")") parenDepth -= 1
    if (ch === "{") braceDepth += 1
    if (ch === "}") braceDepth -= 1
    if (ch === "[") bracketDepth += 1
    if (ch === "]") bracketDepth -= 1
    if ((ch === ";" || ch === "\n") && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i
    }
  }
  return source.length
}

function isIndexInsideQuotedRegion(source, targetIndex) {
  let quote = ""
  let escaped = false
  for (let i = 0; i < source.length && i < targetIndex; i += 1) {
    const ch = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch
    }
  }
  return quote !== ""
}

function findConditionalBlockExpect(source, keyword) {
  const matcher = new RegExp(`\\b${keyword}\\b`, "g")
  let match = matcher.exec(source)
  while (match) {
    if (isIndexInsideQuotedRegion(source, match.index)) {
      match = matcher.exec(source)
      continue
    }
    let cursor = match.index + keyword.length
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
    if (source[cursor] === "(") {
      const conditionEnd = findMatchingBracket(source, cursor, "(", ")")
      if (conditionEnd < 0) {
        match = matcher.exec(source)
        continue
      }
      cursor = conditionEnd + 1
      while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
    }
    if (source[cursor] === "{") {
      const blockEnd = findMatchingBracket(source, cursor, "{", "}")
      if (blockEnd < 0) {
        match = matcher.exec(source)
        continue
      }
      const block = source.slice(cursor, blockEnd + 1)
      if (/\bexpect\s*\(/.test(block)) return true
      match = matcher.exec(source)
      continue
    }
    const statementEnd = findStatementEnd(source, cursor)
    const statement = source.slice(cursor, statementEnd)
    if (/\bexpect\s*\(/.test(statement)) return true
    match = matcher.exec(source)
  }
  return false
}

function findConditionalAssertionFindings(source, file) {
  const findings = []
  const testCases = collectTestCases(source, file)
  const inlineConditionalPatterns = [/\?(?!\.)\s*[^:\n]*\bexpect\s*\(/m, /\b\w+\s*(?:&&|\|\|)\s*expect\s*\(/m]

  for (const item of testCases) {
    if (!/\bexpect\s*\(/.test(item.body)) continue
    const hit =
      findConditionalBlockExpect(item.body, "if") ||
      findConditionalBlockExpect(item.body, "catch") ||
      inlineConditionalPatterns.some((pattern) => pattern.test(item.body))
    if (!hit) continue
    findings.push({
      ruleId: "weak.conditional_assertion",
      file,
      line: item.line,
      message:
        "Detected conditional assertion pattern (if/catch/ternary/short-circuit around expect).",
      snippet: "conditional expect(...) pattern",
    })
  }
  return findings
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const { scopeMode, resolvedRoots, candidateFiles: dedupedCandidates } = collectCandidateFiles(
    options
  )
  const testFiles = dedupedCandidates.filter(isLikelyTestFile)
  const findings = []

  for (const file of testFiles) {
    const source = readFileSync(file, "utf8")
    findings.push(...findLiteralAssertionFindings(source, file))
    findings.push(...findToBeTruthyFindings(source, file))
    findings.push(...findToBeDefinedFindings(source, file))
    findings.push(...findNoAssertionFindings(source, file))
    findings.push(...findConditionalAssertionFindings(source, file))
    findings.push(...findSkipFindings(source, file))
    findings.push(...findOnlyFindings(source, file))
    findings.push(...findE2ERealismFindings(source, file))
  }

  const gate = buildGate(testFiles.length, findings.length, scopeMode)
  const report = {
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    strict: options.strict,
    scan: {
      scopeMode,
      roots: resolvedRoots,
      candidateFiles: dedupedCandidates.length,
      testFiles: testFiles.length,
    },
    gate,
    findings,
  }

  let outJson = "(disabled)"
  let outMd = "(disabled)"
  if (options.writeArtifacts) {
    mkdirSync(resolve(options.outDir), { recursive: true })
    outJson = resolve(options.outDir, `${outputPrefix}-${options.profile}.json`)
    outMd = resolve(options.outDir, `${outputPrefix}-${options.profile}.md`)
    writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8")
    writeFileSync(outMd, renderMarkdown(report), "utf8")
  }

  console.log(
    `[uiq-test-truth-gate] gate_status=${gate.status} reason_code=${gate.reasonCode} findings=${findings.length} test_files=${testFiles.length}`
  )
  console.log(`[uiq-test-truth-gate] artifact_json=${outJson}`)
  console.log(`[uiq-test-truth-gate] artifact_md=${outMd}`)

  if (options.strict && gate.status !== "passed") {
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[uiq-test-truth-gate] error: ${message}`)
  process.exit(2)
}
