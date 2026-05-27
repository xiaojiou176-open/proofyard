import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")
const TARGETS_ROOT = path.join(REPO_ROOT, "config", "targets")

function runTargetSmoke(args: string[] = []) {
  return spawnSync(
    "pnpm",
    ["--dir", "automation", "exec", "tsx", "scripts/run-target-smoke.ts", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    }
  )
}

test("run-target-smoke writes failure report for unsupported driver targets", () => {
  mkdirSync(TARGETS_ROOT, { recursive: true })
  const targetId = `runtime-unsupported-${Date.now()}`
  const targetPath = path.join(TARGETS_ROOT, `${targetId}.json`)

  writeFileSync(
    targetPath,
    JSON.stringify(
      {
        target_id: targetId,
        platform: "macos",
        driver_id: "unsupported-driver",
        base_url: "http://127.0.0.1:17380",
      },
      null,
      2
    ),
    "utf8"
  )

  try {
    const run = runTargetSmoke([`--target=${targetId}`])
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /unsupported driver_id/)
    const reportLine = run.stderr
      .split("\n")
      .find((line) => line.startsWith("report: "))
    assert.ok(reportLine, "expected failure report path in stderr")
    const reportPath = reportLine!.replace(/^report:\s*/, "").trim()
    assert.equal(existsSync(reportPath), true)
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      ok: boolean
      driver_id: string
      target_id: string
      detail: string
      artifacts: { report_path: string | null }
    }
    assert.equal(report.ok, false)
    assert.equal(report.driver_id, "unsupported-driver")
    assert.equal(report.target_id, targetId)
    assert.match(report.detail, /unsupported driver_id/)
    if (report.artifacts.report_path) {
      assert.equal(path.resolve(report.artifacts.report_path), path.resolve(reportPath))
    }
    rmSync(path.dirname(reportPath), { recursive: true, force: true })
  } finally {
    if (existsSync(targetPath)) {
      unlinkSync(targetPath)
    }
  }
})
