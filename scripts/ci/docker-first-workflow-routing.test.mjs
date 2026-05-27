import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const CI_WORKFLOW = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")
const PR_WORKFLOW = readFileSync(resolve(REPO_ROOT, ".github/workflows/pr.yml"), "utf8")

function getJobSection(content, jobName) {
  const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = content.match(new RegExp(`(^  ${escaped}:[\\s\\S]*?)(?=^  [A-Za-z0-9_.-]+:|\\Z)`, "m"))
  assert.ok(match, `expected workflow to contain job ${jobName}`)
  return match[1]
}

function expectRoute(section, task, gate) {
  assert.match(
    section,
    new RegExp(
      `bash scripts/ci/run-in-container\\.sh --task ${task.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --gate ${gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    )
  )
}

function expectBuildImageNeed(section) {
  assert.match(section, /needs:\s*\[[^\]]*build_ci_image[^\]]*\]/)
}

function expectUiqCiImageRef(section) {
  assert.match(section, /UIQ_CI_IMAGE_REF:\s*\$\{\{\s*needs\.build_ci_image\.outputs\.image_ref\s*\}\}/)
}

function expectNoHostBusinessRun(section) {
  const forbidden = [
    /run:\s+pnpm(?!\s+install --frozen-lockfile)/,
    /run:\s+uv run/,
    /run:\s+python3\s+scripts\/ci\//,
    /run:\s+node\s+scripts\/ci\//,
    /run:\s+pnpm\s+--dir/,
    /run:\s+pnpm\s+uiq\s+run/,
    /run:\s+pnpm\s+test:/,
    /run:\s+pnpm\s+mutation:/,
    /run:\s+pnpm\s+exec\s+tsc/,
    /run:\s+pnpm\s+test:gemini:web-audit/,
    /run:\s+bash scripts\/test-matrix\.sh/,
  ]
  for (const pattern of forbidden) {
    assert.doesNotMatch(section, pattern)
  }
}

test("ci workflow routes remaining required Linux/Web jobs through repo-owned container tasks", () => {
  const jobs = {
    frontend: ["frontend-full", "ci-frontend-full"],
    security_scan_script: ["security-scan", "ci-security-scan"],
    preflight_minimal: ["preflight-minimal", "ci-preflight-minimal"],
    backend: ["backend-smoke", "ci-backend-smoke"],
    backend_full: ["backend-full", "ci-backend-full"],
    core_contract_load: ["core-static-gates", "ci-core-static-gates"],
    root_web_typecheck: ["root-web-typecheck", "ci-root-web-typecheck"],
    root_web_unit: ["root-web-unit", "ci-root-web-unit"],
    root_web_ct: ["root-web-ct", "ci-root-web-ct"],
    root_web_e2e: ["root-web-e2e", "ci-root-web-e2e"],
    functional_regression_gate: ["functional-regression-matrix", "ci-functional-regression-matrix"],
    mutation_report: ["mutation-effective", "ci-mutation-effective"],
  }

  for (const [jobName, [task, gate]] of Object.entries(jobs)) {
    const section = getJobSection(CI_WORKFLOW, jobName)
    expectBuildImageNeed(section)
    expectUiqCiImageRef(section)
    expectRoute(section, task, gate)
    expectNoHostBusinessRun(section)
  }

  const manualAuditSection = getJobSection(CI_WORKFLOW, "manual_live_audits")
  expectRoute(manualAuditSection, "live-smoke", "ci-live-smoke")
  expectRoute(manualAuditSection, "gemini-web-audit", "ci-gemini-web-audit")

  const mutationSection = getJobSection(CI_WORKFLOW, "mutation_report")
  expectRoute(mutationSection, "mutation-ts", "ci-mutation-ts-strict")
  expectRoute(mutationSection, "mutation-py", "ci-mutation-py-strict")
})

test("pr workflow routes remaining required Linux/Web jobs through repo-owned container tasks", () => {
  const jobs = {
    "pr-lint-backend": ["backend-lint", "pr-backend-lint"],
    "pr-lint-frontend": ["pr-lint-frontend", "pr-frontend-lint"],
    "pr-static-gate": ["pr-static-gate", "pr-static-gate"],
    "pr-mcp-gate": ["pr-mcp-gate", "pr-mcp-gate"],
    "pr-run-gate": ["pr-run-profile", "pr-run-profile"],
    "pr-frontend-e2e-behavior": ["pr-frontend-e2e-shard", "pr-frontend-e2e-shard"],
    "pr-quality-gate": ["pr-quality-gate", "pr-quality-gate"],
  }

  for (const [jobName, [task, gate]] of Object.entries(jobs)) {
    const section = getJobSection(PR_WORKFLOW, jobName)
    expectBuildImageNeed(section)
    expectUiqCiImageRef(section)
    expectRoute(section, task, gate)
    expectNoHostBusinessRun(section)
  }

  const prE2eSection = getJobSection(PR_WORKFLOW, "pr-frontend-e2e-behavior")
  expectRoute(prE2eSection, "frontend-authenticity", "pr-frontend-authenticity")
  expectRoute(prE2eSection, "frontend-nonstub", "pr-frontend-nonstub")
  expectRoute(prE2eSection, "frontend-critical", "pr-frontend-critical")

  const prQualitySection = getJobSection(PR_WORKFLOW, "pr-quality-gate")
  assert.doesNotMatch(prQualitySection, /run:\s+pnpm mutation:effective/)
  assert.doesNotMatch(prQualitySection, /run:\s+pnpm test:integration/)
  assert.doesNotMatch(prQualitySection, /run:\s+uv run --extra dev pytest/)
})
