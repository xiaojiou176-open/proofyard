import type { ReactNode } from "react"
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import ConfirmDialog from "./ConfirmDialog"

vi.mock("./ui", () => {
  const Dialog = ({ children }: { open?: boolean; children: ReactNode }) => <div>{children}</div>

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
        onDismiss?.()
      }}
      {...props}
    />
  )

  const DialogContent = forwardRef<
    HTMLDivElement,
    HTMLAttributes<HTMLDivElement> & {
      titleId?: string
      descriptionId?: string
    }
  >(({ titleId, descriptionId, children, ...props }, ref) => (
    <div ref={ref} role="dialog" aria-labelledby={titleId} aria-describedby={descriptionId} {...props}>
      {children}
    </div>
  ))

  const DialogTitle = ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h3 {...props}>{children}</h3>
  )

  const DialogDescription = ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  )

  const DialogFooter = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  )

  const Button = forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "destructive" }
  >(({ children, ...props }, ref) => (
    <button ref={ref} {...props}>
      {children}
    </button>
  ))

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

describe("ConfirmDialog accessibility", () => {
  it("renders a modal dialog without aria-hidden conflict on overlay", function () {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="确认执行危险命令" message="请确认后继续。" onConfirm={() => {}} onCancel={() => {}} />
    )

    expect(html).toMatch(/role="(dialog|alertdialog)"/)
    expect(html).toContain('aria-labelledby="')
    expect(html).toContain('aria-describedby="')
    expect(html).not.toContain('aria-hidden="true"')
  })
})
