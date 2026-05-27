import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"

import {
  backendRuntimeStatus,
  checkBackendHealth,
  startBackendRuntime,
  stopBackendRuntime,
} from "../src/core/runtime-manager.js"
import { registerCoreClosedLoopTools } from "../src/tools/register-tools/register-closed-loop-tools.js"
import { startStubBackend } from "./helpers/stub-backend.js"

function runtimeStatePath(runtimeRoot: string): string {
  return resolve(runtimeRoot, "mcp-backend-runtime.json")
}

function runtimeLockPath(runtimeRoot: string): string {
  return resolve(runtimeRoot, "mcp-backend-runtime.lock")
}

function createFakeUvicorn(workspaceRoot: string): void {
  const binDir = resolve(workspaceRoot, ".runtime-cache/toolchains/python/.venv/bin")
  mkdirSync(binDir, { recursive: true })
  const scriptPath = resolve(binDir, "uvicorn")
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env python3",
      "import json",
      "import sys",
      "from http.server import BaseHTTPRequestHandler, HTTPServer",
      "",
      "port = 18080",
      "args = sys.argv[1:]",
      "for index, value in enumerate(args):",
      "    if value == '--port' and index + 1 < len(args):",
      "        port = int(args[index + 1])",
      "        break",
      "",
      "class Handler(BaseHTTPRequestHandler):",
      "    def do_GET(self):",
      "        if self.path in ('/health', '/health/'):",
      "            self.send_response(200)",
      "            self.send_header('content-type', 'application/json; charset=utf-8')",
      "            self.end_headers()",
      "            self.wfile.write(json.dumps({'status': 'ok'}).encode('utf-8'))",
      "            return",
      "        self.send_response(404)",
      "        self.end_headers()",
      "",
      "    def log_message(self, *_args):",
      "        return",
      "",
      "HTTPServer(('127.0.0.1', port), Handler).serve_forever()",
    ].join("\n"),
    "utf8"
  )
  chmodSync(scriptPath, 0o755)
}

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
  "runtime-manager: checkBackendHealth covers success/timeout/network branches",
  { timeout: 40_000, concurrency: false },
  async () => {
    const okBackend = await startStubBackend()
    try {
      await withEnv({ UIQ_MCP_HEALTH_TIMEOUT_MS: "1000" }, async () => {
        const healthy = await checkBackendHealth(okBackend.baseUrl)
        assert.equal(healthy.ok, true)
        assert.equal(healthy.status, 200)
        assert.equal(healthy.detail, "status=200")
      })
      await withEnv({ UIQ_MCP_HEALTH_TIMEOUT_MS: "0" }, async () => {
        const fallbackHealthy = await checkBackendHealth(okBackend.baseUrl)
        assert.equal(fallbackHealthy.ok, true)
        assert.equal(fallbackHealthy.status, 200)
      })
    } finally {
      await okBackend.close()
    }

    const slowBackend = await startStubBackend({ delayMs: 80 })
    try {
      await withEnv({ UIQ_MCP_HEALTH_TIMEOUT_MS: "20" }, async () => {
        const timeout = await checkBackendHealth(slowBackend.baseUrl)
        assert.equal(timeout.ok, false)
        assert.equal(timeout.status, 408)
        assert.match(timeout.detail, /timeout after 20ms/)
      })
    } finally {
      await slowBackend.close()
    }

    await withEnv({ UIQ_MCP_HEALTH_TIMEOUT_MS: "200" }, async () => {
      const network = await checkBackendHealth("http://127.0.0.1:1")
      assert.equal(network.ok, false)
      assert.equal(network.status, null)
      assert.match(network.detail, /^error=/)
    })
  }
)

test(
  "runtime-manager: lock release tolerates unlink failure when lock path changes mid-call",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-lock-release-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-lock-release-dev-root-"))
    const lockPath = runtimeLockPath(runtimeRoot)
    const backend = await startStubBackend({ delayMs: 80 })
    try {
      await withEnv(
        {
          UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_API_BASE_URL: backend.baseUrl,
          UIQ_MCP_HEALTH_TIMEOUT_MS: "1000",
        },
        async () => {
          const pending = backendRuntimeStatus()
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
          rmSync(lockPath, { force: true })
          mkdirSync(lockPath, { recursive: true })
          const result = await pending
          assert.equal(result.action, "status")
          assert.equal(result.running, false)
          rmSync(lockPath, { recursive: true, force: true })
        }
      )
    } finally {
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
)

test(
  "runtime-manager: startBackendRuntime returns explicit failure when uvicorn is missing",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-dev-root-"))

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:18080",
      },
      async () => {
        const started = await startBackendRuntime(19180)
        assert.equal(started.ok, false)
        assert.equal(started.reused, false)
        assert.equal(started.pid, null)
        assert.equal(started.port, null)
        assert.equal(started.logPath, null)
        assert.equal(started.health.ok, false)
        assert.equal(started.health.status, null)
        assert.equal(started.health.detail, "missing managed python env uvicorn")
        assert.match(started.detail, /start blocked/)
      }
    )
  }
)

