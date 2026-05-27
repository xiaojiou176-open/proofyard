import assert from "node:assert/strict"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import nodeTest from "node:test"
import { stopBackendRuntime } from "../src/core/runtime-manager.js"
import {
  registerCoreClosedLoopTools,
  registerRegisterTools,
} from "../src/tools/register-tools/register-closed-loop-tools.js"
import { registerRunTools } from "../src/tools/register-tools/register-run-tools.js"
import {
  analyzeA11y,
  analyzePerf,
  analyzeSecurity,
  analyzeVisual,
  appendRunOverrides,
  buildRegisterTemplatePayload,
  buildTemplateName,
  comparePerf,
  desktopInputWarnings,
  getWorkspaceRoot,
  listRunIds,
  listYamlStemNames,
  normalizeOrchestrateMode,
  pickRunIdOrLatest,
  pollRunToTerminal,
  readRepoTextFile,
  readRunOverview,
  runUiqStream,
  runUiqSync,
} from "../src/tools/register-tools/shared.js"
import {
  callToolText,
  startMcpHarnessAdvanced,
  startMcpHarnessDefault,
} from "./helpers/mcp-client.js"
import { startStubBackend } from "./helpers/stub-backend.js"

const workspaceRoot = resolve(import.meta.dirname, "fixtures/workspace")
const fakeUiqBin = resolve(import.meta.dirname, "fixtures/bin/fake-uiq.sh")

async function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>
): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function cleanupManagedBackendRuntime(): Promise<void> {
  await stopBackendRuntime().catch(() => undefined)
}

function createFakePnpmBin(dirPath: string): string {
  mkdirSync(dirPath, { recursive: true })
  const scriptPath = resolve(dirPath, "pnpm")
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'echo "runId=teach-run"',
      'echo "manifest=teach-manifest.json"',
    ].join("\n"),
    "utf8"
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

nodeTest(
  "default mode exposes new toolset and hides legacy api tools",
  { timeout: 30_000 },
  async () => {
    const harness = await startMcpHarnessDefault({
      workspaceRoot,
      env: { UIQ_MCP_TOOL_GROUPS: "" },
    })
    try {
      const listed = await harness.client.listTools()
      const names = listed.tools.map((tool) => tool.name)
      assert.equal(names.includes("uiq_read"), true)
      assert.equal(names.includes("uiq_run_and_report"), true)
      assert.equal(names.includes("uiq_api_sessions"), false)
      assert.equal(names.includes("uiq_api_flows"), false)
    } finally {
      await harness.close()
    }
  }
)

nodeTest("advanced mode exposes automation api wrappers", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "all" },
  })
  try {
    const listed = await harness.client.listTools()
    const names = listed.tools.map((tool) => tool.name)
    assert.equal(names.includes("uiq_read"), true)
    assert.equal(names.includes("uiq_run_and_report"), true)
    assert.equal(names.includes("uiq_api_sessions"), false)
  } finally {
    await harness.close()
  }
})

nodeTest("register tools validate prepare/teach/clone/resume required fields", async () => {
  type ToolResponse = {
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }
  const handlers = new Map<
    string,
    (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
  >()
  const fakeServer = {
    registerTool(
      name: string,
      _config: unknown,
      handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    ) {
      handlers.set(name, handler)
    },
  }
  registerRegisterTools(fakeServer as never)

  const orchestrate = handlers.get("uiq_register_orchestrate")
  assert.ok(orchestrate)
  try {
    const prepare = await orchestrate?.({ action: "prepare" }, null)
    const teach = await orchestrate?.({ action: "teach" }, null)
    const clone = await orchestrate?.({ action: "clone" }, null)
    const resume = await orchestrate?.({ action: "resume" }, null)

    assert.equal(prepare.isError, undefined)
    assert.match(prepare.content[0]?.text ?? "", /"preparedSession": null/)
    assert.equal(teach.isError, true)
    assert.match(teach.content[0]?.text ?? "", /startUrl is required for action=teach/)
    assert.equal(clone.isError, true)
    assert.match(clone.content[0]?.text ?? "", /templateId is required for action=clone/)
    assert.equal(resume.isError, true)
    assert.match(resume.content[0]?.text ?? "", /runId is required for action=resume/)
  } finally {
    await cleanupManagedBackendRuntime()
  }
})

nodeTest(
  "register tools: teach failure branch returns blocked payload when automation command is unavailable",
  { timeout: 30_000 },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRegisterTools(fakeServer as never)
    const orchestrate = handlers.get("uiq_register_orchestrate")
    assert.ok(orchestrate)

    const backend = await startStubBackend()
    const tempWorkspace = mkdtempSync(resolve(tmpdir(), "uiq-register-teach-fail-"))
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: backend.baseUrl,
          UIQ_MCP_WORKSPACE_ROOT: tempWorkspace,
          UIQ_MCP_DEV_RUNTIME_ROOT: resolve(tempWorkspace, ".runtime-cache/dev"),
          PATH: "",
        },
        async () => {
          try {
            const teach = await orchestrate?.(
              { action: "teach", startUrl: "https://example.test/register", mode: "manual" },
              null
            )
            assert.equal(teach.isError, true)
            assert.match(teach.content[0]?.text ?? "", /"action": "teach"/)
            assert.match(teach.content[0]?.text ?? "", /automation teach failed/)
          } finally {
            await cleanupManagedBackendRuntime()
          }
        }
      )
    } finally {
      await backend.close()
      rmSync(tempWorkspace, { recursive: true, force: true })
    }
  }
)

