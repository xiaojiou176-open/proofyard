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

function runScript(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    "pnpm",
    ["--dir", "automation", "exec", "tsx", "scripts/generate-from-reconstruction.ts", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    }
  )
}

test("generate-from-reconstruction emits flow, api/playwright specs, readiness and replay SLA", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "uiq-generate-from-reconstruction-"))
  const previewPath = path.join(sandbox, "preview.json")
  const outDir = path.join(sandbox, "generated")
  const specPath = path.join(sandbox, "flow_request.spec.json")

  try {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(
      specPath,
      JSON.stringify(
        {
          actionEndpoint: {
            method: "POST",
            fullUrl: "https://example.test/api/register",
            path: "/api/register",
            contentType: "application/json",
          },
          bootstrapSequence: [
            {
              method: "GET",
              fullUrl: "https://example.test/api/csrf",
              path: "/api/csrf",
              reason: "csrf bootstrap",
            },
          ],
          replayHints: {
            tokenHeaderNames: ["x-csrf-token"],
            successStatuses: [200, 201],
          },
          payloadExample: {
            email: "${params.email}",
            password: "${secrets.password}",
            otp: "${params.otp}",
          },
        },
        null,
        2
      ),
      "utf8"
    )
    writeFileSync(
      path.join(sandbox, "run-readiness-report.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          replayAttempt: { attempted: true, success: true, status: "success" },
        },
        null,
        2
      ),
      "utf8"
    )
    writeFileSync(
      previewPath,
      JSON.stringify(
        {
          preview_id: "preview-1",
          flow_draft: {
            start_url: "https://example.test/register",
            steps: [
              {
                step_id: "s1",
                action: "navigate",
                url: "https://example.test/register",
              },
              {
                step_id: "s2",
                action: "type",
                value_ref: "${params.email}",
                target: {
                  selectors: [{ kind: "name", value: "email", score: 90 }],
                },
              },
              {
                step_id: "s3",
                action: "manual_gate",
                unsupported_reason: "Captcha + OTP verification required",
              },
            ],
          },
        },
        null,
        2
      ),
      "utf8"
    )

    const run = runScript([`--preview=${previewPath}`, `--outDir=${outDir}`])
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))

    const stdout = JSON.parse(String(run.stdout ?? "")) as {
      flowPath: string
      playwrightPath: string
      apiPath: string
      readinessPath: string
      specPath: string
    }
    assert.equal(stdout.specPath, specPath)

    const flowDraft = JSON.parse(readFileSync(stdout.flowPath, "utf8")) as {
      steps: Array<{ step_id: string }>
    }
    const playwright = readFileSync(stdout.playwrightPath, "utf8")
    const api = readFileSync(stdout.apiPath, "utf8")
    const readiness = JSON.parse(readFileSync(stdout.readinessPath, "utf8")) as {
      ready: boolean
      apiReplayReady: boolean
      requiredBootstrapSteps: number
      replaySuccessRate7d: number | null
      replaySuccessSamples7d: number
      manualGateReasons: string[]
      manualGateReasonMatrix: { counts: Record<string, number> }
      manualGateStatsPanel: { dominantReasonCode: string | null; totalManualGateSteps: number }
    }

    assert.equal(flowDraft.steps.length, 3)
    assert.match(playwright, /generated from reconstruction/)
    assert.match(playwright, /Captcha \+ OTP verification required/)
    assert.match(api, /generated api replay/)
    assert.match(api, /x-csrf-token/)
    assert.equal(readiness.ready, true)
    assert.equal(readiness.apiReplayReady, true)
    assert.equal(readiness.requiredBootstrapSteps, 1)
    assert.equal(readiness.replaySuccessRate7d, 1)
    assert.equal(readiness.replaySuccessSamples7d, 1)
    assert.deepEqual(readiness.manualGateReasons, ["Captcha + OTP verification required"])
    assert.equal(readiness.manualGateReasonMatrix.counts.captcha, 1)
    assert.equal(readiness.manualGateReasonMatrix.counts.otp, 1)
    assert.equal(readiness.manualGateStatsPanel.dominantReasonCode, "captcha")
    assert.equal(readiness.manualGateStatsPanel.totalManualGateSteps, 1)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("generate-from-reconstruction fails fast when preview arg is missing", () => {
  const run = runScript([])
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /--preview is required/)
})
