/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppStore } from "./useAppStore"

describe("useAppStore first-use and log flow", () => {
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
    vi.useRealTimers()
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("keeps first-use incomplete until run and result are both finished", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(store!.isFirstUseActive).toBe(true)
    expect(store!.firstUseStage).toBe("welcome")

    act(() => {
      store!.setFirstUseStage("verify")
    })
    expect(store!.firstUseStage).toBe("run")

    act(() => {
      store!.completeFirstUse()
    })
    expect(store!.firstUseStage).toBe("run")
    expect(store!.isFirstUseActive).toBe(true)

    act(() => {
      store!.markFirstUseRunTriggered()
    })
    expect(store!.firstUseProgress.runTriggered).toBe(true)

    act(() => {
      store!.completeFirstUse()
    })
    expect(store!.firstUseStage).toBe("verify")
    expect(store!.isFirstUseActive).toBe(true)

    act(() => {
      store!.markFirstUseResultSeen()
    })
    expect(store!.firstUseStage).toBe("verify")

    act(() => {
      store!.completeFirstUse()
    })
    expect(store!.isFirstUseActive).toBe(false)
    expect(localStorage.getItem("ab_first_use_done")).toBe("1")
  })

  it("caps log size and clears logs explicitly", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    act(() => {
      for (let index = 0; index < 505; index += 1) {
        store!.addLog("info", `log-${index}`)
      }
    })

    expect(store!.logs).toHaveLength(500)
    expect(store!.logs[0]?.message).toBe("log-5")

    act(() => {
      store!.clearLogs()
    })
    expect(store!.logs).toHaveLength(0)
  })

  it("pushes notice, allows manual dismiss and auto timeout removal", function () {
    vi.useFakeTimers()
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    act(() => {
      store!.pushNotice("warn", "需要关注")
    })
    expect(store!.notices).toHaveLength(1)
    const firstNoticeId = store!.notices[0]?.id ?? ""

    act(() => {
      store!.dismissNotice(firstNoticeId)
    })
    expect(store!.notices).toHaveLength(0)

    act(() => {
      store!.pushNotice("success", "已完成")
    })
    expect(store!.notices).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(4200)
    })
    expect(store!.notices).toHaveLength(0)
  })

  it("updates config validity via handleParamsChange and blocks completion when invalid", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(store!.firstUseProgress.configValid).toBe(true)

    act(() => {
      store!.handleParamsChange({ baseUrl: "invalid-url", successSelector: "" })
    })
    expect(store!.firstUseProgress.configValid).toBe(false)

    act(() => {
      store!.setFirstUseStage("verify")
      store!.completeFirstUse()
    })
    expect(store!.firstUseStage).toBe("configure")
    expect(store!.isFirstUseActive).toBe(true)
  })

  it("keeps first-use progress unchanged when first-use mode is already disabled", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    act(() => {
      store!.setIsFirstUseActive(false)
    })

    const snapshot = { ...store!.firstUseProgress }
    act(() => {
      store!.markFirstUseRunTriggered()
      store!.markFirstUseResultSeen()
    })

    expect(store!.firstUseProgress).toEqual(snapshot)
  })

  it("derives taskErrorMessage from taskState/feedback and prioritizes taskSyncError", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    expect(store!.taskErrorMessage).toBe("")

    act(() => {
      store!.setFeedbackText("task failed")
      store!.setTaskState("error")
    })
    expect(store!.taskErrorMessage).toBe("task failed")

    act(() => {
      store!.setTaskSyncError("sync failed")
    })
    expect(store!.taskErrorMessage).toBe("sync failed")
  })

  it("catches persistence errors when completing first-use and keeps state stable", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    act(() => {
      store!.markFirstUseRunTriggered()
      store!.markFirstUseResultSeen()
    })

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("write blocked")
    })
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("remove blocked")
    })

    act(() => {
      store!.completeFirstUse()
    })

    expect(store!.isFirstUseActive).toBe(false)
    expect(setItemSpy).toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()
  })

  it("clamps first-use stage after config becomes invalid and skips blank client id persistence", function () {
    let store: ReturnType<typeof useAppStore>

    function Harness() {
      store = useAppStore()
      return null
    }

    act(() => {
      root.render(<Harness />)
    })

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem")

    act(() => {
      store!.setFirstUseStage("verify")
      store!.handleParamsChange({
        baseUrl: "invalid-url",
        successSelector: "",
        automationClientId: "   ",
      })
    })

    expect(store!.firstUseStage).toBe("configure")
    const automationClientIdWrites = setItemSpy.mock.calls
      .filter((call) => call[0] === "ab_automation_client_id")
      .map((call) => String(call[1] ?? ""))
    expect(automationClientIdWrites.some((value) => value.trim() === "")).toBe(false)
  })
})
