/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isFirstUseConfigValid,
  resolveAutomationClientId,
  resolveDefaultBaseUrl,
  useAppStore,
} from "./useAppStore"

describe("useAppStore edge cases", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    localStorage.clear()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("covers default url and automation client id fallbacks", function () {
    expect(resolveDefaultBaseUrl(undefined, "invalid-origin")).toBe("http://127.0.0.1:17380")
    expect(resolveDefaultBaseUrl(" https://gateway.example.com ", "http://localhost:4173")).toBe(
      "https://gateway.example.com"
    )
    expect(resolveDefaultBaseUrl(undefined, "http://localhost:4173")).toBe("http://localhost:4173")
    expect(resolveAutomationClientId(" client-x ", true)).toBe("client-visual-ci")
    expect(resolveAutomationClientId(" custom-id ", false)).toBe("custom-id")
  })

  it("covers first-use config validation error branches", function () {
    expect(
      isFirstUseConfigValid({
        baseUrl: "   ",
        startUrl: "",
        successSelector: "#ok",
        modelName: "",
        geminiApiKey: "",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-1",
        headless: false,
        midsceneStrict: false,
      })
    ).toBe(false)

    expect(
      isFirstUseConfigValid({
        baseUrl: "https://gateway.example.com",
        startUrl: "not-a-valid-url",
        successSelector: "#ok",
        modelName: "",
        geminiApiKey: "",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-1",
        headless: false,
        midsceneStrict: false,
      })
    ).toBe(false)

    expect(
      isFirstUseConfigValid({
        baseUrl: "https://gateway.example.com",
        startUrl: "https://example.com/register",
        successSelector: "   ",
        modelName: "",
        geminiApiKey: "",
        registerPassword: "",
        automationToken: "",
        automationClientId: "client-1",
        headless: false,
        midsceneStrict: false,
      })
    ).toBe(false)
  })

  it("falls back to timestamp client id when randomUUID is unavailable", function () {
    const randomSpy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("uuid unavailable")
    })

    const generated = resolveAutomationClientId(undefined, false)
    expect(generated).toMatch(/^client-\d+$/)
    expect(randomSpy).toHaveBeenCalled()
  })

  it("keeps store usable when localStorage operations throw", function () {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled")
    })
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled")
    })
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled")
    })

    let store: ReturnType<typeof useAppStore> | null = null
    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(store?.isFirstUseActive).toBe(true)
    expect(store?.showOnboarding).toBe(true)

    act(() => {
      store?.completeOnboarding()
      store?.restartOnboarding()
      store?.setParams((prev) => ({ ...prev, automationClientId: "client-new" }))
      store?.setIsFirstUseActive(false)
    })

    act(() => {
      store?.markFirstUseRunTriggered()
      store?.markFirstUseResultSeen()
    })

    expect(store?.showOnboarding).toBe(true)
    expect(typeof store?.firstUseProgress.runTriggered).toBe("boolean")
    expect(typeof store?.firstUseProgress.resultSeen).toBe("boolean")
    expect(getItemSpy).toHaveBeenCalled()
    expect(setItemSpy).toHaveBeenCalled()
    expect(removeItemSpy).toHaveBeenCalled()
  })

  it("recovers from malformed first-use persistence and clamps stored stage", function () {
    localStorage.setItem("ab_first_use_progress", "{\"runTriggered\":true")
    localStorage.setItem("ab_first_use_stage", "mystery")

    let store: ReturnType<typeof useAppStore> | null = null
    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(store?.firstUseStage).toBe("welcome")

    act(() => {
      root.unmount()
    })

    localStorage.setItem(
      "ab_first_use_progress",
      JSON.stringify({ runTriggered: false, resultSeen: false })
    )
    localStorage.setItem("ab_first_use_stage", "verify")

    act(() => {
      root = createRoot(container)
      root.render(<Harness />)
    })

    expect(store?.firstUseStage).toBe("run")
  })

  it("uses deterministic client id in visual mode and clears persistence on completed first-use", function () {
    document.documentElement.setAttribute("data-uiq-visual", "1")

    let store: ReturnType<typeof useAppStore> | null = null
    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(store?.params.automationClientId).toBe("client-visual-ci")

    act(() => {
      store?.markFirstUseRunTriggered()
      store?.markFirstUseResultSeen()
    })

    act(() => {
      store?.completeFirstUse()
    })

    expect(localStorage.getItem("ab_first_use_done")).toBe("1")
    expect(localStorage.getItem("ab_first_use_stage")).toBeNull()
    expect(localStorage.getItem("ab_first_use_progress")).toBeNull()
    expect(store?.isFirstUseActive).toBe(false)
  })

  it("uses VITE_CI and process.env.CI branches when resolving deterministic client ids", function () {
    const env = import.meta.env as ImportMetaEnv & { VITEST?: boolean; VITE_CI?: string }
    const previousVitest = env.VITEST
    const previousViteCi = env.VITE_CI
    const previousProcessCi = process.env.CI

    document.documentElement.removeAttribute("data-uiq-visual")

    env.VITEST = false
    env.VITE_CI = "true"
    let store: ReturnType<typeof useAppStore> | null = null
    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })
    expect(store?.params.automationClientId).toBe("client-visual-ci")

    act(() => {
      root.unmount()
    })
    localStorage.clear()

    env.VITEST = false
    env.VITE_CI = "false"
    process.env.CI = "true"

    act(() => {
      root = createRoot(container)
      root.render(<Harness />)
    })
    expect(store?.params.automationClientId).toBe("client-visual-ci")

    env.VITEST = previousVitest
    env.VITE_CI = previousViteCi
    process.env.CI = previousProcessCi
  })
})
