import React, { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react"
import { cn } from "./cn"

export type ToastLevel = "info" | "success" | "warn" | "error"

export const ToastViewport = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("toast-stack", className)} {...props} />
)

ToastViewport.displayName = "ToastViewport"

export interface ToastProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  level?: ToastLevel
}

export const Toast = forwardRef<HTMLButtonElement, ToastProps>(
  ({ className, level = "info", ...props }, ref) => (
    <button ref={ref} type="button" data-state="open" className={cn("toast-item", level, className)} {...props} />
  )
)

Toast.displayName = "Toast"

export const ToastIcon = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => <span ref={ref} className={cn("toast-icon", className)} {...props} />
)

ToastIcon.displayName = "ToastIcon"

export const ToastMessage = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("toast-message", className)} {...props} />
)

ToastMessage.displayName = "ToastMessage"
