/* @vitest-environment jsdom */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { fireEvent, render } from "@testing-library/react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, it as caseIt, describe, expect, vi } from "vitest"
import ParamsPanel, { defaultStartUrlRoutePath, type ParamsState } from "./ParamsPanel"

const __dirname = dirname(fileURLToPath(import.meta.url))

function readRegisterRoutePathFromContract(): string {
  const contractPath = resolve(__dirname, "../../../../configs/states/routes.yaml")
  const contractText = readFileSync(contractPath, "utf8")
  const registerRouteBlockMatch = contractText.match(
    /- id:\s*route_register[\s\S]*?path:\s*(\/\S+)/
  )
  if (!registerRouteBlockMatch || !registerRouteBlockMatch[1]) {
    throw new Error("route_register.path is missing in configs/states/routes.yaml")
  }
  return registerRouteBlockMatch[1]
}

function createDefaultParams(): ParamsState {
  return {
    baseUrl: "",
    startUrl: "",
    successSelector: "",
    modelName: "",
    registerPassword: "",
    automationToken: "",
    automationClientId: "",
    headless: true,
    midsceneStrict: false,
  }
}

describe("ParamsPanel start-url contract alignment", () => {
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

  caseIt("keeps start-url placeholder consistent with routes contract", () => {
    const registerRoutePath = readRegisterRoutePathFromContract()
    expect(defaultStartUrlRoutePath).toBe(registerRoutePath)

    act(() => {
      root.render(<ParamsPanel params={createDefaultParams()} onChange={() => {}} />)
    })

    const input = container.querySelector<HTMLInputElement>("#start-url")
    expect(input?.placeholder).toBe(`Optional; defaults to base URL + ${registerRoutePath}`)
  })

  caseIt("toggles masked fields and keeps optional api key as empty string by default", () => {
    const onChange = () => {}

    act(() => {
      root.render(<ParamsPanel params={createDefaultParams()} onChange={onChange} />)
    })

    const apiKeyInput = container.querySelector<HTMLInputElement>("#api-key")
    const registerPasswordInput = container.querySelector<HTMLInputElement>("#register-password")
    const tokenInput = container.querySelector<HTMLInputElement>("#automation-token")
    const apiKeyToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="params-toggle-api-key-visibility"]'
    )
    const registerPasswordToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="params-toggle-register-password-visibility"]'
    )
    const tokenToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="params-toggle-token-visibility"]'
    )

    expect(apiKeyInput?.type).toBe("password")
    expect(apiKeyInput?.value).toBe("")
    expect(registerPasswordInput?.type).toBe("password")
    expect(tokenInput?.type).toBe("password")

    act(() => {
      apiKeyToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      registerPasswordToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      tokenToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(apiKeyInput?.type).toBe("text")
    expect(registerPasswordInput?.type).toBe("text")
    expect(tokenInput?.type).toBe("text")
    expect(apiKeyToggle?.textContent).toContain("Hide")
    expect(registerPasswordToggle?.textContent).toContain("Hide")
    expect(tokenToggle?.textContent).toContain("Hide")
  })

  caseIt("emits field and checkbox patches through onChange", () => {
    const onChange = vi.fn()
    const view = render(<ParamsPanel params={createDefaultParams()} onChange={onChange} />)

    const baseUrlInput = view.container.querySelector<HTMLInputElement>("#base-url")
    const modelNameInput = view.container.querySelector<HTMLInputElement>("#model-name")
    const clientIdInput = view.container.querySelector<HTMLInputElement>("#automation-client-id")
    const headlessInput = view.container.querySelectorAll<HTMLInputElement>('.switch-group input[type="checkbox"]')[0]
    const strictInput = view.container.querySelectorAll<HTMLInputElement>('.switch-group input[type="checkbox"]')[1]

    if (baseUrlInput) {
      fireEvent.change(baseUrlInput, { target: { value: "https://example.com" } })
    }
    if (modelNameInput) {
      fireEvent.change(modelNameInput, { target: { value: "gemini-3.1-pro-preview" } })
    }
    if (clientIdInput) {
      fireEvent.change(clientIdInput, { target: { value: "client-001" } })
    }
    if (headlessInput) {
      fireEvent.click(headlessInput)
    }
    if (strictInput) {
      fireEvent.click(strictInput)
    }

    expect(onChange).toHaveBeenCalledWith({ baseUrl: "https://example.com" })
    expect(onChange).toHaveBeenCalledWith({ modelName: "gemini-3.1-pro-preview" })
    expect(onChange).toHaveBeenCalledWith({ automationClientId: "client-001" })
    expect(onChange).toHaveBeenCalledWith({ headless: false })
    expect(onChange).toHaveBeenCalledWith({ midsceneStrict: true })
    view.unmount()
  })
})
