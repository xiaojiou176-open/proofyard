import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { runSecurity } from "./security.js"

function makeBaseDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(resolve(dir, "security"), { recursive: true })
  mkdirSync(resolve(dir, "metrics"), { recursive: true })
  return dir
}

test("runSecurity builtin scan emits clusters and tickets for findings", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "uiq-security-root-"))
  const baseDir = makeBaseDir("uiq-security-base-")
  writeFileSync(
    resolve(rootDir, "sample.ts"),
    [
      'const API_KEY = "super-secret-token-value";',
      "const endpoint = 'http://example.test';",
      "eval('danger')",
    ].join("\n"),
    "utf8"
  )

  try {
    const result = runSecurity(baseDir, {
      rootDir,
      engine: "builtin",
      maxFileSizeKb: 512,
      includeExtensions: [".ts"],
      excludeDirs: [],
    })

    assert.equal(result.executionStatus, "ok")
    assert.equal(result.scannedFiles, 1)
    assert.ok(result.totalIssueCount >= 3)
    assert.ok(result.clusters.byRule.length >= 1)
    assert.ok(result.tickets.length >= 1)
    assert.match(readFileSync(resolve(baseDir, result.reportPath), "utf8"), /"executionStatus": "ok"/)
    assert.match(readFileSync(resolve(baseDir, result.ticketsPath), "utf8"), /"ticketId":/)
  } finally {
    rmSync(rootDir, { recursive: true, force: true })
    rmSync(baseDir, { recursive: true, force: true })
  }
})

test("runSecurity blocks semgrep mode when executable is unavailable", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "uiq-security-root-semgrep-"))
  const baseDir = makeBaseDir("uiq-security-base-semgrep-")
  const originalPath = process.env.PATH
  process.env.PATH = "/nonexistent"

  try {
    const result = runSecurity(baseDir, {
      rootDir,
      engine: "semgrep",
      maxFileSizeKb: 512,
      includeExtensions: [".ts"],
      excludeDirs: [],
    })

    assert.equal(result.executionStatus, "blocked")
    assert.equal(result.blockedReason, "semgrep_not_available")
    assert.match(String(result.executionReasonCode), /^security\.semgrep\.blocked\./)
  } finally {
    process.env.PATH = originalPath
    rmSync(rootDir, { recursive: true, force: true })
    rmSync(baseDir, { recursive: true, force: true })
  }
})
