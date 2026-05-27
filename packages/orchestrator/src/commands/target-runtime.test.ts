import assert from "node:assert/strict"
import { once } from "node:events"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test, { type TestContext } from "node:test"
import { parseCommandString, startTargetRuntime, waitForHealthcheck } from "./target-runtime.js"

test("parseCommandString tokenizes quoted args and blocks shell operators", () => {
  const parsed = parseCommandString('node -e "console.log(1)"')
  assert.equal(parsed.command, "node")
  assert.deepEqual(parsed.args, ["-e", "console.log(1)"])

  assert.throws(() => parseCommandString("pnpm uiq && rm -rf /"), /unsupported shell operators/)
})

test("startTargetRuntime rejects non-allowlisted executable", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-runtime-"))
  await assert.rejects(
    () =>
      startTargetRuntime({
        enabled: true,
        baseDir,
        startCommands: {
          web: "curl http://127.0.0.1:4173",
        },
      }),
    /not allowlisted/
  )
})

test("startTargetRuntime redacts sensitive command args in report", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-runtime-"))
  const result = await startTargetRuntime({
    enabled: true,
    baseDir,
    startCommands: {
      web: "pnpm --token super-secret run dev",
    },
  })
  try {
    assert.equal(result.started, true)
    assert.match(result.processes[0]?.command ?? "", /--token \*\*\*/)
    assert.doesNotMatch(result.processes[0]?.command ?? "", /super-secret/)
  } finally {
    result.teardown()
  }
})

test("startTargetRuntime rejects executable paths with separators", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-runtime-"))
  await assert.rejects(
    () =>
      startTargetRuntime({
        enabled: true,
        baseDir,
        startCommands: {
          web: "../evil/pnpm run dev",
        },
      }),
    /path separators are not allowed/
  )
  await assert.rejects(
    () =>
      startTargetRuntime({
        enabled: true,
        baseDir,
        startCommands: {
          web: "tmp/fake/pnpm run dev",
        },
      }),
    /path separators are not allowed/
  )
})

test("startTargetRuntime rejects executable outside trusted dirs", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-runtime-"))
  const fakeBinDir = mkdtempSync(join(tmpdir(), "uiq-bin-"))
  const fakePnpm = join(fakeBinDir, "pnpm")
  writeFileSync(fakePnpm, "#!/usr/bin/env bash\necho fake-pnpm\n", "utf8")
  chmodSync(fakePnpm, 0o755)

  const originalPath = process.env.PATH
  const originalTrusted = process.env.UIQ_TRUSTED_BIN_DIRS
  process.env.PATH = fakeBinDir
  process.env.UIQ_TRUSTED_BIN_DIRS = "/usr/bin,/bin"
  try {
    await assert.rejects(
      () =>
        startTargetRuntime({
          enabled: true,
          baseDir,
          startCommands: {
            web: "pnpm --version",
          },
        }),
      /not under trusted directories/
    )
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    if (originalTrusted === undefined) {
      delete process.env.UIQ_TRUSTED_BIN_DIRS
    } else {
      process.env.UIQ_TRUSTED_BIN_DIRS = originalTrusted
    }
  }
})

