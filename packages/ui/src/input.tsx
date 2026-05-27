import React, { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react"
import { cn } from "./cn"

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn("ui-input", type === "range" && "ui-input--range", className)}
      {...props}
    />
  )
)

Input.displayName = "Input"

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn("ui-textarea", className)} {...props} />
)

Textarea.displayName = "Textarea"
