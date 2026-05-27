import React, { forwardRef, type InputHTMLAttributes } from "react"
import { cn } from "./cn"

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onChange, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn("ui-checkbox", className)}
      onChange={onChange}
      {...props}
    />
  )
)

Checkbox.displayName = "Checkbox"
