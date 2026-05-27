import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "check-observability-contract.sh"
)

function runContract(scanDir) {
  return spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      UIQ_OBSERVABILITY_SCAN_DIRS: scanDir,
    },
  })
}

function createFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "observability-contract-"))
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, "utf8")
  }
  return dir
}

const anchorFixture = `
logger.info(
    "auth reject",
    extra={
        "request_id": "r1",
        "trace_id": "t1",
        "status_code": 401,
        "error": "denied",
        "audit_reason": "policy"
    }
)
`

test("flags vague phrases from logger.warn and keyword message argument", () => {
  const fixture = createFixture({
    "good.py": anchorFixture,
    "warn.py": 'logger.warn(msg="An Error Occurred in auth flow")\n',
  })
  try {
    const result = runContract(fixture)
    assert.equal(result.status, 1, `expected fail, stdout=${result.stdout}, stderr=${result.stderr}`)
    assert.match(result.stdout, /vague_log_phrase/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("ignores non-logger .error calls to reduce false positives", () => {
  const fixture = createFixture({
    "good.py": anchorFixture,
    "non_logger.py": 'response.error("something went wrong")\n',
  })
  try {
    const result = runContract(fixture)
    assert.equal(result.status, 0, `expected pass, stdout=${result.stdout}, stderr=${result.stderr}`)
    assert.match(result.stdout, /pass: observability contract satisfied/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test("detects vague phrases in f-string logger message", () => {
  const fixture = createFixture({
    "good.py": anchorFixture,
    "fstring.py": 'logger.error(f"unexpected error: {exc}")\n',
  })
  try {
    const result = runContract(fixture)
    assert.equal(result.status, 1, `expected fail, stdout=${result.stdout}, stderr=${result.stderr}`)
    assert.match(result.stdout, /vague_log_phrase/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
