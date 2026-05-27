import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")
const PRIMARY_MODEL = "models/gemini-3.1-pro-preview"
const FLASH_MODEL = "models/gemini-3-flash-preview"

type GeminiMockPayload = {
  text?: string
  candidates?: unknown
  throwMessage?: string
  throwValue?: unknown
  textMode?: "parse_non_error"
}

type RunFixture = {
  runId: string
  runsDir: string
  runDir: string
}

function withEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key]
    } else {
      env[key] = value
    }
  }
  return env
}

function createGeminiLoader(tempDir: string): string {
  const loaderPath = path.join(tempDir, "mock-gemini-loader.mjs")
  const geminiSource = `
const payload = (() => {
  try {
    return JSON.parse(process.env.UIQ_GEMINI_MOCK_PAYLOAD ?? "{}")
  } catch {
    return {}
  }
})()

export class GoogleGenAI {
  models = {
    generateContent: async () => {
      if ("throwValue" in payload) {
        throw payload.throwValue
      }
      if (payload.throwMessage) {
        throw new Error(String(payload.throwMessage))
      }
      const text =
        payload.textMode === "parse_non_error"
          ? {
              trim() {
                return {
                  toString() {
                    throw "mock-non-error-parse"
                  },
                }
              },
            }
          : payload.text
      return {
        text,
        candidates: payload.candidates,
      }
    },
  }
}
`
  const loaderSource = `
const source = ${JSON.stringify(geminiSource)}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@google/genai") {
    return {
      shortCircuit: true,
      url: "data:text/javascript," + encodeURIComponent(source),
    }
  }
  return nextResolve(specifier, context)
}
`
  writeFileSync(loaderPath, loaderSource, "utf-8")
  return loaderPath
}

function runReportScript(
  args: string[],
  overrides: Record<string, string | undefined> = {},
  mockPayload: GeminiMockPayload | null = null
): ReturnType<typeof spawnSync> {
  const loaderRoot = mkdtempSync(path.join(tmpdir(), "uiq-gemini-loader-"))
  try {
    const command = ["--dir", "automation", "exec", "node", "--import", "tsx"]
    const envOverrides: Record<string, string | undefined> = {
      ...overrides,
      NODE_NO_WARNINGS: "1",
    }
    if (mockPayload) {
      const loaderPath = createGeminiLoader(loaderRoot)
      command.push("--loader", loaderPath)
      envOverrides.UIQ_GEMINI_MOCK_PAYLOAD = JSON.stringify(mockPayload)
    }
    command.push("scripts/generate-ui-ux-gemini-report.ts", ...args)

    return spawnSync("pnpm", command, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: withEnv(envOverrides),
    })
  } finally {
    rmSync(loaderRoot, { recursive: true, force: true })
  }
}

function writeArtifact(runDir: string, relPath: unknown): void {
  if (typeof relPath !== "string" || !relPath.trim()) return
  const targetPath = path.join(runDir, relPath)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  if (!existsSync(targetPath)) {
    writeFileSync(targetPath, `artifact:${relPath}`, "utf-8")
  }
}

function createRunFixture(overrides: Record<string, unknown> = {}): RunFixture {
  const runsDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-report-fixture-"))
  const runId = String(overrides.runId ?? "run-1")
  const runDir = path.join(runsDir, runId)
  mkdirSync(runDir, { recursive: true })

  const manifest: Record<string, unknown> = {
    runId,
    profile: "smoke",
    target: { type: "web", name: "demo", baseUrl: "https://example.com" },
    summary: {},
    evidenceIndex: [
      {
        id: "s1",
        source: "state",
        kind: "screenshot",
        path: "screenshots/default.png",
      },
    ],
    ...overrides,
  }

  writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8")

  const evidenceIndex = Array.isArray(manifest.evidenceIndex) ? manifest.evidenceIndex : []
  for (const item of evidenceIndex) {
    const record = item as Record<string, unknown>
    writeArtifact(runDir, record.path)
  }

  const states = Array.isArray(manifest.states) ? manifest.states : []
  for (const state of states) {
    const artifacts = (state as { artifacts?: Record<string, unknown> }).artifacts
    writeArtifact(runDir, artifacts?.screenshot)
    writeArtifact(runDir, artifacts?.video)
  }

  return { runId, runsDir, runDir }
}

