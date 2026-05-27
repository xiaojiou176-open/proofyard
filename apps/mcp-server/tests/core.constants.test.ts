import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { createRequire, syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import {
  DEFAULT_API_RETRY_BASE_DELAY_MS,
  DEFAULT_API_RETRY_MAX_ATTEMPTS,
  DEFAULT_BACKEND_BASE_URL,
  DEFAULT_GOVERN_RATE_LIMIT_CALLS,
  DEFAULT_GOVERN_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_GOVERN_SESSION_BUDGET_MS,
  DEFAULT_GOVERN_TIMEOUT_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_UIQ_SYNC_TIMEOUT_MS,
  DEFAULT_WORKSPACE_ALLOWLIST_ENV,
  PROFILE_TARGET_PATTERN,
  REDACTED,
  STREAM_EVENT_CAP,
  STREAM_STDERR_LINE_CAP,
  STREAM_STDOUT_LINE_CAP,
  auditLogPath,
  ensureDir,
  ensureDirReady,
  envFlag,
  envPositiveInt,
  isLoopbackHost,
  isPathInside,
  readJson,
  readUtf8,
  repoRoot,
  runsRoot,
  runtimeRootOverride,
  safeResolveUnder,
  sleep,
  writeAudit,
  workspaceRoot,
} from "../src/core/constants.js"
import {
  auditLogPath as ioAuditLogPath,
  writeAudit as ioWriteAudit,
} from "../src/core/io.js"

test("constant defaults stay stable", () => {
  assert.equal(DEFAULT_BACKEND_BASE_URL, "http://127.0.0.1:18080")
  assert.equal(DEFAULT_HEALTH_TIMEOUT_MS, 3_000)
  assert.equal(STREAM_STDOUT_LINE_CAP, 800)
  assert.equal(STREAM_STDERR_LINE_CAP, 800)
  assert.equal(STREAM_EVENT_CAP, 1500)
  assert.equal(DEFAULT_UIQ_SYNC_TIMEOUT_MS, 10 * 60 * 1000)
  assert.equal(DEFAULT_GOVERN_RATE_LIMIT_CALLS, 3)
  assert.equal(DEFAULT_GOVERN_RATE_LIMIT_WINDOW_SECONDS, 60)
  assert.equal(DEFAULT_GOVERN_TIMEOUT_MS, 30_000)
  assert.equal(DEFAULT_GOVERN_SESSION_BUDGET_MS, 120_000)
  assert.equal(DEFAULT_WORKSPACE_ALLOWLIST_ENV, "UIQ_MCP_WORKSPACE_ALLOWLIST")
  assert.equal(DEFAULT_API_RETRY_MAX_ATTEMPTS, 6)
  assert.equal(DEFAULT_API_RETRY_BASE_DELAY_MS, 100)
  assert.equal(REDACTED, "[REDACTED]")
})

test("PROFILE_TARGET_PATTERN enforces anchored safe token format", () => {
  assert.equal(PROFILE_TARGET_PATTERN.test("alpha_1.beta-2"), true)
  assert.equal(PROFILE_TARGET_PATTERN.test("alpha beta"), false)
  assert.equal(PROFILE_TARGET_PATTERN.test("alpha!"), false)
  assert.equal(PROFILE_TARGET_PATTERN.test("alpha\nbeta"), false)
})

test("isLoopbackHost normalizes case and whitespace", () => {
  assert.equal(isLoopbackHost(" localhost "), true)
  assert.equal(isLoopbackHost("127.0.0.1"), true)
  assert.equal(isLoopbackHost("::1"), true)
  assert.equal(isLoopbackHost("[::1]"), true)
  assert.equal(isLoopbackHost("EXAMPLE.COM"), false)
})

test("envFlag accepts exact truthy aliases and rejects near-misses", () => {
  const previous = process.env.UIQ_CONST_BOOL
  try {
    for (const value of ["1", " true ", "YES", "On"]) {
      process.env.UIQ_CONST_BOOL = value
      assert.equal(envFlag("UIQ_CONST_BOOL"), true, `expected truthy for ${value}`)
    }
    for (const value of ["", "0", "false", " yes!", "true!"]) {
      process.env.UIQ_CONST_BOOL = value
      assert.equal(envFlag("UIQ_CONST_BOOL"), false, `expected falsy for ${value}`)
    }
    delete process.env.UIQ_CONST_BOOL
    assert.equal(envFlag("UIQ_CONST_BOOL"), false)
  } finally {
    if (previous === undefined) delete process.env.UIQ_CONST_BOOL
    else process.env.UIQ_CONST_BOOL = previous
  }
})

test("envPositiveInt respects fallback/min/max boundaries", () => {
  const previous = process.env.UIQ_CONST_INT
  try {
    process.env.UIQ_CONST_INT = "7"
    assert.equal(envPositiveInt("UIQ_CONST_INT", 5), 7)

    process.env.UIQ_CONST_INT = "3"
    assert.equal(envPositiveInt("UIQ_CONST_INT", 5, 3, 10), 3)

    process.env.UIQ_CONST_INT = "2"
    assert.equal(envPositiveInt("UIQ_CONST_INT", 5, 3, 10), 5)

    process.env.UIQ_CONST_INT = "999"
    assert.equal(envPositiveInt("UIQ_CONST_INT", 5, 1, 10), 10)

    delete process.env.UIQ_CONST_INT
    assert.equal(envPositiveInt("UIQ_CONST_INT", 5), 5)
  } finally {
    if (previous === undefined) delete process.env.UIQ_CONST_INT
    else process.env.UIQ_CONST_INT = previous
  }
})

test("workspaceRoot + runtimeRootOverride + runsRoot + repoRoot resolve roots deterministically", () => {
  const previousWorkspaceRoot = process.env.UIQ_MCP_WORKSPACE_ROOT
  const previousRuntimeRoot = process.env.UIQ_MCP_DEV_RUNTIME_ROOT
  const root = mkdtempSync(join(tmpdir(), "uiq-workspace-"))
  try {
    process.env.UIQ_MCP_WORKSPACE_ROOT = `  ${root}  `
    assert.equal(workspaceRoot(), root)
    assert.equal(repoRoot(), root)
    assert.equal(runsRoot(), resolve(root, ".runtime-cache/artifacts/runs"))

    process.env.UIQ_MCP_DEV_RUNTIME_ROOT = ".runtime-cache/dev"
    assert.equal(runtimeRootOverride(), resolve(root, ".runtime-cache/dev"))

    process.env.UIQ_MCP_DEV_RUNTIME_ROOT = "/tmp/uiq-runtime-absolute"
    assert.equal(runtimeRootOverride(), "/tmp/uiq-runtime-absolute")

    process.env.UIQ_MCP_DEV_RUNTIME_ROOT = "   "
    assert.equal(runtimeRootOverride(), null)

    delete process.env.UIQ_MCP_DEV_RUNTIME_ROOT
    assert.equal(runtimeRootOverride(), null)

    delete process.env.UIQ_MCP_WORKSPACE_ROOT
    assert.equal(workspaceRoot(), resolve("."))
    assert.equal(repoRoot(), resolve("."))
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.UIQ_MCP_WORKSPACE_ROOT
    else process.env.UIQ_MCP_WORKSPACE_ROOT = previousWorkspaceRoot
    if (previousRuntimeRoot === undefined) delete process.env.UIQ_MCP_DEV_RUNTIME_ROOT
    else process.env.UIQ_MCP_DEV_RUNTIME_ROOT = previousRuntimeRoot
  }
})

test("safeResolveUnder blocks traversal and isPathInside handles root/child/sibling boundaries", () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-path-"))
  const nested = join(root, "nested")
  mkdirSync(nested, { recursive: true })
  const leaf = join(nested, "a.txt")
  const sibling = join(resolve(root, ".."), "outside.txt")
  writeFileSync(leaf, "ok", "utf8")
  writeFileSync(sibling, "nope", "utf8")

  assert.equal(safeResolveUnder(root, "nested", "a.txt"), realpathSync(leaf))
  assert.equal(isPathInside(root, root), true)
  assert.equal(isPathInside(root, resolve(root, ".")), true)
  assert.equal(isPathInside(root, leaf), true)
  assert.equal(isPathInside(root, resolve(root, "..")), false)
  assert.equal(isPathInside(root, sibling), false)
  assert.throws(() => safeResolveUnder(root, ".."), /path traversal blocked/)
  assert.throws(
    () => safeResolveUnder(root, "..", "outside.txt"),
    /path traversal blocked/
  )
})