nodeTest(
  "register tools: teach success and missing-flow branches are covered",
  { timeout: 30_000 },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRegisterTools(fakeServer as never)
    const orchestrate = handlers.get("uiq_register_orchestrate")
    assert.ok(orchestrate)

    const tempWorkspace = mkdtempSync(resolve(tmpdir(), "uiq-register-teach-success-"))
    const fakeBinDir = resolve(tempWorkspace, "fake-bin")
    createFakePnpmBin(fakeBinDir)

    const successBackend = await startStubBackend()
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: successBackend.baseUrl,
          UIQ_MCP_WORKSPACE_ROOT: tempWorkspace,
          UIQ_MCP_DEV_RUNTIME_ROOT: resolve(tempWorkspace, ".runtime-cache/dev"),
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        },
        async () => {
          try {
            const teach = await orchestrate?.(
              {
                action: "teach",
                startUrl: "https://example.test/register",
                sessionId: " session-1 ",
                successSelector: " #done ",
                mode: "manual",
                email: "demo@example.test",
                password: "secret-pass",
                otpProvider: "IMAP",
              },
              null
            )
            assert.equal(Boolean(teach.isError), false)
            const text = teach.content[0]?.text ?? ""
            assert.match(text, /"action": "teach"/)
            assert.match(text, /"importedFlow"/)
            assert.match(text, /"template_id": "tpl-1"/)
            assert.match(text, /"provider": "imap"/)
          } finally {
            await cleanupManagedBackendRuntime()
          }
        }
      )
    } finally {
      await successBackend.close()
    }

    const missingFlowBackend = await startStubBackend({ importLatestFlowPayload: {} })
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: missingFlowBackend.baseUrl,
          UIQ_MCP_WORKSPACE_ROOT: tempWorkspace,
          UIQ_MCP_DEV_RUNTIME_ROOT: resolve(tempWorkspace, ".runtime-cache/dev"),
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        },
        async () => {
          try {
            const teach = await orchestrate?.(
              { action: "teach", startUrl: "https://example.test/register", mode: "manual" },
              null
            )
            assert.equal(teach.isError, true)
            assert.match(teach.content[0]?.text ?? "", /import_latest did not return flow_id/)
          } finally {
            await cleanupManagedBackendRuntime()
          }
        }
      )
    } finally {
      await missingFlowBackend.close()
      rmSync(tempWorkspace, { recursive: true, force: true })
    }
  }
)

