import type { ReactNode } from "react"
import { memo } from "react"
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from "@uiq/ui"

interface RunDetailCardProps {
  title: string
  status: string
  isSuccess: boolean
  detailHint: string
  children: ReactNode
  className?: string
}

function RunDetailCard({
  title,
  status,
  isSuccess,
  detailHint,
  children,
  className,
}: RunDetailCardProps) {
  return (
    <Card className={cn("run-detail-card", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Badge className="chip" variant={isSuccess ? "success" : "default"}>
          {status}
        </Badge>
      </CardHeader>
      <CardContent className="field-group">
        <p className="hint-text mb-2">{detailHint}</p>
        {children}
      </CardContent>
    </Card>
  )
}

export default memo(RunDetailCard)
