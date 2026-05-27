import React, { forwardRef, type SelectHTMLAttributes } from "react"
import { cn } from "./cn"

type SelectSize = "default" | "sm"

const sizeClass: Record<SelectSize, string> = {
  default: "ui-select--default",
  sm: "ui-select--sm",
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  size?: SelectSize
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, size = "default", children, ...props }, ref) => (
    <select ref={ref} className={cn("ui-select", sizeClass[size], className)} {...props}>
      {children}
    </select>
  )
)

Select.displayName = "Select"
