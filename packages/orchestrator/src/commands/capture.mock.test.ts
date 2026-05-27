import assert from "node:assert/strict"
import test from "node:test"
import { resolveCaptureApiMock } from "./capture.js"

test("resolveCaptureApiMock covers required capture endpoints", () => {
  const requiredPaths = [
    "/api/automation/commands",
    "/api/automation/tasks",
    "/health/diagnostics",
    "/health/alerts",
    "/api/command-tower/latest-flow",
    "/api/command-tower/latest-flow-draft",
    "/api/command-tower/evidence-timeline",
  ]

  for (const pathname of requiredPaths) {
    const mocked = resolveCaptureApiMock(pathname)
    assert.ok(mocked, `expected mock response for ${pathname}`)
    assert.equal(mocked?.status, 200)
  }
})

test("resolveCaptureApiMock falls back /api/* and /health/* to empty 200 payload", () => {
  const apiFallback = resolveCaptureApiMock("/api/anything-else")
  assert.deepEqual(apiFallback, { status: 200, body: {} })

  const healthFallback = resolveCaptureApiMock("/health/unknown")
  assert.deepEqual(healthFallback, { status: 200, body: {} })

  assert.equal(resolveCaptureApiMock("/not-mocked"), null)
})
