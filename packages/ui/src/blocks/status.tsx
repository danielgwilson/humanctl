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

const statusClasses: Record<StatusState, string> = {
  running: "bg-work-soft text-work before:bg-work",
  "needs-input": "bg-need-soft text-need before:bg-need",
  blocked: "bg-block-soft text-block before:bg-block",
  complete: "bg-done-soft text-done before:bg-done",
  idle: "bg-idle-soft text-idle before:bg-idle",
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
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[var(--radius-1)] px-1.5 font-sans text-xs leading-none font-medium before:size-1.5 before:shrink-0 before:rounded-full",
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
