import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, "../..")

test("extract-register-spec forwards args to extract-flow-spec", () => {
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "uiq-register-bridge-outside-"))
  try {
    const outsideHar = path.join(outsideRoot, "register.har")
    writeFileSync(outsideHar, JSON.stringify({ log: { entries: [] } }, null, 2), "utf-8")

    const run = spawnSync(
      "pnpm",
      [
        "--dir",
        "automation",
        "exec",
        "tsx",
        "scripts/extract-register-spec.ts",
        `--har=${outsideHar}`,
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      }
    )

    assert.notEqual(run.status, 0)
    assert.match(String(run.stderr), /extract-flow-spec failed:/)
    assert.match(String(run.stderr), /unsafe --har path outside runtime root/)
  } finally {
    rmSync(outsideRoot, { recursive: true, force: true })
  }
})
