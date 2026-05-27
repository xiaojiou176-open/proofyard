import assert from "node:assert/strict"
import test from "node:test"
import { z } from "zod"

import { runOverrideSchema } from "../src/core/types.js"

const runOverrideZodSchema = z.object(runOverrideSchema)

test("runOverrideSchema accepts valid enum + numeric overrides", () => {
  const parsed = runOverrideZodSchema.safeParse({
    loadEngine: "both",
    a11yEngine: "axe",
    perfPreset: "desktop",
    perfEngine: "lhci",
    visualMode: "diff",
    exploreMaxDepth: 3,
    autostartTarget: true,
  })
  assert.equal(parsed.success, true)
})

test("runOverrideSchema rejects invalid enum variants", () => {
  const parsed = runOverrideZodSchema.safeParse({
    loadEngine: "legacy",
    a11yEngine: "x",
    perfPreset: "tablet",
    perfEngine: "custom",
    visualMode: "merge",
  })
  assert.equal(parsed.success, false)
})

test("runOverrideSchema enforces integer + boolean field contracts", () => {
  const parsed = runOverrideZodSchema.safeParse({
    exploreMaxDepth: 1.5,
    diagnosticsMaxItems: "10",
    autostartTarget: "true",
  })
  assert.equal(parsed.success, false)
})
