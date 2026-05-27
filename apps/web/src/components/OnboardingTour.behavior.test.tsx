/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import OnboardingTour from "./OnboardingTour"

function findButton(container: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${label}`)
  }
  return button
}

describe("OnboardingTour behavior", () => {
  let container: HTMLDivElement
  let root: Root
  let consoleRoot: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    consoleRoot = document.createElement("div")
    consoleRoot.className = "console-root"
    document.body.appendChild(consoleRoot)
    document.body.style.overflow = ""
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    consoleRoot.remove()
    container.remove()
    document.body.style.overflow = ""
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("supports next/prev/escape and restores console accessibility attributes", function () {
    const onComplete = vi.fn()

    act(() => {
      root.render(<OnboardingTour active onComplete={onComplete} />)
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLDivElement | null
    expect(dialog).toBeInstanceOf(HTMLDivElement)
    expect(document.body.style.overflow).toBe("hidden")
    expect(consoleRoot.getAttribute("aria-hidden")).toBe("true")
    expect(consoleRoot.hasAttribute("inert")).toBe(true)
    expect(dialog?.textContent).toContain("1 / 3")

    const next = findButton(dialog!, "Next")
    act(() => {
      next.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(dialog?.textContent).toContain("2 / 3")
    expect(findButton(dialog!, "Previous")).toBeInstanceOf(HTMLButtonElement)

    act(() => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(dialog?.textContent).toContain("1 / 3")

    act(() => {
      root.render(<OnboardingTour active={false} onComplete={onComplete} />)
    })
    expect(document.body.style.overflow).toBe("")
    expect(consoleRoot.hasAttribute("aria-hidden")).toBe(false)
    expect(consoleRoot.hasAttribute("inert")).toBe(false)
  })

  it("keeps preexisting hidden/inert state and traps focus with tab key", function () {
    const onComplete = vi.fn()
    consoleRoot.setAttribute("aria-hidden", "false")
    consoleRoot.setAttribute("inert", "")

    act(() => {
      root.render(<OnboardingTour active onComplete={onComplete} />)
    })

    const dialog = document.body.querySelector('[role="dialog"]') as HTMLDivElement
    const buttons = Array.from(dialog.querySelectorAll("button"))
    expect(buttons.length).toBeGreaterThan(1)

    const first = buttons[0] as HTMLButtonElement
    const last = buttons[buttons.length - 1] as HTMLButtonElement
    act(() => {
      last.focus()
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    })
    expect(document.activeElement).toBe(first)

    act(() => {
      buttons.forEach((button) => {
        button.disabled = true
      })
      dialog.focus()
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
    })
    expect(document.activeElement).toBe(dialog)

    act(() => {
      root.render(<OnboardingTour active={false} onComplete={onComplete} />)
    })
    expect(consoleRoot.getAttribute("aria-hidden")).toBe("false")
    expect(consoleRoot.hasAttribute("inert")).toBe(true)
  })
})
