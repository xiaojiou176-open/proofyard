import assert from "node:assert/strict"
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  applyProviderProtection,
  assertPathWithinRoots,
  buildFlowDraft,
  cleanupExpiredSessions,
  createSessionId,
  envEnabled,
  eventLooksSensitive,
  eventLooksStripeField,
  extractHostname,
  hasOtpHint,
  isPathWithinRoot,
  isSessionDirectory,
  isSessionDirectoryName,
  parseGatePolicy,
  parsePositiveNumber,
  parseProtectedProviderDomains,
  redactEventsForPersist,
  resolveRepoRoot,
  resolveMidsceneDriverPath,
  resolveMode,
  resolveRuntimeCacheRoot,
  resolveRuntimeRoot,
  resolveSafeMidsceneDriverPath,
  resolveProtectedProviderDomain,
  sanitizeSessionId,
  sanitizeUrlForPersist,
  triggerWorkspaceCleanup,
  type CapturedEvent,
} from "./record-session.js"
import type { FlowDraft, FlowStep } from "./record-session.shared.js"

function event(overrides: Partial<CapturedEvent> = {}): CapturedEvent {
  return {
    ts: "2026-03-09T00:00:00.000Z",
    type: "click",
    url: "https://checkout.stripe.com/pay?token=abc#frag",
    target: {
      tag: "input",
      id: "card-number",
      name: "cardNumber",
      type: "text",
      role: "textbox",
      text: "4242 4242 4242 4242",
      classes: ["field"],
      cssPath: "form > input[name='cardNumber']",
    },
    ...overrides,
  }
}

test("record-session path and numeric helpers cover root, sanitation and parsing branches", () => {
  const repoRoot = process.cwd()
  const runtimeRoot = path.join(repoRoot, ".runtime-cache")
  const inside = path.join(runtimeRoot, "automation", "session-1")
  const outside = path.resolve(repoRoot, "..", "session-1")

  assert.equal(isPathWithinRoot(inside, runtimeRoot), true)
  assert.equal(isPathWithinRoot(outside, runtimeRoot), false)
  assert.equal(assertPathWithinRoots(inside, [runtimeRoot], "inside"), inside)
  assert.throws(() => assertPathWithinRoots(outside, [runtimeRoot], "outside"), /unsafe outside/)

  assert.match(createSessionId(), /^session-\d{4}-\d{2}-\d{2}T/)
  assert.equal(sanitizeSessionId(undefined).startsWith("session-"), true)
  assert.equal(sanitizeSessionId("session-ok_1"), "session-ok_1")
  assert.throws(() => sanitizeSessionId("bad/value"), /invalid SESSION_ID/)

  assert.equal(sanitizeUrlForPersist("https://example.test/path?token=1#frag"), "https://example.test/path")
  assert.equal(sanitizeUrlForPersist("not-a-url"), "not-a-url")

  assert.equal(parsePositiveNumber("4", 10), 4)
  assert.equal(parsePositiveNumber("0", 10), 10)
  assert.equal(parsePositiveNumber("abc", 10), 10)
})

test("record-session provider and sensitivity helpers cover normalization branches", () => {
  assert.deepEqual(parseProtectedProviderDomains(undefined), ["stripe.com", "js.stripe.com"])
  assert.deepEqual(parseProtectedProviderDomains(" https://Stripe.com/pay, js.stripe.com "), [
    "stripe.com",
    "js.stripe.com",
  ])

  assert.equal(parseGatePolicy(undefined), "force_manual")
  assert.equal(parseGatePolicy("force_manual"), "force_manual")
  assert.equal(parseGatePolicy("unexpected"), "force_manual")

  assert.equal(extractHostname("https://checkout.stripe.com/pay"), "checkout.stripe.com")
  assert.equal(extractHostname("notaurl"), null)

  const protectedDomain = resolveProtectedProviderDomain(event(), ["stripe.com", "paypal.com"])
  assert.equal(protectedDomain, "stripe.com")
  assert.equal(
    resolveProtectedProviderDomain(
      event({ url: "https://example.test", target: { ...event().target, text: "plain" } }),
      ["stripe.com"]
    ),
    null
  )

  assert.equal(eventLooksStripeField(event()), true)
  assert.equal(eventLooksSensitive(event()), true)
  assert.equal(hasOtpHint("verification_code"), true)
  assert.equal(hasOtpHint("plain text"), false)
})