nodeTest(
  "register tools cover prepare success plus clone/resume terminal-run branches",
  { timeout: 60_000 },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRegisterTools(fakeServer as never)
    const orchestrate = handlers.get("uiq_register_orchestrate")
    assert.ok(orchestrate)

    const backend = await startStubBackend({
      runStatusSequence: ["waiting_otp", "success"],
      otpSuccessStatus: "success",
    })
    const tempWorkspace = mkdtempSync(resolve(tmpdir(), "uiq-register-success-"))
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: backend.baseUrl,
          UIQ_MCP_WORKSPACE_ROOT: tempWorkspace,
          UIQ_MCP_DEV_RUNTIME_ROOT: resolve(tempWorkspace, ".runtime-cache/dev"),
        },
        async () => {
          try {
            const prepare = await orchestrate?.(
              { action: "prepare", startUrl: "https://example.test/register", mode: "midscene" },
              null
            )
            assert.equal(prepare.isError, undefined)
            assert.match(prepare.content[0]?.text ?? "", /"preparedSession"/)
            assert.match(prepare.content[0]?.text ?? "", /"session_id": "session-1"/)

            const clone = await orchestrate?.(
              {
                action: "clone",
                templateId: "tpl-1",
                email: "user@example.test",
                password: "secret",
                otpCode: "123456",
                mode: "midscene",
                stripeCardNumber: "4242424242424242",
                stripeExpMonth: "12",
                stripeExpYear: "30",
                stripeCvc: "123",
                stripeCardholderName: "User Example",
                stripePostalCode: "94107",
                stripeCountry: "US",
                pollTimeoutSeconds: 5,
                pollIntervalSeconds: 1,
              },
              null
            )
            assert.equal(clone.isError, false)
            assert.match(clone.content[0]?.text ?? "", /"createdRun"/)
            assert.match(clone.content[0]?.text ?? "", /"terminalRun"/)
            assert.equal(backend.getStats().otpSubmitCount >= 1, true)

            const cancelledBackend = await startStubBackend({ runStatusSequence: ["cancelled"] })
            try {
              process.env.UIQ_MCP_API_BASE_URL = cancelledBackend.baseUrl
              const resume = await orchestrate?.(
                {
                  action: "resume",
                  runId: "run-1",
                  pollTimeoutSeconds: 2,
                  pollIntervalSeconds: 1,
                },
                null
              )
              assert.equal(resume.isError, true)
              assert.match(resume.content[0]?.text ?? "", /"run"/)
              assert.match(resume.content[0]?.text ?? "", /"cancelled"/)
            } finally {
              await cancelledBackend.close()
            }
          } finally {
            await cleanupManagedBackendRuntime()
          }
        }
      )
    } finally {
      await backend.close()
      rmSync(tempWorkspace, { recursive: true, force: true })
    }
  }
)

nodeTest("uiq_run_and_report rejects malicious runId input", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "all" },
  })
  try {
    const res = await callToolText(harness.client, "uiq_run_and_report", {
      mode: "overview",
      runId: "../../escape",
    })
    assert.equal(res.isError, true)
    assert.match(res.text, /(Invalid runId|TOOL_EXECUTION_FAILED|detail|ENOENT|no such file)/i)
  } finally {
    await harness.close()
  }
})

nodeTest("read entrypoints reject path traversal payloads", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "all" },
  })
  try {
    const assertTraversalBlocked = (res: { isError: boolean; text: string }) => {
      assert.equal(res.isError, true)
      assert.match(
        res.text,
        /(path traversal blocked|path not allowed|parent path is not allowed|relativePath must use forward slashes|Invalid artifact path|ENOENT|no such file)/i
      )
    }

    const repoDocPayloads = [
      "../package.json",
      "..%2fpackage.json",
      "..%2Fpackage.json",
      "%2e%2e%2fpackage.json",
      "%2E%2E%2Fpackage.json",
      "%252e%252e%252fpackage.json",
      "..\\package.json",
      "..%5cpackage.json",
      "x/../../package.json",
    ]

    for (const relativePath of repoDocPayloads) {
      const readDoc = await callToolText(harness.client, "uiq_read", {
        source: "repo_doc",
        relativePath,
      })
      assertTraversalBlocked(readDoc)
    }

    const artifactPayloads = [
      "../manifest.json",
      "..%2fmanifest.json",
      "..%2Fmanifest.json",
      "%2e%2e%2fmanifest.json",
      "%2E%2E%2Fmanifest.json",
      "%252e%252e%252fmanifest.json",
      "..\\manifest.json",
      "..%5cmanifest.json",
      "%2e%2e/%2e%2e/manifest.json",
      "nested/../../manifest.json",
    ]

    for (const relativePath of artifactPayloads) {
      const readArtifact = await callToolText(harness.client, "uiq_read", {
        source: "artifact",
        runId: "run-a",
        relativePath,
      })
      assertTraversalBlocked(readArtifact)
    }
  } finally {
    await harness.close()
  }
})

