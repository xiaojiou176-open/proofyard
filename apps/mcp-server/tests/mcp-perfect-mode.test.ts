import assert from "node:assert/strict"
import test from "node:test"
import { isAdvancedToolsEnabled } from "../src/core/api-client.js"

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const snapshot = Object.fromEntries(
    Object.keys(vars).map((key) => [key, process.env[key]])
  ) as Record<string, string | undefined>
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fn()
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("perfect mode does not implicitly enable advanced tools without group opt-in", () => {
  withEnv(
    {
      UIQ_MCP_PERFECT_MODE: "true",
      UIQ_MCP_TOOL_GROUPS: undefined,
    },
    () => {
      assert.equal(isAdvancedToolsEnabled(), false)
    }
  )
})

test("unset perfect mode still requires explicit advanced group opt-in", () => {
  withEnv(
    {
      UIQ_MCP_PERFECT_MODE: undefined,
      UIQ_MCP_TOOL_GROUPS: undefined,
    },
    () => {
      assert.equal(isAdvancedToolsEnabled(), false)
    }
  )
})

test("non-perfect mode keeps advanced tools opt-in", () => {
  withEnv(
    {
      UIQ_MCP_PERFECT_MODE: "false",
      UIQ_MCP_TOOL_GROUPS: "",
    },
    () => {
      assert.equal(isAdvancedToolsEnabled(), false)
    }
  )
})

test("non-perfect mode enables advanced tools only when advanced group is present", () => {
  withEnv(
    {
      UIQ_MCP_PERFECT_MODE: "false",
      UIQ_MCP_TOOL_GROUPS: "advanced,proof",
    },
    () => {
      assert.equal(isAdvancedToolsEnabled(), true)
    }
  )
})
