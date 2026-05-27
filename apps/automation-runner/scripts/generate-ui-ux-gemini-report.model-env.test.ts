import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPrompt,
  extToMime,
  extractThoughtSignatures,
  findLatestRunDir,
  gatherErrorContext,
  parseBoolean,
  parseTopN,
  pickArtifacts,
  resolveGeminiModelFromEnv,
  resolveIncludeThoughts,
  toInlineDataPart,
  validateReasonCodes,
} from "./generate-ui-ux-gemini-report.js"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

test("resolveGeminiModelFromEnv uses primary model in normal mode", () => {
  const model = resolveGeminiModelFromEnv(false, {
    GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
    GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
  })

  assert.equal(model, "models/gemini-3.1-pro-preview")
})

test("resolveGeminiModelFromEnv trims primary model value in normal mode", () => {
  const model = resolveGeminiModelFromEnv(false, {
    GEMINI_MODEL_PRIMARY: "  models/gemini-3.1-pro-preview  ",
    GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
  })

  assert.equal(model, "models/gemini-3.1-pro-preview")
})

test("resolveGeminiModelFromEnv uses flash model in speed mode", () => {
  const model = resolveGeminiModelFromEnv(true, {
    GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
    GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
  })

  assert.equal(model, "models/gemini-3-flash-preview")
})

test("resolveGeminiModelFromEnv trims flash model value in speed mode", () => {
  const model = resolveGeminiModelFromEnv(true, {
    GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
    GEMINI_MODEL_FLASH: "  models/gemini-3-flash-preview  ",
  })

  assert.equal(model, "models/gemini-3-flash-preview")
})

