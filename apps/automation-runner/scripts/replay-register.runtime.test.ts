import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")
const AUTOMATION_RUNTIME_ROOT = path.join(REPO_ROOT, ".runtime-cache", "automation")

async function startHttpFixture(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on("end", () => {
      handler(req, Buffer.concat(chunks).toString("utf8"), res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("failed to start replay-register fixture server")
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function runReplayRegister(args: string[] = [], env: Record<string, string | undefined> = {}) {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete mergedEnv[key]
    else mergedEnv[key] = value
  }
  return spawnSync("pnpm", ["--dir", "automation", "exec", "tsx", "scripts/replay-register.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: mergedEnv,
  })
}

async function runReplayRegisterAsync(
  args: string[] = [],
  env: Record<string, string | undefined> = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete mergedEnv[key]
    else mergedEnv[key] = value
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--dir", "automation", "exec", "tsx", "scripts/replay-register.ts", ...args],
      {
        cwd: REPO_ROOT,
        env: mergedEnv,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", reject)
    child.on("close", (status) => {
      resolve({ status, stdout, stderr })
    })
  })
}

test("replay-register fails fast when bootstrap endpoint is unavailable", async () => {
  const sandbox = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "replay-register-"))
  const specPath = path.join(sandbox, "flow_request.spec.json")
  const pointerPath = path.join(sandbox, "latest-spec.json")
  const baseUrl = "http://127.0.0.1:9"

  try {
    writeFileSync(
      specPath,
      JSON.stringify(
        {
          baseUrl,
          actionEndpoint: {
            method: "POST",
            path: "/register",
            contentType: "application/json",
          },
          bootstrapSequence: [{ method: "GET", path: "/csrf" }],
          requiredHeaders: { "x-static-header": "fixed", "x-csrf-token": "***DYNAMIC***" },
          payloadExample: {
            email: "demo@example.test",
            password: "***REDACTED***",
            csrfToken: "***REDACTED***",
          },
          replayHints: {
            bodyMode: "json",
            tokenHeaderNames: ["x-csrf-token"],
            successStatuses: [201],
          },
        },
        null,
        2
      ),
      "utf8"
    )
    writeFileSync(pointerPath, JSON.stringify({ specPath }, null, 2), "utf8")

    const run = await runReplayRegisterAsync([], {
      REPLAY_PASSWORD: "super-secret-password",
      REPLAY_TOKEN: undefined,
      UIQ_AUTOMATION_LATEST_SPEC_PATH: pointerPath,
    })
    assert.notEqual(run.status, 0)
    assert.match(`${run.stderr}\n${run.stdout}`, /apiRequestContext\.get|replay-register failed/)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("replay-register rejects unsafe spec paths outside runtime root", () => {
  const outside = mkdtempSync(path.join(tmpdir(), "uiq-replay-spec-outside-"))
  const specPath = path.join(outside, "flow_request.spec.json")
  try {
    writeFileSync(specPath, JSON.stringify({ baseUrl: "http://127.0.0.1:1" }), "utf8")
    const run = runReplayRegister([`--spec=${specPath}`], { REPLAY_PASSWORD: "x" })
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /unsafe --spec path outside runtime root/)
  } finally {
    rmSync(outside, { recursive: true, force: true })
  }
})

test("replay-register succeeds with bootstrap token discovery and form payload", async () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const sandbox = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "replay-register-success-"))
  const specPath = path.join(sandbox, "flow_request.spec.json")
  const pointerPath = path.join(sandbox, "latest-spec.json")
  const seen: { method?: string; headers?: http.IncomingHttpHeaders; body?: string } = {}
  const server = await startHttpFixture((req, body, res) => {
    if (req.url === "/csrf") {
      assert.equal(req.method, "POST")
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ csrfToken: "server-token-123" }))
      return
    }
    if (req.url === "/register") {
      seen.method = req.method ?? ""
      seen.headers = req.headers
      seen.body = body
      res.writeHead(201, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, authorization: "bearer secret-token" }))
      return
    }
    res.writeHead(404).end("missing")
  })

  try {
    writeFileSync(
      specPath,
      JSON.stringify(
        {
          baseUrl: server.baseUrl,
          actionEndpoint: {
            method: "POST",
            path: "/register",
            contentType: "application/x-www-form-urlencoded",
          },
          bootstrapSequence: [{ method: "POST", path: "/csrf" }],
          requiredHeaders: { "x-static-header": "fixed", "x-csrf-token": "***DYNAMIC***" },
          payloadExample: {
            email: "demo@example.test",
            password: "***REDACTED***",
            csrfToken: "***REDACTED***",
          },
          replayHints: {
            bodyMode: "form",
            tokenHeaderNames: ["x-csrf-token"],
            successStatuses: [201],
          },
        },
        null,
        2
      ),
      "utf8"
    )
    writeFileSync(pointerPath, JSON.stringify({ specPath }, null, 2), "utf8")

    const run = await runReplayRegisterAsync([], {
      REPLAY_PASSWORD: "super-secret-password",
      REPLAY_TOKEN: undefined,
      UIQ_AUTOMATION_LATEST_SPEC_PATH: pointerPath,
    })
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
    const payload = JSON.parse(run.stdout) as {
      method: string
      status: number
      ok: boolean
      headersUsed: string[]
      responseBody: string
    }
    assert.equal(payload.method, "POST")
    assert.equal(payload.status, 201)
    assert.equal(payload.ok, true)
    assert.ok(payload.headersUsed.includes("x-csrf-token"))
    assert.match(payload.responseBody, /\*\*\*REDACTED\*\*\*/)
    assert.equal(seen.method, "POST")
    assert.match(String(seen.headers?.["content-type"]), /application\/x-www-form-urlencoded/)
    assert.match(String(seen.headers?.["x-csrf-token"]), /server-token-123/)
    assert.match(String(seen.body), /password=super-secret-password/)
  } finally {
    await server.close()
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test("replay-register succeeds for GET endpoint via csrfBootstrap fallback", async () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const sandbox = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "replay-register-get-"))
  const specPath = path.join(sandbox, "flow_request.spec.json")
  const pointerPath = path.join(sandbox, "latest-spec.json")
  const seen = { csrfHits: 0, endpointHits: 0 }
  const server = await startHttpFixture((req, _body, res) => {
    if (req.url === "/csrf") {
      seen.csrfHits += 1
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ nonce_value: "bootstrap-nonce" }))
      return
    }
    if (req.url === "/profile") {
      seen.endpointHits += 1
      assert.equal(req.method, "GET")
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("profile-ok")
      return
    }
    res.writeHead(404).end("missing")
  })

  try {
    writeFileSync(
      specPath,
      JSON.stringify(
        {
          baseUrl: server.baseUrl,
          actionEndpoint: { method: "GET", path: "/profile" },
          csrfBootstrap: { exists: true, fullUrl: null, path: "/csrf" },
          replayHints: {},
        },
        null,
        2
      ),
      "utf8"
    )
    writeFileSync(pointerPath, JSON.stringify({ specPath }, null, 2), "utf8")

    const run = await runReplayRegisterAsync([], {
      REPLAY_PASSWORD: "unused",
      UIQ_AUTOMATION_LATEST_SPEC_PATH: pointerPath,
    })
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`)
    const payload = JSON.parse(run.stdout) as { method: string; status: number; ok: boolean }
    assert.equal(payload.method, "GET")
    assert.equal(payload.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(seen.csrfHits, 1)
    assert.equal(seen.endpointHits, 1)
  } finally {
    await server.close()
    rmSync(sandbox, { recursive: true, force: true })
  }
})
