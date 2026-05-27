import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")
const AUTOMATION_RUNTIME_ROOT = path.join(REPO_ROOT, ".runtime-cache", "automation")
const LATEST_SESSION_PATH = path.join(AUTOMATION_RUNTIME_ROOT, "latest-session.json")
const TARGETS_ROOT = path.join(REPO_ROOT, "config", "targets")

function readMaybe(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null
}

function runBuildManifest(args: string[] = []): ReturnType<typeof spawnSync> {
  return spawnSync("pnpm", ["--dir", "automation", "exec", "tsx", "scripts/build-manifest.ts", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  })
}

test("build-manifest uses fallback session discovery and target file metadata", { concurrency: false }, () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  mkdirSync(TARGETS_ROOT, { recursive: true })

  const previousLatest = readMaybe(LATEST_SESSION_PATH)
  const targetId = `build-manifest-target-${Date.now()}`
  const targetPath = path.join(TARGETS_ROOT, `${targetId}.json`)
  const sessionId = `build-manifest-session-${Date.now()}`
  const sessionDir = path.join(AUTOMATION_RUNTIME_ROOT, sessionId)

  try {
    writeFileSync(
      LATEST_SESSION_PATH,
      JSON.stringify({ sessionId: "broken-pointer", sessionDir: path.join(AUTOMATION_RUNTIME_ROOT, "missing") }),
      "utf8"
    )
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      path.join(sessionDir, "flow-draft.json"),
      JSON.stringify({ steps: [{ step_id: "s1" }, { step_id: "s2" }] }, null, 2),
      "utf8"
    )
    writeFileSync(
      path.join(sessionDir, "replay-flow-result.json"),
      JSON.stringify({ stepResults: [{ ok: true }, { ok: false }, {}] }, null, 2),
      "utf8"
    )
    writeFileSync(path.join(sessionDir, "register.har"), "{}", "utf8")
    writeFileSync(path.join(sessionDir, "source.html"), "<html></html>", "utf8")
    mkdirSync(path.join(sessionDir, "video"), { recursive: true })
    writeFileSync(
      targetPath,
      JSON.stringify(
        {
          target_id: targetId,
          platform: "web",
          driver_id: "web-playwright",
          base_url: "http://127.0.0.1:4173",
        },
        null,
        2
      ),
      "utf8"
    )

    const run = runBuildManifest([`--target=${targetId}`])
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))

    const manifestPath = path.join(sessionDir, "manifest.json")
    assert.equal(existsSync(manifestPath), true)
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      run_id: string
      target: { target_id: string; driver_id: string }
      summary: { step_total: number; failed_steps: number; has_video: boolean }
      artifacts: { replay_result_path: string | null }
    }
    assert.equal(manifest.run_id, sessionId)
    assert.equal(manifest.target.target_id, targetId)
    assert.equal(manifest.target.driver_id, "web-playwright")
    assert.equal(manifest.summary.step_total, 3)
    assert.equal(manifest.summary.failed_steps, 1)
    assert.equal(manifest.summary.has_video, true)
    assert.equal(manifest.artifacts.replay_result_path, path.join(sessionDir, "replay-flow-result.json"))
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
    rmSync(targetPath, { force: true })
    if (previousLatest === null) {
      rmSync(LATEST_SESSION_PATH, { force: true })
    } else {
      writeFileSync(LATEST_SESSION_PATH, previousLatest, "utf8")
    }
  }
})

test("build-manifest fails when explicit session exists without flow draft", { concurrency: false }, () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const previousLatest = readMaybe(LATEST_SESSION_PATH)
  const sessionId = `build-manifest-empty-${Date.now()}`
  const sessionDir = path.join(AUTOMATION_RUNTIME_ROOT, sessionId)

  try {
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(LATEST_SESSION_PATH, JSON.stringify({ sessionId, sessionDir }, null, 2), "utf8")

    const run = runBuildManifest([`--session-id=${sessionId}`])
    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /session has no flow-draft\.json/)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
    if (previousLatest === null) {
      rmSync(LATEST_SESSION_PATH, { force: true })
    } else {
      writeFileSync(LATEST_SESSION_PATH, previousLatest, "utf8")
    }
  }
})

