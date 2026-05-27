// @ts-nocheck

import assert from "node:assert/strict"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { callToolJson, callToolText, startMcpHarnessAdvanced } from "./helpers/mcp-client.js"
import { startStubBackend } from "./helpers/stub-backend.js"

const fixtureWorkspaceRoot = resolve(import.meta.dirname, "fixtures/workspace")

function createTempWorkspace(prefix: string): string {
  const source = fixtureWorkspaceRoot
  const temp = mkdtempSync(resolve(tmpdir(), `${prefix}-`))
  cpSync(source, temp, { recursive: true })
  return temp
}

function createFakeUiqWithoutRunId(workspaceRoot: string): string {
  const scriptPath = resolve(workspaceRoot, ".runtime-cache/fake-uiq-no-runid.sh")
  mkdirSync(resolve(workspaceRoot, ".runtime-cache"), { recursive: true })
  writeFileSync(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo \"manifest=.runtime-cache/artifacts/runs/run-a/manifest.json\"",
      "exit 0",
      "",
    ].join("\n"),
    "utf8"
  )
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

test("mcp failure paths: allowlist/path/schema/backend error", { timeout: 60_000 }, async () => {
  const backend = await startStubBackend({ commandsStatus: 500 })
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot: fixtureWorkspaceRoot,
    env: { UIQ_MCP_API_BASE_URL: backend.baseUrl, UIQ_MCP_TOOL_GROUPS: "all" },
  })

  try {
    const denied = await callToolText(harness.client, "uiq_read", {
      source: "repo_doc",
      relativePath: "../secrets.txt",
    })
    assert.equal(denied.isError, true)
    assert.match(denied.text, /(path not allowed|parent path is not allowed)/)

    const deniedCrossPlatformTraversal = await callToolText(harness.client, "uiq_read", {
      source: "repo_doc",
      relativePath: "docs/..\\..\\secrets.txt",
    })
    assert.equal(deniedCrossPlatformTraversal.isError, true)
    assert.match(
      deniedCrossPlatformTraversal.text,
      /(path traversal blocked|relativePath must use forward slashes)/
    )

    const missingArtifact = await callToolText(harness.client, "uiq_read", {
      source: "artifact",
      runId: "run-a",
      relativePath: "reports/not-exists.json",
    })
    assert.equal(missingArtifact.isError, true)
    assert.match(missingArtifact.text, /(ENOENT|no such file|not exist)/i)

    const invalidRunStream = await callToolJson<{ ok: boolean; detail: string }>(
      harness.client,
      "uiq_run_and_report",
      {
        mode: "stream",
        runMode: "profile",
        profile: "pr",
      }
    )
    assert.equal(invalidRunStream.isError, true)
    assert.equal(invalidRunStream.data.ok, false)
    assert.match(invalidRunStream.data.detail, /required/)

    const invalidProfileSlug = await callToolText(harness.client, "uiq_run", {
      mode: "profile",
      profile: "../pr",
      target: "web.local",
    })
    assert.equal(invalidProfileSlug.isError, true)
    assert.match(
      invalidProfileSlug.text,
      /(Invalid profile; only \[A-Za-z0-9._-\] are allowed|Invalid profile: path separators or '\.\.' are not allowed)/
    )

    const invalidTargetSlug = await callToolText(harness.client, "uiq_run_and_report", {
      mode: "stream",
      runMode: "command",
      command: "capture",
      target: "configs/targets/web.local.yaml",
    })
    assert.equal(invalidTargetSlug.isError, true)
    assert.match(
      invalidTargetSlug.text,
      /(Invalid target; only \[A-Za-z0-9._-\] are allowed|Invalid target: path separators or '\.\.' are not allowed)/
    )

    const invalidOptionalProfileSlug = await callToolText(harness.client, "uiq_run", {
      mode: "command",
      command: "capture",
      profile: "configs/profiles/pr.yaml",
    })
    assert.equal(invalidOptionalProfileSlug.isError, true)
    assert.match(
      invalidOptionalProfileSlug.text,
      /(Invalid profile; only \[A-Za-z0-9._-\] are allowed|Invalid profile: path separators or '\.\.' are not allowed)/
    )

    const apiErr = await callToolJson<Record<string, unknown>>(
      harness.client,
      "uiq_api_automation",
      { action: "list_commands" }
    )
    assert.equal(apiErr.isError, true)
  } finally {
    await harness.close()
    await backend.close()
  }
})

