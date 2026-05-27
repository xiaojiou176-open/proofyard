/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, it as caseIt, describe, expect } from "vitest"
import { resolveAutomationClientId, resolveDefaultBaseUrl, useAppStore } from "./useAppStore"

describe("useAppStore runtime defaults", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    document.documentElement.removeAttribute("data-uiq-visual")
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    localStorage.clear()
    document.documentElement.removeAttribute("data-uiq-visual")
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  caseIt("falls back to current origin when VITE_DEFAULT_BASE_URL is not provided", () => {
    expect(resolveDefaultBaseUrl(undefined, "http://127.0.0.1:4173")).toBe("http://127.0.0.1:4173")
  })

  caseIt("uses deterministic automationClientId in visual snapshot mode", () => {
    document.documentElement.setAttribute("data-uiq-visual", "1")
    let clientId = ""

    function Harness() {
      const store = useAppStore()
      clientId = store.params.automationClientId
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(clientId).toBe("client-visual-ci")
    expect(localStorage.getItem("ab_automation_client_id")).toBe("client-visual-ci")
  })

  caseIt("keeps existing client id when deterministic mode is disabled", () => {
    expect(resolveAutomationClientId("client-existing", false)).toBe("client-existing")
  })

  caseIt("defaults locale to english and persists locale updates", () => {
    let locale = ""
    let setLocale: ((next: "en" | "zh-CN") => void) | null = null

    function Harness() {
      const store = useAppStore()
      locale = store.locale
      setLocale = store.setLocale
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(locale).toBe("en")

    act(() => {
      setLocale?.("zh-CN")
    })

    expect(localStorage.getItem("proofyard_locale")).toBe("zh-CN")
  })
})