test("startTargetRuntime blocks shell-style command operators", async () => {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "uiq-target-runtime-"))
  mkdirSync(resolve(tempRoot, "reports"), { recursive: true })

  try {
    await assert.rejects(
      startTargetRuntime({
        enabled: true,
        baseDir: tempRoot,
        startCommands: { web: "pnpm uiq && rm -rf /" },
      }),
      /unsupported shell operators/
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("startTargetRuntime healthcheck only passes on 2xx responses", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "uiq-runtime-"))
  let requestCount = 0

  const server = createServer((_, response) => {
    requestCount += 1
    if (requestCount === 1) {
      response.statusCode = 404
      response.end("not found")
      return
    }
    response.statusCode = 200
    response.end("ok")
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const healthcheckUrl = `http://127.0.0.1:${address.port}/health`
  const keepAlivePort = address.port + 1

  const result = await startTargetRuntime({
    enabled: true,
    baseDir,
    startCommands: { web: `python3 -m http.server ${keepAlivePort}` },
    healthcheckUrl,
  })
  try {
    assert.equal(result.healthcheckPassed, true)
    assert.ok(requestCount >= 2, "healthcheck should continue polling after 404")
  } finally {
    result.teardown()
    server.close()
  }
})

test("waitForHealthcheck aborts individual requests while preserving total timeout", async (t: TestContext) => {
  let seenAbort = false
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = ((_: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error("missing abort signal"))
        return
      }
      signal.addEventListener("abort", () => {
        seenAbort = true
        reject(new Error("aborted"))
      })
    })) as typeof fetch

  const ok = await waitForHealthcheck("http://127.0.0.1:9999/health", 120)
  assert.equal(ok, false)
  assert.equal(seenAbort, true)
})

test("startTargetRuntime fails healthcheck when spawned process exits during stability window", async () => {
  const server = createServer((_, res) => {
    res.statusCode = 200
    res.end("ok")
  })
  await new Promise<void>((resolveReady) => {
    server.listen(0, "127.0.0.1", () => {
      resolveReady()
    })
  })
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const healthcheckUrl = `http://127.0.0.1:${address.port}/health`

  const tempRoot = mkdtempSync(resolve(tmpdir(), "uiq-target-runtime-stability-"))
  mkdirSync(resolve(tempRoot, "reports"), { recursive: true })
  const exitScriptPath = resolve(tempRoot, "exit-runtime.js")
  writeFileSync(
    exitScriptPath,
    [
      "setTimeout(() => {",
      "  process.exit(0)",
      "}, 200)",
    ].join("\n"),
    "utf8"
  )

  try {
    const result = await startTargetRuntime({
      enabled: true,
      baseDir: tempRoot,
      startCommands: {
        web: `node ${exitScriptPath}`,
      },
      healthcheckUrl,
    })
    assert.equal(result.started, true)
    assert.equal(result.healthcheckPassed, false)
  } finally {
    await new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("startTargetRuntime forwards api and web env overrides to spawned processes", async () => {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "uiq-target-runtime-env-"))
  mkdirSync(resolve(tempRoot, "reports"), { recursive: true })
  const captureScriptPath = resolve(tempRoot, "capture-env.js")
  const apiOutputPath = resolve(tempRoot, "api-env.json")
  const webOutputPath = resolve(tempRoot, "web-env.json")
  writeFileSync(
    captureScriptPath,
    [
      'const [, , outputPath, expectedKey] = process.argv;',
      'const { writeFileSync } = require("node:fs");',
      'writeFileSync(outputPath, JSON.stringify({ value: process.env[expectedKey] ?? null }), "utf8");',
      'setTimeout(() => process.exit(0), 5000);',
    ].join("\n"),
    "utf8"
  )

  const result = await startTargetRuntime({
    enabled: true,
    baseDir: tempRoot,
    startCommands: {
      api: `node ${captureScriptPath} ${apiOutputPath} AUTOMATION_ALLOW_LOCAL_NO_TOKEN`,
      web: `node ${captureScriptPath} ${webOutputPath} BACKEND_PORT`,
    },
    apiEnvOverrides: {
      AUTOMATION_ALLOW_LOCAL_NO_TOKEN: "true",
    },
    webEnvOverrides: {
      BACKEND_PORT: "17380",
    },
  })

  try {
    assert.equal(result.started, true)
    assert.deepEqual(
      JSON.parse(readFileSync(apiOutputPath, "utf8")),
      { value: "true" }
    )
    assert.deepEqual(
      JSON.parse(readFileSync(webOutputPath, "utf8")),
      { value: "17380" }
    )
  } finally {
    result.teardown()
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
