import assert from "node:assert/strict"
import test from "node:test"

import {
  buildReplayDraftContextOptions,
  deriveReplayDraftOutcome,
  resolveReplayDraftHeadless,
  resolveReplayDraftTargetUrl,
  shouldReplayPreconditions,
} from "./replay-flow-draft.js"
import {
  buildReplayStepContextOptions,
  deriveReplayStepStatus,
  resolveReplayStepHeadless,
  resolveReplayStepTargetUrl,
  shouldThrowReplayStepResult,
} from "./replay-flow-step.js"

test("replay-flow-step helpers cover headless, context, targetUrl and status branches", () => {
  assert.equal(resolveReplayStepHeadless(undefined), true)
  assert.equal(resolveReplayStepHeadless("false"), false)
  assert.equal(resolveReplayStepHeadless("true"), true)

  assert.deepEqual(buildReplayStepContextOptions(false, "/tmp/state.json"), {
    viewport: { width: 1280, height: 720 },
  })
  assert.deepEqual(buildReplayStepContextOptions(true, "/tmp/state.json"), {
    viewport: { width: 1280, height: 720 },
    storageState: "/tmp/state.json",
  })

  assert.equal(
    resolveReplayStepTargetUrl("click", true, "https://example.test/resume", "https://example.test/start"),
    "https://example.test/resume"
  )
  assert.equal(
    resolveReplayStepTargetUrl("navigate", true, "https://example.test/resume", "https://example.test/start"),
    "https://example.test/start"
  )
  assert.equal(
    resolveReplayStepTargetUrl("click", false, "https://example.test/resume", "https://example.test/start"),
    "https://example.test/start"
  )

  assert.equal(deriveReplayStepStatus({ manual_gate_required: true, ok: false }), "manual_gate")
  assert.equal(deriveReplayStepStatus({ manual_gate_required: false, ok: true }), "running")
  assert.equal(deriveReplayStepStatus({ manual_gate_required: false, ok: false }), "failed")

  assert.equal(shouldThrowReplayStepResult({ manual_gate_required: true, ok: false }), false)
  assert.equal(shouldThrowReplayStepResult({ manual_gate_required: false, ok: true }), false)
  assert.equal(shouldThrowReplayStepResult({ manual_gate_required: false, ok: false }), true)
})

test("replay-flow-draft helpers cover headless, resume, preconditions and final outcome branches", () => {
  assert.equal(resolveReplayDraftHeadless(undefined), true)
  assert.equal(resolveReplayDraftHeadless("false"), false)
  assert.equal(resolveReplayDraftHeadless("true"), true)

  assert.deepEqual(buildReplayDraftContextOptions(false, "/tmp/state.json"), {
    viewport: { width: 1280, height: 720 },
  })
  assert.deepEqual(buildReplayDraftContextOptions(true, "/tmp/state.json"), {
    viewport: { width: 1280, height: 720 },
    storageState: "/tmp/state.json",
  })

  assert.equal(shouldReplayPreconditions(0, true), false)
  assert.equal(shouldReplayPreconditions(2, false), false)
  assert.equal(shouldReplayPreconditions(2, true), true)

  assert.equal(
    resolveReplayDraftTargetUrl(true, "https://example.test/resume", "https://example.test/start"),
    "https://example.test/resume"
  )
  assert.equal(
    resolveReplayDraftTargetUrl(false, "https://example.test/resume", "https://example.test/start"),
    "https://example.test/start"
  )

  assert.deepEqual(deriveReplayDraftOutcome(true, [], []), {
    success: false,
    status: "manual_gate",
  })
  assert.deepEqual(deriveReplayDraftOutcome(false, [{ ok: true }], [{ ok: true }]), {
    success: true,
    status: "success",
  })
  assert.deepEqual(deriveReplayDraftOutcome(false, [{ ok: false }], [{ ok: true }]), {
    success: false,
    status: "failed",
  })
  assert.deepEqual(deriveReplayDraftOutcome(false, [{ ok: true }], [{ ok: false }]), {
    success: false,
    status: "failed",
  })
})
