import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  discoverUiFiles,
  evaluateUiFoundation,
  extractJsonObject,
  resolveGeminiApiKey,
  validateAuditPayload,
  writeArtifacts,
} from "./uiq-gemini-uiux-audit.mjs"

function withEnv(overrides, fn) {
  const snapshot = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = String(value)
    }
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test("extractJsonObject parses direct JSON payload", () => {
  const parsed = extractJsonObject('{"passed":true,"issues":[]}')
  assert.deepEqual(parsed, { passed: true, issues: [] })
})

test("extractJsonObject parses fenced JSON payload", () => {
  const parsed = extractJsonObject(
    "```json\n{\"passed\":false,\"issues\":[{\"severity\":\"warning\"}]}\n```"
  )
  assert.equal(parsed?.passed, false)
  assert.equal(Array.isArray(parsed?.issues), true)
})

test("extractJsonObject rejects near-JSON payload without unsafe eval fallback", () => {
  const parsed = extractJsonObject('{"passed": true, "issues": [], "x": (function(){return 1})()}')
  assert.equal(parsed, null)
})

test("resolveGeminiApiKey prefers LIVE_GEMINI_API_KEY after GEMINI_API_KEY", () => {
  withEnv(
    {
      GEMINI_API_KEY: "",
      LIVE_GEMINI_API_KEY: "live-key",
    },
    () => {
      const resolved = resolveGeminiApiKey()
      assert.equal(resolved.key, "live-key")
      assert.equal(resolved.source, "process.env.LIVE_GEMINI_API_KEY")
    }
  )
})

test("writeArtifacts writes both json and markdown artifacts", () => {
  const outDir = mkdtempSync(join(tmpdir(), "uiq-gemini-uiux-audit-"))
  try {
    const report = {
      status: "blocked",
      reasonCode: "gate.uiux.gemini.blocked.missing_api_key",
      model: "gemini-3-flash-preview",
      apiKeySource: "missing",
      fileCount: 1,
      analyzedFileCount: 0,
      skippedFileCount: 1,
      httpStatus: null,
      durationMs: null,
      message: "missing key",
      issues: [],
    }
    const artifacts = writeArtifacts(report, outDir)
    const json = JSON.parse(readFileSync(artifacts.jsonPath, "utf8"))
    const markdown = readFileSync(artifacts.mdPath, "utf8")
    assert.equal(json.reasonCode, report.reasonCode)
    assert.match(markdown, /# Gemini UI\/UX Audit/)
    assert.match(markdown, /apiKeySource: missing/)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test("discoverUiFiles finds default apps/web/apps web ui sources and skips test files", () => {
  const files = discoverUiFiles()
  assert.ok(files.some((file) => file === "apps/web/src/styles.css"))
  assert.ok(files.some((file) => file === "apps/web/src/styles.css"))
  assert.ok(!files.some((file) => file.includes(".test.")))
  assert.ok(!files.some((file) => file.includes(".spec.")))
})

test("evaluateUiFoundation fails when shadcn components config is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-ui-foundation-missing-config-"))
  try {
    mkdirSync(join(root, "apps/web/src"), { recursive: true })
    mkdirSync(join(root, "apps/web/src"), { recursive: true })
    writeFileSync(
      join(root, "apps/web/src/styles.css"),
      ":root{--background:#fff;--foreground:#111;--primary:#00f;--ring:#00f;--motion-duration-fast:1ms;--motion-duration-emphasized:2ms;--ui-control-size:44px;}@media (prefers-reduced-motion: reduce){*{animation:none;}}",
      "utf8"
    )
    writeFileSync(
      join(root, "apps/web/src/styles.css"),
      ":root{--background:#fff;--foreground:#111;--primary:#00f;--ring:#00f;--motion-duration-fast:1ms;--motion-duration-emphasized:2ms;--ui-control-size:44px;}@media (prefers-reduced-motion: reduce){*{animation:none;}}",
      "utf8"
    )

    const report = evaluateUiFoundation({ cwd: root, uiFiles: [] })
    assert.equal(report.passed, false)
    assert.ok(report.issues.some((issue) => issue.file === "apps/web/components.json"))
    assert.ok(report.issues.some((issue) => issue.severity === "error"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("evaluateUiFoundation passes with valid shadcn config, tokens, and ui primitive usage", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-ui-foundation-pass-"))
  try {
    mkdirSync(join(root, "apps/web/src/components"), { recursive: true })
    mkdirSync(join(root, "apps/web/src/components"), { recursive: true })
    writeFileSync(
      join(root, "apps/web/components.json"),
      JSON.stringify(
        {
          style: "new-york",
          tailwind: { cssVariables: true },
          aliases: { ui: "../packages/ui/src", components: "../packages/ui/src" },
        },
        null,
        2
      ),
      "utf8"
    )
    const stylePayload =
      ":root{--background:#fff;--foreground:#111;--primary:#00f;--ring:#00f;--motion-duration-fast:1ms;--motion-duration-emphasized:2ms;--ui-control-size:44px;}@media (prefers-reduced-motion: reduce){*{animation:none;}}"
    writeFileSync(join(root, "apps/web/src/styles.css"), stylePayload, "utf8")
    writeFileSync(join(root, "apps/web/src/styles.css"), stylePayload, "utf8")

    const uiFiles = []
    for (let i = 0; i < 5; i += 1) {
      const rel = `apps/web/src/components/ui-${i}.tsx`
      writeFileSync(join(root, rel), 'import { Button } from "@uiq/ui"\nexport const Ui = () => <Button />\n', "utf8")
      uiFiles.push(rel)
    }
    for (let i = 0; i < 3; i += 1) {
      const rel = `apps/web/src/components/ui-${i}.tsx`
      writeFileSync(join(root, rel), 'import { Card } from "@uiq/ui"\nexport const Ui = () => <Card />\n', "utf8")
      uiFiles.push(rel)
    }

    const report = evaluateUiFoundation({ cwd: root, uiFiles })
    assert.equal(report.passed, true)
    assert.equal(report.issues.filter((issue) => issue.severity === "error").length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("validateAuditPayload rejects malformed payloads", () => {
  assert.deepEqual(validateAuditPayload(null), { ok: false, reason: "invalid_response" })
  assert.deepEqual(validateAuditPayload({ passed: true, summary: 1, issues: [] }), {
    ok: false,
    reason: "schema_mismatch",
  })
  assert.deepEqual(
    validateAuditPayload({
      passed: true,
      summary: "ok",
      issues: [{ file: "x.tsx", line: 1, severity: "error", category: "ux", message: "m" }],
    }),
    { ok: true }
  )
})
