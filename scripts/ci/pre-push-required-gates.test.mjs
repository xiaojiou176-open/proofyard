import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT = resolve(REPO_ROOT, "scripts/ci/pre-push-required-gates.sh")

function runDry() {
  return spawnSync("bash", [SCRIPT, "--dry-run"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      UIQ_PREPUSH_REQUIRED_MODE: "strict",
      UIQ_PREPUSH_RUN_HEAVY_GATES: "true",
      UIQ_PREPUSH_RUN_LOCAL_NONSTUB_E2E: "true",
    },
    encoding: "utf8",
  })
}

test("pre-push strict heavy dry-run routes mutation and dedicated frontend gates through run-in-container", () => {
  const run = runDry()
  assert.equal(run.status, 0)
  assert.match(run.stdout, /mutation-ts-strict/)
  assert.match(run.stdout, /scripts\/ci\/run-in-container\.sh \[dry-run\] --task \[dry-run\] mutation-ts \[dry-run\] --gate \[dry-run\] mutation-ts-strict/)
  assert.match(run.stdout, /scripts\/ci\/run-in-container\.sh \[dry-run\] --task \[dry-run\] mutation-py \[dry-run\] --gate \[dry-run\] mutation-py-strict/)
  assert.match(run.stdout, /bash scripts\/ci\/run-in-container\.sh --task frontend-authenticity --gate nonstub-e2e\\\(local-backend\\,strict\\\)/)
  assert.match(run.stdout, /bash scripts\/ci\/run-in-container\.sh --task frontend-nonstub --gate nonstub-e2e\\\(local-backend\\,strict\\\)/)
  assert.match(run.stdout, /bash scripts\/ci\/run-in-container\.sh --task frontend-critical --gate nonstub-e2e\\\(local-backend\\,strict\\\)/)
})
