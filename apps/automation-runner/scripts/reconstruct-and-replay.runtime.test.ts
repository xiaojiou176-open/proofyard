import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")

function runReconstructAndReplay(
  args: string[] = [],
  env: Record<string, string | undefined> = {}
) {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete mergedEnv[key]
    else mergedEnv[key] = value
  }
  return spawnSync(
    "pnpm",
    ["--dir", "automation", "exec", "tsx", "scripts/reconstruct-and-replay.ts", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: mergedEnv,
    }
  )
}

test("reconstruct-and-replay returns non-zero when preview backend is unavailable", () => {
  const run = runReconstructAndReplay(
    ["--sessionDir=/tmp/uiq-session-demo", "--mode=ensemble"],
    { UIQ_BASE_URL: "http://127.0.0.1:9", AUTOMATION_API_TOKEN: "test-token-1" }
  )
  assert.notEqual(run.status, 0)
  assert.match(`${run.stderr}\n${run.stdout}`, /reconstruct-and-replay failed|fetch failed/i)
})

test("reconstruct-and-replay returns non-zero when generate endpoint fails", () => {
  const run = runReconstructAndReplay([], { UIQ_BASE_URL: "http://127.0.0.1:9" })
  assert.notEqual(run.status, 0)
  assert.match(`${run.stderr}\n${run.stdout}`, /reconstruct-and-replay failed|fetch failed/i)
})
