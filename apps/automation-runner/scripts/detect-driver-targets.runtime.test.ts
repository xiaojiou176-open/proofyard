import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")

function runDetectDriverTargets() {
  return spawnSync(
    "pnpm",
    ["--dir", "automation", "exec", "tsx", "scripts/detect-driver-targets.ts"],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    }
  )
}

test("detect-driver-targets emits structured report for tauri/swift candidates", () => {
  const run = runDetectDriverTargets()
  const combined = `${run.stdout}\n${run.stderr}`
  assert.equal(run.status, 0, combined)

  const payload = JSON.parse(run.stdout) as {
    generated_at: string
    tauri: {
      binary_candidates: string[]
      app_bundle_candidates: string[]
      suggestion: string | null
    }
    swift: {
      xcodeproj_candidates: string[]
      xcworkspace_candidates: string[]
      suggestion: {
        project_or_workspace: string | null
        scheme_hint: string | null
      }
    }
  }

  assert.match(payload.generated_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(Array.isArray(payload.tauri.binary_candidates))
  assert.ok(Array.isArray(payload.tauri.app_bundle_candidates))
  assert.equal(payload.tauri.suggestion === null || typeof payload.tauri.suggestion === "string", true)
  assert.ok(Array.isArray(payload.swift.xcodeproj_candidates))
  assert.ok(Array.isArray(payload.swift.xcworkspace_candidates))
  assert.equal(
    payload.swift.suggestion.project_or_workspace === null ||
      typeof payload.swift.suggestion.project_or_workspace === "string",
    true
  )
})
