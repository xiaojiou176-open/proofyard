#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"

const API_ROOT = path.join(process.cwd(), "apps/api/app/api")
const FORBIDDEN_CALL = /\b(check_token|check_rate_limit|requester_id)\s*\(/g
const SAFE_CALL = /\brequire_(access|actor)\s*\(|\bdef\s+require_[A-Za-z0-9_]+\s*\(/

function toRepoPath(absolutePath) {
  return path.relative(process.cwd(), absolutePath).replaceAll(path.sep, "/")
}

function walkPythonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return []
  }
  const files = []
  const stack = [dirPath]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith(".py")) {
        files.push(fullPath)
      }
    }
  }
  return files
}

function main() {
  const pythonFiles = walkPythonFiles(API_ROOT)
  if (pythonFiles.length === 0) {
    console.log("[access-control-usage] pass: no api python files found")
    process.exit(0)
  }

  const violations = []

  for (const filePath of pythonFiles) {
    const content = fs.readFileSync(filePath, "utf8")
    const hasSafePattern = SAFE_CALL.test(content)
    const lines = content.split(/\r?\n/)
    const hits = []

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const match = line.match(FORBIDDEN_CALL)
      if (!match) {
        continue
      }
      for (const token of match) {
        hits.push({
          line: index + 1,
          token: token.replace(/\(.*/, ""),
          text: line.trim(),
        })
      }
    }

    if (hits.length > 0 && !hasSafePattern) {
      violations.push({
        file: toRepoPath(filePath),
        hits,
      })
    }
  }

  if (violations.length === 0) {
    console.log(
      "[access-control-usage] pass: apps/api/app/api uses require_access/require_actor access pattern"
    )
    process.exit(0)
  }

  console.error(
    `[access-control-usage] failed: ${violations.length} file(s) call check_token/check_rate_limit/requester_id without require_access/require_actor`
  )
  for (const violation of violations) {
    console.error(`- ${violation.file}`)
    for (const hit of violation.hits) {
      console.error(`  - L${hit.line} ${hit.token} -> ${hit.text}`)
    }
  }
  process.exit(1)
}

main()
