/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type ImportMainResult = {
  createRootMock: ReturnType<typeof vi.fn>
  renderMock: ReturnType<typeof vi.fn>
  module: typeof import("./main")
}

async function importMainWithMocks(): Promise<ImportMainResult> {
  const renderMock = vi.fn()
  const createRootMock = vi.fn(() => ({ render: renderMock }))

  vi.doMock("react-dom/client", () => ({
    default: { createRoot: createRootMock },
    createRoot: createRootMock,
  }))

  vi.doMock("./App", () => ({
    default: () => null,
  }))

  const module = await import("./main")

  return {
    createRootMock,
    renderMock,
    module,
  }
}

describe("main.tsx", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    document.body.innerHTML = '<div id="root"></div>'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("mounts App with createRoot when RUM is disabled", async function () {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const { createRootMock, renderMock } = await importMainWithMocks()

    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById("root"))
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("exposes RUM helpers for direct branch validation", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "")
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const { module } = await importMainWithMocks()

    expect(module.buildRumEndpoint("health/rum")).toBe("/health/rum")

    const previousWindow = globalThis.window
    vi.stubGlobal("window", undefined as unknown as Window)
    expect(() => module.emitRumDeliverySignal("ok", { metric: "noop" })).not.toThrow()
    vi.stubGlobal("window", previousWindow)

    await module.sendRumMetric("noop", -1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("collects and posts RUM metrics when enabled", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "http://127.0.0.1:17380")

    const fetchSpy = vi.fn(async () => ({ ok: true, status: 202 }))
    vi.stubGlobal("fetch", fetchSpy)

    vi.stubGlobal("performance", {
      getEntriesByType: (type: string) =>
        ({ navigation: [{ responseStart: 45, type: "reload" }] }[type] ?? []),
    })

    class FakePerformanceObserver {
      private readonly callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void

      constructor(callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.callback = callback
      }

      observe(options: Record<string, unknown>) {
        const entriesByType: Record<string, Array<Record<string, unknown>>> = {
          paint: [{ name: "first-contentful-paint", startTime: 120 }],
          "largest-contentful-paint": [{ startTime: 330 }],
          "layout-shift": [{ hadRecentInput: false, value: 0.12 }],
          event: [{ interactionId: 1, duration: 80 }],
        }
        const type = String(options.type ?? "")
        const entries = entriesByType[type]
        if (entries) this.callback({ getEntries: () => entries })
      }

      disconnect() {
        // noop for test
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    const deliveryEvents: Array<Record<string, unknown>> = []
    window.addEventListener("uiq:rum-delivery", (event) => {
      deliveryEvents.push((event as CustomEvent<Record<string, unknown>>).detail)
    })

    await importMainWithMocks()
    await Promise.resolve()

    window.dispatchEvent(new Event("pagehide"))
    await Promise.resolve()

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(String(fetchSpy.mock.calls[0][0])).toBe("http://127.0.0.1:17380/health/rum")
    expect(fetchSpy.mock.calls.some((call) => String(call[1]?.body ?? "").includes('"metric":"TTFB"'))).toBe(
      true
    )
    expect(fetchSpy.mock.calls.some((call) => String(call[1]?.body ?? "").includes('"metric":"LCP"'))).toBe(
      true
    )
    expect(deliveryEvents.length).toBe(0)
  })

  it("emits degraded RUM events and applies cooldown for server errors", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "http:// bad-url")

    const fetchSpy = vi.fn(async () => ({ ok: false, status: 503 }))
    vi.stubGlobal("fetch", fetchSpy)

    vi.stubGlobal("performance", {
      getEntriesByType: (type: string) =>
        ({ navigation: [{ responseStart: 30, type: "navigate" }] }[type] ?? []),
    })

    class FakePerformanceObserver {
      private readonly callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void

      constructor(callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.callback = callback
      }

      observe(options: Record<string, unknown>) {
        const type = String(options.type ?? "")
        const entries = type === "largest-contentful-paint" ? [{ startTime: 256 }] : null
        if (entries) this.callback({ getEntries: () => entries })
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    const deliveryEvents: Array<Record<string, unknown>> = []
    window.addEventListener("uiq:rum-delivery", (event) => {
      deliveryEvents.push((event as CustomEvent<Record<string, unknown>>).detail)
    })

    await importMainWithMocks()
    await Promise.resolve()
    await Promise.resolve()

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    await Promise.resolve()

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(fetchSpy.mock.calls.every((call) => String(call[0]).includes("/health/rum"))).toBe(true)
    expect(deliveryEvents.some((detail) => detail.reason === "http_error")).toBe(true)
  })

  it("handles network failures and unsupported event timing observer", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "http://127.0.0.1:17380")

    const fetchSpy = vi.fn(async () => {
      throw new Error("network down")
    })
    vi.stubGlobal("fetch", fetchSpy)

    vi.stubGlobal("performance", {
      getEntriesByType: () => [],
    })

    class FakePerformanceObserver {
      private readonly callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void

      constructor(callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.callback = callback
      }

      observe(options: Record<string, unknown>) {
        const type = String(options.type ?? "")
        const paintEntries = type === "paint" ? [{ name: "first-contentful-paint", startTime: 120 }] : null
        if (paintEntries) this.callback({ getEntries: () => paintEntries })
        if (type === "event") {
          throw new Error("event timing is not supported")
        }
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    const deliveryEvents: Array<Record<string, unknown>> = []
    window.addEventListener("uiq:rum-delivery", (event) => {
      deliveryEvents.push((event as CustomEvent<Record<string, unknown>>).detail)
    })

    const { createRootMock, renderMock } = await importMainWithMocks()
    await Promise.resolve()
    await Promise.resolve()

    expect(createRootMock).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(deliveryEvents.some((detail) => detail.reason === "network_error")).toBe(true)
  })

  it("enters cooldown after repeated network failures and skips later metric sends", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "http://127.0.0.1:17380")

    const fetchSpy = vi.fn(async () => {
      throw new Error("network down")
    })
    vi.stubGlobal("fetch", fetchSpy)

    vi.stubGlobal("performance", {
      getEntriesByType: (type: string) =>
        ({ navigation: [{ responseStart: 20, type: "reload" }] }[type] ?? []),
    })

    class FakePerformanceObserver {
      private readonly callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void

      constructor(callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.callback = callback
      }

      observe(options: Record<string, unknown>) {
        const entriesByType: Record<string, Array<Record<string, unknown>>> = {
          paint: [{ name: "first-contentful-paint", startTime: 90 }],
          "largest-contentful-paint": [{ startTime: 250 }],
        }
        const entries = entriesByType[String(options.type ?? "")]
        if (entries) this.callback({ getEntries: () => entries })
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    await importMainWithMocks()
    await Promise.resolve()
    window.dispatchEvent(new Event("pagehide"))
    await Promise.resolve()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("tolerates unsupported paint, lcp and cls observers", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    vi.stubGlobal("performance", {
      getEntriesByType: () => [],
    })

    class FakePerformanceObserver {
      observe(options: Record<string, unknown>) {
        const type = String(options.type ?? "")
        if (["paint", "largest-contentful-paint", "layout-shift"].includes(type)) {
          throw new Error(`unsupported:${type}`)
        }
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    await importMainWithMocks()
    await Promise.resolve()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("uses relative health endpoint when base url is empty and keeps retryable 429 uncooldowned", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "")

    const fetchSpy = vi.fn(async () => ({ ok: false, status: 429 }))
    vi.stubGlobal("fetch", fetchSpy)

    vi.stubGlobal("performance", {
      getEntriesByType: (type: string) =>
        ({ navigation: [{ responseStart: 10, type: "navigate" }] }[type] ?? []),
    })

    class FakePerformanceObserver {
      private readonly callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void

      constructor(callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.callback = callback
      }

      observe(options: Record<string, unknown>) {
        const entriesByType: Record<string, Array<Record<string, unknown>>> = {
          paint: [{ name: "first-contentful-paint", startTime: 40 }],
          "layout-shift": [{ hadRecentInput: true, value: undefined }],
        }
        const entries = entriesByType[String(options.type ?? "")]
        if (entries) this.callback({ getEntries: () => entries })
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    await importMainWithMocks()
    await Promise.resolve()
    window.dispatchEvent(new Event("pagehide"))
    await Promise.resolve()

    expect(String(fetchSpy.mock.calls[0]?.[0] ?? "")).toBe("/health/rum")
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1)
  })

  it("ignores event timing entries without valid interaction duration", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    vi.stubEnv("VITE_DEFAULT_BASE_URL", "http://127.0.0.1:17380")

    const fetchSpy = vi.fn(async () => ({ ok: true, status: 202 }))
    vi.stubGlobal("fetch", fetchSpy)

    vi.stubGlobal("performance", {
      getEntriesByType: () => [],
    })

    class FakePerformanceObserver {
      private readonly callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void

      constructor(callback: (list: { getEntries: () => Array<Record<string, unknown>> }) => void) {
        this.callback = callback
      }

      observe(options: Record<string, unknown>) {
        const entries =
          String(options.type ?? "") === "event"
            ? [
                { interactionId: 0, duration: 90 },
                { interactionId: 1, duration: 0 },
              ]
            : null
        if (entries) this.callback({ getEntries: () => entries })
      }
    }

    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)

    await importMainWithMocks()
    await Promise.resolve()
    window.dispatchEvent(new Event("pagehide"))
    await Promise.resolve()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("skips RUM collection when PerformanceObserver is unavailable", async function () {
    vi.stubEnv("VITE_RUM_ENABLED", "true")
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    vi.stubGlobal("PerformanceObserver", undefined as unknown as typeof PerformanceObserver)

    await importMainWithMocks()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