nodeTest("uiq_read_manifest returns seeded run artifact", { timeout: 30_000 }, async () => {
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot,
    env: { UIQ_MCP_TOOL_GROUPS: "all" },
  })
  try {
    const manifest = await callToolText(harness.client, "uiq_read", {
      source: "manifest",
      runId: "run-a",
    })
    assert.equal(manifest.isError, false)
    assert.match(manifest.text, /"runId": "run-a"/)
  } finally {
    await harness.close()
  }
})

nodeTest("shared helpers: override arguments, desktop warnings and naming branches", async () => {
  const args: string[] = ["run"]
  appendRunOverrides(args, {
    baseUrl: "http://127.0.0.1:4173",
    app: "/tmp/app",
    bundleId: "com.example.app",
    loadVus: 4,
    autostartTarget: false,
  })
  assert.ok(args.includes("--base-url"))
  assert.ok(args.includes("--app"))
  assert.ok(args.includes("--bundle-id"))
  assert.ok(args.includes("--load-vus"))
  assert.ok(args.includes("--autostart-target"))
  assert.ok(args.includes("false"))

  const warnings = desktopInputWarnings({
    command: "desktop-e2e",
    profile: "tauri.local",
    target: "swift.local",
  })
  assert.equal(warnings.length, 2)

  assert.equal(normalizeOrchestrateMode("midscene"), "ai")
  assert.equal(normalizeOrchestrateMode(" MANUAL "), "manual")
  assert.equal(normalizeOrchestrateMode(undefined), undefined)

  const validName = buildTemplateName("https://example.com/register")
  assert.match(validName, /^register-example-com-/)
  const fallbackName = buildTemplateName("not-a-url")
  assert.match(fallbackName, /^register-\d+$/)

  const templatePayload = buildRegisterTemplatePayload(
    "flow-1",
    "name-1",
    " user@example.com ",
    " secret ",
    "imap"
  )
  assert.equal(templatePayload.flow_id, "flow-1")
  assert.equal(templatePayload.defaults.email, "user@example.com")
  assert.equal(templatePayload.defaults.password, "secret")
  assert.equal(templatePayload.policies.otp.provider, "imap")
})

nodeTest(
  "shared helpers: runUiqSync/runUiqStream and overview/readers cover stream branches",
  { timeout: 60_000 },
  async () => {
    const tempWorkspace = mkdtempSync(resolve(tmpdir(), "uiq-shared-workspace-"))
    cpSync(workspaceRoot, tempWorkspace, { recursive: true })
    try {
      await withEnv(
        {
          UIQ_MCP_WORKSPACE_ROOT: tempWorkspace,
          UIQ_MCP_FAKE_UIQ_BIN: fakeUiqBin,
          UIQ_MCP_RUNTIME_CACHE_ROOT: resolve(tempWorkspace, ".runtime-cache"),
        },
        async () => {
          const syncOk = runUiqSync(["capture"])
          assert.equal(syncOk.ok, true)
          assert.equal(syncOk.runId, "run-a")

          const syncFail = runUiqSync(["fail-now"])
          assert.equal(syncFail.ok, false)
          assert.match(syncFail.detail, /exited with code/)

          const streamed = await runUiqStream(["spam-lines"], 20_000)
          assert.equal(streamed.ok, true)
          assert.ok(streamed.events.length > 0)
          assert.equal(streamed.runId, "run-stream")
          assert.equal(streamed.stdout.includes("[truncated"), true)

          const timedOut = await runUiqStream(["ignore-term"], 1_000)
          assert.equal(timedOut.ok, false)
          assert.equal(timedOut.timedOut, true)
          assert.ok(timedOut.killStage === "sigterm" || timedOut.killStage === "sigkill")

          const overview = readRunOverview("run-a")
          assert.equal(overview.gateStatus, "failed")
          assert.ok(overview.failedChecks.length > 0)

          const manifestText = readRepoTextFile("README.md")
          assert.ok(manifestText.length > 0)
          assert.throws(() => readRepoTextFile("/etc/passwd"), /absolute path is not allowed/)
          assert.throws(() => readRepoTextFile("docs/..\\secret.md"), /forward slashes/)
        }
      )
    } finally {
      rmSync(tempWorkspace, { recursive: true, force: true })
    }
  }
)

