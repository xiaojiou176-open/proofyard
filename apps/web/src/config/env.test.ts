import { describe, expect, it } from "vitest"
import { FRONTEND_ENV } from "./env"

describe("FRONTEND_ENV", () => {
  it("exposes default base url value shape", () => {
    expect(["string", "undefined"]).toContain(typeof FRONTEND_ENV.VITE_DEFAULT_BASE_URL)
    expect(["string", "undefined"]).toContain(typeof FRONTEND_ENV.VITE_DEFAULT_AUTOMATION_TOKEN)
    expect(["string", "undefined"]).toContain(
      typeof FRONTEND_ENV.VITE_DEFAULT_AUTOMATION_CLIENT_ID
    )
  })
})
