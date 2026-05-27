import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, test } from "@playwright/test"

const AUTOMATION_ROOT = path.resolve(process.cwd())

test("extract-flow-spec rejects HAR path outside runtime root", async () => {
  const unsafeHarPath = path.join(os.tmpdir(), `unsafe-flow-spec-${Date.now()}.har.json`)
  writeFileSync(unsafeHarPath, JSON.stringify({ log: { entries: [] } }, null, 2), "utf-8")

  const run = spawnSync("pnpm", ["tsx", "scripts/extract-flow-spec.ts", `--har=${unsafeHarPath}`], {
    cwd: AUTOMATION_ROOT,
    env: process.env,
    encoding: "utf-8",
    timeout: 120_000,
  })

  expect(run.status).not.toBe(0)
  expect(run.stderr).toContain("unsafe --har path outside runtime root")
})
