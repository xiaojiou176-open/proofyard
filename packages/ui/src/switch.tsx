import React, { forwardRef, type InputHTMLAttributes } from "react"
import { cn } from "./cn"

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  onCheckedChange?: (checked: boolean) => void
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onChange, onCheckedChange, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      className={cn("ui-switch", className)}
      onChange={(event) => {
        onChange?.(event)
        onCheckedChange?.(event.target.checked)
      }}
      {...props}
    />
  )
)

Switch.displayName = "Switch"
