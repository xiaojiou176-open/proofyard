import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { pathToFileURL } from "node:url"

const WEB_AUDIT_SCRIPT = resolve("scripts/ci/uiq-gemini-web-audit.mjs")

test("uiq-gemini-web-audit readJsonReport tags missing file with structured reasonCode", async () => {
  const { readJsonReport } = await import(pathToFileURL(WEB_AUDIT_SCRIPT).href)
  const root = mkdtempSync(join(tmpdir(), "uiq-web-audit-missing-json-"))
  try {
    const result = readJsonReport(join(root, "missing.json"), "liveSmoke")
    assert.equal(result.ok, false)
    assert.equal(
      result.reasonCode,
      "gate.uiux.gemini.web_audit.downstream.live_smoke_report.missing_file"
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-web-audit readJsonReport tags invalid JSON with structured reasonCode", async () => {
  const { readJsonReport } = await import(pathToFileURL(WEB_AUDIT_SCRIPT).href)
  const root = mkdtempSync(join(tmpdir(), "uiq-web-audit-invalid-json-"))
  try {
    const target = join(root, "invalid.json")
    writeFileSync(target, "{invalid", "utf8")
    const result = readJsonReport(target, "uiAudit")
    assert.equal(result.ok, false)
    assert.equal(
      result.reasonCode,
      "gate.uiux.gemini.web_audit.downstream.ui_audit_report.invalid_json"
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("uiq-gemini-web-audit downstream failure report preserves structured nested reason codes", async () => {
  const { buildDownstreamJsonFailureReport } = await import(pathToFileURL(WEB_AUDIT_SCRIPT).href)
  const report = buildDownstreamJsonFailureReport({
    strict: true,
    liveSmokeResult: {
      ok: false,
      source: "liveSmoke",
      path: "/tmp/live.json",
      reasonCode: "gate.uiux.gemini.web_audit.downstream.live_smoke_report.missing_file",
      errorMessage: "ENOENT: no such file",
    },
    uiAuditResult: {
      ok: false,
      source: "uiAudit",
      path: "/tmp/ui.json",
      reasonCode: "gate.uiux.gemini.web_audit.downstream.ui_audit_report.invalid_json",
      errorMessage: "Unexpected token",
    },
  })

  assert.equal(report.status, "failed")
  assert.equal(report.reasonCode, "gate.uiux.gemini.web_audit.failed.downstream_json_unreadable")
  assert.equal(
    report.liveSmoke.reasonCode,
    "gate.uiux.gemini.web_audit.downstream.live_smoke_report.missing_file"
  )
  assert.equal(
    report.uiAudit.reasonCode,
    "gate.uiux.gemini.web_audit.downstream.ui_audit_report.invalid_json"
  )
  assert.equal(report.downstreamErrors.length, 2)
  assert.deepEqual(
    report.downstreamErrors.map((item) => item.reasonCode),
    [
      "gate.uiux.gemini.web_audit.downstream.live_smoke_report.missing_file",
      "gate.uiux.gemini.web_audit.downstream.ui_audit_report.invalid_json",
    ]
  )
})

test("uiq-gemini-web-audit main emits structured reasonCode when downstream JSON is unreadable", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-web-audit-main-"))
  try {
    const outDir = join(root, "artifacts")
    const liveScript = join(root, "live.mock.mjs")
    const uiScript = join(root, "ui.mock.mjs")

    writeFileSync(
      liveScript,
      `
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
const target = process.env.UIQ_GEMINI_WEB_AUDIT_OUT_DIR + "/uiq-gemini-live-smoke-gate.json"
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, "{bad-json", "utf8")
`,
      "utf8"
    )

    writeFileSync(
      uiScript,
      `
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
const target = process.env.UIQ_GEMINI_WEB_AUDIT_OUT_DIR + "/uiq-gemini-uiux-audit.json"
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify({ status: "passed", reasonCode: "gate.ai_review.passed", fileCount: 1 }), "utf8")
`,
      "utf8"
    )

    const run = spawnSync(process.execPath, [WEB_AUDIT_SCRIPT, "--strict", "false"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        UIQ_GEMINI_WEB_AUDIT_OUT_DIR: outDir,
        UIQ_GEMINI_WEB_AUDIT_LIVE_SMOKE_SCRIPT: liveScript,
        UIQ_GEMINI_WEB_AUDIT_UIUX_AUDIT_SCRIPT: uiScript,
      },
    })

    assert.equal(run.status, 0)
    const reportPath = join(outDir, "uiq-gemini-web-audit.json")
    const report = JSON.parse(readFileSync(reportPath, "utf8"))
    assert.equal(report.reasonCode, "gate.uiux.gemini.web_audit.failed.downstream_json_unreadable")
    assert.equal(
      report.liveSmoke.reasonCode,
      "gate.uiux.gemini.web_audit.downstream.live_smoke_report.invalid_json"
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
