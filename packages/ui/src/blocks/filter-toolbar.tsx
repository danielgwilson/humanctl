import type { ComponentProps, ReactNode } from "react"

import { cn } from "@humanctl/ui/lib/cn"

type FilterToolbarProps = ComponentProps<"div"> & {
  search?: ReactNode
  filters?: ReactNode
  actions?: ReactNode
  resultCount?: number
  resultLabel?: string
}

function FilterToolbar({
  className,
  search,
  filters,
  actions,
  resultCount,
  resultLabel = "results",
  ...props
}: FilterToolbarProps) {
  return (
    <div
      data-slot="filter-toolbar"
      className={cn(
        "flex min-h-[var(--toolbar)] shrink-0 items-center gap-2 border-b border-border px-3 py-1 max-[680px]:flex-wrap",
        className,
      )}
      {...props}
    >
      {search ? <div className="w-full max-w-72 min-w-40 max-[680px]:max-w-none">{search}</div> : null}
      {filters ? <div className="flex min-w-0 items-center gap-1.5">{filters}</div> : null}
      {resultCount != null ? (
        <span className="ml-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-3" aria-live="polite">
          {resultCount} {resultCount === 1 && resultLabel.endsWith("s") ? resultLabel.slice(0, -1) : resultLabel}
        </span>
      ) : null}
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

export { FilterToolbar, type FilterToolbarProps }
