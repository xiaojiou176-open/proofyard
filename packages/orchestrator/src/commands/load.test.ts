import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { runLoad } from "./load.js"

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler)
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("failed to bind test server")
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

test("runLoad executes ramp-up/steady/spike/soak and enforces external engine hard gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uiq-load-"))
  mkdirSync(join(dir, "metrics"), { recursive: true })

  const { server, baseUrl } = await withServer((_req, res) => {
    res.statusCode = 200
    res.end("ok")
  })

  try {
    const result = await runLoad(dir, {
      baseUrl,
      vus: 2,
      durationSeconds: 4,
      requestTimeoutMs: 1500,
      engines: ["builtin"],
    })

    assert.deepEqual(
      result.stages.map((stage) => stage.stage),
      ["ramp-up", "steady", "spike", "soak"]
    )
    assert.equal(
      result.stages.reduce((acc, stage) => acc + stage.durationSeconds, 0),
      4
    )

    assert.equal(result.gateMetrics.engineReady, false)
    assert.equal(result.gateMetrics.engineReadyReason, "external_engine_not_requested")
    assert.equal(result.requestsPerSecond, 0)
    assert.ok(result.failedRequests >= result.gateMetrics.stageFailedCount + 1)

    const persisted = JSON.parse(readFileSync(join(dir, "metrics/load-summary.json"), "utf8")) as {
      stages: Array<{ stage: string }>
      gateMetrics: { engineReady: boolean }
    }
    assert.equal(persisted.stages.length, 4)
    assert.equal(persisted.gateMetrics.engineReady, false)
  } finally {
    await new Promise<void>((resolvePromise) => {
      server.close(() => {
        resolvePromise()
      })
    })
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runLoad exposes p99 through legacy loadP95 channel for gate compatibility", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uiq-load-p99-"))
  mkdirSync(join(dir, "metrics"), { recursive: true })

  const { server, baseUrl } = await withServer((_req, res) => {
    setTimeout(() => {
      res.statusCode = 200
      res.end("ok")
    }, 20)
  })

  try {
    const result = await runLoad(dir, {
      baseUrl,
      vus: 1,
      durationSeconds: 4,
      requestTimeoutMs: 2000,
      engines: ["builtin"],
    })

    assert.equal(result.latencyMs.p95, result.latencyMs.p99)
    assert.ok(result.latencyMs.p95 >= result.latencyMs.p95Observed)
  } finally {
    await new Promise<void>((resolvePromise) => {
      server.close(() => {
        resolvePromise()
      })
    })
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runLoad emits attribution with top failing endpoints/status distribution/timeout and network categories", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uiq-load-attribution-"))
  mkdirSync(join(dir, "metrics"), { recursive: true })

  let count = 0
  const { server, baseUrl } = await withServer((_req, res) => {
    count += 1
    if (count % 3 === 0) {
      setTimeout(() => {
        res.statusCode = 200
        res.end("delayed")
      }, 80)
      return
    }
    if (count % 2 === 0) {
      res.statusCode = 503
      res.end("unavailable")
      return
    }
    res.statusCode = 200
    res.end("ok")
  })

  try {
    const result = await runLoad(dir, {
      baseUrl: `${baseUrl}/unstable`,
      vus: 1,
      durationSeconds: 4,
      requestTimeoutMs: 20,
      engines: ["builtin"],
    })

    assert.ok((result.attribution.topFailingEndpoints[0]?.failedRequests ?? 0) > 0)
    assert.equal(result.attribution.topFailingEndpoints[0]?.endpoint, "/unstable")
    assert.ok(result.attribution.timeoutErrors > 0)
    assert.ok(result.attribution.statusDistribution.some((item) => item.status === "503"))
    assert.ok(result.attribution.statusDistribution.some((item) => item.status === "timeout"))

    const persisted = JSON.parse(readFileSync(join(dir, "metrics/load-summary.json"), "utf8")) as {
      attribution?: {
        topFailingEndpoints?: Array<{ endpoint?: string }>
        statusDistribution?: Array<{ status?: string }>
      }
    }
    assert.equal(persisted.attribution?.topFailingEndpoints?.[0]?.endpoint, "/unstable")
    assert.ok(persisted.attribution?.statusDistribution?.some((item) => item.status === "503"))
  } finally {
    await new Promise<void>((resolvePromise) => {
      server.close(() => {
        resolvePromise()
      })
    })
    rmSync(dir, { recursive: true, force: true })
  }
})

test("runLoad marks k6 engine as failed when summary parsing fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uiq-load-k6-parse-"))
  const fakeBinDir = mkdtempSync(join(tmpdir(), "uiq-k6-bin-"))
  mkdirSync(join(dir, "metrics"), { recursive: true })

  const fakeK6Path = join(fakeBinDir, "k6")
  writeFileSync(
    fakeK6Path,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "${1:-}" == "version" ]]; then',
      '  echo "k6 v0.0.0-test"',
      "  exit 0",
      "fi",
      'if [[ "${1:-}" == "run" ]]; then',
      '  summary=""',
      "  i=1",
      "  while [[ $i -le $# ]]; do",
      '    arg="${!i}"',
      '    if [[ "$arg" == "--summary-export" ]]; then',
      "      j=$((i+1))",
      '      summary="${!j}"',
      "      break",
      "    fi",
      "    i=$((i+1))",
      "  done",
      '  if [[ -z "$summary" ]]; then',
      "    exit 2",
      "  fi",
      '  echo "not-json" >"$summary"',
      "  exit 0",
      "fi",
      "exit 1",
      "",
    ].join("\n"),
    "utf8"
  )
  chmodSync(fakeK6Path, 0o755)

  const { server, baseUrl } = await withServer((_req, res) => {
    res.statusCode = 200
    res.end("ok")
  })

  const previousPath = process.env.PATH ?? ""
  process.env.PATH = `${fakeBinDir}:${previousPath}`

  try {
    const result = await runLoad(dir, {
      baseUrl,
      vus: 1,
      durationSeconds: 4,
      requestTimeoutMs: 1500,
      engines: ["k6"],
    })

    const k6 = result.engines.find((engine) => engine.engine === "k6")
    assert.equal(k6?.status, "failed")
    assert.equal(k6?.reasonCode, "load.k6.failed.k6_summary_parse_failed")
    assert.equal(result.gateMetrics.engineReady, false)
    assert.equal(result.gateMetrics.engineReadyReason, "no_external_engine_ready")
  } finally {
    process.env.PATH = previousPath
    await new Promise<void>((resolvePromise) => {
      server.close(() => {
        resolvePromise()
      })
    })
    rmSync(dir, { recursive: true, force: true })
    rmSync(fakeBinDir, { recursive: true, force: true })
  }
})
