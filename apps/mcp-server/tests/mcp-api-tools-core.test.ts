import assert from "node:assert/strict"
import http from "node:http"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import { apiRequest, registerApiTools } from "../src/core/api-tools.js"
import { startStubBackend } from "./helpers/stub-backend.js"

async function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>
): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test(
  "core api-tools: apiRequest injects default headers and token for JSON body",
  { timeout: 30_000, concurrency: false },
  async () => {
    const runtimeCacheRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-api-tools-cache-"))
    const captured: {
      method?: string
      url?: string
      contentType?: string
      token?: string
      body?: string
    } = {}

    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      captured.method = req.method ?? ""
      captured.url = req.url ?? ""
      captured.contentType = req.headers["content-type"] as string | undefined
      captured.token = req.headers["x-automation-token"] as string | undefined
      captured.body = Buffer.concat(chunks).toString("utf8")
      res.writeHead(201, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: true }))
    })

    await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", () => resolveReady()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server address unavailable")
    const baseUrl = `http://127.0.0.1:${address.port}`

    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: baseUrl,
          UIQ_MCP_AUTOMATION_TOKEN: "token-for-core-api-tools",
          UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeCacheRoot,
          UIQ_MCP_WORKSPACE_ROOT: runtimeCacheRoot,
        },
        async () => {
          const result = await apiRequest("/api/custom", {
            method: "POST",
            body: JSON.stringify({ hello: "world" }),
          })
          assert.equal(result.ok, true)
          assert.equal(result.status, 201)
          assert.deepEqual(result.json, { ok: true })
        }
      )
    } finally {
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
      )
    }

    assert.equal(captured.method, "POST")
    assert.equal(captured.url, "/api/custom")
    assert.equal(captured.contentType?.includes("application/json"), true)
    assert.equal(captured.token, "token-for-core-api-tools")
    assert.deepEqual(JSON.parse(captured.body ?? "{}"), { hello: "world" })
  }
)

test(
  "core api-tools: apiRequest normalizes timeout and network failures",
  { timeout: 30_000, concurrency: false },
  async () => {
    const runtimeCacheRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-api-tools-failures-"))
    const slowBackend = await startStubBackend({ delayMs: 80 })
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: slowBackend.baseUrl,
          UIQ_MCP_API_TIMEOUT_MS: "20",
          UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeCacheRoot,
          UIQ_MCP_WORKSPACE_ROOT: runtimeCacheRoot,
        },
        async () => {
          const timeoutResult = await apiRequest("/api/automation/commands")
          assert.equal(timeoutResult.ok, false)
          assert.equal(timeoutResult.status, 0)
          const timeoutJson = timeoutResult.json as {
            error: { code: string; timeoutMs: number; method: string; path: string }
          }
          assert.equal(timeoutJson.error.code, "REQUEST_TIMEOUT")
          assert.equal(timeoutJson.error.timeoutMs, 20)
          assert.equal(timeoutJson.error.method, "GET")
          assert.equal(timeoutJson.error.path, "/api/automation/commands")
        }
      )
    } finally {
      await slowBackend.close()
    }

    await withEnv(
      {
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:1",
        UIQ_MCP_API_TIMEOUT_MS: "200",
        UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeCacheRoot,
        UIQ_MCP_WORKSPACE_ROOT: runtimeCacheRoot,
      },
      async () => {
        const networkResult = await apiRequest("/api/automation/commands")
        assert.equal(networkResult.ok, false)
        assert.equal(networkResult.status, 0)
        const networkJson = networkResult.json as { error: { code: string; method: string } }
        assert.equal(networkJson.error.code, "NETWORK_ERROR")
        assert.equal(networkJson.error.method, "GET")
      }
    )
  }
)

