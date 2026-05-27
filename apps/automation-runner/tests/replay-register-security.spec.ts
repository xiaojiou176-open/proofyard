import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "@playwright/test"
import { startMockRegisterApiServer } from "./support/mock-register-api.js"

const AUTOMATION_ROOT = path.resolve(process.cwd())
const REPO_ROOT = path.resolve(AUTOMATION_ROOT, "..", "..")
const OUTPUT_ROOT = path.join(
  REPO_ROOT,
  ".runtime-cache",
  "artifacts",
  "ci",
  "test-output",
  "replay-register-security"
)

type SpawnResult = {
  status: number | null
  stdout: string
  stderr: string
}

function runNodeScript(args: string[], env: NodeJS.ProcessEnv): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, {
      cwd: AUTOMATION_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf-8")
    child.stderr.setEncoding("utf-8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("close", (status) => {
      resolve({ status, stdout, stderr })
    })
  })
}

function resetOutputRoot(): void {
  rmSync(OUTPUT_ROOT, { recursive: true, force: true })
  mkdirSync(OUTPUT_ROOT, { recursive: true })
}

test("replay-register resolves required env and redacts payload in result artifact", async () => {
  resetOutputRoot()
  const mockServer = await startMockRegisterApiServer()
  const specPath = path.join(OUTPUT_ROOT, "flow_request.spec.json")
  const spec = {
    baseUrl: mockServer.baseUrl,
    actionEndpoint: {
      method: "POST",
      fullUrl: `${mockServer.baseUrl}${mockServer.registerPath}`,
      path: mockServer.registerPath,
      contentType: "application/json",
    },
    bootstrapSequence: [{ method: "GET", path: mockServer.csrfPath }],
    requiredHeaders: {
      "content-type": "application/json",
      "x-csrf-token": "***DYNAMIC***",
    },
    payloadExample: {
      email: "seed@example.com",
      password: "***REDACTED***",
    },
    replayHints: {
      bodyMode: "json",
      contentType: "application/json",
      tokenHeaderNames: ["x-csrf-token"],
      successStatuses: [201],
    },
  }
  writeFileSync(specPath, JSON.stringify(spec, null, 2), "utf-8")

  const run = await runNodeScript(
    ["node", "--import", "tsx", "scripts/replay-register.ts", `--spec=${specPath}`],
    {
      ...process.env,
      REPLAY_PASSWORD: "ReplayPass!123",
    }
  )

  await mockServer.close()
  expect(run.status).toBe(0)

  const result = JSON.parse(
    readFileSync(path.join(OUTPUT_ROOT, "replay-result.json"), "utf-8")
  ) as {
    ok: boolean
    payload: { password?: string; email?: string }
  }
  expect(result.ok).toBe(true)
  expect(result.payload.password).toBe("***REDACTED***")
  expect(String(result.payload.email ?? "")).toContain("replay+")
})

test("replay-register rejects unsafe spec path outside runtime root", async () => {
  resetOutputRoot()
  const unsafeSpecPath = path.join(os.tmpdir(), `unsafe-replay-spec-${Date.now()}.json`)
  writeFileSync(
    unsafeSpecPath,
    JSON.stringify(
      {
        baseUrl: "http://127.0.0.1:9",
        actionEndpoint: { method: "POST", path: "/api/register", contentType: "application/json" },
        payloadExample: {},
      },
      null,
      2
    ),
    "utf-8"
  )

  const run = await runNodeScript(
    ["node", "--import", "tsx", "scripts/replay-register.ts", `--spec=${unsafeSpecPath}`],
    process.env
  )

  expect(run.status).not.toBe(0)
  expect(run.stderr).toContain("unsafe --spec path outside runtime root")
})