test("build-manifest falls back to env target metadata and preserves missing optional artifacts", { concurrency: false }, () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const previousLatest = readMaybe(LATEST_SESSION_PATH)
  const previousTargetId = process.env.TARGET_ID
  const previousTargetPlatform = process.env.TARGET_PLATFORM
  const previousDriverId = process.env.DRIVER_ID
  const previousBaseUrl = process.env.BASE_URL
  const sessionId = `build-manifest-env-target-${Date.now()}`
  const sessionDir = path.join(AUTOMATION_RUNTIME_ROOT, sessionId)

  try {
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      path.join(sessionDir, "flow-draft.json"),
      JSON.stringify({ steps: [{ step_id: "only-step" }] }, null, 2),
      "utf8"
    )
    writeFileSync(LATEST_SESSION_PATH, JSON.stringify({ sessionId, sessionDir }, null, 2), "utf8")
    process.env.TARGET_ID = "missing-target"
    process.env.TARGET_PLATFORM = "desktop"
    process.env.DRIVER_ID = "desktop-driver"
    process.env.BASE_URL = "http://127.0.0.1:4444"

    const run = runBuildManifest([`--session-id=${sessionId}`])
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))

    const manifestPath = path.join(sessionDir, "manifest.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      target: { target_id: string; platform: string; driver_id: string; base_url?: string }
      summary: {
        step_total: number
        failed_steps: number
        has_flow_draft: boolean
        has_har: boolean
        has_html: boolean
        has_video: boolean
      }
      artifacts: {
        flow_draft_path: string | null
        har_path: string | null
        html_path: string | null
        video_dir: string | null
        replay_result_path: string | null
      }
    }
    assert.equal(manifest.target.target_id, "missing-target")
    assert.equal(manifest.target.platform, "desktop")
    assert.equal(manifest.target.driver_id, "desktop-driver")
    assert.equal(manifest.target.base_url, "http://127.0.0.1:4444")
    assert.equal(manifest.summary.step_total, 0)
    assert.equal(manifest.summary.failed_steps, 0)
    assert.equal(manifest.summary.has_flow_draft, true)
    assert.equal(manifest.summary.has_har, false)
    assert.equal(manifest.summary.has_html, false)
    assert.equal(manifest.summary.has_video, false)
    assert.equal(manifest.artifacts.flow_draft_path, path.join(sessionDir, "flow-draft.json"))
    assert.equal(manifest.artifacts.har_path, null)
    assert.equal(manifest.artifacts.html_path, null)
    assert.equal(manifest.artifacts.video_dir, null)
    assert.equal(manifest.artifacts.replay_result_path, null)
  } finally {
    if (previousTargetId === undefined) delete process.env.TARGET_ID
    else process.env.TARGET_ID = previousTargetId
    if (previousTargetPlatform === undefined) delete process.env.TARGET_PLATFORM
    else process.env.TARGET_PLATFORM = previousTargetPlatform
    if (previousDriverId === undefined) delete process.env.DRIVER_ID
    else process.env.DRIVER_ID = previousDriverId
    if (previousBaseUrl === undefined) delete process.env.BASE_URL
    else process.env.BASE_URL = previousBaseUrl
    rmSync(sessionDir, { recursive: true, force: true })
    if (previousLatest === null) {
      rmSync(LATEST_SESSION_PATH, { force: true })
    } else {
      writeFileSync(LATEST_SESSION_PATH, previousLatest, "utf8")
    }
  }
})

test("build-manifest fails when explicit session directory does not exist", { concurrency: false }, () => {
  const missingSessionId = `build-manifest-missing-${Date.now()}`
  const run = runBuildManifest([`--session-id=${missingSessionId}`])
  assert.notEqual(run.status, 0)
  assert.match(String(run.stderr), /session not found:/)
})

test("build-manifest prefers latest-session pointer when it already points to a usable session", { concurrency: false }, () => {
  mkdirSync(AUTOMATION_RUNTIME_ROOT, { recursive: true })
  const previousLatest = readMaybe(LATEST_SESSION_PATH)
  const sessionId = `build-manifest-pointer-${Date.now()}`
  const sessionDir = path.join(AUTOMATION_RUNTIME_ROOT, sessionId)

  try {
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      path.join(sessionDir, "flow-draft.json"),
      JSON.stringify({ steps: [{ step_id: "pointer-step" }] }, null, 2),
      "utf8"
    )
    writeFileSync(
      LATEST_SESSION_PATH,
      JSON.stringify({ sessionId, sessionDir }, null, 2),
      "utf8"
    )

    const run = runBuildManifest()
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const manifest = JSON.parse(readFileSync(path.join(sessionDir, "manifest.json"), "utf8")) as {
      run_id: string
    }
    assert.equal(manifest.run_id, sessionId)
  } finally {
    rmSync(sessionDir, { recursive: true, force: true })
    if (previousLatest === null) {
      rmSync(LATEST_SESSION_PATH, { force: true })
    } else {
      writeFileSync(LATEST_SESSION_PATH, previousLatest, "utf8")
    }
  }
})
