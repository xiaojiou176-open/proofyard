/* @vitest-environment jsdom */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useAppStore } from "./useAppStore"

function LocaleProbe() {
  const store = useAppStore()
  return (
    <button type="button" onClick={() => store.setLocale("zh-CN")}>
      {store.locale}
    </button>
  )
}

describe("useAppStore locale", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    localStorage.clear()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("defaults to english and persists explicit locale changes", function () {
    act(() => {
      root.render(<LocaleProbe />)
    })

    expect(container.textContent).toContain("en")
    expect(localStorage.getItem("webaudit_locale")).toBe("en")

    const button = container.querySelector("button")
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain("zh-CN")
    expect(localStorage.getItem("webaudit_locale")).toBe("zh-CN")
  })

  it("restores a supported stored locale", function () {
    localStorage.setItem("webaudit_locale", "zh-CN")

    act(() => {
      root.render(<LocaleProbe />)
    })

    expect(container.textContent).toContain("zh-CN")
  })
})
