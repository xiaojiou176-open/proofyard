import { describe, expect, it } from "vitest"
import {
  buildApiUrl,
  formatActionableApiError,
  normalizeTransportErrorMessage,
  unwrapRunPayload,
} from "./useApiClient.helpers"

describe("useApiClient.helpers", () => {
  describe("buildApiUrl", () => {
    it("handles absolute path/URL and base-url normalization branches", () => {
      expect(buildApiUrl("  ", "   ")).toBe("   ")
      expect(buildApiUrl("http://127.0.0.1:17380", "https://example.com/health")).toBe(
        "https://example.com/health"
      )
      expect(buildApiUrl("", "api/tasks")).toBe("/api/tasks")
      expect(buildApiUrl("/", "api/tasks")).toBe("/api/tasks")
      expect(buildApiUrl("/proxy/", "api/tasks")).toBe("/proxy/api/tasks")
    })

    it("uses URL resolution when base is http(s) and falls back for invalid protocols", () => {
      expect(buildApiUrl("http://127.0.0.1:17380/base/", "/api/tasks")).toBe(
        "http://127.0.0.1:17380/api/tasks"
      )
      expect(buildApiUrl("https://example.com/sub-path/", "api/tasks")).toBe(
        "https://example.com/api/tasks"
      )
      expect(buildApiUrl("ftp://example.com", "/api/tasks")).toBe("/api/tasks")
      expect(buildApiUrl("not-a-valid-url", "/api/tasks")).toBe("/api/tasks")
    })
  })

  describe("normalizeTransportErrorMessage", () => {
    it("normalizes blank/network messages and preserves explicit error text", () => {
      expect(normalizeTransportErrorMessage("   ")).toBe("Backend service is temporarily unreachable.")
      expect(normalizeTransportErrorMessage("Failed to fetch")).toBe("Backend service connection failed.")
      expect(normalizeTransportErrorMessage("networkError happened")).toBe("Backend service connection failed.")
      expect(normalizeTransportErrorMessage(" 服务端返回 429 ")).toBe("服务端返回 429")
    })
  })

  describe("unwrapRunPayload", () => {
    it("extracts run objects and run_id payloads", () => {
      const nestedRun = { run: { run_id: "run-1", status: "running" } }
      const flatRun = { run_id: "run-2", status: "success" }

      expect(unwrapRunPayload(null)).toBeNull()
      expect(unwrapRunPayload("invalid")).toBeNull()
      expect(unwrapRunPayload({ run: "invalid" })).toBeNull()
      expect(unwrapRunPayload(nestedRun)).toEqual({ run_id: "run-1", status: "running" })
      expect(unwrapRunPayload(flatRun)).toEqual(flatRun)
    })
  })

  describe("formatActionableApiError", () => {
    it("passes through already-structured guidance messages", () => {
      const english = [
        "Issue: Backend offline",
        "Suggested action: Restart the backend",
        "Troubleshooting: Check terminal logs",
      ].join("\n")
      expect(formatActionableApiError(english)).toBe(english)
    })

    it("formats default and custom actionable guidance blocks", () => {
      const message = formatActionableApiError("fetch failed")
      expect(message).toContain("Issue: Backend service connection failed.")
      expect(message).toContain("Suggested action: Correct the current input and retry.")
      expect(message).toContain("Troubleshooting: Check the task-center run logs and the browser developer-tools network panel.")

      const custom = formatActionableApiError("请求超时", "稍后重试", "查看网关日志")
      expect(custom).toBe("Issue: 请求超时\nSuggested action: 稍后重试\nTroubleshooting: 查看网关日志")
    })
  })
})
