import * as React from "react"
import { cn } from "@/lib/utils"
import { AlertTriangle } from "lucide-react"

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  action?: React.ReactNode
}

export function ErrorState({
  title = "Something went wrong",
  description = "An error occurred while loading this data.",
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center border border-danger-subtle bg-danger-subtle/30 rounded-lg",
        className
      )}
      {...props}
    >
      <AlertTriangle className="h-8 w-8 text-danger mb-4" />
      <h3 className="text-lg font-semibold text-danger">{title}</h3>
      <p className="text-sm text-text-secondary mt-2 max-w-sm">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

