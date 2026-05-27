import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"
import { callToolJson, startMcpHarnessAdvanced } from "./helpers/mcp-client.js"

test("mcp timeout + semantic parsing", { timeout: 60_000 }, async () => {
  const harness = await startMcpHarnessAdvanced({
    workspaceRoot: resolve(import.meta.dirname, "fixtures/workspace"),
    env: {
      UIQ_MCP_FAKE_UIQ_BIN: resolve(import.meta.dirname, "fixtures/bin/fake-uiq.sh"),
      UIQ_MCP_TOOL_GROUPS: "all",
    },
  })

  try {
    const timeoutRun = await callToolJson<{ ok: boolean; detail: string }>(
      harness.client,
      "uiq_run_and_report",
      {
        mode: "stream",
        runMode: "command",
        command: "sleep-forever",
        timeoutMs: 50,
      }
    )
    assert.equal(timeoutRun.isError, true)
    assert.equal(timeoutRun.data.ok, false)
    assert.match(timeoutRun.data.detail, /timed out/)

    const failRun = await callToolJson<{ ok: boolean; detail: string }>(harness.client, "uiq_run", {
      mode: "command",
      command: "fail-now",
    })
    assert.equal(failRun.isError, true)
    assert.equal(failRun.data.ok, false)

    const gate = await callToolJson<{ failedChecks: Array<{ id: string }> }>(
      harness.client,
      "uiq_run_and_report",
      {
        mode: "failures",
        runId: "run-a",
      }
    )
    assert.equal(gate.isError, false)
    assert.equal(gate.data.failedChecks.length, 2)

    const a11y = await callToolJson<{ topIssues: Array<{ rank: number; id: string }> }>(
      harness.client,
      "uiq_quality_read",
      {
        kind: "a11y",
        runId: "run-a",
        topN: 2,
      }
    )
    assert.equal(a11y.isError, false)
    assert.equal(a11y.data.topIssues.length, 2)
    assert.equal(a11y.data.topIssues[0].rank, 1)

    const perf = await callToolJson<{ metrics: { fcp: number } }>(
      harness.client,
      "uiq_quality_read",
      {
        kind: "perf",
        runId: "run-a",
      }
    )
    assert.equal(perf.isError, false)
    assert.equal(perf.data.metrics.fcp, 1.2)

    const visual = await callToolJson<{ diffPixels: number }>(harness.client, "uiq_quality_read", {
      kind: "visual",
      runId: "run-a",
    })
    assert.equal(visual.isError, false)
    assert.equal(visual.data.diffPixels, 124)

    const security = await callToolJson<{ ticketCount: number }>(
      harness.client,
      "uiq_quality_read",
      {
        kind: "security",
        runId: "run-a",
      }
    )
    assert.equal(security.isError, false)
    assert.equal(security.data.ticketCount, 2)

    const compared = await callToolJson<{ deltas: Record<string, { delta: number }> }>(
      harness.client,
      "uiq_compare_perf",
      {
        runIdA: "run-a",
        runIdB: "run-b",
      }
    )
    assert.equal(compared.isError, false)
    assert.equal(compared.data.deltas.fcp.delta, -0.2)
  } finally {
    await harness.close()
  }
})
