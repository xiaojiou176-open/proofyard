/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, it as caseIt, describe, expect, vi } from "vitest"
import type { FetchTaskOptions } from "../types"
import type { AppStore } from "./useAppStore"
import { usePolling } from "./usePolling"

type StoreStub = {
  runningCount: number
  setCommandState: ReturnType<typeof vi.fn>
  setTaskState: ReturnType<typeof vi.fn>
  setFeedbackText: ReturnType<typeof vi.fn>
  setTaskSyncError: ReturnType<typeof vi.fn>
  addLog: ReturnType<typeof vi.fn>
  pushNotice: ReturnType<typeof vi.fn>
  setParams: ReturnType<typeof vi.fn>
}

function createStore(): AppStore & StoreStub {
  const store: StoreStub = {
    runningCount: 0,
    setCommandState: vi.fn(),
    setTaskState: vi.fn(),
    setFeedbackText: vi.fn(),
    setTaskSyncError: vi.fn(),
    addLog: vi.fn(),
    pushNotice: vi.fn(),
    setParams: vi.fn(),
  }
  return store as unknown as AppStore & StoreStub
}

function PollingHarness({
  store,
  bootstrap,
  fetchTasks,
}: {
  store: AppStore
  bootstrap: () => Promise<void>
  fetchTasks: (opts?: FetchTaskOptions) => Promise<void>
}) {
  usePolling(store, bootstrap, fetchTasks)
  return null
}

describe("usePolling", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    // Let React know this environment supports act().
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    window.history.replaceState({}, "", "/")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  caseIt("keeps polling after rerender with a new store reference", async () => {
    const firstStore = createStore()
    const secondStore = createStore()
    const bootstrap = vi.fn().mockResolvedValue(undefined)
    const fetchTasks = vi.fn().mockResolvedValue(undefined)

    act(() => {
      root.render(
        <PollingHarness store={firstStore} bootstrap={bootstrap} fetchTasks={fetchTasks} />
      )
    })
    expect(bootstrap).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
    })
    expect(fetchTasks).toHaveBeenCalledTimes(1)

    act(() => {
      root.render(
        <PollingHarness store={secondStore} bootstrap={bootstrap} fetchTasks={fetchTasks} />
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
    })

    expect(fetchTasks).toHaveBeenCalledTimes(2)
  })

  caseIt("does not reschedule polling after unmount while a fetch is in flight", async () => {
    const store = createStore()
    const bootstrap = vi.fn().mockResolvedValue(undefined)
    let resolveFetch: ((value?: void | PromiseLike<void>) => void) | undefined
    const fetchTasks = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve
        })
    )

    act(() => {
      root.render(<PollingHarness store={store} bootstrap={bootstrap} fetchTasks={fetchTasks} />)
    })

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
    })
    expect(fetchTasks).toHaveBeenCalledTimes(1)

    act(() => {
      root.unmount()
    })
    resolveFetch?.()
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(fetchTasks).toHaveBeenCalledTimes(1)
  })

  caseIt("applies the same error path for visibility-triggered refresh failures", async () => {
    const store = createStore()
    const bootstrap = vi.fn().mockResolvedValue(undefined)
    const visibilityError = new Error("visibility refresh failed")
    const fetchTasks = vi.fn().mockRejectedValueOnce(visibilityError)
    const timeoutSpy = vi.spyOn(window, "setTimeout")

    act(() => {
      root.render(<PollingHarness store={store} bootstrap={bootstrap} fetchTasks={fetchTasks} />)
    })
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2_000)

    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })

    expect(fetchTasks).toHaveBeenCalledTimes(1)
    expect(store.setTaskSyncError).toHaveBeenCalledWith("visibility refresh failed")
    expect(store.pushNotice).toHaveBeenCalledWith("warn", "visibility refresh failed")
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2_000)
  })

  caseIt("uses hidden/idle intervals with backoff and avoids duplicate warning notices", async () => {
    const nowSpy = vi.spyOn(Date, "now")
    let now = 0
    nowSpy.mockImplementation(() => now)

    const timeoutSpy = vi.spyOn(window, "setTimeout")
    const store = createStore()
    const bootstrap = vi.fn().mockResolvedValue(undefined)
    const fetchTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("poll failed once"))
      .mockRejectedValueOnce(new Error("poll failed twice"))
      .mockResolvedValue(undefined)

    Object.defineProperty(document, "hidden", { value: true, configurable: true })

    act(() => {
      root.render(<PollingHarness store={store} bootstrap={bootstrap} fetchTasks={fetchTasks} />)
    })
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 15_000)

    await act(async () => {
      now = 15_000
      vi.advanceTimersByTime(15_000)
      await Promise.resolve()
    })
    expect(store.pushNotice).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 30_000)

    await act(async () => {
      now = 45_000
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
    })
    expect(store.pushNotice).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 30_000)

    Object.defineProperty(document, "hidden", { value: false, configurable: true })
    await act(async () => {
      now = 120_001
      vi.advanceTimersByTime(30_000)
      await Promise.resolve()
    })
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 8_000)
  })

  caseIt("resets backoff after successful visibility refresh and clears password on unload", async () => {
    const timeoutSpy = vi.spyOn(window, "setTimeout")
    const store = createStore()
    const bootstrap = vi.fn().mockResolvedValue(undefined)
    const fetchTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("poll once failed"))
      .mockResolvedValue(undefined)

    act(() => {
      root.render(<PollingHarness store={store} bootstrap={bootstrap} fetchTasks={fetchTasks} />)
    })

    await act(async () => {
      vi.advanceTimersByTime(2_000)
      await Promise.resolve()
    })
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 4_000)

    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true })
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(fetchTasks).toHaveBeenCalledTimes(2)
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 4_000)

    await act(async () => {
      vi.advanceTimersByTime(4_000)
      await Promise.resolve()
    })
    expect(fetchTasks).toHaveBeenCalledTimes(3)
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2_000)

    act(() => {
      window.dispatchEvent(new Event("beforeunload"))
    })

    expect(store.setParams).toHaveBeenCalledTimes(1)
    const updater = store.setParams.mock.calls[0]?.[0] as (params: Record<string, unknown>) => Record<string, unknown>
    expect(updater({ registerPassword: "secret", baseUrl: "https://example.com" }).registerPassword).toBe("")
  })
})
