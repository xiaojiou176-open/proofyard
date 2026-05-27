import assert from "node:assert/strict"
import test from "node:test"

import {
  ALL_REGISTERED_TOOL_NAMES,
  CORE_12_TOOL_NAMES,
  isToolEnabled,
  resolveEnabledToolGroups,
} from "../src/core/registry.js"

test("resolveEnabledToolGroups keeps core-only defaults", () => {
  const groups = resolveEnabledToolGroups({})
  assert.deepEqual([...groups].sort(), ["core"])
})

test("resolveEnabledToolGroups expands all optional groups for token=all", () => {
  const groups = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "all" })
  assert.deepEqual([...groups].sort(), ["advanced", "analysis", "core", "proof", "register"])
})

test("resolveEnabledToolGroups ignores unknown tool groups", () => {
  const groups = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "unknown, proof , invalid" })
  assert.deepEqual([...groups].sort(), ["core", "proof"])
})

test("resolveEnabledToolGroups enables optional groups through UIQ_MCP_TOOL_GROUPS=all", () => {
  const groups = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "all" })
  assert.deepEqual([...groups].sort(), ["advanced", "analysis", "core", "proof", "register"])
})

test("ALL_REGISTERED_TOOL_NAMES is always sorted in stable lexicographic order", () => {
  const sorted = [...ALL_REGISTERED_TOOL_NAMES].sort()
  assert.deepEqual(ALL_REGISTERED_TOOL_NAMES, sorted)
})

test("resolveEnabledToolGroups ignores blank tool-group tokens", () => {
  const expected = ["advanced", "analysis", "core", "proof", "register"]
  const groups = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "advanced, register, proof, analysis" })
  assert.deepEqual([...groups].sort(), expected)
  const blank = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "   " })
  assert.deepEqual([...blank].sort(), ["core"])
})

test("resolveEnabledToolGroups filters blank tokens before group membership checks", () => {
  const originalIncludes = Array.prototype.includes
  let lookedUpBlankToken = false

  const includesProbe: typeof Array.prototype.includes = function (
    this: unknown[],
    searchElement: unknown,
    fromIndex?: number
  ): boolean {
    if (searchElement === "") lookedUpBlankToken = true
    return originalIncludes.call(this, searchElement, fromIndex)
  }

  Object.defineProperty(Array.prototype, "includes", {
    value: includesProbe,
    configurable: true,
    writable: true,
  })

  try {
    const groups = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "proof, ,register,,  " })
    assert.deepEqual([...groups].sort(), ["core", "proof", "register"])
  } finally {
    Object.defineProperty(Array.prototype, "includes", {
      value: originalIncludes,
      configurable: true,
      writable: true,
    })
  }

  assert.equal(lookedUpBlankToken, false)
})

test("isToolEnabled returns true for all core tools when only core group is enabled", () => {
  const coreOnly = new Set(["core"] as const)
  for (const tool of CORE_12_TOOL_NAMES) {
    assert.equal(isToolEnabled(tool, coreOnly), true, `expected core tool enabled: ${tool}`)
  }
})

test("isToolEnabled respects group filtering for non-core tools", () => {
  const coreOnly = new Set(["core"] as const)
  const full = resolveEnabledToolGroups({ UIQ_MCP_TOOL_GROUPS: "all" })

  const nonCoreTools = ALL_REGISTERED_TOOL_NAMES.filter(
    (name) => !CORE_12_TOOL_NAMES.includes(name as never)
  )
  assert.ok(nonCoreTools.length > 0)

  for (const tool of nonCoreTools) {
    assert.equal(
      isToolEnabled(tool, coreOnly),
      false,
      `expected non-core tool disabled in core-only mode: ${tool}`
    )
    assert.equal(
      isToolEnabled(tool, full),
      true,
      `expected non-core tool enabled when all groups are on: ${tool}`
    )
  }
})