nodeTest("shared helpers: analytics and run selection branches", async () => {
  await withEnv(
    {
      UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
      UIQ_MCP_RUNTIME_CACHE_ROOT: resolve(workspaceRoot, ".runtime-cache"),
    },
    async () => {
      const runs = listRunIds(500)
      assert.ok(runs.length >= 1)
      assert.equal(pickRunIdOrLatest(" run-a "), "run-a")
      assert.ok(pickRunIdOrLatest(undefined).length > 0)

      const profiles = listYamlStemNames(resolve(workspaceRoot, "profiles"))
      assert.ok(profiles.includes("pr"))

      const a11y = analyzeA11y("run-a", 1)
      assert.equal(a11y.topIssues.length, 1)
      const perf = analyzePerf("run-a")
      assert.equal(typeof perf.metrics, "object")
      const visual = analyzeVisual("run-a")
      assert.equal(visual.mode, "diff")
      const security = analyzeSecurity("run-a")
      assert.equal(security.ticketCount, 2)
      const perfDiff = comparePerf("run-a", "run-b")
      assert.equal(typeof perfDiff.deltas, "object")
    }
  )
})

nodeTest(
  "closed-loop tools cover api sessions + register_state success/error branches",
  { timeout: 60_000, concurrency: false },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerCoreClosedLoopTools(fakeServer as never)
    registerRegisterTools(fakeServer as never)
    const sessionTool = handlers.get("uiq_api_sessions")
    const registerStateTool = handlers.get("uiq_register_state")
    assert.ok(sessionTool)
    assert.ok(registerStateTool)

    const backend = await startStubBackend()
    const runtimeRoot = mkdtempSync(resolve(tmpdir(), "uiq-register-state-runtime-"))
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: backend.baseUrl,
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_HEALTH_TIMEOUT_MS: "300",
        },
        async () => {
          const listed = await sessionTool?.({ action: "list", limit: 12 }, null)
          assert.equal(Boolean(listed.isError), false)
          assert.match(listed.content[0]?.text ?? "", /"action": "list"/)
          assert.match(listed.content[0]?.text ?? "", /session-1/)

          const startMissing = await sessionTool?.({ action: "start" }, null)
          assert.equal(startMissing.isError, true)
          assert.match(startMissing.content[0]?.text ?? "", /startUrl is required/)

          const started = await sessionTool?.(
            { action: "start", startUrl: " https://example.com/register ", mode: "manual" },
            null
          )
          assert.equal(Boolean(started.isError), false)
          assert.match(started.content[0]?.text ?? "", /https:\/\/example.com\/register/)

          const finishMissing = await sessionTool?.({ action: "finish" }, null)
          assert.equal(finishMissing.isError, true)
          assert.match(finishMissing.content[0]?.text ?? "", /sessionId is required/)

          const finished = await sessionTool?.({ action: "finish", sessionId: "session-1" }, null)
          assert.equal(Boolean(finished.isError), false)
          assert.match(finished.content[0]?.text ?? "", /"status": "finished"/)

          const stateOk = await registerStateTool?.(
            { sessionId: "session-1", flowId: "flow-1", templateId: "tpl-1", runId: "run-1" },
            null
          )
          assert.equal(Boolean(stateOk.isError), false)
          assert.match(stateOk.content[0]?.text ?? "", /"flow_id": "flow-1"/)
          assert.match(stateOk.content[0]?.text ?? "", /"template_id": "tpl-1"/)
          assert.match(stateOk.content[0]?.text ?? "", /"run_id": "run-1"/)

          const stateDefault = await registerStateTool?.({}, null)
          assert.equal(Boolean(stateDefault.isError), false)
          assert.match(stateDefault.content[0]?.text ?? "", /"session_id": "session-1"/)
          assert.match(stateDefault.content[0]?.text ?? "", /"flow": null/)
          assert.match(stateDefault.content[0]?.text ?? "", /"template": null/)
          assert.match(stateDefault.content[0]?.text ?? "", /"run": null/)
        }
      )

      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: "http://127.0.0.1:1",
          UIQ_MCP_DEV_RUNTIME_ROOT: runtimeRoot,
          UIQ_MCP_HEALTH_TIMEOUT_MS: "100",
        },
        async () => {
          const stateErr = await registerStateTool?.({}, null)
          assert.equal(stateErr.isError, true)
          assert.match(stateErr.content[0]?.text ?? "", /ok": false/)
        }
      )
    } finally {
      await backend.close()
      rmSync(runtimeRoot, { recursive: true, force: true })
    }
  }
)