test("record-session flow draft and redaction helpers cover provider-gated and otp branches", () => {
  const clickEvent = event({
    type: "click",
    target: { ...event().target, text: "Pay now", role: "button" },
  })
  const otpEvent = event({
    type: "type",
    url: "https://example.test/register?otp=1",
    value: "123456",
    target: {
      ...event().target,
      id: "otp",
      name: "otp_code",
      type: "tel",
      text: "verification code",
      cssPath: "form > input[name='otp_code']",
    },
  })
  const passwordEvent = event({
    type: "type",
    url: "https://example.test/register?password=1",
    value: "super-secret",
    target: {
      ...event().target,
      id: "password",
      name: "password",
      type: "password",
      text: "password field",
      cssPath: "form > input[name='password']",
    },
  })

  const config = {
    protectedProviderDomains: ["stripe.com"],
    protectedProviderGatePolicy: "force_manual" as const,
  }
  const protectedStep = applyProviderProtection(
    {
      step_id: "s2",
      action: "click",
      target: { selectors: [{ kind: "css", value: "#pay", score: 80 }] },
    },
    clickEvent,
    config
  )
  assert.equal(protectedStep.gate_policy, "force_manual")
  assert.equal(protectedStep.gate_reason, "provider_protected_payment_step")

  const redacted = redactEventsForPersist([otpEvent, passwordEvent], false)
  assert.equal(redacted[0]?.value, "__redacted__")
  assert.equal(redacted[1]?.target.text, "__redacted__")
  assert.equal(redacted[0]?.url.includes("?"), false)

  const preserved = redactEventsForPersist(
    [
      event({
        type: "type",
        url: "https://example.test/profile?name=1",
        value: "visible-text",
        target: {
          ...event().target,
          id: "nickname",
          name: "nickname",
          type: "text",
          text: "nickname",
          cssPath: "form > input[name='nickname']",
        },
      }),
    ],
    true
  )
  assert.equal(preserved[0]?.value, "visible-text")

  const draft = buildFlowDraft("session-1", "https://example.test/register?foo=1", [
    { ...clickEvent, url: "https://checkout.stripe.com/pay?token=1" },
    otpEvent,
    passwordEvent,
  ], config) as FlowDraft
  assert.equal(draft.steps[0]?.action, "navigate")
  assert.equal(draft.start_url, "https://example.test/register")
  assert.equal(
    draft.steps.some((step: FlowStep) => step.gate_reason === "provider_protected_payment_step"),
    true
  )
  assert.equal(draft.steps.some((step: FlowStep) => step.value_ref === "${params.otp}"), true)
  assert.equal(draft.steps.some((step: FlowStep) => step.value_ref === "${secrets.input}"), true)
})

