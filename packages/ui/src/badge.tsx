import React, { forwardRef, type HTMLAttributes } from "react"
import { cn } from "./cn"

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive"

const variantClass: Record<BadgeVariant, string> = {
  default: "ui-badge--default",
  secondary: "ui-badge--secondary",
  success: "ui-badge--success",
  warning: "ui-badge--warning",
  destructive: "ui-badge--destructive",
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span ref={ref} className={cn("ui-badge", variantClass[variant], className)} {...props} />
  )
)

Badge.displayName = "Badge"
