import type { ComponentProps } from "react"

import { cn } from "@humanctl/ui/lib/cn"

type StatusState = "running" | "needs-input" | "blocked" | "complete" | "idle"

const statusLabels: Record<StatusState, string> = {
  running: "Running",
  "needs-input": "Needs input",
  blocked: "Blocked",
  complete: "Complete",
  idle: "Idle",
}

// State is a colored dot plus a colored label, not a filled pill. The dot is
// the semantic mark DESIGN.md requires; dropping the tinted box keeps the list
// scannable without every row carrying a heavy chip (Linear/Geist status-dot).
const statusClasses: Record<StatusState, string> = {
  running: "text-work before:bg-work",
  "needs-input": "text-need before:bg-need",
  blocked: "text-block before:bg-block",
  complete: "text-done before:bg-done",
  idle: "text-idle before:bg-idle",
}

type StatusChipProps = ComponentProps<"span"> & {
  state: StatusState
  label?: string
}

function StatusChip({ state, label = statusLabels[state], className, ...props }: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      data-state={state}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 font-sans text-xs leading-none font-medium tracking-[-0.006em] before:size-1.5 before:shrink-0 before:rounded-full",
        statusClasses[state],
        className,
      )}
      {...props}
    >
      {label}
    </span>
  )
}

export { StatusChip, type StatusChipProps, type StatusState }
