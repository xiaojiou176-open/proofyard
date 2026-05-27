/* @vitest-environment jsdom */

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ConfirmDialog from "./ConfirmDialog"

vi.mock("./ui", () => {
  const Dialog = ({ children }: { open?: boolean; children: ReactNode }) => (
    <div data-testid="mock-dialog-root">{children}</div>
  )

  const DialogOverlay = ({
    className,
    onClick,
    onDismiss,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { onDismiss?: () => void }) => (
    <div
      className={className}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onDismiss?.()
      }}
      {...props}
    />
  )

  const DialogContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
    titleId?: string
    descriptionId?: string
    onEscapeKeyDown?: (event: KeyboardEvent) => void
  }>((props, ref) => {
    const { titleId, descriptionId, onEscapeKeyDown, children, ...rest } = props
    return (
      <div
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        {...rest}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onEscapeKeyDown) {
            onEscapeKeyDown(event as unknown as KeyboardEvent)
          }
          props.onKeyDown?.(event)
        }}
      >
        {children}
      </div>
    )
  })

  const DialogTitle = ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h3 {...props}>{children}</h3>
  )

  const DialogDescription = ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  )

  const DialogFooter = ({ className, children }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  )

  const Button = forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "destructive" }
  >(({ variant = "default", className = "", children, ...props }, ref) => {
    const mapped = variant === "destructive" ? "btn-danger" : variant === "outline" ? "btn-outline" : "btn-primary"
    return (
      <button ref={ref} className={`${className} ${mapped}`.trim()} {...props}>
        {children}
      </button>
    )
  })

  return {
    Dialog,
    DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
    DialogOverlay,
    DialogContent,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
    DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Button,
  }
})

describe("ConfirmDialog", () => {
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

  it("focuses cancel first and handles escape, overlay, confirm", function () {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    act(() => {
      root.render(
        <ConfirmDialog
          title="危险操作"
          message="是否继续执行"
          confirmLabel="确认执行"
          cancelLabel="先取消"
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )
    })

    const cancelButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "先取消"
    ) as HTMLButtonElement | undefined
    const confirmButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === "确认执行"
    ) as HTMLButtonElement | undefined

    expect(cancelButton).not.toBeUndefined()
    expect(confirmButton).not.toBeUndefined()
    expect(document.activeElement).toBe(cancelButton)
    expect(confirmButton?.className.includes("ui-button--destructive")).toBe(true)

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)

    const overlay = document.body.querySelector(".ui-dialog-overlay") as HTMLDivElement
    act(() => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)

    act(() => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it("traps focus with tab loop and keeps click inside dialog from bubbling", function () {
    const onCancel = vi.fn()

    act(() => {
      root.render(
        <ConfirmDialog
          title="确认"
          message="提示"
          onConfirm={() => {}}
          onCancel={onCancel}
        />
      )
    })

    const dialogBox = document.body.querySelector(".ui-dialog-content") as HTMLDivElement
    const buttons = Array.from(document.body.querySelectorAll("button")) as HTMLButtonElement[]
    const cancelButton = buttons[0]
    const confirmButton = buttons[1]

    act(() => {
      confirmButton.focus()
      dialogBox.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
      )
    })
    expect(document.activeElement).toBe(cancelButton)

    act(() => {
      cancelButton.focus()
      dialogBox.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      )
    })
    expect(document.activeElement).toBe(confirmButton)

    act(() => {
      dialogBox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
