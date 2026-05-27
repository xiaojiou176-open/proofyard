import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCRIPT = readFileSync(resolve(REPO_ROOT, "scripts/run-frontend-e2e-nonstub.sh"), "utf8")

test("frontend nonstub temporary backend uses uv dev extras when launching uvicorn", () => {
  assert.match(SCRIPT, /launcher=\("uv"\s+"run"\s+"--extra"\s+"dev"\s+"uvicorn"\)/)
})
