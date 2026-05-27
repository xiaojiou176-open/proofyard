import React, {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PropsWithChildren,
} from "react"
import { cn } from "./cn"

export interface DialogProps extends HTMLAttributes<HTMLDivElement> {
  open?: boolean
}

export function Dialog({ open = true, className, ...props }: DialogProps) {
  return <div data-state={open ? "open" : "closed"} className={cn("ui-dialog", className)} {...props} />
}

export function DialogPortal({ children }: PropsWithChildren) {
  return <>{children}</>
}

export const DialogTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type, ...props }, ref) => (
    <button ref={ref} type={type ?? "button"} className={cn("ui-dialog-trigger", className)} {...props} />
  )
)

DialogTrigger.displayName = "DialogTrigger"

export const DialogClose = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type, ...props }, ref) => (
    <button ref={ref} type={type ?? "button"} className={cn("ui-dialog-close", className)} {...props} />
  )
)

DialogClose.displayName = "DialogClose"

export interface DialogOverlayProps extends HTMLAttributes<HTMLDivElement> {
  onDismiss?: () => void
  open?: boolean
}

export interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  titleId?: string
  descriptionId?: string
  open?: boolean
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}

export const DialogOverlay = forwardRef<HTMLDivElement, DialogOverlayProps>(
  ({ className, onDismiss, onClick, open = true, ...props }, ref) => (
    <div
      ref={ref}
      role="presentation"
      data-state={open ? "open" : "closed"}
      className={cn("ui-dialog-overlay", className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onDismiss?.()
      }}
      {...props}
    />
  )
)

DialogOverlay.displayName = "DialogOverlay"

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, titleId, descriptionId, onKeyDown, onEscapeKeyDown, open = true, ...props }, ref) => (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-state={open ? "open" : "closed"}
      className={cn("ui-dialog-content", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onEscapeKeyDown?.(event.nativeEvent)
        onKeyDown?.(event)
      }}
      {...props}
    />
  )
)

DialogContent.displayName = "DialogContent"

export const DialogHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ui-dialog-header", className)} {...props} />
)

DialogHeader.displayName = "DialogHeader"

export const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn("ui-dialog-title", className)} {...props} />
)

DialogTitle.displayName = "DialogTitle"

export const DialogDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("ui-dialog-description", className)} {...props} />
)

DialogDescription.displayName = "DialogDescription"

export const DialogFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ui-dialog-footer", className)} {...props} />
)

DialogFooter.displayName = "DialogFooter"