nodeTest(
  "pollRunToTerminal covers otp submit/no-op/auto wait and timeout branches",
  { timeout: 90_000, concurrency: false },
  async () => {
    const manualNoOtpBackend = await startStubBackend({ runStatusSequence: ["waiting_otp"] })
    try {
      await withEnv({ UIQ_MCP_API_BASE_URL: manualNoOtpBackend.baseUrl }, async () => {
        const run = await pollRunToTerminal({
          runId: "run-1",
          otpProvider: "manual",
          pollTimeoutSeconds: 15,
          pollIntervalSeconds: 1,
        })
        assert.equal((run as { status?: string }).status, "waiting_otp")
        assert.equal(manualNoOtpBackend.getStats().otpSubmitCount, 0)
      })
    } finally {
      await manualNoOtpBackend.close()
    }

    const manualOtpBackend = await startStubBackend({
      runStatusSequence: ["waiting_otp", "success"],
      otpSuccessStatus: "success",
    })
    try {
      await withEnv({ UIQ_MCP_API_BASE_URL: manualOtpBackend.baseUrl }, async () => {
        const run = await pollRunToTerminal({
          runId: "run-1",
          otpCode: " 654321 ",
          otpProvider: "manual",
          pollTimeoutSeconds: 15,
          pollIntervalSeconds: 1,
        })
        assert.equal((run as { status?: string }).status, "success")
        assert.equal(manualOtpBackend.getStats().otpSubmitCount, 1)
        assert.deepEqual(manualOtpBackend.getStats().receivedOtpCodes, ["654321"])
      })
    } finally {
      await manualOtpBackend.close()
    }

    const autoProviderBackend = await startStubBackend({
      runStatusSequence: ["waiting_otp", "waiting_user"],
    })
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: autoProviderBackend.baseUrl,
          GMAIL_IMAP_USER: "",
          GMAIL_IMAP_PASSWORD: "",
        },
        async () => {
          const run = await pollRunToTerminal({
            runId: "run-1",
            otpProvider: "gmail",
            pollTimeoutSeconds: 15,
            pollIntervalSeconds: 1,
          })
          assert.equal((run as { status?: string }).status, "waiting_user")
          assert.equal(autoProviderBackend.getStats().otpSubmitCount, 0)
          assert.ok(autoProviderBackend.getStats().runGetCount >= 2)
        }
      )
    } finally {
      await autoProviderBackend.close()
    }

    const timeoutBackend = await startStubBackend({ runStatusSequence: ["running"] })
    try {
      await withEnv({ UIQ_MCP_API_BASE_URL: timeoutBackend.baseUrl }, async () => {
        await assert.rejects(
          () =>
            pollRunToTerminal({
              runId: "run-1",
              otpProvider: "manual",
              pollTimeoutSeconds: 1,
              pollIntervalSeconds: 1,
            }),
          /polling timeout/
        )
      })
    } finally {
      await timeoutBackend.close()
    }
  }
)

nodeTest(
  "register run tools exposes promotion candidate metadata through uiq_evidence_runs",
  { timeout: 60_000, concurrency: false },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRunTools(fakeServer as never)
    const evidenceTool = handlers.get("uiq_evidence_runs")
    assert.ok(evidenceTool)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_RUNTIME_CACHE_ROOT: resolve(workspaceRoot, ".runtime-cache"),
      },
      async () => {
        const promotion = await evidenceTool?.(
          { action: "promotion", runId: "run-a", candidateRunId: "run-b" },
          null
        )
        assert.equal(Boolean(promotion.isError), false)
        const payload = JSON.parse(promotion.content[0]?.text ?? "{}") as {
          candidate?: {
            eligible: boolean
            provenanceReady: boolean
            sharePackReady: boolean
            compareReady: boolean
            releaseReference: string
            showcaseReference: string
          }
        }
        assert.equal(payload.candidate?.eligible, false)
        assert.equal(payload.candidate?.provenanceReady, false)
        assert.equal(payload.candidate?.sharePackReady, true)
        assert.equal(payload.candidate?.compareReady, true)
        assert.match(payload.candidate?.releaseReference ?? "", /run-a\.promotion-candidate\.md$/)
        assert.equal(
          payload.candidate?.showcaseReference,
          "docs/showcase/minimal-success-case.md#promotion-candidate-contract"
        )
      }
    )
  }
)

