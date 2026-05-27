import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const REPO_ROOT = process.cwd()

function withFixture(t, callback) {
  const root = mkdtempSync(join(tmpdir(), "uiq-gov-hardcut-"))
  t.after(() => {
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(join(root, "configs/governance"), { recursive: true })
  mkdirSync(join(root, "docs/reference/generated/governance"), { recursive: true })
  mkdirSync(join(root, "apps/api/app/core"), { recursive: true })
  mkdirSync(join(root, "apps/mcp-server/src/core"), { recursive: true })
  writeFileSync(join(root, ".gitignore"), "/.runtime-cache/\n", "utf8")
  writeFileSync(join(root, "docs/reference/public-surface-sanitization-policy.md"), "docs/reference/generated/governance/log-event-schema.md\ndocs/reference/generated/governance/runtime-output-registry.md\n", "utf8")
  writeFileSync(join(root, "apps/api/app/core/observability.py"), "", "utf8")
  writeFileSync(join(root, "apps/mcp-server/src/core/io.ts"), "", "utf8")
  writeControlPlane(root)
  callback(root)
}

function writeControlPlane(root) {
  writeJson(join(root, "configs/governance/root-allowlist.json"), {
    mode: "strict-hallway",
    allowedTrackedRoots: ["configs", "frontend", "backend", "apps", "packages", "automation", "docs", ".gitignore"],
    allowedLocalRuntimeRoots: [".runtime-cache"],
    allowedLocalToolingRoots: [],
    forbiddenRootNames: [],
    forbiddenRootGlobs: [],
    archiveTargets: {},
    requiredDocs: [],
  })
  writeJson(join(root, "configs/governance/runtime-output-registry.json"), {
    runtimeRoot: ".runtime-cache",
    managedBuckets: [{ id: "logs", path: ".runtime-cache/logs", kind: "logs", cleanupOwner: "scripts/runtime-gc.sh", retention: { strategy: "rotate+gc" } }],
    requiredGitignoreLines: ["/.runtime-cache/"],
    rootNoisePaths: [],
    toolOutputs: [],
  })
  writeJson(join(root, "configs/governance/log-event.schema.json"), {
    required: ["timestamp", "level", "kind", "component", "channel", "run_id", "event_code", "message", "attrs", "redaction_state"],
    properties: {
      timestamp: { type: "string" },
      level: { type: "string", enum: ["debug", "info", "warning", "error", "critical"] },
      kind: { type: "string", enum: ["runtime", "test", "ci", "audit"] },
      component: { type: "string" },
      channel: { type: "string" },
      run_id: { type: ["string", "null"] },
      event_code: { type: "string" },
      message: { type: "string" },
      attrs: { type: "object" },
      redaction_state: { type: "string", enum: ["unknown", "raw-safe", "redacted", "secret-free"] },
    },
    additionalProperties: false,
  })
  writeJson(join(root, "configs/governance/module-boundaries.json"), {
    responsibilityMap: [
      { root: "frontend", role: "ui", mayDependOn: ["packages", "contracts", "configs"], mustNotDependOn: ["backend", "tests", "docs", ".runtime-cache"] },
      { root: "packages", role: "shared", mayDependOn: ["contracts", "configs"], mustNotDependOn: ["frontend", "backend", "automation", "tests", "docs", ".runtime-cache"] },
      { root: "backend", role: "api", mayDependOn: ["contracts", "configs"], mustNotDependOn: ["frontend", "tests", "docs", ".runtime-cache"] },
      { root: "automation", role: "automation", mayDependOn: ["packages", "contracts", "configs"], mustNotDependOn: ["tests", "docs", ".runtime-cache"] },
      { root: "apps", role: "apps", mayDependOn: ["packages", "contracts", "configs", "backend"], mustNotDependOn: ["tests", "docs", ".runtime-cache"] },
      { root: "tests", role: "tests", mayDependOn: ["frontend", "apps", "backend", "automation", "packages", "contracts", "configs"], mustNotDependOn: [".runtime-cache"] },
    ],
    forbiddenImportRootsForSource: ["docs", "tests", ".runtime-cache"],
    contractOnlyRoots: ["contracts", "configs/schemas"],
    publicSurfaceHints: [],
  })
  writeJson(join(root, "configs/governance/upstream-registry.json"), { entries: [] })
  writeJson(join(root, "configs/governance/upstream-compat-matrix.json"), { groups: [] })
}

function writeJson(path, payload) {
  mkdirSync(resolve(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

test("module boundaries reject forbidden cross-root import", (t) => {
  withFixture(t, (root) => {
    mkdirSync(join(root, "apps/web/src"), { recursive: true })
    mkdirSync(join(root, "apps/api/app"), { recursive: true })
    writeFileSync(join(root, "apps/api/app/service.ts"), "export const x = 1;\n", "utf8")
    writeFileSync(join(root, "apps/web/src/page.ts"), 'import "../../apps/api/app/service.ts"\n', "utf8")
    const result = spawnSync("node", [resolve(REPO_ROOT, "scripts/ci/check-module-boundaries.mjs")], {
      cwd: root,
      encoding: "utf8",
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /may-depend violation|must-not-depend violation/)
  })
})

test("governance score rejects missing current-run proof", (t) => {
  withFixture(t, (root) => {
    const result = spawnSync(
      "node",
      [resolve(REPO_ROOT, "scripts/ci/governance-score-report.mjs")],
      {
        cwd: root,
        env: { ...process.env, UIQ_GOVERNANCE_RUN_ID: "missing-proof" },
        encoding: "utf8",
      }
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /missing fresh governance proof/)
  })
})