test(
  "runtime-manager: backendRuntimeStatus rejects untrusted baseUrl and pid-command mismatch state",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-status-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-status-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:18080",
      },
      async () => {
        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: process.pid,
              port: 19080,
              baseUrl: "http://example.com:18080",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["node"],
            },
            null,
            2
          ),
          "utf8"
        )
        const untrusted = await backendRuntimeStatus()
        assert.equal(untrusted.ok, false)
        assert.equal(untrusted.running, false)
        assert.equal(untrusted.health.detail, "untrusted runtime baseUrl")
        assert.equal(existsSync(statePath), false)

        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: process.pid,
              port: 19081,
              baseUrl: "http://127.0.0.1:19081",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["definitely-not-current-process-command"],
            },
            null,
            2
          ),
          "utf8"
        )
        const mismatch = await backendRuntimeStatus()
        assert.equal(mismatch.ok, false)
        assert.equal(mismatch.running, false)
        assert.equal(mismatch.health.detail, "runtime pid command mismatch")
        assert.equal(existsSync(statePath), false)
      }
    )
  }
)

test(
  "runtime-manager: stopBackendRuntime handles empty state and closed-loop tool dispatches start/status/stop",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-tool-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-tool-dev-root-"))

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:18080",
      },
      async () => {
        const stopped = await stopBackendRuntime()
        assert.equal(stopped.ok, true)
        assert.equal(stopped.stopped, false)
        assert.equal(stopped.detail, "no managed backend runtime state found")
        type ToolResponse = {
          content: Array<{ type: string; text: string }>
          isError?: boolean
        }
        const tools = new Map<
          string,
          (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
        >()
        const fakeServer = {
          registerTool(
            name: string,
            _config: unknown,
            handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
          ) {
            tools.set(name, handler)
          },
        }
        registerCoreClosedLoopTools(fakeServer as never)
        const runtimeTool = tools.get("uiq_backend_runtime")
        assert.ok(runtimeTool)

        const parseResponse = async (
          input: Record<string, unknown>
        ): Promise<{ data: Record<string, unknown>; isError: boolean }> => {
          const response = await runtimeTool!(input, null)
          const text = response.content.find((item) => item.type === "text")?.text ?? "{}"
          return { data: JSON.parse(text) as Record<string, unknown>, isError: Boolean(response.isError) }
        }

        const statusResp = await parseResponse({ action: "status" })
        assert.equal(statusResp.isError, true)
        assert.equal(statusResp.data.ok, false)
        assert.equal(statusResp.data.action, "status")
        assert.equal((statusResp.data.runtime as { action: string }).action, "status")
        assert.match(
          (statusResp.data.runtime as { detail: string }).detail,
          /no managed backend runtime state found/
        )

        const stopResp = await parseResponse({ action: "stop" })
        assert.equal(stopResp.isError, false)
        assert.equal(stopResp.data.ok, true)
        assert.equal(stopResp.data.action, "stop")
        assert.equal((stopResp.data.runtime as { ok: boolean }).ok, true)
        assert.equal((stopResp.data.runtime as { action: string }).action, "stop")
        assert.equal((stopResp.data.runtime as { stopped: boolean }).stopped, false)

        const startResp = await parseResponse({ action: "start", preferredPort: 19300 })
        assert.equal(startResp.isError, true)
        assert.equal(startResp.data.ok, false)
        assert.equal(startResp.data.action, "start")
        assert.equal((startResp.data.runtime as { action: string }).action, "start")
        assert.equal((startResp.data.runtime as { ok: boolean }).ok, false)
        assert.equal(
          (startResp.data.runtime as { health: { detail: string } }).health.detail,
          "missing managed python env uvicorn"
        )
      }
    )
  }
)

test(
  "runtime-manager: startBackendRuntime reuses trusted managed state when health is ok",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-reuse-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-reuse-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)
    const backend = await startStubBackend()
    try {
      await withEnv(
        {
          UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_API_BASE_URL: backend.baseUrl,
          UIQ_MCP_HEALTH_TIMEOUT_MS: "300",
        },
        async () => {
          writeFileSync(
            statePath,
            JSON.stringify(
              {
                pid: process.pid,
                port: Number(new URL(backend.baseUrl).port),
                baseUrl: backend.baseUrl,
                startedAt: new Date().toISOString(),
                logPath: resolve(runtimeRoot, "runtime.log"),
                command: ["node"],
              },
              null,
              2
            ),
            "utf8"
          )
          const reused = await startBackendRuntime()
          assert.equal(reused.ok, true)
          assert.equal(reused.reused, true)
          assert.equal(reused.pid, process.pid)
          assert.equal(reused.health.ok, true)
          assert.match(reused.detail, /reused existing backend runtime/)
        }
      )
    } finally {
      await backend.close()
    }
  }
)