nodeTest(
  "register run tools cover proof/compare/model-target error branches",
  { timeout: 60_000, concurrency: false },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRunTools(fakeServer as never)
    const proofTool = handlers.get("uiq_proof")
    const comparePerfTool = handlers.get("uiq_compare_perf")
    const capabilitiesTool = handlers.get("uiq_model_target_capabilities")
    assert.ok(proofTool)
    assert.ok(comparePerfTool)
    assert.ok(capabilitiesTool)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_RUNTIME_CACHE_ROOT: resolve(workspaceRoot, ".runtime-cache"),
      },
      async () => {
        const diffMissing = await proofTool?.({ action: "diff" }, null)
        assert.equal(diffMissing.isError, true)
        assert.match(diffMissing.content[0]?.text ?? "", /campaignIdA and campaignIdB/)

        const invalidCampaign = await proofTool?.(
          { action: "run", campaignId: "bad/id", runIds: ["run-a"] },
          null
        )
        assert.equal(invalidCampaign.isError, true)
        assert.match(invalidCampaign.content[0]?.text ?? "", /Invalid campaignId/)

        const missingRunPerf = await comparePerfTool?.({ runIdA: "no-a", runIdB: "no-b" }, null)
        assert.equal(missingRunPerf.isError, true)
        assert.match(missingRunPerf.content[0]?.text ?? "", /uiq_compare_perf failed/)

        const explodingModelInput = {
          model: {
            trim: (): string => {
              throw new Error("trim boom")
            },
          },
        } as unknown as Record<string, unknown>
        const capsError = await capabilitiesTool?.(explodingModelInput, null)
        assert.equal(capsError.isError, true)
        assert.match(capsError.content[0]?.text ?? "", /trim boom/)
      }
    )
  }
)

nodeTest(
  "register run tools cover uiq_run/uiq_run_and_report branches",
  { timeout: 60_000, concurrency: false },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRunTools(fakeServer as never)
    const runTool = handlers.get("uiq_run")
    const runAndReportTool = handlers.get("uiq_run_and_report")
    assert.ok(runTool)
    assert.ok(runAndReportTool)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_RUNTIME_CACHE_ROOT: resolve(workspaceRoot, ".runtime-cache"),
        UIQ_MCP_FAKE_UIQ_BIN: fakeUiqBin,
      },
      async () => {
        const missingProfile = await runTool?.({ mode: "profile", profile: "pr" }, null)
        assert.equal(missingProfile.isError, true)
        assert.match(missingProfile.content[0]?.text ?? "", /profile and target are required/)

        const missingCommand = await runTool?.({ mode: "command" }, null)
        assert.equal(missingCommand.isError, true)
        assert.match(missingCommand.content[0]?.text ?? "", /command is required/)

        const profileRun = await runTool?.(
          { mode: "profile", profile: "pr", target: "web.local", runId: "run-custom" },
          null
        )
        assert.equal(Boolean(profileRun.isError), false)
        assert.match(profileRun.content[0]?.text ?? "", /"runId": "run-a"/)

        const commandRun = await runTool?.(
          {
            mode: "command",
            command: "desktop-e2e",
            profile: "swift.local",
            target: "tauri.local",
          },
          null
        )
        assert.equal(Boolean(commandRun.isError), false)
        assert.match(commandRun.content[0]?.text ?? "", /"warnings":/)

        const failures = await runAndReportTool?.({ mode: "failures", runId: "run-a" }, null)
        assert.equal(Boolean(failures.isError), false)
        assert.match(failures.content[0]?.text ?? "", /"gateStatus": "failed"/)

        const bundle = await runAndReportTool?.({ mode: "bundle", runId: "run-a" }, null)
        assert.equal(Boolean(bundle.isError), false)
        assert.match(bundle.content[0]?.text ?? "", /"runId": "run-a"/)

        const streamOnly = await runAndReportTool?.(
          { mode: "stream", runMode: "command", command: "capture", timeoutMs: 3_000 },
          null
        )
        assert.equal(Boolean(streamOnly.isError), false)
        assert.match(streamOnly.content[0]?.text ?? "", /"runId": "run-a"/)

        const fullMissingRunId = await runAndReportTool?.(
          { mode: "full", runMode: "command", command: "fail-now", timeoutMs: 3_000 },
          null
        )
        assert.equal(fullMissingRunId.isError, true)
        assert.match(fullMissingRunId.content[0]?.text ?? "", /requires runId from stream result/)
      }
    )
  }
)

