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

type RegisterSpec = {
  baseUrl: string
  registerEndpoint: {
    method: string
    path: string
    contentType: string | null
  }
  csrfBootstrap: {
    exists: boolean
    path: string | null
  }
  payloadExample: Record<string, unknown>
}

function runGeneratePlaywrightCase(args: string[], env: Record<string, string | undefined> = {}) {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete mergedEnv[key]
    else mergedEnv[key] = value
  }
  return spawnSync(
    "pnpm",
    ["--dir", "automation", "exec", "tsx", "scripts/generate-playwright-case.ts", ...args],
    {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: mergedEnv,
    }
  )
}

function buildSpec(): RegisterSpec {
  return {
    baseUrl: "https://example.test",
    registerEndpoint: {
      method: "POST",
      path: "/api/register",
      contentType: "application/json",
    },
    csrfBootstrap: {
      exists: true,
      path: "/api/csrf",
    },
    payloadExample: {
      email: "person@example.test",
      password: "demo-secret",
      marketing_opt_in: true,
    },
  }
}

test("generate-playwright-case supports explicit --spec and --out", { concurrency: false }, () => {
  const sandboxDir = path.join(AUTOMATION_RUNTIME_ROOT, `generate-playwright-case-${Date.now()}`)
  mkdirSync(sandboxDir, { recursive: true })
  const specPath = path.join(sandboxDir, "flow_request.spec.json")
  const outPath = path.join(sandboxDir, "register-from-har.generated.spec.ts")
  writeFileSync(specPath, JSON.stringify(buildSpec(), null, 2), "utf8")

  try {
    const run = runGeneratePlaywrightCase([`--spec=${specPath}`, `--out=${outPath}`])
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    assert.equal(existsSync(outPath), true)
    const generated = readFileSync(outPath, "utf8")
    assert.match(generated, /register from HAR generated template/)
    assert.match(generated, /const REGISTER_PATH = "\/api\/register";/)
    assert.match(generated, /const CSRF_PATH = "\/api\/csrf";/)
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true })
  }
})

test("generate-playwright-case falls back to latest-spec pointer", { concurrency: false }, () => {
  const sandboxDir = path.join(AUTOMATION_RUNTIME_ROOT, `generate-playwright-case-latest-${Date.now()}`)
  mkdirSync(sandboxDir, { recursive: true })
  const specPath = path.join(sandboxDir, "flow_request.spec.json")
  const outPath = path.join(sandboxDir, "register-from-har.latest.generated.spec.ts")
  const pointerPath = path.join(sandboxDir, "latest-spec.json")
  writeFileSync(specPath, JSON.stringify(buildSpec(), null, 2), "utf8")
  writeFileSync(pointerPath, JSON.stringify({ specPath }, null, 2), "utf8")

  try {
    const run = runGeneratePlaywrightCase([`--out=${outPath}`], {
      UIQ_AUTOMATION_LATEST_SPEC_PATH: pointerPath,
    })
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const payload = JSON.parse(String(run.stdout ?? "")) as { specPath: string; outputPath: string }
    assert.equal(payload.specPath, specPath)
    assert.equal(payload.outputPath, outPath)
    assert.equal(existsSync(outPath), true)
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true })
  }
})

test("generate-playwright-case defaults csrf bootstrap path when spec omits csrfBootstrap", () => {
  const sandboxDir = path.join(AUTOMATION_RUNTIME_ROOT, `generate-playwright-case-default-csrf-${Date.now()}`)
  mkdirSync(sandboxDir, { recursive: true })
  const specPath = path.join(sandboxDir, "flow_request.spec.json")
  const outPath = path.join(sandboxDir, "register-from-har.default-csrf.generated.spec.ts")
  writeFileSync(
    specPath,
    JSON.stringify(
      {
        baseUrl: "https://example.test",
        registerEndpoint: {
          method: "POST",
          path: "/api/register",
          contentType: "application/json",
        },
        payloadExample: {
          email: "person@example.test",
          password: "demo-secret",
        },
      },
      null,
      2
    ),
    "utf8"
  )

  try {
    const run = runGeneratePlaywrightCase([`--spec=${specPath}`, `--out=${outPath}`])
    assert.equal(run.status, 0, String(run.stderr ?? run.stdout ?? ""))
    const generated = readFileSync(outPath, "utf8")
    assert.match(generated, /const CSRF_PATH = "\/api\/csrf";/)
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true })
  }
})