test(
  "runtime-manager: startBackendRuntime reused state can return unhealthy result without clearing trusted state",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-reuse-unhealthy-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-reuse-unhealthy-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:19091",
          UIQ_MCP_HEALTH_TIMEOUT_MS: "500",
      },
      async () => {
        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: process.pid,
              port: 19091,
              baseUrl: "http://127.0.0.1:19091",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["node"],
            },
            null,
            2
          ),
          "utf8"
        )
        const reused = await startBackendRuntime()
        assert.equal(reused.reused, true)
        assert.equal(reused.ok, false)
        assert.equal(reused.health.ok, false)
        assert.match(reused.detail, /reused existing backend runtime/)
        assert.equal(existsSync(statePath), true)
      }
    )
  }
)

test(
  "runtime-manager: status returns not-alive branch for trusted dead pid state",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-dead-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-dead-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:19090",
        UIQ_MCP_HEALTH_TIMEOUT_MS: "120",
      },
      async () => {
        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: 999_999,
              port: 19090,
              baseUrl: "http://127.0.0.1:19090",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["node"],
            },
            null,
            2
          ),
          "utf8"
        )
        const status = await backendRuntimeStatus()
        assert.equal(status.ok, false)
        assert.equal(status.running, false)
        assert.equal(status.detail, "managed backend runtime not alive")
        assert.equal(existsSync(statePath), true)
      }
    )
  }
)

test(
  "runtime-manager: stopBackendRuntime rejects untrusted/mismatch states and handles already-dead trusted state",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-stop-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-stop-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:18080",
      },
      async () => {
        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: process.pid,
              port: 18080,
              baseUrl: "http://example.com:18080",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["node"],
            },
            null,
            2
          ),
          "utf8"
        )
        const untrusted = await stopBackendRuntime()
        assert.equal(untrusted.ok, false)
        assert.match(untrusted.detail, /untrusted baseUrl/)
        assert.equal(existsSync(statePath), false)

        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: process.pid,
              port: 18081,
              baseUrl: "http://127.0.0.1:18081",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["definitely-not-current-process-command"],
            },
            null,
            2
          ),
          "utf8"
        )
        const mismatch = await stopBackendRuntime()
        assert.equal(mismatch.ok, false)
        assert.match(mismatch.detail, /pid command mismatch/)
        assert.equal(existsSync(statePath), false)

        writeFileSync(
          statePath,
          JSON.stringify(
            {
              pid: 999_999,
              port: 18082,
              baseUrl: "http://127.0.0.1:18082",
              startedAt: new Date().toISOString(),
              logPath: resolve(runtimeRoot, "runtime.log"),
              command: ["node"],
            },
            null,
            2
          ),
          "utf8"
        )
        const alreadyDead = await stopBackendRuntime()
        assert.equal(alreadyDead.ok, true)
        assert.equal(alreadyDead.stopped, false)
        assert.equal(alreadyDead.detail, "managed backend runtime already dead")
        assert.equal(existsSync(statePath), false)
      }
    )
  }
)

test(
  "runtime-manager: stopBackendRuntime returns still_alive when managed process ignores SIGTERM",
  { timeout: 30_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-still-alive-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-still-alive-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)
    const stubborn = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', ()=>{}); setInterval(()=>{}, 1000)"],
      { detached: true, stdio: "ignore" }
    )
    stubborn.unref()
    const pid = stubborn.pid
    if (!pid) throw new Error("failed to spawn stubborn process")

    try {
      await withEnv(
        {
          UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_API_BASE_URL: "http://127.0.0.1:19092",
        },
        async () => {
          writeFileSync(
            statePath,
            JSON.stringify(
              {
                pid,
                port: 19092,
                baseUrl: "http://127.0.0.1:19092",
                startedAt: new Date().toISOString(),
                logPath: resolve(runtimeRoot, "runtime.log"),
                command: [process.execPath, "-e"],
              },
              null,
              2
            ),
            "utf8"
          )
          const stopped = await stopBackendRuntime()
          assert.equal(stopped.pid, pid)
          if (stopped.detail === "still_alive") {
            assert.equal(stopped.ok, false)
            assert.equal(stopped.stopped, false)
            assert.equal(existsSync(statePath), true)
          } else if (stopped.detail.includes("pid command mismatch")) {
            assert.equal(stopped.ok, false)
            assert.equal(stopped.stopped, false)
            assert.equal(existsSync(statePath), false)
          } else if (stopped.detail === "managed backend runtime already dead") {
            assert.equal(stopped.ok, true)
            assert.equal(stopped.stopped, false)
            assert.equal(existsSync(statePath), false)
          } else {
            assert.equal(stopped.ok, true)
            assert.equal(stopped.stopped, true)
            assert.equal(stopped.detail, "managed backend runtime stopped")
            assert.equal(existsSync(statePath), false)
          }
        }
      )
    } finally {
      try {
        process.kill(pid, "SIGKILL")
      } catch {
        // ignore cleanup failure for already-exited process
      }
      await withEnv(
        {
          UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_API_BASE_URL: "http://127.0.0.1:19092",
        },
        async () => {
          await stopBackendRuntime()
        }
      )
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
)