function cleanupFixture(fixture: RunFixture): void {
  rmSync(fixture.runsDir, { recursive: true, force: true })
}

function readOutputReport(fixture: RunFixture, output = "out.json"): Record<string, unknown> {
  const outputPath = path.join(fixture.runDir, output)
  return JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>
}

test("report script fails fast on invalid --speed_mode value", () => {
  const run = runReportScript(["--speed_mode=maybe"])
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /ai\.gemini\.invalid_argument/)
  assert.match(String(run.stderr), /--speed_mode must be true\|false/)
})

test("report script fails fast on out-of-range --top_screenshots", () => {
  const run = runReportScript(["--top_screenshots=11"])
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /ai\.gemini\.invalid_argument/)
  assert.match(String(run.stderr), /--top_screenshots must be integer in \[1,10\]/)
})

test("report script fails when no manifest exists in runs directory", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-report-no-manifest-"))
  try {
    const run = runReportScript([`--runs_dir=${runsDir}`], {
      GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
      GEMINI_API_KEY: "dummy-key",
    })
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.input\.no_run_manifest/)
  } finally {
    rmSync(runsDir, { recursive: true, force: true })
  }
})

test("report script fails when manifest has no screenshot evidence", () => {
  const runsDir = mkdtempSync(path.join(tmpdir(), "uiq-gemini-report-missing-screenshot-"))
  try {
    const runId = "run-missing-screenshot"
    const runDir = path.join(runsDir, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      path.join(runDir, "manifest.json"),
      JSON.stringify(
        {
          runId,
          profile: "smoke",
          target: { type: "web", name: "demo", baseUrl: "https://example.com" },
          summary: {},
          evidenceIndex: [
            {
              id: "v1",
              source: "state",
              kind: "video",
              path: "videos/session.mp4",
            },
          ],
        },
        null,
        2
      ),
      "utf-8"
    )

    const run = runReportScript([`--runs_dir=${runsDir}`, `--run_id=${runId}`], {
      GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
      GEMINI_API_KEY: "dummy-key",
    })
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.input\.missing_screenshot/)
  } finally {
    rmSync(runsDir, { recursive: true, force: true })
  }
})

test("report script fails fast when GEMINI_API_KEY is missing", () => {
  const run = runReportScript([], {
    GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
    GEMINI_API_KEY: undefined,
  })
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /ai\.gemini\.unavailable\.no_api_key/)
})

test("report script fails fast when explicit run_id becomes empty after trim", () => {
  const run = runReportScript(["--run_id=   "], {
    GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
    GEMINI_API_KEY: "dummy-key",
  })
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /ai\.gemini\.input\.invalid_run_id/)
})

