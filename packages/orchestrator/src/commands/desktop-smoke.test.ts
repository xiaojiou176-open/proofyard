import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runDesktopSmoke } from "./desktop-smoke.js"

test("runDesktopSmoke fails closed for operator-manual lane", async (t) => {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-desktop-smoke-"))
  t.after(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })
  mkdirSync(join(baseDir, "metrics"), { recursive: true })

  const result = await runDesktopSmoke(baseDir, {
    targetType: "tauri",
    app: "/Applications/Prooftrail.app",
  })
  assert.equal(result.status, "passed")
  assert.equal(result.reasonCode, "desktop.smoke.operator_manual_only")
  assert.match(result.detail, /operator-manual lane/)

  const stored = JSON.parse(readFileSync(join(baseDir, "metrics/desktop-smoke.json"), "utf8")) as {
    status?: string
    reasonCode?: string
  }
  assert.equal(stored.reasonCode, "desktop.smoke.operator_manual_only")
  assert.equal(stored.status, "passed")
})
