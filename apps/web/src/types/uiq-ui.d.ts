declare module "@uiq/ui" {
  import * as React from "react"

  type UiProps = Record<string, unknown> & { children?: React.ReactNode }
  type UiComponent = React.ComponentType<UiProps>

  export const Badge: UiComponent
  export const Button: UiComponent
  export const Card: UiComponent
  export const CardContent: UiComponent
  export const CardDescription: UiComponent
  export const CardFooter: UiComponent
  export const CardHeader: UiComponent
  export const CardTitle: UiComponent
  export const Checkbox: UiComponent
  export const Dialog: UiComponent
  export const DialogClose: UiComponent
  export const DialogContent: UiComponent
  export const DialogDescription: UiComponent
  export const DialogFooter: UiComponent
  export const DialogHeader: UiComponent
  export const DialogOverlay: UiComponent
  export const DialogPortal: UiComponent
  export const DialogTitle: UiComponent
  export const DialogTrigger: UiComponent
  export const Input: UiComponent
  export const Select: UiComponent
  export const Switch: UiComponent
  export const Tabs: UiComponent
  export const TabsContent: UiComponent
  export const TabsList: UiComponent
  export const TabsTrigger: UiComponent
  export const Toast: UiComponent
  export const ToastIcon: UiComponent
  export const ToastMessage: UiComponent
  export const ToastViewport: UiComponent
  export function cn(...parts: Array<string | false | null | undefined>): string
}

declare module "@uiq/ui/styles.css"