test(
  "core api-tools: registerApiTools validates required identifiers for branch actions",
  { timeout: 30_000, concurrency: false },
  async () => {
    type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
    const handlers = new Map<string, Handler>()

    registerApiTools((toolName, _config, handler) => {
      handlers.set(toolName, handler as Handler)
    })

    const flowHandler = handlers.get("uiq_api_flows")
    const templateHandler = handlers.get("uiq_api_templates")
    const runHandler = handlers.get("uiq_api_runs")
    assert.ok(flowHandler)
    assert.ok(templateHandler)
    assert.ok(runHandler)

    await assert.rejects(
      flowHandler!({ action: "get" }, null),
      /flowId required for action=get/
    )
    await assert.rejects(
      flowHandler!({ action: "update" }, null),
      /flowId required for action=update/
    )
    await assert.rejects(
      templateHandler!({ action: "get" }, null),
      /templateId required for action=get/
    )
    await assert.rejects(
      templateHandler!({ action: "export" }, null),
      /templateId required for action=export/
    )
    await assert.rejects(
      runHandler!({ action: "get" }, null),
      /runId required for action=get/
    )
    await assert.rejects(
      runHandler!({ action: "otp" }, null),
      /runId required for action=otp/
    )
    await assert.rejects(
      runHandler!({ action: "cancel" }, null),
      /runId required for action=cancel/
    )
  }
)

test(
  "core api-tools: apiRequest handles external abort and invalid JSON payload safely",
  { timeout: 30_000, concurrency: false },
  async () => {
    const runtimeCacheRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-api-tools-abort-"))

    const server = http.createServer(async (_req, res) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 80))
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end("{not-json")
    })
    await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", () => resolveReady()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server address unavailable")
    const baseUrl = `http://127.0.0.1:${address.port}`

    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: baseUrl,
          UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeCacheRoot,
          UIQ_MCP_WORKSPACE_ROOT: runtimeCacheRoot,
        },
        async () => {
          const noJsonResult = await apiRequest("/api/invalid-json")
          assert.equal(noJsonResult.ok, true)
          assert.equal(noJsonResult.status, 200)
          assert.equal(noJsonResult.json, undefined)

          const abortController = new AbortController()
          const pendingRequest = apiRequest("/api/slow", { signal: abortController.signal })
          abortController.abort(new Error("caller aborted"))
          const abortedResult = await pendingRequest
          assert.equal(abortedResult.ok, false)
          assert.equal(abortedResult.status, 0)
          const abortedJson = abortedResult.json as { error?: { code?: string } }
          assert.equal(abortedJson.error?.code, "NETWORK_ERROR")
        }
      )
    } finally {
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
      )
    }
  }
)