test("resolveGeminiModelFromEnv fail-fast when speed mode lacks flash model", () => {
  assert.throws(
    () =>
      resolveGeminiModelFromEnv(true, { GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview" }),
    /GEMINI_MODEL_FLASH is required when --speed_mode=true/
  )
})

test("resolveGeminiModelFromEnv fail-fast when speed mode has blank flash model", () => {
  assert.throws(
    () =>
      resolveGeminiModelFromEnv(true, {
        GEMINI_MODEL_PRIMARY: "models/gemini-3.1-pro-preview",
        GEMINI_MODEL_FLASH: "   ",
      }),
    /GEMINI_MODEL_FLASH is required when --speed_mode=true/
  )
})

test("resolveGeminiModelFromEnv fail-fast when normal mode lacks primary model env", () => {
  assert.throws(
    () => resolveGeminiModelFromEnv(false, { GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview" }),
    /GEMINI_MODEL_PRIMARY is required when --speed_mode=false/
  )
})

test("resolveGeminiModelFromEnv fail-fast when normal mode has blank primary model env", () => {
  assert.throws(
    () =>
      resolveGeminiModelFromEnv(false, {
        GEMINI_MODEL_PRIMARY: "   ",
        GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
      }),
    /GEMINI_MODEL_PRIMARY is required when --speed_mode=false/
  )
})

test("resolveGeminiModelFromEnv rejects legacy GEMINI_MODEL alias", () => {
  assert.throws(
    () =>
      resolveGeminiModelFromEnv(false, {
        GEMINI_MODEL: "models/gemini-3.1-pro-preview",
        GEMINI_MODEL_FLASH: "models/gemini-3-flash-preview",
      }),
    /GEMINI_MODEL_PRIMARY is required when --speed_mode=false/
  )
})

test("parseBoolean respects fallback and rejects invalid tokens", () => {
  assert.equal(parseBoolean(null, true), true)
  assert.equal(parseBoolean(" true ", false), true)
  assert.equal(parseBoolean("FALSE", true), false)
  assert.throws(() => parseBoolean("maybe", false), /--speed_mode must be true\|false/)
})

test("parseTopN respects fallback and range validation", () => {
  assert.equal(parseTopN(null, 3), 3)
  assert.equal(parseTopN("", 4), 4)
  assert.equal(parseTopN("5", 3), 5)
  assert.throws(() => parseTopN("0", 3), /--top_screenshots must be integer in \[1,10\]/)
})

test("resolveIncludeThoughts follows explicit env before speed fallback", () => {
  const previous = process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS
  try {
    delete process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS
    assert.equal(resolveIncludeThoughts(false), true)
    assert.equal(resolveIncludeThoughts(true), false)
    process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS = "on"
    assert.equal(resolveIncludeThoughts(true), true)
    process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS = "off"
    assert.equal(resolveIncludeThoughts(false), false)
  } finally {
    if (previous === undefined) delete process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS
    else process.env.AI_REVIEW_GEMINI_INCLUDE_THOUGHTS = previous
  }
})

test("extractThoughtSignatures distinguishes present, missing and malformed payloads", () => {
  assert.deepEqual(
    extractThoughtSignatures({
      candidates: [{ content: { parts: [{ thoughtSignature: "sig-1" }, { thought: { signature: "sig-2" } }] } }],
    }),
    {
      status: "present",
      reason_code: "ai.gemini.thought_signature.present",
      signatures: ["sig-1", "sig-2"],
    }
  )
  assert.deepEqual(extractThoughtSignatures({ candidates: [{ content: { parts: [{}] } }] }), {
    status: "missing",
    reason_code: "ai.gemini.thought_signature.missing",
    signatures: [],
  })
  assert.deepEqual(
    extractThoughtSignatures({
      candidates: [
        { content: { parts: [{ thought_signature: 123 }, { thought: { signature: null, thoughtSignature: 456 } }] } },
      ],
    }),
    {
      status: "parse_failed",
      reason_code: "ai.gemini.thought_signature.parse_failed",
      signatures: [],
    }
  )
  const throwingRoot = {}
  Object.defineProperty(throwingRoot, "candidates", {
    get() {
      throw new Error("boom")
    },
  })
  assert.deepEqual(extractThoughtSignatures(throwingRoot), {
    status: "parse_failed",
    reason_code: "ai.gemini.thought_signature.parse_failed",
    signatures: [],
  })
  assert.deepEqual(extractThoughtSignatures(null as never), {
    status: "missing",
    reason_code: "ai.gemini.thought_signature.missing",
    signatures: [],
  })
  assert.deepEqual(extractThoughtSignatures({ candidates: [null] } as never), {
    status: "missing",
    reason_code: "ai.gemini.thought_signature.missing",
    signatures: [],
  })
})

test("extToMime maps supported media and rejects unsupported extensions", () => {
  assert.equal(extToMime("shot.png"), "image/png")
  assert.equal(extToMime("shot.jpeg"), "image/jpeg")
  assert.equal(extToMime("shot.webp"), "image/webp")
  assert.equal(extToMime("clip.webm"), "video/webm")
  assert.throws(() => extToMime("artifact"), /unsupported media extension: <none>/)
  assert.throws(() => extToMime("artifact.txt"), /unsupported media extension/)
})

test("gatherErrorContext aggregates diagnostics and failed checks", () => {
  const context = gatherErrorContext({
    summary: { consoleError: 7, pageError: 5, http5xx: 3 },
    diagnostics: {
      capture: { consoleErrors: ["c1"], pageErrors: ["p1"], http5xxUrls: ["u1"] },
      explore: { consoleErrors: ["c2"], pageErrors: ["p2"], http5xxUrls: ["u2"] },
      chaos: { consoleErrors: ["c3"], pageErrors: ["p3"], http5xxUrls: ["u3"] },
    },
    gateResults: {
      checks: [
        { id: "console.error", status: "failed", reasonCode: "gate.console.failed", evidencePath: "reports/summary.json" },
        { id: "test.unit", status: "passed", reasonCode: undefined, evidencePath: "reports/unit.json" },
      ],
    },
  } as never)
  assert.equal(context.console_error_count, 7)
  assert.equal(context.page_error_count, 5)
  assert.equal(context.http5xx_count, 3)
  assert.deepEqual(context.sample_console_errors, ["c1", "c2", "c3"])
  assert.equal(context.failed_gate_checks.length, 1)
})

test("buildPrompt and validateReasonCodes enforce machine-readable reason codes", () => {
  const prompt = buildPrompt({
    runId: "run-1",
    profile: "pr",
    target: { type: "web", name: "web.local", baseUrl: "http://127.0.0.1:4173" },
    screenshots: ["screenshots/home.png"],
    video: "videos/demo.webm",
    errors: {
      console_error_count: 1,
      page_error_count: 2,
      http5xx_count: 3,
      sample_console_errors: ["boom"],
      sample_page_errors: ["page"],
      sample_http5xx_urls: ["u1"],
      failed_gate_checks: [],
    },
  })
  assert.match(prompt, /Run ID: run-1/)
  assert.match(prompt, /reason_code prefixes/)

  validateReasonCodes({
    reason_code: "ai.gemini.ui_ux.pass",
    reason_codes: ["ai.gemini.ui_ux.pass"],
    findings: [
      {
        id: "finding-pass",
        severity: "low",
        category: "ui",
        reason_code: "gate.ai_review.failed",
        title: "ok",
        diagnosis: "ok",
        recommendation: "ok",
        evidence: [],
      },
    ],
  })
  assert.throws(
    () => validateReasonCodes({ reason_code: "", reason_codes: [], findings: [] }),
    /top-level reason_code is missing/
  )
  assert.throws(
    () =>
      validateReasonCodes({
        reason_code: "ai.gemini.ui_ux.pass",
        reason_codes: ["ai.gemini.ui_ux.pass"],
        findings: [{}],
      } as never),
    /finding reason_code is missing/
  )
  assert.throws(
    () =>
      validateReasonCodes({
        reason_code: "ai.gemini.invalid_prefix",
        reason_codes: ["ai.gemini.ui_ux.pass"],
        findings: [{ reason_code: "gate.ai_review.failed" }],
      } as never),
    /ai\.gemini\.failed\.invalid_reason_code_prefix/
  )
  assert.throws(
    () =>
      validateReasonCodes({
        reason_code: "ai.gemini.ui_ux.pass",
        reason_codes: ["ai.gemini.ui_ux.pass", "gate.unexpected.reason"],
        findings: [{ reason_code: "gate.ai_review.failed" }],
      } as never),
    /ai\.gemini\.failed\.invalid_reason_code_prefix/
  )
  assert.throws(
    () =>
      validateReasonCodes({
        reason_code: "ai.gemini.ui_ux.pass",
        reason_codes: ["ai.gemini.ui_ux.pass"],
        findings: [{ id: "finding-1", reason_code: "ai.gemini.invalid.issue" }],
      } as never),
    /ai\.gemini\.failed\.invalid_reason_code_prefix/
  )
  assert.throws(
    () =>
      validateReasonCodes({
        reason_code: "ai.gemini.ui_ux.pass",
        reason_codes: ["gate.ai_review.failed"],
        findings: [{ reason_code: "gate.ai_review.failed" }],
      } as never),
    /reason_codes must include top-level reason_code/
  )
  assert.throws(
    () =>
      validateReasonCodes({
        reason_code: "ai.gemini.ui_ux.pass",
        reason_codes: ["ai.gemini.ui_ux.pass", 1],
        findings: [{ reason_code: "gate.ai_review.failed" }],
      } as never),
    /reason_codes\[1\] must be a non-empty string/
  )
})

test("findLatestRunDir picks newest manifest-backed run and rejects missing manifests", async () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-runs-"))
  try {
    mkdirSync(path.join(runsDir, "older"), { recursive: true })
    mkdirSync(path.join(runsDir, "newer"), { recursive: true })
    mkdirSync(path.join(runsDir, "without-manifest"), { recursive: true })
    writeFileSync(path.join(runsDir, "older", "manifest.json"), "{}", "utf8")
    await new Promise((resolve) => setTimeout(resolve, 15))
    writeFileSync(path.join(runsDir, "newer", "manifest.json"), "{}", "utf8")
    assert.equal(await findLatestRunDir(runsDir), "newer")
  } finally {
    rmSync(runsDir, { recursive: true, force: true })
  }

  const emptyRunsDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-empty-runs-"))
  try {
    await assert.rejects(() => findLatestRunDir(emptyRunsDir), /no run manifest found/)
  } finally {
    rmSync(emptyRunsDir, { recursive: true, force: true })
  }
})

test("pickArtifacts prefers evidence screenshots, falls back to state screenshots and videos dir", async () => {
  const runDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-artifacts-"))
  try {
    mkdirSync(path.join(runDir, "videos"), { recursive: true })
    writeFileSync(path.join(runDir, "videos", "fallback.webm"), "video", "utf8")
    const artifacts = await pickArtifacts(
      {
        evidenceIndex: [
          { kind: "screenshot", path: "screenshots/a.png" },
          { kind: "screenshot", path: "screenshots/a.png" },
        ],
        states: [{ artifacts: { screenshot: "screenshots/b.png", video: "" } }],
      } as never,
      runDir,
      3
    )
    assert.deepEqual(artifacts.screenshots, ["screenshots/a.png", "screenshots/b.png"])
    assert.equal(artifacts.video, "videos/fallback.webm")
  } finally {
    rmSync(runDir, { recursive: true, force: true })
  }

  const missingDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-no-shot-"))
  try {
    const stateOnlyArtifacts = await pickArtifacts(
      { states: [{ artifacts: { screenshot: "screenshots/from-state.png", video: "" } }] } as never,
      missingDir,
      2
    )
    assert.deepEqual(stateOnlyArtifacts.screenshots, ["screenshots/from-state.png"])
    assert.equal(stateOnlyArtifacts.video, null)
    await assert.rejects(
      () => pickArtifacts({ evidenceIndex: [], states: [] } as never, missingDir, 2),
      /no screenshot evidence found/
    )
  } finally {
    rmSync(missingDir, { recursive: true, force: true })
  }
})

test("toInlineDataPart encodes media and rejects oversized payloads", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uiq-inline-media-"))
  try {
    const pngPath = path.join(dir, "shot.png")
    writeFileSync(pngPath, "abc", "utf8")
    const part = await toInlineDataPart(pngPath, 10)
    assert.equal(part.inlineData.mimeType, "image/png")
    assert.equal(Buffer.from(part.inlineData.data, "base64").toString("utf8"), "abc")

    const bigPath = path.join(dir, "big.webm")
    writeFileSync(bigPath, "0123456789ABCDE", "utf8")
    await assert.rejects(() => toInlineDataPart(bigPath, 4), /exceeds 4 bytes/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