test("report script fails when Gemini returns empty response text", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      { text: "   ", candidates: [] }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.empty_response/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when Gemini returns invalid JSON", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      { text: "{invalid-json", candidates: [] }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_json/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when JSON parse receives non-Error throw payload", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      { textMode: "parse_non_error", candidates: [] }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_json/)
    assert.match(String(run.stderr), /mock-non-error-parse/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when top-level reason_code is missing", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_codes: ["ai.gemini.ui_ux.needs_attention"],
          summary: { verdict: "needs_attention", overall_score: 65 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_response_reason_code/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when top-level reason_codes is missing", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          summary: { verdict: "needs_attention", overall_score: 60 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_response_reason_codes/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when any finding misses reason_code", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          reason_codes: ["ai.gemini.ui_ux.needs_attention"],
          summary: { verdict: "needs_attention", overall_score: 55 },
          findings: [
            {
              id: "f-1",
              severity: "high",
              category: "ui",
              title: "Button overlaps helper text",
              diagnosis: "CTA overlaps with helper text at 320px",
              recommendation: "Increase bottom spacing on action row.",
              evidence: ["screenshots/default.png"],
            },
          ],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_finding_reason_code/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when top-level reason_code prefix violates contract", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.invalid_prefix",
          reason_codes: ["ai.gemini.ui_ux.needs_attention"],
          summary: { verdict: "needs_attention", overall_score: 58 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_reason_code_prefix/)
    assert.match(String(run.stderr), /top-level reason_code/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when reason_codes array contains unsupported prefix", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          reason_codes: ["ai.gemini.ui_ux.needs_attention", "gate.unexpected.reason"],
          summary: { verdict: "needs_attention", overall_score: 57 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_reason_code_prefix/)
    assert.match(String(run.stderr), /reason_codes\[1\]/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when reason_codes omits top-level reason_code", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          reason_codes: ["gate.ai_review.failed"],
          summary: { verdict: "needs_attention", overall_score: 55 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(
      String(run.stderr),
      /ai\.gemini\.failed\.invalid_response_reason_codes.*reason_codes must include top-level reason_code/
    )
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when reason_codes contains non-string value", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          reason_codes: ["ai.gemini.ui_ux.needs_attention", 1],
          summary: { verdict: "needs_attention", overall_score: 56 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /reason_codes\[1\] must be a non-empty string/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script resolves latest run when --run_id is omitted", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.pass",
          reason_codes: ["ai.gemini.ui_ux.pass"],
          summary: { verdict: "pass", overall_score: 91 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const report = readOutputReport(fixture)
    assert.equal(report.runId, fixture.runId)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when finding reason_code prefix violates contract", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          reason_codes: ["ai.gemini.ui_ux.needs_attention"],
          summary: { verdict: "needs_attention", overall_score: 54 },
          findings: [
            {
              id: "f-prefix",
              severity: "high",
              category: "ui",
              reason_code: "ai.gemini.invalid.finding",
              title: "Primary CTA visually clipped",
              diagnosis: "CTA text clips at 320px breakpoint.",
              recommendation: "Increase min-width and update responsive typography scale.",
              evidence: ["screenshots/default.png"],
            },
          ],
        }),
        candidates: [],
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.invalid_reason_code_prefix/)
    assert.match(String(run.stderr), /finding\[f-prefix\]\.reason_code/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script writes defaults for missing summary/findings and marks thought signature missing", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.pass",
          reason_codes: ["ai.gemini.ui_ux.pass"],
          findings: "not-an-array",
        }),
        candidates: [],
      }
    )
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const report = readOutputReport(fixture)
    const summary = report.summary as Record<string, unknown>
    const thought = report.thought_signatures as Record<string, unknown>
    assert.equal(summary.verdict, "needs_attention")
    assert.equal(summary.overall_score, 0)
    assert.equal(summary.total_findings, 0)
    assert.equal(thought.status, "missing")
    assert.equal(thought.reason_code, "ai.gemini.thought_signature.missing")
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script handles undefined response text via nullish fallback", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      { candidates: [] }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /ai\.gemini\.failed\.empty_response/)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script keeps deduped screenshot order, prefers evidence video, and extracts present thought signatures", () => {
  const fixture = createRunFixture({
    evidenceIndex: [
      { id: "s1", source: "state", kind: "screenshot", path: "screenshots/1.png" },
      { id: "s2", source: "state", kind: "screenshot", path: "screenshots/2.png" },
      { id: "v1", source: "report", kind: "video", path: "videos/evidence.mp4" },
    ],
    states: [
      { artifacts: { screenshot: "screenshots/2.png", video: "videos/state.mp4" } },
      { artifacts: { screenshot: "screenshots/3.png" } },
    ],
  })
  try {
    const run = runReportScript(
      [
        `--runs_dir=${fixture.runsDir}`,
        `--run_id=${fixture.runId}`,
        "--output=out.json",
        "--top_screenshots=2",
      ],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.needs_attention",
          reason_codes: ["ai.gemini.ui_ux.needs_attention", "gate.ai_review.failed"],
          summary: { verdict: "needs_attention", overall_score: 68 },
          findings: [
            {
              id: "f-1",
              severity: "critical",
              category: "functional",
              reason_code: "gate.ai_review.failed",
              title: "Checkout CTA does not submit",
              diagnosis: "Clicking the primary action does nothing due to disabled state loop.",
              recommendation: "Fix disabled-state guard and add interaction retry telemetry.",
              evidence: ["screenshots/1.png"],
            },
            {
              id: "f-2",
              severity: "low",
              category: "ux",
              reason_code: "ai.gemini.ui_ux.copy_tone",
              title: "Tooltip copy is too verbose",
              diagnosis: "Instruction text adds friction in first-run flow.",
              recommendation: "Replace with shorter guidance.",
              evidence: ["screenshots/2.png"],
            },
          ],
        }),
        candidates: [
          {
            content: {
              parts: [
                { thoughtSignature: "sig-1" },
                { thought: { signature: "sig-2" } },
                { thought_signature: "sig-1" },
              ],
            },
          },
        ],
      }
    )
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const report = readOutputReport(fixture)
    const thought = report.thought_signatures as Record<string, unknown>
    const summary = report.summary as Record<string, unknown>
    const inputContext = report.input_context as Record<string, unknown>
    assert.deepEqual(inputContext.screenshots, ["screenshots/1.png", "screenshots/2.png"])
    assert.equal(inputContext.video, "videos/evidence.mp4")
    assert.equal(thought.status, "present")
    assert.equal(thought.signature_count, 2)
    assert.deepEqual(thought.signatures, ["sig-1", "sig-2"])
    assert.equal(summary.total_findings, 2)
    assert.equal(summary.high_or_above, 1)
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script falls back to state video and marks thought signatures parse_failed for malformed payload", () => {
  const fixture = createRunFixture({
    evidenceIndex: [{ id: "s1", source: "state", kind: "screenshot", path: "screenshots/a.png" }],
    states: [{ artifacts: { video: "videos/state.webm" } }],
  })
  try {
    const run = runReportScript(
      [
        `--runs_dir=${fixture.runsDir}`,
        `--run_id=${fixture.runId}`,
        "--output=out.json",
        "--speed_mode=true",
      ],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_MODEL_FLASH: FLASH_MODEL,
        GEMINI_API_KEY: "dummy-key",
        AI_REVIEW_GEMINI_INCLUDE_THOUGHTS: "true",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.pass",
          reason_codes: ["ai.gemini.ui_ux.pass"],
          summary: { verdict: "pass", overall_score: 90 },
          findings: [],
        }),
        candidates: [{ content: { parts: [{ thoughtSignature: 123 }] } }],
      }
    )
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const report = readOutputReport(fixture)
    const thought = report.thought_signatures as Record<string, unknown>
    const inputContext = report.input_context as Record<string, unknown>
    assert.equal(report.model, FLASH_MODEL)
    assert.equal(thought.include_thoughts_enabled, true)
    assert.equal(thought.status, "parse_failed")
    assert.equal(thought.reason_code, "ai.gemini.thought_signature.parse_failed")
    assert.equal(inputContext.video, "videos/state.webm")
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script falls back to videos directory artifact when manifest has no video path", () => {
  const fixture = createRunFixture({
    evidenceIndex: [{ id: "s1", source: "state", kind: "screenshot", path: "screenshots/a.png" }],
  })
  try {
    mkdirSync(path.join(fixture.runDir, "videos"), { recursive: true })
    writeFileSync(path.join(fixture.runDir, "videos", "fallback.webm"), "video", "utf-8")

    const run = runReportScript(
      [
        `--runs_dir=${fixture.runsDir}`,
        `--run_id=${fixture.runId}`,
        "--output=out.json",
        "--speed_mode=true",
      ],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_MODEL_FLASH: FLASH_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.pass",
          reason_codes: ["ai.gemini.ui_ux.pass"],
          summary: { verdict: "pass", overall_score: 88 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const report = readOutputReport(fixture)
    const thought = report.thought_signatures as Record<string, unknown>
    const inputContext = report.input_context as Record<string, unknown>
    assert.equal(thought.include_thoughts_enabled, false)
    assert.equal(thought.status, "missing")
    assert.equal(inputContext.video, "videos/fallback.webm")
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script writes absolute output path and defaults missing target fields", () => {
  const fixture = createRunFixture({
    target: {},
  })
  const outputPath = path.join(fixture.runDir, "absolute", "report.json")
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, `--output=${outputPath}`],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      {
        text: JSON.stringify({
          reason_code: "ai.gemini.ui_ux.pass",
          reason_codes: ["ai.gemini.ui_ux.pass"],
          summary: { verdict: "pass", overall_score: 95 },
          findings: [],
        }),
        candidates: [],
      }
    )
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    assert.equal(existsSync(outputPath), true)
    const report = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>
    assert.deepEqual(report.target, { type: "unknown", name: "unknown", baseUrl: "" })
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when screenshot extension is unsupported", () => {
  const fixture = createRunFixture({
    evidenceIndex: [{ id: "s1", source: "state", kind: "screenshot", path: "screenshots/invalid.bmp" }],
  })
  try {
    const run = runReportScript([`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`], {
      GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
      GEMINI_API_KEY: "dummy-key",
    })
    assert.notEqual(run.status, 0)
    assert.ok(String(run.stderr).includes("ai.gemini.input.unsupported_media"))
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when screenshot exceeds max bytes", () => {
  const fixture = createRunFixture({
    evidenceIndex: [{ id: "s1", source: "state", kind: "screenshot", path: "screenshots/large.png" }],
  })
  try {
    writeFileSync(path.join(fixture.runDir, "screenshots", "large.png"), Buffer.alloc(5 * 1024 * 1024 + 1, 1))
    const run = runReportScript([`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`], {
      GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
      GEMINI_API_KEY: "dummy-key",
    })
    assert.notEqual(run.status, 0)
    assert.ok(String(run.stderr).includes("ai.gemini.input.media_too_large"))
    assert.ok(String(run.stderr).includes("large.png exceeds 5242880 bytes"))
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script fails when video exceeds max bytes", () => {
  const fixture = createRunFixture({
    evidenceIndex: [
      { id: "s1", source: "state", kind: "screenshot", path: "screenshots/default.png" },
      { id: "v1", source: "state", kind: "video", path: "videos/large.mp4" },
    ],
  })
  try {
    writeFileSync(path.join(fixture.runDir, "videos", "large.mp4"), Buffer.alloc(20 * 1024 * 1024 + 1, 2))
    const run = runReportScript([`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`], {
      GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
      GEMINI_API_KEY: "dummy-key",
    })
    assert.notEqual(run.status, 0)
    assert.ok(String(run.stderr).includes("ai.gemini.input.media_too_large"))
    assert.ok(String(run.stderr).includes("large.mp4 exceeds 20971520 bytes"))
  } finally {
    cleanupFixture(fixture)
  }
})

test("report script top-level catch handles non-Error thrown values", () => {
  const fixture = createRunFixture()
  try {
    const run = runReportScript(
      [`--runs_dir=${fixture.runsDir}`, `--run_id=${fixture.runId}`, "--output=out.json"],
      {
        GEMINI_MODEL_PRIMARY: PRIMARY_MODEL,
        GEMINI_API_KEY: "dummy-key",
      },
      { throwValue: "top-level-non-error" }
    )
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /generate-ui-ux-gemini-report failed: top-level-non-error/)
  } finally {
    cleanupFixture(fixture)
  }
})
