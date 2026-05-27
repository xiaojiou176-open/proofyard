import { describe, expect, it } from "vitest"
import { formatActionableErrorMessage } from "./errorFormatter"

describe("formatActionableErrorMessage", () => {
  it("returns empty string for blank input", () => {
    expect(
      formatActionableErrorMessage("   ", {
        action: "Retry",
        troubleshootingEntry: "Check logs",
      })
    ).toBe("")
  })

  it("returns structured message as-is when tokens already exist", () => {
    const message = "Issue: failure. Suggested action: retry. Troubleshooting: check logs"
    expect(
      formatActionableErrorMessage(message, {
        action: "Ignore",
        troubleshootingEntry: "Ignore",
      })
    ).toBe(message)
  })

  it("formats unstructured message into actionable copy", () => {
    expect(
      formatActionableErrorMessage("Network timeout", {
        action: "Rerun",
        troubleshootingEntry: "Task center",
      })
    ).toBe("Issue: Network timeout. Suggested action: Rerun. Troubleshooting: Task center")
  })
})