test("record-session envEnabled honors common truthy aliases", () => {
  const key = "UIQ_TEST_ENV_ENABLED"
  const previous = process.env[key]
  try {
    process.env[key] = "true"
    assert.equal(envEnabled(key), true)
    process.env[key] = "YES"
    assert.equal(envEnabled(key), true)
    process.env[key] = "0"
    assert.equal(envEnabled(key), false)
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

test("record-session runtime root helpers respect env overrides and reject unsafe overrides", () => {
  const repoRoot = process.cwd()
  const previousRuntime = process.env.UIQ_RUNTIME_CACHE_ROOT
  const previousMcpRuntime = process.env.UIQ_MCP_RUNTIME_CACHE_ROOT
  const previousUniversal = process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR
  try {
    delete process.env.UIQ_RUNTIME_CACHE_ROOT
    delete process.env.UIQ_MCP_RUNTIME_CACHE_ROOT
    delete process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR
    assert.equal(resolveRuntimeCacheRoot(repoRoot), path.resolve(repoRoot, ".runtime-cache"))

    process.env.UIQ_RUNTIME_CACHE_ROOT = ".cache-local"
    assert.equal(resolveRuntimeCacheRoot(repoRoot), path.resolve(repoRoot, ".cache-local"))

    delete process.env.UIQ_RUNTIME_CACHE_ROOT
    process.env.UIQ_MCP_RUNTIME_CACHE_ROOT = ".cache-from-mcp"
    assert.equal(resolveRuntimeCacheRoot(repoRoot), path.resolve(repoRoot, ".cache-from-mcp"))

    delete process.env.UIQ_MCP_RUNTIME_CACHE_ROOT
    process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR = path.resolve(repoRoot, ".runtime-cache/custom-automation")
    assert.equal(
      resolveRuntimeRoot(repoRoot),
      path.resolve(repoRoot, ".runtime-cache/custom-automation")
    )

    process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR = path.resolve(repoRoot, "..", "unsafe-automation")
    assert.throws(() => resolveRuntimeRoot(repoRoot), /unsafe UNIVERSAL_AUTOMATION_RUNTIME_DIR/)
  } finally {
    if (previousRuntime === undefined) delete process.env.UIQ_RUNTIME_CACHE_ROOT
    else process.env.UIQ_RUNTIME_CACHE_ROOT = previousRuntime
    if (previousMcpRuntime === undefined) delete process.env.UIQ_MCP_RUNTIME_CACHE_ROOT
    else process.env.UIQ_MCP_RUNTIME_CACHE_ROOT = previousMcpRuntime
    if (previousUniversal === undefined) delete process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR
    else process.env.UNIVERSAL_AUTOMATION_RUNTIME_DIR = previousUniversal
  }
})

test("record-session cleanupExpiredSessions removes expired and oversized session directories", async () => {
  const runtimeRoot = path.join(process.cwd(), ".runtime-cache", `record-session-cleanup-${Date.now()}`)
  const oldDir = path.join(runtimeRoot, "session-old")
  const keepDir = path.join(runtimeRoot, "session-keep")
  const trimDir = path.join(runtimeRoot, "session-trim")
  const noiseDir = path.join(runtimeRoot, "not-a-session")
  mkdirSync(oldDir, { recursive: true })
  mkdirSync(keepDir, { recursive: true })
  mkdirSync(trimDir, { recursive: true })
  mkdirSync(noiseDir, { recursive: true })
  writeFileSync(path.join(oldDir, "artifact.txt"), "old")
  writeFileSync(path.join(keepDir, "artifact.txt"), "k".repeat(26 * 1024 * 1024))
  writeFileSync(path.join(trimDir, "artifact.txt"), "t".repeat(26 * 1024 * 1024))
  writeFileSync(path.join(noiseDir, "artifact.txt"), "noise")

  const oldTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000)
  utimesSync(oldDir, oldTimestamp, oldTimestamp)

  const previousRetention = process.env.AUTOMATION_RETENTION_HOURS
  const previousMax = process.env.AUTOMATION_RUNTIME_MAX_BYTES
  try {
    process.env.AUTOMATION_RETENTION_HOURS = "1"
    process.env.AUTOMATION_RUNTIME_MAX_BYTES = "150"
    await cleanupExpiredSessions(runtimeRoot)

    assert.equal(existsSync(oldDir), false)
    assert.equal(existsSync(noiseDir), true)
    assert.equal(existsSync(keepDir) || existsSync(trimDir), true)
    assert.equal(existsSync(keepDir) && existsSync(trimDir), false)
  } finally {
    if (previousRetention === undefined) delete process.env.AUTOMATION_RETENTION_HOURS
    else process.env.AUTOMATION_RETENTION_HOURS = previousRetention
    if (previousMax === undefined) delete process.env.AUTOMATION_RUNTIME_MAX_BYTES
    else process.env.AUTOMATION_RUNTIME_MAX_BYTES = previousMax
    rmSync(runtimeRoot, { recursive: true, force: true })
  }
})

test("record-session session-directory and mode helpers cover naming and override branches", async () => {
  assert.equal(isSessionDirectoryName("session-abc"), true)
  assert.equal(isSessionDirectoryName("2026-03-09t00-00-00z"), true)
  assert.equal(isSessionDirectoryName("misc-dir"), false)

  const runtimeRoot = path.join(process.cwd(), ".runtime-cache", `record-session-meta-${Date.now()}`)
  const metaDir = path.join(runtimeRoot, "misc-dir")
  mkdirSync(metaDir, { recursive: true })
  writeFileSync(path.join(metaDir, "session-meta.json"), "{}", "utf8")
  try {
    assert.equal(await isSessionDirectory(metaDir, "misc-dir"), true)
    assert.equal(await isSessionDirectory(path.join(runtimeRoot, "plain"), "plain"), false)
  } finally {
    rmSync(runtimeRoot, { recursive: true, force: true })
  }

  const previousMode = process.env.RECORD_MODE
  try {
    delete process.env.RECORD_MODE
    assert.equal(resolveMode(), "manual")
    process.env.RECORD_MODE = "midscene"
    assert.equal(resolveMode(), "midscene")
    process.env.RECORD_MODE = "weird"
    assert.throws(() => resolveMode(), /unsupported record mode/)
  } finally {
    if (previousMode === undefined) delete process.env.RECORD_MODE
    else process.env.RECORD_MODE = previousMode
  }
})

test("record-session driver path helpers cover env resolution and safe path validation", async () => {
  const repoRoot = path.resolve(process.cwd(), "..")
  const allowedScriptDir = path.join(repoRoot, "automation", "scripts")
  const safeDriver = path.join(allowedScriptDir, "tmp-safe-driver.ts")
  const unsafeDriver = path.join(repoRoot, "tmp-unsafe-driver.txt")
  writeFileSync(safeDriver, "export async function runMidsceneTakeover() {}", "utf8")
  writeFileSync(unsafeDriver, "plain", "utf8")

  const previousDriver = process.env.MIDSCENE_DRIVER
  try {
    process.env.MIDSCENE_DRIVER = "./scripts/tmp-safe-driver.ts"
    assert.equal(resolveMidsceneDriverPath(), path.resolve(process.cwd(), "./scripts/tmp-safe-driver.ts"))
    assert.equal(await resolveSafeMidsceneDriverPath(repoRoot, safeDriver), safeDriver)
    await assert.rejects(
      () => resolveSafeMidsceneDriverPath(repoRoot, unsafeDriver),
      /driver must be a script file/
    )
  } finally {
    if (previousDriver === undefined) delete process.env.MIDSCENE_DRIVER
    else process.env.MIDSCENE_DRIVER = previousDriver
    rmSync(safeDriver, { force: true })
    rmSync(unsafeDriver, { force: true })
  }
})

test("record-session repo root and workspace cleanup helpers cover env/skip branches", async () => {
  const repoRoot = path.resolve(process.cwd(), "..")
  const previousRepoRoot = process.env.UIQ_REPO_ROOT
  const previousCleanupDisable = process.env.FLOW_DISABLE_AUTO_RUNTIME_CLEANUP
  const previousRuntimeRoot = process.env.UIQ_RUNTIME_CACHE_ROOT
  const cleanupRoot = path.join(repoRoot, ".runtime-cache", `record-session-workspace-${Date.now()}`)
  const cacheDir = path.join(cleanupRoot, "cache")
  mkdirSync(cacheDir, { recursive: true })

  try {
    process.env.UIQ_REPO_ROOT = path.join(repoRoot, "frontend")
    assert.equal(resolveRepoRoot(), path.resolve(repoRoot, "frontend"))

    process.env.UIQ_RUNTIME_CACHE_ROOT = cleanupRoot
    process.env.FLOW_DISABLE_AUTO_RUNTIME_CLEANUP = "1"
    await triggerWorkspaceCleanup(repoRoot)
    assert.equal(existsSync(path.join(cacheDir, "record-session-cleanup-marker.json")), false)

    delete process.env.FLOW_DISABLE_AUTO_RUNTIME_CLEANUP
    await triggerWorkspaceCleanup(path.join(repoRoot, "missing-repo-root"))
    assert.equal(existsSync(path.join(cacheDir, "record-session-cleanup-marker.json")), false)
  } finally {
    if (previousRepoRoot === undefined) delete process.env.UIQ_REPO_ROOT
    else process.env.UIQ_REPO_ROOT = previousRepoRoot
    if (previousCleanupDisable === undefined) delete process.env.FLOW_DISABLE_AUTO_RUNTIME_CLEANUP
    else process.env.FLOW_DISABLE_AUTO_RUNTIME_CLEANUP = previousCleanupDisable
    if (previousRuntimeRoot === undefined) delete process.env.UIQ_RUNTIME_CACHE_ROOT
    else process.env.UIQ_RUNTIME_CACHE_ROOT = previousRuntimeRoot
    rmSync(cleanupRoot, { recursive: true, force: true })
  }
})
