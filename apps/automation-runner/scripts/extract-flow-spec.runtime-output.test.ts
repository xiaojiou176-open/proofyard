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
const SAFE_RUNTIME_ROOT = path.join(REPO_ROOT, ".runtime-cache")
const AUTOMATION_RUNTIME_ROOT = path.join(SAFE_RUNTIME_ROOT, "automation")
const LATEST_SPEC_PATH = path.join(AUTOMATION_RUNTIME_ROOT, "latest-spec.json")

type HarEntry = {
  startedDateTime: string
  request: {
    method: string
    url: string
    headers?: Array<{ name: string; value: string }>
    postData?: { mimeType?: string; text?: string }
  }
  response: {
    status: number
    headers?: Array<{ name: string; value: string }>
  }
}

function runExtractFlowSpec(harPath: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    "pnpm",
    ["--dir", "automation", "exec", "tsx", "scripts/extract-flow-spec.ts", `--har=${harPath}`],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    }
  )
}

function buildHar(entries: HarEntry[]): string {
  return JSON.stringify({ log: { entries } }, null, 2)
}

test("extract-flow-spec rejects har path outside safe runtime root", () => {
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "uiq-har-outside-root-"))
  try {
    const outsideHar = path.join(outsideRoot, "register.har")
    writeFileSync(outsideHar, buildHar([]), "utf-8")

    const run = runExtractFlowSpec(outsideHar)
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /unsafe --har path outside runtime root/)
  } finally {
    rmSync(outsideRoot, { recursive: true, force: true })
  }
})

test("extract-flow-spec generates canonical flow request spec with sanitized payload", () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const previousLatestSpec = existsSync(LATEST_SPEC_PATH) ? readFileSync(LATEST_SPEC_PATH, "utf-8") : null
  const sessionDir = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "extract-flow-spec-"))
  const harPath = path.join(sessionDir, "register.har")

  const now = Date.now()
  const entries: HarEntry[] = [
    {
      startedDateTime: new Date(now - 2000).toISOString(),
      request: {
        method: "GET",
        url: "https://example.test/api/csrf",
        headers: [{ name: "accept", value: "application/json" }],
      },
      response: {
        status: 200,
        headers: [{ name: "set-cookie", value: "sessionid=abc123; Path=/; HttpOnly" }],
      },
    },
    {
      startedDateTime: new Date(now - 500).toISOString(),
      request: {
        method: "POST",
        url: "https://example.test/api/register",
        headers: [
          { name: "content-type", value: "application/json" },
          { name: "x-csrf-token", value: "dynamic-token" },
          { name: "cookie", value: "sessionid=abc123" },
          { name: "accept", value: "application/json" },
        ],
        postData: {
          mimeType: "application/json",
          text: JSON.stringify({
            email: "person@example.test",
            password: "super-secret-password",
            csrfToken: "token-value",
          }),
        },
      },
      response: { status: 201, headers: [{ name: "content-type", value: "application/json" }] },
    },
  ]
  writeFileSync(harPath, buildHar(entries), "utf-8")

  try {
    const run = runExtractFlowSpec(harPath)
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))

    const canonicalPath = path.join(sessionDir, "flow_request.spec.json")
    const registerCompatPath = path.join(sessionDir, "register_request.spec.json")
    assert.equal(existsSync(canonicalPath), true)
    assert.equal(existsSync(registerCompatPath), true)
    assert.equal(existsSync(LATEST_SPEC_PATH), true)

    const canonical = JSON.parse(readFileSync(canonicalPath, "utf-8")) as {
      actionEndpoint: { path: string; method: string }
      replayHints: { bodyMode: string; tokenHeaderNames: string[] }
      security: { cookieNames: string[] }
      requiredHeaders: Record<string, string>
      payloadExample: Record<string, unknown>
      bootstrapSequence: Array<{ path: string }>
    }
    assert.equal(canonical.actionEndpoint.path, "/api/register")
    assert.equal(canonical.actionEndpoint.method, "POST")
    assert.equal(canonical.replayHints.bodyMode, "json")
    assert.ok(canonical.replayHints.tokenHeaderNames.includes("x-csrf-token"))
    assert.equal(canonical.payloadExample.email, "person@example.test")
    assert.equal(canonical.payloadExample.password, "***REDACTED***")
    assert.equal(canonical.payloadExample.csrfToken, "***REDACTED***")
    assert.equal(canonical.requiredHeaders["x-csrf-token"], "***DYNAMIC***")
    assert.ok(canonical.security.cookieNames.includes("sessionid"))
    assert.ok(canonical.bootstrapSequence.some((step) => step.path === "/api/csrf"))

    const latestSpec = JSON.parse(readFileSync(LATEST_SPEC_PATH, "utf-8")) as { specPath: string }
    assert.equal(latestSpec.specPath, canonicalPath)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
    if (previousLatestSpec === null) {
      rmSync(LATEST_SPEC_PATH, { force: true })
    } else {
      writeFileSync(LATEST_SPEC_PATH, previousLatestSpec, "utf-8")
    }
  }
})