test(
  "core api-tools: registerApiTools executes workflow/automation/reconstruction branches",
  { timeout: 30_000, concurrency: false },
  async () => {
    type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }>

    const handlers = new Map<string, Handler>()
    const requests: Array<{ method: string; pathname: string; search: string; body: string }> = []

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const chunks: Buffer[] = []
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const body = Buffer.concat(chunks).toString("utf8")
      requests.push({
        method: req.method ?? "GET",
        pathname: url.pathname,
        search: url.search,
        body,
      })
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: true, path: url.pathname }))
    })
    await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", () => resolveReady()))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("test server address unavailable")
    const baseUrl = `http://127.0.0.1:${address.port}`
    const runtimeCacheRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-api-tools-branches-"))

    try {
      registerApiTools((toolName, _config, handler) => {
        handlers.set(toolName, handler as Handler)
      })

      const flowHandler = handlers.get("uiq_api_flows")
      const templateHandler = handlers.get("uiq_api_templates")
      const runHandler = handlers.get("uiq_api_runs")
      const automationTasks = handlers.get("uiq_api_automation_tasks")
      const automationTask = handlers.get("uiq_api_automation_task")
      const automationRun = handlers.get("uiq_api_automation_run")
      const automationCancel = handlers.get("uiq_api_automation_cancel")
      const reconstructionPreview = handlers.get("uiq_api_reconstruction_preview")
      const reconstructionGenerate = handlers.get("uiq_api_reconstruction_generate")
      const profilesResolve = handlers.get("uiq_api_profiles_resolve")
      assert.ok(flowHandler)
      assert.ok(templateHandler)
      assert.ok(runHandler)
      assert.ok(automationTasks)
      assert.ok(automationTask)
      assert.ok(automationRun)
      assert.ok(automationCancel)
      assert.ok(reconstructionPreview)
      assert.ok(reconstructionGenerate)
      assert.ok(profilesResolve)

      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: baseUrl,
          UIQ_MCP_RUNTIME_CACHE_ROOT: runtimeCacheRoot,
          UIQ_MCP_WORKSPACE_ROOT: runtimeCacheRoot,
          UIQ_MCP_AUTOMATION_TOKEN: "branch-token",
        },
        async () => {
          await flowHandler!({ action: "list", limit: 5 }, null)
          await flowHandler!({ action: "get", flowId: "flow-1" }, null)
          await flowHandler!({ action: "import_latest" }, null)
          await flowHandler!(
            {
              action: "create",
              sessionId: "session-1",
              startUrl: "https://example.com",
              sourceEventCount: 3,
              steps: [{ id: "step-1" }],
            },
            null
          )
          await flowHandler!({ action: "update", flowId: "flow-1", startUrl: "https://next" }, null)
          await flowHandler!(
            { action: "update", flowId: "flow-1", steps: [{ id: "step-update" }] },
            null
          )

          await templateHandler!({ action: "list", limit: 3 }, null)
          await templateHandler!({ action: "get", templateId: "tpl-1" }, null)
          await templateHandler!({ action: "export", templateId: "tpl-1" }, null)
          await templateHandler!(
            {
              action: "create",
              flowId: "flow-1",
              name: "tpl-name",
              paramsSchema: [{ key: "email" }],
              defaults: { email: "u@example.com" },
              policies: { retries: 1 },
            },
            null
          )
          await templateHandler!({ action: "update", templateId: "tpl-1", name: "new-name" }, null)
          await templateHandler!(
            { action: "update", templateId: "tpl-1", defaults: { email: "x@example.com" } },
            null
          )

          await runHandler!({ action: "list", limit: 4 }, null)
          await runHandler!({ action: "get", runId: "run-1" }, null)
          await runHandler!({ action: "create", templateId: "tpl-1", params: { a: 1 } }, null)
          await runHandler!(
            { action: "create", templateId: "tpl-1", params: { a: 1 }, otpCode: "123456" },
            null
          )
          await runHandler!({ action: "otp", runId: "run-1", otpCode: "654321" }, null)
          await runHandler!({ action: "cancel", runId: "run-1" }, null)

          await automationTasks!({ status: "running", commandId: "run-ui", limit: 8 }, null)
          await automationTask!({ taskId: "task-1" }, null)
          await automationRun!({ commandId: "run-ui", params: { foo: "bar" } }, null)
          await automationRun!({ commandId: "run-ui" }, null)
          await automationCancel!({ taskId: "task-1" }, null)

          await reconstructionPreview!(
            {
              artifacts: { screenshot: "a.png" },
              videoAnalysisMode: "gemini",
              extractorStrategy: "balanced",
              autoRefineIterations: 2,
            },
            null
          )
          await reconstructionGenerate!(
            {
              previewId: "preview-1",
              preview: { blocks: [] },
              templateName: "tpl-auto",
              createRun: true,
              runParams: { email: "u@example.com" },
            },
            null
          )
          await profilesResolve!(
            { artifacts: { screenshot: "a.png" }, extractorStrategy: "strict" },
            null
          )
        }
      )
    } finally {
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose()))
      )
    }

    assert.ok(requests.length > 20)
    assert.ok(requests.some((req) => req.pathname === "/api/flows/import-latest"))
    assert.ok(requests.some((req) => req.pathname === "/api/templates/tpl-1/export"))
    assert.ok(requests.some((req) => req.pathname === "/api/runs/run-1/otp"))
    assert.ok(requests.some((req) => req.pathname === "/api/reconstruction/preview"))
    assert.ok(requests.some((req) => req.pathname === "/api/profiles/resolve"))
  }
)
