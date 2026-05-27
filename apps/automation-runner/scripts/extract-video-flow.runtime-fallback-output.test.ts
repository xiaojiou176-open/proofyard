import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")

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

test("extract-video-flow emits structured fallback output when policy allows non-gemini fallback", () => {
  const sessionDir = mkdtempSync(path.join(tmpdir(), "uiq-extract-video-fallback-"))
  try {
    mkdirSync(path.join(sessionDir, ".context-cache", "video-flow"), { recursive: true })
    const providerPolicyPath = path.join(sessionDir, "provider-policy.yaml")
    writeFileSync(
      providerPolicyPath,
      [
        "provider: gemini",
        "primary: gemini",
        "fallback: event_log",
        "fallbackMode: permissive",
      ].join("\n"),
      "utf-8"
    )
    writeFileSync(path.join(sessionDir, "session.transcript.json"), JSON.stringify([], null, 2), "utf-8")
    writeFileSync(
      path.join(sessionDir, "event-log.json"),
      JSON.stringify(
        [
          {
            ts: new Date().toISOString(),
            type: "navigate",
            url: "https://example.com/register",
            target: {
              tag: "a",
              id: null,
              name: null,
              type: null,
              role: null,
              text: null,
              cssPath: "a[href='/register']",
            },
          },
          {
            ts: new Date().toISOString(),
            type: "click",
            url: "https://example.com/register",
            target: {
              tag: "button",
              id: "submit",
              name: null,
              type: "submit",
              role: "button",
              text: "Continue",
              cssPath: "button[type='submit']",
            },
          },
        ],
        null,
        2
      ),
      "utf-8"
    )
    writeFileSync(
      path.join(sessionDir, "register.har"),
      JSON.stringify({ log: { entries: [] } }, null, 2),
      "utf-8"
    )
    writeFileSync(
      path.join(sessionDir, "final.register.html"),
      "<html><body>register</body></html>",
      "utf-8"
    )

    const run = spawnSync(
      "pnpm",
      [
        "--dir",
        "automation",
        "exec",
        "tsx",
        "scripts/extract-video-flow.ts",
        `--sessionDir=${sessionDir}`,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: withEnv({
          PROVIDER_POLICY_PATH: providerPolicyPath,
          GEMINI_API_KEY: undefined,
        }),
      }
    )

    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const outputPath = path.join(sessionDir, "video_flow.signals.json")
    const payload = JSON.parse(readFileSync(outputPath, "utf-8")) as {
      analysisPath: string
      analysisReasonCode: string
      providerPolicy: { strictNoFallback: boolean; fallbackMode: string; fallback: string }
      thoughtSignatures: { reasonCode: string; status: string; signatureCount: number }
      modelAttempts: Array<{ reasonCode: string; status: string }>
      candidateSteps: Array<{ action: string }>
    }

    assert.equal(payload.analysisPath, "event-log-fallback")
    assert.equal(payload.analysisReasonCode, "ai.gemini.event_log_fallback")
    assert.equal(payload.providerPolicy.strictNoFallback, false)
    assert.equal(payload.providerPolicy.fallbackMode, "permissive")
    assert.equal(payload.providerPolicy.fallback, "event_log")
    assert.equal(payload.thoughtSignatures.status, "missing")
    assert.equal(payload.thoughtSignatures.reasonCode, "ai.gemini.thought_signature.missing.no_api_key")
    assert.equal(payload.thoughtSignatures.signatureCount, 0)
    assert.ok(payload.modelAttempts.length >= 1)
    assert.equal(payload.modelAttempts[0]?.status, "unavailable")
    assert.equal(payload.modelAttempts[0]?.reasonCode, "ai.gemini.unavailable.no_api_key")
    assert.ok(payload.candidateSteps.length >= 1)
    assert.ok(payload.candidateSteps.some((step) => step.action === "click"))
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})