test("audit wrappers and filesystem helpers preserve behavior", async () => {
  const root = mkdtempSync(join(tmpdir(), "uiq-const-io-"))
  const txt = join(root, "payload.txt")
  const json = join(root, "payload.json")
  const created = join(root, "created", "deep")
  const previousWorkspaceRoot = process.env.UIQ_MCP_WORKSPACE_ROOT
  const previousRuntimeRoot = process.env.UIQ_MCP_RUNTIME_CACHE_ROOT
  try {
    process.env.UIQ_MCP_WORKSPACE_ROOT = root
    process.env.UIQ_MCP_RUNTIME_CACHE_ROOT = join(root, ".runtime-cache")
    writeFileSync(txt, "hello", "utf8")
    writeFileSync(json, JSON.stringify({ ok: true }), "utf8")

    assert.equal(readUtf8(txt), "hello")
    assert.deepEqual(readJson(json), { ok: true })
    assert.equal(auditLogPath(), ioAuditLogPath())
    ioWriteAudit({ type: "constants-test-io", ok: true, detail: "probe-io" })
    const before = readUtf8(auditLogPath())
    writeAudit({ type: "constants-test-wrapper", ok: true, detail: "probe-wrapper" })
    const after = readUtf8(auditLogPath())
    assert.equal(before.includes("constants-test-wrapper"), false)
    assert.equal(after.includes("constants-test-wrapper"), true)

    assert.equal(ensureDir(root), true)
    assert.equal(ensureDir(txt), false)
    assert.equal(ensureDir("\0invalid"), false)
    assert.equal(ensureDir({} as unknown as string), false)

    assert.equal(ensureDirReady(created), true)
    assert.equal(ensureDir(created), true)
    assert.equal(ensureDirReady("\0invalid"), false)

    const sleepResult = await Promise.race([
      sleep(0).then(() => "resolved"),
      new Promise((resolveTimeout) => setTimeout(() => resolveTimeout("timeout"), 100)),
    ])
    assert.equal(sleepResult, "resolved")
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.UIQ_MCP_WORKSPACE_ROOT
    else process.env.UIQ_MCP_WORKSPACE_ROOT = previousWorkspaceRoot
    if (previousRuntimeRoot === undefined) delete process.env.UIQ_MCP_RUNTIME_CACHE_ROOT
    else process.env.UIQ_MCP_RUNTIME_CACHE_ROOT = previousRuntimeRoot
  }
})

test("ensureDir catch branch returns strict false when fs stat throws", () => {
  const require = createRequire(import.meta.url)
  const fsModule = require("node:fs")
  const originalExistsSync = fsModule.existsSync
  const originalStatSync = fsModule.statSync
  try {
    fsModule.existsSync = () => true
    fsModule.statSync = () => {
      throw new Error("synthetic stat failure")
    }
    syncBuiltinESMExports()
    assert.equal(ensureDir("/tmp/force-throw"), false)
  } finally {
    fsModule.existsSync = originalExistsSync
    fsModule.statSync = originalStatSync
    syncBuiltinESMExports()
  }
})