test(
  "mcp run_overview falls back to manifest checks and evidence mapping when summary is missing",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = createTempWorkspace("uiq-mcp-failure-manifest")
    const runId = `run-manifest-fallback-${Date.now()}`
    const runDir = resolve(workspaceRoot, ".runtime-cache/artifacts/runs", runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      resolve(runDir, "manifest.json"),
      `${JSON.stringify(
        {
          runId,
          gateResults: {
            status: "failed",
            checks: [
              {
                id: "security.high_vuln",
                status: "failed",
                actual: 3,
                expected: 0,
                reasonCode: "HIGH_VULN_FOUND",
              },
            ],
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: { UIQ_MCP_API_BASE_URL: backend.baseUrl, UIQ_MCP_TOOL_GROUPS: "all" },
    })

    try {
      const overview = await callToolJson<{
        ok: boolean
        gateStatus: string
        failedChecks: Array<{ id: string; source: string; evidencePath: string | null }>
      }>(harness.client, "uiq_run_and_report", { mode: "overview", runId })
      assert.equal(overview.isError, false)
      assert.equal(overview.data.ok, true)
      assert.equal(overview.data.gateStatus, "failed")
      assert.equal(overview.data.failedChecks.length, 1)
      assert.equal(overview.data.failedChecks[0]?.source, "manifest")
      assert.equal(overview.data.failedChecks[0]?.evidencePath, "security/report.json")
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)

test(
  "mcp run_overview returns typed error when both manifest and summary are missing",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = createTempWorkspace("uiq-mcp-failure-missing")
    const runId = `run-missing-artifacts-${Date.now()}`
    const runDir = resolve(workspaceRoot, ".runtime-cache/artifacts/runs", runId)
    mkdirSync(runDir, { recursive: true })

    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: { UIQ_MCP_API_BASE_URL: backend.baseUrl, UIQ_MCP_TOOL_GROUPS: "all" },
    })

    try {
      const overview = await callToolJson<{ ok: boolean; detail: string }>(
        harness.client,
        "uiq_run_and_report",
        { mode: "overview", runId }
      )
      assert.equal(overview.isError, true)
      assert.equal(overview.data.ok, false)
      assert.match(overview.data.detail, /run artifacts missing/)
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)

test("mcp apiRequest timeout/network errors are normalized", { timeout: 60_000 }, async () => {
  const slowBackend = await startStubBackend({ delayMs: 80 })
  const timeoutHarness = await startMcpHarnessAdvanced({
    workspaceRoot: fixtureWorkspaceRoot,
    env: {
      UIQ_MCP_API_BASE_URL: slowBackend.baseUrl,
      UIQ_MCP_API_TIMEOUT_MS: "20",
      UIQ_MCP_TOOL_GROUPS: "all",
    },
  })

  try {
    const timeoutResp = await callToolJson<Record<string, unknown> | string>(
      timeoutHarness.client,
      "uiq_api_automation",
      { action: "list_commands" }
    )
    assert.equal(timeoutResp.isError, true)
    assert.equal(typeof timeoutResp.data, "string")
    assert.match(String(timeoutResp.data), /request timeout after 20ms/)
  } finally {
    await timeoutHarness.close()
    await slowBackend.close()
  }

  const networkHarness = await startMcpHarnessAdvanced({
    workspaceRoot: fixtureWorkspaceRoot,
    env: {
      UIQ_MCP_API_BASE_URL: "http://127.0.0.1:1",
      UIQ_MCP_API_TIMEOUT_MS: "200",
      UIQ_MCP_TOOL_GROUPS: "all",
    },
  })

  try {
    const networkResp = await callToolJson<Record<string, unknown> | string>(
      networkHarness.client,
      "uiq_api_automation",
      { action: "list_commands" }
    )
    assert.equal(networkResp.isError, true)
    assert.equal(typeof networkResp.data, "string")
    assert.match(String(networkResp.data), /request failed:/)
  } finally {
    await networkHarness.close()
  }
})

test(
  "mcp automation run rejects legacy env field in input schema",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const strictResp = await callToolText(harness.client, "uiq_api_automation", {
        action: "run",
        commandId: "run-ui",
        env: { BASE_URL: "https://example.com" },
      })
      assert.equal(strictResp.isError, true)
      assert.match(strictResp.text.toLowerCase(), /env/)
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)

test(
  "mcp governed workspace allowlist blocks calls with sanitized output",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const outsideAllowlist = resolve(import.meta.dirname, "fixtures/workspace/docs")
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_WORKSPACE_ALLOWLIST: outsideAllowlist,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const denied = await callToolText(harness.client, "uiq_catalog", {})
      assert.equal(denied.isError, true)
      assert.match(denied.text, /WORKSPACE_NOT_ALLOWLISTED/)
      assert.doesNotMatch(
        denied.text,
        new RegExp(fixtureWorkspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      )
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)

test(
  "mcp failure paths: workflow and automation required-field validation branches",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const flowUpdateMissingPayload = await callToolText(harness.client, "uiq_api_workflow", {
        entity: "flows",
        action: "update",
        flowId: "flow-1",
      })
      assert.equal(flowUpdateMissingPayload.isError, true)
      assert.match(flowUpdateMissingPayload.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)

      const templateUpdateMissingPayload = await callToolText(harness.client, "uiq_api_workflow", {
        entity: "templates",
        action: "update",
        templateId: "tpl-1",
      })
      assert.equal(templateUpdateMissingPayload.isError, true)
      assert.match(templateUpdateMissingPayload.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)

      const runCreateMissingTemplate = await callToolText(harness.client, "uiq_api_workflow", {
        entity: "runs",
        action: "create",
      })
      assert.equal(runCreateMissingTemplate.isError, true)
      assert.match(runCreateMissingTemplate.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)

      const runOtpMissingCode = await callToolText(harness.client, "uiq_api_workflow", {
        entity: "runs",
        action: "otp",
        runId: "run-1",
      })
      assert.equal(runOtpMissingCode.isError, true)
      assert.match(runOtpMissingCode.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)

      const automationGetTaskMissingId = await callToolText(harness.client, "uiq_api_automation", {
        action: "get_task",
      })
      assert.equal(automationGetTaskMissingId.isError, true)
      assert.match(automationGetTaskMissingId.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)

      const automationRunMissingCommand = await callToolText(harness.client, "uiq_api_automation", {
        action: "run",
      })
      assert.equal(automationRunMissingCommand.isError, true)
      assert.match(automationRunMissingCommand.text, /"reasonCode": "TOOL_EXECUTION_FAILED"/)
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)

test(
  "mcp failure paths: deep audit returns early when selfcheck fails",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = mkdtempSync(resolve(tmpdir(), "uiq-mcp-deep-audit-empty-"))
    mkdirSync(resolve(workspaceRoot, ".runtime-cache/artifacts/runs"), { recursive: true })

    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const deepAudit = await callToolJson<{ ok: boolean; detail: string }>(
        harness.client,
        "uiq_run_deep_audit_autofix_localhost",
        {}
      )
      assert.equal(deepAudit.isError, true)
      assert.equal(deepAudit.data.ok, false)
      assert.match(deepAudit.data.detail, /selfcheck failed/)
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)

test(
  "mcp failure paths: deep-load/deep-audit/full return blocked when stream has no runId",
  { timeout: 60_000 },
  async () => {
    const workspaceRoot = createTempWorkspace("uiq-mcp-no-runid")
    const fakeUiqNoRunId = createFakeUiqWithoutRunId(workspaceRoot)
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
        UIQ_MCP_FAKE_UIQ_BIN: fakeUiqNoRunId,
      },
    })

    try {
      const deepLoad = await callToolJson<{ ok: boolean; detail: string }>(
        harness.client,
        "uiq_run_deep_load_localhost",
        { baseUrl: backend.baseUrl }
      )
      assert.equal(deepLoad.isError, true)
      assert.equal(deepLoad.data.ok, false)
      assert.match(deepLoad.data.detail, /run_stream returned no runId/)

      const full = await callToolJson<{ ok: boolean; detail: string }>(
        harness.client,
        "uiq_run_and_report",
        { mode: "full", runMode: "command", command: "capture" }
      )
      assert.equal(full.isError, true)
      assert.equal(full.data.ok, false)
      assert.match(full.data.detail, /requires runId from stream result/)

      const deepAudit = await callToolJson<{ ok: boolean; detail: string }>(
        harness.client,
        "uiq_run_deep_audit_autofix_localhost",
        { baseUrl: backend.baseUrl }
      )
      assert.equal(deepAudit.isError, true)
      assert.equal(deepAudit.data.ok, false)
      assert.equal(deepAudit.data.detail, "ok")
    } finally {
      await harness.close()
      await backend.close()
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  }
)

test(
  "mcp failure paths: deep-load input slug validation surfaces invalid profile/target",
  { timeout: 60_000 },
  async () => {
    const backend = await startStubBackend()
    const harness = await startMcpHarnessAdvanced({
      workspaceRoot: fixtureWorkspaceRoot,
      env: {
        UIQ_MCP_API_BASE_URL: backend.baseUrl,
        UIQ_MCP_TOOL_GROUPS: "all",
      },
    })

    try {
      const invalidProfile = await callToolText(harness.client, "uiq_run_deep_load_localhost", {
        profile: "../bad",
      })
      assert.equal(invalidProfile.isError, true)
      assert.match(invalidProfile.text, /Invalid profile/i)

      const invalidTarget = await callToolText(harness.client, "uiq_run_deep_audit_autofix_localhost", {
        target: "configs/targets/web.local.yaml",
      })
      assert.equal(invalidTarget.isError, true)
      assert.match(invalidTarget.text, /Invalid target/i)
    } finally {
      await harness.close()
      await backend.close()
    }
  }
)
