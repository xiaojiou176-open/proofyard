/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import { I18nProvider, type AppLocale } from "../i18n"
import ConsoleHeader from "./ConsoleHeader"

describe("ConsoleHeader", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("changes views and fires help / restart actions", function () {
    const onViewChange = vi.fn()
    const onOpenHelp = vi.fn()
    const onRestartTour = vi.fn()

    act(() => {
      root.render(
        <ConsoleHeader
          runningCount={2}
          successCount={5}
          failedCount={1}
          activeView="launch"
          onViewChange={onViewChange}
          onOpenHelp={onOpenHelp}
          onRestartTour={onRestartTour}
        />
      )
    })

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
    act(() => {
      tabs[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      tabs[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    const help = container.querySelector('button[aria-label="Help"]')
    const restart = container.querySelector('button[aria-label="Restart onboarding"]')
    act(() => {
      help?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      restart?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onViewChange).toHaveBeenCalled()
    expect(onOpenHelp).toHaveBeenCalledTimes(1)
    expect(onRestartTour).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Running")
    expect(container.textContent).toContain("Succeeded")
    expect(container.textContent).toContain("Failed")
  })

  it("supports roving focus keyboard controls for tabs", function () {
    const onViewChange = vi.fn()

    act(() => {
      root.render(
        <ConsoleHeader
          runningCount={0}
          successCount={0}
          failedCount={0}
          activeView="launch"
          onViewChange={onViewChange}
          onOpenHelp={() => {}}
          onRestartTour={() => {}}
        />
      )
    })

    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLButtonElement[]
    expect(tabs.length).toBe(3)

    act(() => {
      tabs[0]?.focus()
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[1])

    act(() => {
      tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[0])

    act(() => {
      tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[2])

    act(() => {
      tabs[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
    })
    expect(document.activeElement).toBe(tabs[0])

    act(() => {
      tabs[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })
    expect(onViewChange).toHaveBeenCalledWith("workshop")
  })

  it("updates visible labels after switching locale", function () {
    function LocaleHarness() {
      const [locale, setLocale] = React.useState<AppLocale>("en")
      return (
        <I18nProvider locale={locale} setLocale={setLocale}>
          <ConsoleHeader
            runningCount={1}
            successCount={2}
            failedCount={3}
            activeView="launch"
            onViewChange={() => {}}
            onOpenHelp={() => {}}
            onRestartTour={() => {}}
          />
        </I18nProvider>
      )
    }

    act(() => {
      root.render(<LocaleHarness />)
    })

    const zhToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "中文"
    )

    act(() => {
      zhToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("快速启动")
    expect(container.textContent).toContain("运行中 1")
    expect(container.textContent).toContain("已成功 2")
    expect(container.textContent).toContain("失败 3")
  })
})
