import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const TRUTH_GATE_SCRIPT = resolve(REPO_ROOT, "scripts/ci/uiq-test-truth-gate.mjs")

function runTruthGate({ fileName, source }) {
  const root = mkdtempSync(join(tmpdir(), "uiq-truth-gate-cases-"))
  try {
    const testsDir = join(root, "frontend", "src")
    const outDir = join(root, "out")
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(join(testsDir, fileName), source, "utf8")
    const run = spawnSync(
      process.execPath,
      [
        TRUTH_GATE_SCRIPT,
        "--profile",
        "matrix",
        "--strict",
        "false",
        "--paths",
        testsDir,
        "--out-dir",
        outDir,
      ],
      {
        cwd: REPO_ROOT,
        env: process.env,
        encoding: "utf8",
      }
    )
    const report = JSON.parse(readFileSync(join(outDir, "uiq-test-truth-gate-matrix.json"), "utf8"))
    return { run, report }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("uiq-test-truth-gate does not misclassify nested arrow callbacks as missing assertions", () => {
  const { run, report } = runTruthGate({
    fileName: "nested-arrow.test.ts",
    source: `
      import { it, expect } from "vitest"

      it("keeps the outer assertion", () => {
        const values = [1, 2, 3]
        const result = values.map((value) => value * 2)
        expect(result).toEqual([2, 4, 6])
      })
    `,
  })

  assert.equal(run.status, 0)
  assert.equal(report.gate.status, "passed")
  assert.equal(
    report.findings.some((finding) => finding.ruleId === "weak.no_assertion_in_test_case"),
    false
  )
})

test("uiq-test-truth-gate still flags true no-assertion test callbacks", () => {
  const { report } = runTruthGate({
    fileName: "missing-assertion.test.ts",
    source: `
      import { it } from "vitest"

      it("forgets assertions", () => {
        const values = [1, 2, 3]
        values.map((value) => value * 2)
      })
    `,
  })

  assert.equal(report.gate.status, "failed")
  assert.equal(
    report.findings.some((finding) => finding.ruleId === "weak.no_assertion_in_test_case"),
    true
  )
})

test("uiq-test-truth-gate still flags weak truthy matchers", () => {
  const { report } = runTruthGate({
    fileName: "weak-truthy.test.ts",
    source: `
      import { it, expect } from "vitest"

      it("uses toBeTruthy", () => {
        expect("hello").toBeTruthy()
      })
    `,
  })

  assert.equal(report.gate.status, "failed")
  assert.equal(report.findings.some((finding) => finding.ruleId === "weak.to_be_truthy"), true)
})

test("uiq-test-truth-gate ignores setup conditionals when assertions are outside the block", () => {
  const { run, report } = runTruthGate({
    fileName: "setup-conditional.test.ts",
    source: `
      import { it, expect } from "vitest"

      it("allows setup if-blocks", () => {
        if (Math.random() > -1) {
          const local = 42
          void local
        }
        expect("stable").toBe("stable")
      })
    `,
  })

  assert.equal(run.status, 0)
  assert.equal(report.findings.some((finding) => finding.ruleId === "weak.conditional_assertion"), false)
})

test("uiq-test-truth-gate ignores conditional keywords inside string literals", () => {
  const { run, report } = runTruthGate({
    fileName: "string-literal-if.test.ts",
    source: `
      import { it, expect } from "vitest"

      it("allows debugging strings", () => {
        expect("if (value)").toContain("if (")
      })
    `,
  })

  assert.equal(run.status, 0)
  assert.equal(report.findings.some((finding) => finding.ruleId === "weak.conditional_assertion"), false)
})
