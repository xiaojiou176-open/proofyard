/* @vitest-environment jsdom */

import { fireEvent } from "@testing-library/react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ParamsPanel, { type ParamsState } from "./ParamsPanel"

function createParams(): ParamsState {
  return {
    baseUrl: "https://example.com",
    startUrl: "https://example.com/register",
    successSelector: "#ready",
    modelName: "gemini-3-flash-preview",
    geminiApiKey: "gem-key",
    registerPassword: "secret-123",
    automationToken: "token-123",
    automationClientId: "client-123",
    headless: true,
    midsceneStrict: false,
  }
}

describe("ParamsPanel behavior", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("toggles sensitive inputs between masked and visible", function () {
    act(() => {
      root.render(<ParamsPanel params={createParams()} onChange={() => {}} />)
    })

    const apiKeyInput = container.querySelector<HTMLInputElement>("#api-key")
    const registerPasswordInput = container.querySelector<HTMLInputElement>("#register-password")
    const tokenInput = container.querySelector<HTMLInputElement>("#automation-token")
    const toggleApiKey = container.querySelector<HTMLButtonElement>(
      '[data-testid="params-toggle-api-key-visibility"]'
    )
    const toggleRegisterPassword = container.querySelector<HTMLButtonElement>(
      '[data-testid="params-toggle-register-password-visibility"]'
    )
    const toggleToken = container.querySelector<HTMLButtonElement>(
      '[data-testid="params-toggle-token-visibility"]'
    )

    expect(apiKeyInput?.type).toBe("password")
    expect(registerPasswordInput?.type).toBe("password")
    expect(tokenInput?.type).toBe("password")

    act(() => {
      toggleApiKey?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      toggleRegisterPassword?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      toggleToken?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(apiKeyInput?.type).toBe("text")
    expect(registerPasswordInput?.type).toBe("text")
    expect(tokenInput?.type).toBe("text")
    expect(toggleApiKey?.getAttribute("aria-pressed")).toBe("true")
    expect(toggleRegisterPassword?.getAttribute("aria-pressed")).toBe("true")
    expect(toggleToken?.getAttribute("aria-pressed")).toBe("true")
  })

  it("emits precise patches for remaining optional fields", function () {
    const onChange = vi.fn()

    act(() => {
      root.render(<ParamsPanel params={createParams()} onChange={onChange} />)
    })

    const startUrlInput = container.querySelector<HTMLInputElement>("#start-url")
    const successSelectorInput = container.querySelector<HTMLInputElement>("#success-selector")
    const apiKeyInput = container.querySelector<HTMLInputElement>("#api-key")
    const registerPasswordInput = container.querySelector<HTMLInputElement>("#register-password")
    const tokenInput = container.querySelector<HTMLInputElement>("#automation-token")

    expect(startUrlInput).not.toBeNull()
    expect(successSelectorInput).not.toBeNull()
    expect(apiKeyInput).not.toBeNull()
    expect(registerPasswordInput).not.toBeNull()
    expect(tokenInput).not.toBeNull()

    act(() => {
      fireEvent.focus(startUrlInput!)
      fireEvent.input(startUrlInput!, { target: { value: "https://prod.example.com/signup" } })
      fireEvent.focus(successSelectorInput!)
      fireEvent.input(successSelectorInput!, { target: { value: ".done-banner" } })
      fireEvent.focus(apiKeyInput!)
      fireEvent.input(apiKeyInput!, { target: { value: "new-gem-key" } })
      fireEvent.focus(registerPasswordInput!)
      fireEvent.input(registerPasswordInput!, { target: { value: "new-secret" } })
      fireEvent.focus(tokenInput!)
      fireEvent.input(tokenInput!, { target: { value: "new-token" } })
    })

    expect(onChange).toHaveBeenCalledWith({ geminiApiKey: "new-gem-key" })
    expect(onChange).toHaveBeenCalledWith({ registerPassword: "new-secret" })
    expect(onChange).toHaveBeenCalledWith({ automationToken: "new-token" })
    expect(onChange).toHaveBeenCalledWith({ startUrl: "https://prod.example.com/signup" })
    expect(onChange).toHaveBeenCalledWith({ successSelector: ".done-banner" })
  })
})