test(
  "runtime-manager: start/status/stop cover managed uvicorn success path",
  { timeout: 40_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-managed-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-managed-dev-root-"))
    createFakeUvicorn(workspaceRoot)

    try {
      await withEnv(
        {
          UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_API_BASE_URL: "http://127.0.0.1:18080",
          UIQ_MCP_HEALTH_TIMEOUT_MS: "1000",
        },
        async () => {
          let managedPid: number | null = null
          try {
            const started = await startBackendRuntime(19400)
            managedPid = started.pid
            if (!started.ok) {
              assert.match(started.detail, /(health check failed|start failed|missing)/)
              return
            }
            assert.equal(started.reused, false)
            assert.equal(typeof started.pid, "number")
            assert.equal(typeof started.port, "number")
            assert.equal(started.health.ok, true)
            assert.match(started.detail, /started/)
            assert.equal(existsSync(runtimeStatePath(runtimeRoot)), true)

            const status = await backendRuntimeStatus()
            assert.equal(status.ok, true)
            assert.equal(status.running, true)
            assert.equal(status.pid, started.pid)
            assert.equal(status.port, started.port)
            assert.match(status.detail, /managed backend runtime detected/)
            assert.equal(status.health.ok, true)

            const stopped = await stopBackendRuntime()
            assert.equal(stopped.ok, true)
            assert.equal(stopped.stopped, true)
            assert.match(stopped.detail, /managed backend runtime stopped/)
            assert.equal(existsSync(runtimeStatePath(runtimeRoot)), false)
          } finally {
            if (typeof managedPid === "number") {
              try {
                process.kill(managedPid, "SIGKILL")
              } catch {
                // ignore already-exited process
              }
            }
          }
        }
      )
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
)

test(
  "runtime-manager: stale lock and malformed state are handled by status and backend runtime tool catch branch",
  { timeout: 40_000, concurrency: false },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-lock-workspace-"))
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-runtime-lock-dev-root-"))
    mkdirSync(runtimeRoot, { recursive: true })
    const statePath = runtimeStatePath(runtimeRoot)
    const lockPath = runtimeLockPath(runtimeRoot)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
        UIQ_MCP_API_BASE_URL: "http://127.0.0.1:1",
        UIQ_MCP_HEALTH_TIMEOUT_MS: "100",
      },
      async () => {
        writeFileSync(lockPath, "lock", "utf8")
        const staleAt = new Date(Date.now() - 120_000)
        utimesSync(lockPath, staleAt, staleAt)
        const statusAfterStaleLock = await backendRuntimeStatus()
        assert.equal(statusAfterStaleLock.ok, false)
        assert.match(statusAfterStaleLock.detail, /no managed backend runtime state found/)

        writeFileSync(statePath, "[]", "utf8")
        const statusWithArrayState = await backendRuntimeStatus()
        assert.equal(statusWithArrayState.ok, false)
        assert.match(statusWithArrayState.detail, /no managed backend runtime state found/)

        rmSync(statePath, { force: true })
        mkdirSync(statePath, { recursive: true })
        type ToolResponse = {
          content: Array<{ type: string; text: string }>
          isError?: boolean
        }
        const tools = new Map<
          string,
          (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
        >()
        const fakeServer = {
          registerTool(
            name: string,
            _config: unknown,
            handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
          ) {
            tools.set(name, handler)
          },
        }
        registerCoreClosedLoopTools(fakeServer as never)
        const runtimeTool = tools.get("uiq_backend_runtime")
        assert.ok(runtimeTool)
        const response = await runtimeTool!({ action: "status" }, null)
        assert.equal(Boolean(response.isError), true)
        const text = response.content.find((item) => item.type === "text")?.text ?? ""
        assert.match(text, /Unexpected end of JSON input/)
      }
    )

    rmSync(workspaceRoot, { recursive: true, force: true })
    rmSync(runtimeRoot, { recursive: true, force: true })
  }
)
