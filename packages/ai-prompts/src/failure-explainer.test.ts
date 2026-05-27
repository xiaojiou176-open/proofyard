import assert from "node:assert/strict"
import test from "node:test"
import { getPromptDefinition } from "./registry.js"

test("failure explainer prompt definition exists with strict contract", () => {
  const definition = getPromptDefinition("failure_explainer.explanation")
  assert.equal(definition.version, "1.0.0")
  assert.equal(definition.outputSchema.required?.includes("evidence_anchors"), true)
  assert.equal(definition.outputSchema.required?.includes("next_actions"), true)
})
