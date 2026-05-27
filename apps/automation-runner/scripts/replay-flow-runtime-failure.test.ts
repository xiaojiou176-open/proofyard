import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")
const AUTOMATION_RUNTIME_ROOT = path.join(REPO_ROOT, ".runtime-cache", "automation")
const isEmulatedLinuxChromium =
  process.platform === "linux" &&
  process.arch === "x64" &&
  /^(aarch64|arm64)$/i.test(process.env.UIQ_HOST_ARCH ?? "")

function runScript(
  scriptName: "replay-flow-step.ts" | "replay-flow-draft.ts",
  envOverrides: Record<string, string | undefined>
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return spawnSync("pnpm", ["--dir", "automation", "exec", "tsx", `scripts/${scriptName}`], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env,
  })
}

function writeFlowDraft(sessionDir: string): void {
  const flowDraft = {
    flow_id: "flow-test",
    session_id: path.basename(sessionDir),
    start_url: "https://example.test",
    steps: [
      {
        step_id: "step-1",
        action: "navigate",
        url: "https://example.test/register",
      },
      {
        step_id: "step-2",
        action: "click",
        target: { selectors: [{ kind: "css", value: "button[type='submit']", score: 90 }] },
      },
    ],
  }
  writeFileSync(path.join(sessionDir, "flow-draft.json"), JSON.stringify(flowDraft, null, 2), "utf-8")
}

function writeSuccessFlowDraft(sessionDir: string): void {
  const html = encodeURIComponent("<html><body><button type='submit'>Submit</button></body></html>")
  const url = `data:text/html,${html}`
  const flowDraft = {
    flow_id: "flow-success",
    session_id: path.basename(sessionDir),
    start_url: url,
    steps: [
      { step_id: "step-1", action: "navigate", url },
      {
        step_id: "step-2",
        action: "click",
        target: { selectors: [{ kind: "css", value: "button[type='submit']", score: 90 }] },
      },
    ],
  }
  writeFileSync(path.join(sessionDir, "flow-draft.json"), JSON.stringify(flowDraft, null, 2), "utf-8")
}

test("replay-flow-step fails fast when FLOW_STEP_ID is missing", () => {
  const run = runScript("replay-flow-step.ts", {
    FLOW_STEP_ID: undefined,
    FLOW_SESSION_ID: undefined,
  })
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /FLOW_STEP_ID is required/)
})

test("replay-flow-step fails fast when FLOW_STEP_ID cannot be found in draft", () => {
  mkdirSync(path.join(REPO_ROOT, ".runtime-cache"), { recursive: true })
  const runtimeCacheRoot = mkdtempSync(path.join(REPO_ROOT, ".runtime-cache", "replay-step-cache-"))
  const automationRuntimeRoot = path.join(runtimeCacheRoot, "automation")
  mkdirSync(automationRuntimeRoot, { recursive: true })
  const sessionDir = mkdtempSync(path.join(automationRuntimeRoot, "replay-step-not-found-"))
  const sessionId = path.basename(sessionDir)
  writeFlowDraft(sessionDir)

  try {
    const run = runScript("replay-flow-step.ts", {
      FLOW_SESSION_ID: sessionId,
      FLOW_STEP_ID: "missing-step",
      HEADLESS: "true",
      UIQ_RUNTIME_CACHE_ROOT: runtimeCacheRoot,
    })
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /step not found: missing-step/)
  } finally {
    rmSync(runtimeCacheRoot, { recursive: true, force: true })
  }
})

test("replay-flow-draft fails before browser launch when FLOW_FROM_STEP_ID is invalid", () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const sessionDir = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "replay-draft-invalid-from-"))
  const sessionId = path.basename(sessionDir)
  writeFlowDraft(sessionDir)

  try {
    const run = runScript("replay-flow-draft.ts", {
      FLOW_SESSION_ID: sessionId,
      FLOW_FROM_STEP_ID: "step-unknown",
      HEADLESS: "true",
    })
    assert.notEqual(run.status, 0)
    assert.ok(String(run.stderr).includes("FLOW_FROM_STEP_ID not found"))
    assert.ok(String(run.stderr).includes("Known step ids: [step-1, step-2]"))
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})

test("replay-flow-draft reports missing flow draft file for unknown session", () => {
  const run = runScript("replay-flow-draft.ts", {
    FLOW_SESSION_ID: `missing-${Date.now()}`,
    HEADLESS: "true",
    FLOW_FROM_STEP_ID: undefined,
  })
  assert.notEqual(run.status, 0)
  assert.ok(String(run.stderr).includes("ENOENT"))
  assert.ok(String(run.stderr).includes("flow-draft.json"))
})

const browserSuccessTest = isEmulatedLinuxChromium ? test.skip : test

browserSuccessTest("replay-flow-draft succeeds for a simple data-url flow", () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const sessionDir = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "replay-draft-success-"))
  const sessionId = path.basename(sessionDir)
  writeSuccessFlowDraft(sessionDir)

  try {
    const run = runScript("replay-flow-draft.ts", {
      FLOW_SESSION_ID: sessionId,
      HEADLESS: "true",
      FLOW_FROM_STEP_ID: undefined,
    })
    assert.equal(run.status, 0, String(run.stderr))
    const result = JSON.parse(
      readFileSync(path.join(sessionDir, "replay-flow-result.json"), "utf-8")
    ) as {
      success: boolean
      status: string
      stepResults: Array<{ ok: boolean; step_id: string }>
    }
    assert.equal(result.success, true)
    assert.equal(result.status, "success")
    assert.equal(result.stepResults.every((step) => step.ok), true)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})

browserSuccessTest("replay-flow-step succeeds for a direct navigate step", () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const sessionDir = mkdtempSync(path.join(AUTOMATION_RUNTIME_ROOT, "replay-step-success-"))
  const sessionId = path.basename(sessionDir)
  writeSuccessFlowDraft(sessionDir)

  try {
    const run = runScript("replay-flow-step.ts", {
      FLOW_SESSION_ID: sessionId,
      FLOW_STEP_ID: "step-1",
      HEADLESS: "true",
    })
    assert.equal(run.status, 0, String(run.stderr))
    const result = JSON.parse(
      readFileSync(path.join(sessionDir, "replay-flow-step-result.json"), "utf-8")
    ) as {
      ok: boolean
      detail: string
      action: string
    }
    assert.equal(result.ok, true)
    assert.equal(result.action, "navigate")
    assert.match(result.detail, /navigated to data:text\/html/)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
  }
})
