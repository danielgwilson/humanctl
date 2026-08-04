import type { ComponentProps } from "react"

import { cn } from "@humanctl/ui/lib/cn"

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-[var(--radius-1)] bg-[color-mix(in_oklch,var(--surface-1),var(--ink)_8%)]",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
