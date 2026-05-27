import React, { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from "react"
import { cn } from "./cn"

export const Tabs = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ui-tabs", className)} {...props} />
)

Tabs.displayName = "Tabs"

export const TabsList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, role, ...props }, ref) => (
    <div ref={ref} role={role ?? "tablist"} className={cn("ui-tabs-list", className)} {...props} />
  )
)

TabsList.displayName = "TabsList"

export interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  isActive?: boolean
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, active, isActive, role, type, ...props }, ref) => {
    const selected = Boolean(active ?? isActive)
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        role={role ?? "tab"}
        aria-selected={selected}
        data-state={selected ? "active" : "inactive"}
        className={cn("ui-tabs-trigger", selected && "is-active", className)}
        {...props}
      />
    )
  }
)

TabsTrigger.displayName = "TabsTrigger"

export const TabsContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} role="tabpanel" className={cn("ui-tabs-content", className)} {...props} />
  )
)

TabsContent.displayName = "TabsContent"
