/* @vitest-environment jsdom */

import { fireEvent } from "@testing-library/react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n"
import type { UniversalTemplate } from "../types"
import QuickLaunchView from "./QuickLaunchView"

vi.mock("../components/CommandGrid", () => ({
  default: () => <div data-testid="mock-command-grid" />,
}))

vi.mock("../components/ParamsPanel", () => ({
  default: () => <div data-testid="mock-params-panel" />,
}))

vi.mock("../components/EmptyState", () => ({
  default: ({ title }: { title: string }) => <div data-testid="mock-empty-state">{title}</div>,
}))

const template: UniversalTemplate = {
  template_id: "tpl-1",
  flow_id: "flow-123456",
  name: "模板A",
  params_schema: [{ key: "email", type: "email", required: true }],
  defaults: { email: "demo@example.com" },
  policies: {
    retries: 0,
    timeout_seconds: 120,
    otp: {
      required: true,
      provider: "manual",
      timeout_seconds: 120,
      regex: "\\d{6}",
      sender_filter: "",
      subject_filter: "",
    },
    branches: {},
  },
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const optionalTemplate: UniversalTemplate = {
  ...template,
  template_id: "tpl-optional",
  name: "模板B",
  params_schema: [{ key: "note", type: "string", required: false }],
  defaults: null,
  policies: {
    ...template.policies,
    otp: {
      ...template.policies.otp,
      required: false,
    },
  },
}

describe("QuickLaunchView behavior", () => {
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

  it("drives first-use stage actions", function () {
    const onFirstUseStageChange = vi.fn()

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId=""
          isFirstUseActive
          firstUseStage="welcome"
          firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={onFirstUseStageChange}
          onCompleteFirstUse={() => {}}
          onOpenWorkshop={() => {}}
          onOpenMcpGuide={() => {}}
        />
      )
    })

    const startButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start step 1"
    )
    const locateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Go to configuration"
    )

    act(() => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      locateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onFirstUseStageChange).toHaveBeenCalledWith("configure")
    expect(onFirstUseStageChange).toHaveBeenCalledTimes(2)
  })

  it("supports template selection, run params update and sidebar toggle", function () {
    const onRunParamsChange = vi.fn()
    const onSelectedTemplateIdChange = vi.fn()
    const onCreateRun = vi.fn()
    const onOpenWorkshop = vi.fn()
    const onOpenMcpGuide = vi.fn()

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[template]}
          onCreateRun={onCreateRun}
          onRunParamsChange={onRunParamsChange}
          runParams={{}}
          onSelectedTemplateIdChange={onSelectedTemplateIdChange}
          selectedTemplateId=""
          isFirstUseActive={false}
          firstUseStage="welcome"
          firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
          onOpenWorkshop={onOpenWorkshop}
          onOpenMcpGuide={onOpenMcpGuide}
        />
      )
    })

    const selectTemplateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Select template"
    )
    act(() => {
      selectTemplateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelectedTemplateIdChange).toHaveBeenCalledWith(template.template_id)
    expect(onRunParamsChange).toHaveBeenCalledWith(template.defaults)

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[template]}
          onCreateRun={onCreateRun}
          onRunParamsChange={onRunParamsChange}
          runParams={{ email: "demo@example.com" }}
          onSelectedTemplateIdChange={onSelectedTemplateIdChange}
          selectedTemplateId={template.template_id}
          isFirstUseActive={false}
          firstUseStage="welcome"
          firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    const emailInput = container.querySelector(
      `#template-param-${template.template_id}-email`
    ) as HTMLInputElement
    act(() => {
      emailInput.value = "next@example.com"
      emailInput.dispatchEvent(new Event("input", { bubbles: true }))
      emailInput.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(onRunParamsChange).toHaveBeenCalled()

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Start run"
    )
    act(() => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCreateRun).toHaveBeenCalledTimes(1)

    const sidebarToggle = container.querySelector(
      'button[aria-controls="quick-launch-params-panel"]'
    ) as HTMLButtonElement
    expect(sidebarToggle.getAttribute("aria-expanded")).toBe("true")
    expect(sidebarToggle.getAttribute("aria-label")).toBe("Collapse parameter rail")

    act(() => {
      sidebarToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(sidebarToggle.getAttribute("aria-expanded")).toBe("false")
    expect(sidebarToggle.getAttribute("aria-label")).toBe("Expand parameter rail")
    const paramsPanel = container.querySelector("#quick-launch-params-panel") as HTMLDivElement
    expect(paramsPanel.hidden).toBe(true)
  })

  it("surfaces AI and MCP side-road cards without replacing the main path", function () {
    const onOpenWorkshop = vi.fn()
    const onOpenMcpGuide = vi.fn()

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId=""
          isFirstUseActive={false}
          firstUseStage="verify"
          firstUseProgress={{ configValid: true, runTriggered: true, resultSeen: true }}
          canCompleteFirstUse={true}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
          onOpenWorkshop={onOpenWorkshop}
          onOpenMcpGuide={onOpenMcpGuide}
        />
      )
    })

    expect(container.textContent).toContain("AI Reconstruction Assistant")
    expect(container.textContent).toContain("MCP Integration Side Road")
    expect(container.textContent).toContain("Webaudit Command Center")
    expect(container.textContent).toContain("Evidence-first browser automation with recovery and MCP")
    expect(container.textContent).toContain("tool-using shells")
    expect(container.textContent).toContain("Codex")
    expect(container.textContent).toContain("Claude Code")
    expect(container.textContent).toContain("OpenHands")
    expect(container.textContent).toContain("OpenCode")
    expect(container.textContent).toContain("OpenClaw")
    expect(container.textContent).toContain("browser-evidence substrate")
    expect(container.textContent).toContain("Named ecosystem fit")
    expect(container.textContent).toContain("MCP-first today: Claude Code / OpenCode")
    expect(container.textContent).toContain("API-first or hybrid")
    expect(container.textContent).toContain("Use Recovery Center before raw logs or workshop replay")
    expect(container.querySelector(".launch-hero-card")?.textContent).toContain(
      "AI Reconstruction Assistant"
    )
    expect(container.querySelector(".launch-hero-card")?.textContent).toContain(
      "MCP Integration Side Road"
    )

    const buttons = Array.from(container.querySelectorAll("button"))
    const workshopButton = buttons.find((button) => button.textContent === "Open Flow Workshop")
    const mcpButton = buttons.find((button) => button.textContent === "Open MCP guide")

    act(() => {
      workshopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      mcpButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenWorkshop).toHaveBeenCalledTimes(1)
    expect(onOpenMcpGuide).toHaveBeenCalledTimes(1)
  })

  it("renders verify/configure guidance branches and empty template state", function () {
    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId=""
          isFirstUseActive
          firstUseStage="configure"
          firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    expect(container.textContent).toContain(
      "Enter a valid baseUrl, an optional startUrl, and a successSelector before continuing."
    )
    expect(container.textContent).toContain("No templates yet")

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId=""
          isFirstUseActive
          firstUseStage="verify"
          firstUseProgress={{ configValid: true, runTriggered: true, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    expect(container.textContent).toContain(
      "No success or failure result is visible yet. Wait for the task to finish in Task Center first."
    )
    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Complete the first-use guide"
    ) as HTMLButtonElement | undefined
    expect(completeButton?.disabled).toBe(true)
  })

  it("renders key product copy in Chinese when locale is switched", function () {
    act(() => {
      root.render(
        <I18nProvider locale="zh-CN" setLocale={() => {}}>
          <QuickLaunchView
            commands={[]}
            commandState="success"
            activeTab="all"
            submittingId=""
            feedbackText=""
            onActiveTabChange={() => {}}
            onRunCommand={() => {}}
            params={{
              baseUrl: "http://127.0.0.1:17380",
              startUrl: "",
              successSelector: "#ok",
              modelName: "models/gemini-3.1-pro-preview",
              registerPassword: "",
              automationToken: "",
              automationClientId: "client-001",
              headless: false,
              midsceneStrict: false,
            }}
            onParamsChange={() => {}}
            templates={[]}
            onCreateRun={() => {}}
            onRunParamsChange={() => {}}
            runParams={{}}
            onSelectedTemplateIdChange={() => {}}
            selectedTemplateId=""
            isFirstUseActive={false}
            firstUseStage="welcome"
            firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
            canCompleteFirstUse={false}
            onFirstUseStageChange={() => {}}
            onCompleteFirstUse={() => {}}
            onOpenWorkshop={() => {}}
            onOpenMcpGuide={() => {}}
          />
        </I18nProvider>
      )
    })

    expect(container.textContent).toContain("以证据为先的浏览器自动化，内置恢复与 MCP")
    expect(container.textContent).toContain("主操作")
    expect(container.textContent).toContain("高级侧路")
    expect(container.textContent).toContain("MCP 集成侧路")
    expect(container.textContent).toContain("打开 MCP 指南")
  })

  it("updates optional template params and falls back to empty defaults", function () {
    const onRunParamsChange = vi.fn()
    const onSelectedTemplateIdChange = vi.fn()

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[optionalTemplate]}
          onCreateRun={() => {}}
          onRunParamsChange={onRunParamsChange}
          runParams={{ note: "" }}
          onSelectedTemplateIdChange={onSelectedTemplateIdChange}
          selectedTemplateId={optionalTemplate.template_id}
          isFirstUseActive={false}
          firstUseStage="welcome"
          firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    expect(container.textContent).toContain(" / Timeout 120s")
    expect(container.textContent).not.toContain(" / OTP")

    const optionalInput = container.querySelector(
      `#template-param-${optionalTemplate.template_id}-note`
    ) as HTMLInputElement
    expect(optionalInput.placeholder).toBe("Optional")

    act(() => {
      fireEvent.input(optionalInput, { target: { value: "memo" } })
    })
    expect(onRunParamsChange).toHaveBeenCalledWith({ note: "memo" })

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[optionalTemplate]}
          onCreateRun={() => {}}
          onRunParamsChange={onRunParamsChange}
          runParams={{}}
          onSelectedTemplateIdChange={onSelectedTemplateIdChange}
          selectedTemplateId=""
          isFirstUseActive={false}
          firstUseStage="welcome"
          firstUseProgress={{ configValid: false, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    const selectTemplateButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Select template"
    )
    act(() => {
      selectTemplateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelectedTemplateIdChange).toHaveBeenCalledWith(optionalTemplate.template_id)
    expect(onRunParamsChange).toHaveBeenCalledWith({})
  })

  it("allows configured users to advance into run stage", function () {
    const onFirstUseStageChange = vi.fn()

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId=""
          isFirstUseActive
          firstUseStage="configure"
          firstUseProgress={{ configValid: true, runTriggered: false, resultSeen: false }}
          canCompleteFirstUse={false}
          onFirstUseStageChange={onFirstUseStageChange}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    const runStageButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Configuration done, continue to run"
    ) as HTMLButtonElement | undefined

    act(() => {
      runStageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onFirstUseStageChange).toHaveBeenCalledWith("run")
  })

  it("renders default timeout and secret template params with progress fully checked", function () {
    const secretTemplate: UniversalTemplate = {
      ...template,
      template_id: "tpl-secret",
      policies: {
        ...template.policies,
        timeout_seconds: undefined as unknown as number,
      },
      params_schema: [{ key: "password", type: "secret", required: true }],
      defaults: null,
    }

    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[secretTemplate]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId={secretTemplate.template_id}
          isFirstUseActive
          firstUseStage="verify"
          firstUseProgress={{ configValid: true, runTriggered: true, resultSeen: true }}
          canCompleteFirstUse
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
        />
      )
    })

    expect(container.textContent).toContain(
      "Progress: configure ✅ / trigger a run ✅ / review a result ✅"
    )
    expect(container.textContent).toContain(" / OTP")
    expect(container.textContent).toContain(" / Timeout 120s")

    const passwordInput = container.querySelector(
      `#template-param-${secretTemplate.template_id}-password`
    ) as HTMLInputElement
    expect(passwordInput.type).toBe("password")
    expect(passwordInput.value).toBe("")
  })

  it("renders the Wave 4 category story on the first screen", function () {
    act(() => {
      root.render(
        <QuickLaunchView
          commands={[]}
          commandState="success"
          activeTab="all"
          submittingId=""
          feedbackText=""
          onActiveTabChange={() => {}}
          onRunCommand={() => {}}
          params={{
            baseUrl: "http://127.0.0.1:17380",
            startUrl: "",
            successSelector: "#ok",
            modelName: "models/gemini-3.1-pro-preview",
            registerPassword: "",
            automationToken: "",
            automationClientId: "client-001",
            headless: false,
            midsceneStrict: false,
          }}
          onParamsChange={() => {}}
          templates={[]}
          onCreateRun={() => {}}
          onRunParamsChange={() => {}}
          runParams={{}}
          onSelectedTemplateIdChange={() => {}}
          selectedTemplateId=""
          isFirstUseActive={false}
          firstUseStage="verify"
          firstUseProgress={{ configValid: true, runTriggered: true, resultSeen: true }}
          canCompleteFirstUse
          onFirstUseStageChange={() => {}}
          onCompleteFirstUse={() => {}}
          onOpenWorkshop={() => {}}
          onOpenMcpGuide={() => {}}
        />
      )
    })

    expect(container.textContent).toContain("Webaudit Command Center")
    expect(container.textContent).toContain("Evidence-first browser automation with recovery and MCP")
    expect(container.textContent).toContain(
      "This is for AI agents, Codex, Claude Code, OpenHands, OpenCode, OpenClaw, and human operators who need inspectable runs instead of guesswork."
    )
    expect(container.textContent).toContain("Use Recovery Center before raw logs or workshop replay")
    expect(container.textContent).toContain("Codex")
    expect(container.textContent).toContain("Claude Code")
    expect(container.textContent).toContain("OpenHands")
    expect(container.textContent).toContain("OpenCode")
    expect(container.textContent).toContain("OpenClaw")
    expect(container.textContent).toContain("MCP-first today: Claude Code / OpenCode")
    expect(container.textContent).toContain("API-first or hybrid today: Codex, OpenHands, and OpenClaw.")
    expect(container.querySelector(".launch-hero-card")?.textContent).toContain(
      "AI Reconstruction Assistant"
    )
    expect(container.querySelector(".launch-hero-card")?.textContent).toContain(
      "MCP Integration Side Road"
    )
  })
})
