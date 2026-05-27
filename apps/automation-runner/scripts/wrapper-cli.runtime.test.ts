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
const TARGETS_ROOT = path.join(REPO_ROOT, "config", "targets")

function runAutomationScript(script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("pnpm", ["--dir", "automation", "exec", "tsx", `scripts/${script}`, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
  })
}

test("generate-playwright-case sanitizes payload example and writes generated spec", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "uiq-generate-playwright-case-"))
  const specPath = path.join(sandbox, "register.spec.json")
  const outPath = path.join(sandbox, "register.generated.spec.ts")

  try {
    writeFileSync(
      specPath,
      JSON.stringify(
        {
          baseUrl: "https://example.test",
          registerEndpoint: {
            method: "POST",
            path: "/api/register",
            contentType: "application/json",
          },
          csrfBootstrap: {
            exists: true,
            path: "/api/csrf",
          },
          payloadExample: {
            email: "real-user@example.test",
            password: "SuperSecret123!",
          },
        },
        null,
        2
      ),
      "utf8"
    )
    const run = runAutomationScript("generate-playwright-case.ts", [
      `--spec=${specPath}`,
      `--out=${outPath}`,
    ])
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))

    const generated = readFileSync(outPath, "utf8")
    assert.match(generated, /const SPEC_PATH = process\.env\.SPEC_PATH/)
    assert.match(generated, /template@example\.com/)
    assert.match(generated, /"\*\*\*"/)
    assert.match(generated, /startMockRegisterApiServer/)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("reconstruct-and-replay fails fast when reconstruction backend is unavailable", async () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "uiq-reconstruct-replay-"))
  try {
    const run = runAutomationScript(
      "reconstruct-and-replay.ts",
      [`--sessionDir=${sandbox}`, "--mode=ensemble"],
      {
        UIQ_BASE_URL: "http://127.0.0.1:9",
        AUTOMATION_API_TOKEN: "token-test",
      }
    )
    assert.notEqual(run.status, 0)
    assert.match(`${run.stderr}${run.stdout}`, /reconstruct-and-replay failed/i)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("run-target-smoke writes failed artifact for unsupported driver target", () => {
  mkdirSync(TARGETS_ROOT, { recursive: true })
  const targetId = `unsupported-driver-${Date.now()}`
  const targetPath = path.join(TARGETS_ROOT, `${targetId}.json`)

  try {
    writeFileSync(
      targetPath,
      JSON.stringify(
        {
          target_id: targetId,
          platform: "desktop",
          driver_id: "unknown-driver",
        },
        null,
        2
      ),
      "utf8"
    )

    const run = runAutomationScript("run-target-smoke.ts", [`--target=${targetId}`])
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /unsupported driver_id for smoke/)
    assert.match(run.stderr, /report:/)
    const reportPath = run.stderr
      .split("\n")
      .find((line) => line.startsWith("report: "))
      ?.replace("report: ", "")
      .trim()
    assert.ok(reportPath)
    const report = JSON.parse(readFileSync(reportPath!, "utf8")) as {
      ok: boolean
      driver_id: string
      target_id: string
    }
    assert.equal(report.ok, false)
    assert.equal(report.driver_id, "unknown-driver")
    assert.equal(report.target_id, targetId)
  } finally {
    rmSync(targetPath, { force: true })
  }
})
