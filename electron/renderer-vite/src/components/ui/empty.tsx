import * as React from "react"

import { cn } from "@/lib/utils"

// The one quiet, instructive empty-state primitive (DESIGN.md: "Empty states
// are quiet and instructive, never celebratory"), replacing five hand-rolled
// one-off `<div className="p-... text-ink-3">` placeholders (session-detail's
// two, sessions-view's two, fleet-view's one, inbox's one). Hand-ported
// (`npx shadcn add empty` produces a dashed-border, rounded-lg, bg-muted
// icon-medallion card -- DESIGN.md's "flat surfaces, no cards, no
// shadows-as-hierarchy" rules that look out on sight) into a minimal
// Empty/EmptyTitle/EmptyDescription family in the house style instead: flat,
// borderless, centered mono text, nothing celebratory.
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center",
        className
      )}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-4",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "max-w-sm font-mono text-[11.5px] leading-relaxed text-ink-3 [&>code]:rounded [&>code]:bg-surface-2 [&>code]:px-1.5 [&>code]:py-px [&>code]:font-mono",
        className
      )}
      {...props}
    />
  )
}

export { Empty, EmptyTitle, EmptyDescription }
