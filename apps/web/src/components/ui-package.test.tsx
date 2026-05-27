/* @vitest-environment jsdom */

import { fireEvent } from "@testing-library/react"
import { act, createRef, type MouseEvent } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as ui from "@uiq/ui"

describe("shared ui package", () => {
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
    vi.restoreAllMocks()
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  it("cn joins only truthy class names", () => {
    expect(ui.cn("alpha", false, null, undefined, "beta")).toBe("alpha beta")
    expect(ui.cn("", false, undefined)).toBe("")
  })

  it("renders Badge and Button with variant classes and forwards refs", () => {
    const badgeRef = createRef<HTMLSpanElement>()
    const buttonRef = createRef<HTMLButtonElement>()
    const onClick = vi.fn()

    act(() => {
      root.render(
        <div>
          <ui.Badge ref={badgeRef} variant="warning" className="custom-badge" data-testid="badge">
            {"warn"}
          </ui.Badge>
          <ui.Button
            ref={buttonRef}
            variant="destructive"
            size="sm"
            className="custom-button"
            data-testid="button"
            onClick={onClick}
          >
            {"delete"}
          </ui.Button>
        </div>
      )
    })

    const badge = container.querySelector("[data-testid='badge']") as HTMLSpanElement
    const button = container.querySelector("[data-testid='button']") as HTMLButtonElement

    expect(badge.className).toContain("ui-badge")
    expect(badge.className).toContain("ui-badge--warning")
    expect(badge.className).toContain("custom-badge")
    expect(badgeRef.current).toBe(badge)

    expect(button.className).toContain("ui-button")
    expect(button.className).toContain("ui-button--destructive")
    expect(button.className).toContain("ui-button--sm")
    expect(button.className).toContain("custom-button")
    expect(button.type).toBe("button")
    expect(buttonRef.current).toBe(button)
    act(() => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders card family components with semantic tags", () => {
    act(() => {
      root.render(
        <ui.Card tone="raised" data-testid="card">
          <ui.CardHeader data-testid="card-header">
            <ui.CardTitle data-testid="card-title">{"Title"}</ui.CardTitle>
            <ui.CardDescription data-testid="card-description">{"Description"}</ui.CardDescription>
          </ui.CardHeader>
          <ui.CardContent data-testid="card-content">{"Body"}</ui.CardContent>
          <ui.CardFooter data-testid="card-footer">{"Footer"}</ui.CardFooter>
        </ui.Card>
      )
    })

    const card = container.querySelector("[data-testid='card']") as HTMLDivElement
    expect(card.className).toContain("ui-card")
    expect(card.className).toContain("ui-card--raised")
    expect(container.querySelector("[data-testid='card-title']")?.tagName).toBe("H3")
    expect(container.querySelector("[data-testid='card-description']")?.tagName).toBe("P")
    expect(container.querySelector("[data-testid='card-content']")?.className).toContain("ui-card-content")
    expect(container.querySelector("[data-testid='card-footer']")?.className).toContain("ui-card-footer")
  })

  it("dialog overlay dismisses by default and respects prevented click", () => {
    const onDismiss = vi.fn()
    const onClick = vi.fn((event: MouseEvent<HTMLDivElement>) => event.preventDefault())

    act(() => {
      root.render(
        <div>
          <ui.DialogOverlay data-testid="overlay-dismiss" onDismiss={onDismiss} />
          <ui.DialogOverlay data-testid="overlay-prevent" onDismiss={onDismiss} onClick={onClick} />
          <ui.DialogContent titleId="dialog-title" descriptionId="dialog-description" data-testid="dialog">
            {"Dialog"}
          </ui.DialogContent>
          <ui.DialogHeader data-testid="dialog-header" />
          <ui.DialogTitle id="dialog-title">{"Dialog title"}</ui.DialogTitle>
          <ui.DialogDescription id="dialog-description">{"Dialog description"}</ui.DialogDescription>
          <ui.DialogFooter data-testid="dialog-footer" />
        </div>
      )
    })

    const dismissOverlay = container.querySelector("[data-testid='overlay-dismiss']") as HTMLDivElement
    const preventedOverlay = container.querySelector("[data-testid='overlay-prevent']") as HTMLDivElement
    const dialog = container.querySelector("[data-testid='dialog']") as HTMLDivElement

    act(() => {
      dismissOverlay.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      preventedOverlay.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(dialog.getAttribute("role")).toBe("dialog")
    expect(dialog.getAttribute("aria-modal")).toBe("true")
    expect(dialog.getAttribute("aria-labelledby")).toBe("dialog-title")
    expect(dialog.getAttribute("aria-describedby")).toBe("dialog-description")
  })

  it("renders input, textarea and tabs trigger active state from both props", () => {
    act(() => {
      root.render(
        <div>
          <ui.Input data-testid="input" className="extra-input" />
          <ui.Textarea data-testid="textarea" className="extra-textarea" />
          <ui.TabsList data-testid="tabs-list" className="extra-tabs-list" />
          <ui.TabsTrigger data-testid="tabs-trigger-active" active className="custom-trigger">
            {"Active"}
          </ui.TabsTrigger>
          <ui.TabsTrigger data-testid="tabs-trigger-is-active" isActive>
            {"IsActive"}
          </ui.TabsTrigger>
        </div>
      )
    })

    const input = container.querySelector("[data-testid='input']") as HTMLInputElement
    const textarea = container.querySelector("[data-testid='textarea']") as HTMLTextAreaElement
    const tabsList = container.querySelector("[data-testid='tabs-list']") as HTMLDivElement
    const tabsTriggerActive = container.querySelector(
      "[data-testid='tabs-trigger-active']"
    ) as HTMLButtonElement
    const tabsTriggerIsActive = container.querySelector(
      "[data-testid='tabs-trigger-is-active']"
    ) as HTMLButtonElement

    expect(input.className).toContain("ui-input")
    expect(input.className).toContain("extra-input")
    expect(textarea.className).toContain("ui-textarea")
    expect(textarea.className).toContain("extra-textarea")
    expect(tabsList.className).toContain("ui-tabs-list")
    expect(tabsList.className).toContain("extra-tabs-list")
    expect(tabsTriggerActive.className).toContain("ui-tabs-trigger")
    expect(tabsTriggerActive.className).toContain("is-active")
    expect(tabsTriggerActive.className).toContain("custom-trigger")
    expect(tabsTriggerIsActive.className).toContain("is-active")
  })

  it("renders extended dialog, select, switch and toast primitives", () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const closeRef = createRef<HTMLButtonElement>()
    const switchRef = createRef<HTMLInputElement>()
    const onEscapeKeyDown = vi.fn()
    const onCheckedChange = vi.fn()

    act(() => {
      root.render(
        <div>
          <ui.Dialog data-testid="dialog-root" open={false} />
          <ui.DialogPortal>
            <ui.DialogTrigger ref={triggerRef} data-testid="dialog-trigger">
              {"Open"}
            </ui.DialogTrigger>
            <ui.DialogClose ref={closeRef} data-testid="dialog-close">
              {"Close"}
            </ui.DialogClose>
            <ui.DialogContent
              data-testid="dialog-content-extended"
              titleId="title-2"
              descriptionId="desc-2"
              open={false}
              onEscapeKeyDown={onEscapeKeyDown}
            >
              {"Body"}
            </ui.DialogContent>
          </ui.DialogPortal>
          <ui.Select data-testid="select" size="sm" defaultValue="b">
            <option value="a">{"A"}</option>
            <option value="b">{"B"}</option>
          </ui.Select>
          <ui.Switch
            ref={switchRef}
            data-testid="switch"
            checked={false}
            onCheckedChange={onCheckedChange}
          />
          <ui.ToastViewport data-testid="toast-viewport">
            <ui.Toast data-testid="toast" level="success">
              <ui.ToastIcon data-testid="toast-icon">{"✓"}</ui.ToastIcon>
              <ui.ToastMessage data-testid="toast-message">{"Saved"}</ui.ToastMessage>
            </ui.Toast>
          </ui.ToastViewport>
        </div>
      )
    })

    const dialogRoot = container.querySelector("[data-testid='dialog-root']") as HTMLDivElement
    const dialogTrigger = container.querySelector("[data-testid='dialog-trigger']") as HTMLButtonElement
    const dialogClose = container.querySelector("[data-testid='dialog-close']") as HTMLButtonElement
    const dialogContent = container.querySelector(
      "[data-testid='dialog-content-extended']"
    ) as HTMLDivElement
    const select = container.querySelector("[data-testid='select']") as HTMLSelectElement
    const switchInput = container.querySelector("[data-testid='switch']") as HTMLInputElement
    const toast = container.querySelector("[data-testid='toast']") as HTMLButtonElement

    expect(dialogRoot.getAttribute("data-state")).toBe("closed")
    expect(dialogTrigger.type).toBe("button")
    expect(dialogClose.type).toBe("button")
    expect(triggerRef.current).toBe(dialogTrigger)
    expect(closeRef.current).toBe(dialogClose)
    expect(dialogContent.getAttribute("data-state")).toBe("closed")
    act(() => {
      dialogContent.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(onEscapeKeyDown).toHaveBeenCalledTimes(1)

    expect(select.className).toContain("ui-select")
    expect(select.className).toContain("ui-select--sm")
    expect(select.value).toBe("b")

    expect(switchInput.getAttribute("role")).toBe("switch")
    expect(switchInput.getAttribute("data-state")).toBe("unchecked")
    expect(switchRef.current).toBe(switchInput)
    act(() => {
      fireEvent.click(switchInput)
    })
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    expect(container.querySelector("[data-testid='toast-viewport']")?.className).toContain("toast-stack")
    expect(toast.className).toContain("toast-item")
  })
})