nodeTest(
  "register run tools cover proof read/export/diff success branches",
  { timeout: 60_000, concurrency: false },
  async () => {
    type ToolResponse = {
      content: Array<{ type: string; text: string }>
      isError?: boolean
    }
    const handlers = new Map<
      string,
      (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
    >()
    const fakeServer = {
      registerTool(
        name: string,
        _config: unknown,
        handler: (input: Record<string, unknown>, extra: unknown) => Promise<ToolResponse>
      ) {
        handlers.set(name, handler)
      },
    }
    registerRunTools(fakeServer as never)
    const proofTool = handlers.get("uiq_proof")
    assert.ok(proofTool)

    await withEnv(
      {
        UIQ_MCP_WORKSPACE_ROOT: workspaceRoot,
        UIQ_MCP_RUNTIME_CACHE_ROOT: resolve(workspaceRoot, ".runtime-cache"),
      },
      async () => {
        const runA = await proofTool?.(
          { action: "run", campaignId: "campaign-a", runIds: ["run-a"] },
          null
        )
        assert.equal(Boolean(runA.isError), false)
        assert.match(runA.content[0]?.text ?? "", /"campaignId": "campaign-a"/)

        const runB = await proofTool?.(
          {
            action: "run",
            campaignId: "campaign-b",
            runIds: ["run-b"],
            baselineCampaignId: "campaign-a",
          },
          null
        )
        assert.equal(Boolean(runB.isError), false)
        assert.match(runB.content[0]?.text ?? "", /"baselineDiff":/)

        const read = await proofTool?.({ action: "read", campaignId: "campaign-b" }, null)
        assert.equal(Boolean(read.isError), false)
        assert.match(read.content[0]?.text ?? "", /"campaignId": "campaign-b"/)

        const exported = await proofTool?.(
          { action: "export", campaignId: "campaign-b", includeRunReports: true },
          null
        )
        assert.equal(Boolean(exported.isError), false)
        assert.match(exported.content[0]?.text ?? "", /"exportPath":/)

        const diff = await proofTool?.(
          { action: "diff", campaignIdA: "campaign-a", campaignIdB: "campaign-b" },
          null
        )
        assert.equal(Boolean(diff.isError), false)
        assert.match(diff.content[0]?.text ?? "", /"campaignA": "campaign-a"/)
      }
    )
  }
)

nodeTest(
  "shared helpers cover imap otp auto-submit branch and workspace getter",
  { timeout: 60_000, concurrency: false },
  async () => {
    const fakePythonDir = mkdtempSync(resolve(tmpdir(), "uiq-fake-python-"))
    const fakePythonPath = resolve(fakePythonDir, "python3")
    writeFileSync(fakePythonPath, "#!/usr/bin/env bash\necho 112233\n", "utf8")
    chmodSync(fakePythonPath, 0o755)

    const imapBackend = await startStubBackend({
      runStatusSequence: ["waiting_otp", "success"],
      otpSuccessStatus: "success",
    })
    try {
      await withEnv(
        {
          UIQ_MCP_API_BASE_URL: imapBackend.baseUrl,
          IMAP_HOST: "imap.example.test",
          IMAP_USER: "imap-user",
          IMAP_PASSWORD: "imap-pass",
          PATH: `${fakePythonDir}:${process.env.PATH ?? ""}`,
        },
        async () => {
          const run = await pollRunToTerminal({
            runId: "run-1",
            otpProvider: "imap",
            senderFilter: "sender@example.test",
            subjectFilter: "OTP",
            pollTimeoutSeconds: 15,
            pollIntervalSeconds: 1,
          })
          assert.equal((run as { status?: string }).status, "success")
          assert.equal(imapBackend.getStats().otpSubmitCount, 1)
          assert.deepEqual(imapBackend.getStats().receivedOtpCodes, ["112233"])
          assert.equal(getWorkspaceRoot().length > 0, true)
        }
      )
    } finally {
      await imapBackend.close()
      rmSync(fakePythonDir, { recursive: true, force: true })
    }
  }
)
