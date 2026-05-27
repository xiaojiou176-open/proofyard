import React, { forwardRef, type ButtonHTMLAttributes } from "react"
import { cn } from "./cn"

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive"
type ButtonSize = "default" | "sm" | "icon"

const variantClass: Record<ButtonVariant, string> = {
  default: "ui-button--default",
  secondary: "ui-button--secondary",
  outline: "ui-button--outline",
  ghost: "ui-button--ghost",
  destructive: "ui-button--destructive",
}

const sizeClass: Record<ButtonSize, string> = {
  default: "ui-button--default-size",
  sm: "ui-button--sm",
  icon: "ui-button--icon",
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn("ui-button", variantClass[variant], sizeClass[size], className)}
      {...props}
    />
  )
)

Button.displayName = "Button"
