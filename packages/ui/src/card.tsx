import React, { forwardRef, type HTMLAttributes } from "react"
import { cn } from "./cn"

type CardTone = "default" | "raised" | "ghost"

const toneClass: Record<CardTone, string> = {
  default: "ui-card--default",
  raised: "ui-card--raised",
  ghost: "ui-card--ghost",
}

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone
}

export const Card = forwardRef<HTMLElement, CardProps>(
  ({ className, tone = "default", ...props }, ref) => (
    <article ref={ref} className={cn("ui-card", toneClass[tone], className)} {...props} />
  )
)

Card.displayName = "Card"

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ui-card-header", className)} {...props} />
)

CardHeader.displayName = "CardHeader"

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn("ui-card-title", className)} {...props} />
)

CardTitle.displayName = "CardTitle"

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("ui-card-description", className)} {...props} />
)

CardDescription.displayName = "CardDescription"

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ui-card-content", className)} {...props} />
)

CardContent.displayName = "CardContent"

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ui-card-footer", className)} {...props} />
)

CardFooter.displayName = "CardFooter"
