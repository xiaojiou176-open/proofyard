/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import HelpPanel from "./HelpPanel"

describe("HelpPanel behavior", () => {
  let container: HTMLDivElement
  let root: Root
  let focusAnchor: HTMLButtonElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    focusAnchor = document.createElement("button")
    focusAnchor.textContent = "anchor"
    document.body.appendChild(focusAnchor)
    focusAnchor.focus()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    focusAnchor.remove()
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("handles escape/overlay/restart and restores focus on unmount", function () {
    const onClose = vi.fn()
    const onRestartTour = vi.fn()

    act(() => {
      root.render(
        <HelpPanel activeView="tasks" onClose={onClose} onRestartTour={onRestartTour} />
      )
    })

    const closeButtons = Array.from(
      document.body.querySelectorAll('button[aria-label="Close help panel"]')
    ) as HTMLButtonElement[]
    expect(closeButtons).toHaveLength(2)
    const [overlayButton, closeButton] = closeButtons
    expect(document.activeElement).toBe(closeButton)

    const restartButton = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Restart the first-use guide")
    ) as HTMLButtonElement | undefined
    expect(restartButton).not.toBeUndefined()

    act(() => {
      closeButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })
      )
    })
    expect(document.activeElement).toBe(restartButton)

    act(() => {
      restartButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onRestartTour).toHaveBeenCalledTimes(1)

    act(() => {
      overlayButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(2)

    act(() => {
      root.render(<></>)
    })
    expect(document.activeElement).toBe(focusAnchor)
  })
})
