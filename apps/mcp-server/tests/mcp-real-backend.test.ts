import assert from "node:assert/strict"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import nodeTest from "node:test"
import { callToolJson, startMcpHarnessDefault } from "./helpers/mcp-client.js"

const workspaceRoot = resolve(import.meta.dirname, "fixtures/workspace")
const realBackendEnabled = /^(1|true|yes|on)$/i.test(
  process.env.UIQ_ENABLE_REAL_BACKEND_TESTS ?? ""
)

type SessionPayload = {
  session_id: string
  start_url: string
  mode: "manual" | "ai"
  finished_at: string | null
}

type FlowPayload = {
  flow_id: string
  session_id: string
  start_url: string
  steps: Array<{ step_id: string; action: string; url?: string }>
}

async function apiJson<T>(
  baseUrl: string,
  path: string,
  init?: {
    method?: "GET" | "POST"
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
): Promise<T> {
  const method = init?.method ?? "GET"
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`request ${method} ${path} failed with ${response.status}: ${text}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", () => resolveReady()))
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("unable to reserve a local port for real backend test")
  }
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return address.port
}

async function waitForBackendReady(
  baseUrl: string,
  proc: ChildProcessWithoutNullStreams,
  logs: () => string,
  spawnError: () => Error | null,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const launchError = spawnError()
    if (launchError) {
      throw new Error(`real backend failed to launch: ${launchError.message}\n${logs()}`)
    }
    if (proc.exitCode !== null) {
      throw new Error(`real backend exited before ready (exit=${proc.exitCode})\n${logs()}`)
    }
    try {
      const res = await fetch(`${baseUrl}/health/`)
      if (res.ok) return
    } catch {
      // keep polling until timeout
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 200))
  }
  throw new Error(`timed out waiting for real backend health endpoint: ${baseUrl}/health/`)
}

async function stopProcess(proc: ChildProcessWithoutNullStreams): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  proc.kill("SIGTERM")
  const exited = once(proc, "exit")
  const timeout = new Promise<void>((resolveTimeout) => {
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL")
      }
      resolveTimeout()
    }, 5_000)
  })
  await Promise.race([exited, timeout])
}

nodeTest(
  "mcp real backend: aggregated automation and workflow tools hit FastAPI uvicorn",
  { timeout: 120_000, skip: !realBackendEnabled },
  async () => {
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-real-backend-"))
    const universalDataDir = resolve(runtimeRoot, "universal-data")
    const universalRuntimeDir = resolve(runtimeRoot, "universal-runtime")
    const port = await reservePort()
    const baseUrl = `http://127.0.0.1:${port}`
    let launchError: Error | null = null
    let stdoutTail = ""
    let stderrTail = ""

    const backendProc = spawn(
      "uv",
      [
        "run",
        "--frozen",
        "--extra",
        "dev",
        "uvicorn",
        "apps.api.app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: resolve(import.meta.dirname, "../../.."),
        stdio: "pipe",
        env: {
          ...process.env,
          AUTOMATION_REQUIRE_TOKEN: "false",
          AUTOMATION_ALLOW_LOCAL_NO_TOKEN: "true",
          UNIVERSAL_PLATFORM_DATA_DIR: universalDataDir,
          UNIVERSAL_AUTOMATION_RUNTIME_DIR: universalRuntimeDir,
        },
      }
    )
    backendProc.on("error", (error) => {
      launchError = error
    })
    backendProc.stdout.on("data", (chunk: Buffer | string) => {
      stdoutTail = `${stdoutTail}${chunk.toString()}`.slice(-8_000)
    })
    backendProc.stderr.on("data", (chunk: Buffer | string) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-8_000)
    })

    const harness = await startMcpHarnessDefault({
      workspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: baseUrl,
      },
    })

    try {
      await waitForBackendReady(
        baseUrl,
        backendProc,
        () => [stdoutTail.trim(), stderrTail.trim()].filter(Boolean).join("\n"),
        () => launchError
      )

      const startedSession = await apiJson<SessionPayload>(baseUrl, "/api/sessions/start", {
        method: "POST",
        body: {
          start_url: "https://example.com/register",
          mode: "manual",
        },
      })
      assert.match(startedSession.session_id, /^ss_/)
      assert.equal(startedSession.start_url, "https://example.com/register")

      const listedSessions = await apiJson<{ sessions: SessionPayload[] }>(
        baseUrl,
        "/api/sessions?limit=10"
      )
      assert.ok(
        listedSessions.sessions.some((item) => item.session_id === startedSession.session_id)
      )

      const automationCommands = await callToolJson<{
        commands: Array<{ command_id: string; title: string }>
      }>(harness.client, "uiq_api_automation", {
        action: "list_commands",
      })
      assert.equal(automationCommands.isError, false)
      assert.ok(automationCommands.data.commands.some((item) => item.command_id === "run"))

      const automationTasks = await callToolJson<{
        tasks: Array<{ task_id: string; command_id: string; status: string }>
      }>(harness.client, "uiq_api_automation", {
        action: "list_tasks",
        limit: 5,
      })
      assert.equal(automationTasks.isError, false)
      assert.ok(Array.isArray(automationTasks.data.tasks))

      const createdFlow = await apiJson<FlowPayload>(baseUrl, "/api/flows", {
        method: "POST",
        body: {
          session_id: startedSession.session_id,
          start_url: "https://example.com/register",
          source_event_count: 1,
          steps: [
            {
              step_id: "s1",
              action: "navigate",
              url: "https://example.com/register",
            },
          ],
        },
      })
      assert.match(createdFlow.flow_id, /^fl_/)
      assert.equal(createdFlow.session_id, startedSession.session_id)
      assert.equal(createdFlow.steps.length, 1)

      const listedFlows = await apiJson<{ flows: FlowPayload[] }>(baseUrl, "/api/flows?limit=10")
      assert.ok(
        listedFlows.flows.some((item) => item.flow_id === createdFlow.flow_id),
        "created flow should be listable from real backend"
      )

      const sessionsData = JSON.parse(
        readFileSync(resolve(universalDataDir, "sessions.json"), "utf8")
      ) as SessionPayload[]
      assert.ok(Array.isArray(sessionsData))
      assert.ok(sessionsData.some((item) => item.session_id === startedSession.session_id))

      const flowsData = JSON.parse(
        readFileSync(resolve(universalDataDir, "flows.json"), "utf8")
      ) as FlowPayload[]
      assert.ok(Array.isArray(flowsData))
      assert.ok(flowsData.some((item) => item.flow_id === createdFlow.flow_id))
    } finally {
      await harness.close()
      await stopProcess(backendProc)
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
)
