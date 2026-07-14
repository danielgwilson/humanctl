import type { ComponentProps, ReactNode } from "react"
import { AlertCircleIcon, InboxIcon } from "lucide-react"

import { StatusChip } from "@humanctl/ui/blocks/status"
import { Button } from "@humanctl/ui/components/button"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { cn } from "@humanctl/ui/lib/cn"

import type {
  HumanctlResource,
  HumanctlSession,
  HumanctlSessionState,
} from "./contracts"
import { stateLabel, stateTone } from "./helpers"

export function SessionStatus({ state }: { state: HumanctlSessionState }) {
  return <StatusChip state={stateTone(state)} label={stateLabel(state)} />
}

export function HarnessMark({ harness }: Pick<HumanctlSession, "harness">) {
  const codex = harness === "codex"
  return (
    <span
      aria-label={codex ? "Codex" : "Claude Code"}
      title={codex ? "Codex" : "Claude Code"}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-[var(--radius-1)] font-mono text-[10px] font-medium",
        codex ? "bg-accent-soft text-primary" : "bg-idle-soft text-ink-2",
      )}
    >
      {codex ? "CX" : "CC"}
    </span>
  )
}

export function ResourceNotice({
  resource,
  label,
  onRetry,
}: {
  resource: HumanctlResource<unknown>
  label: string
  onRetry?: () => void
}) {
  if (!resource.error) return null
  return (
    <div role="status" className="flex min-h-9 items-center gap-2 border-b border-block/30 bg-block-soft px-4 text-[12px] text-block">
      <AlertCircleIcon className="size-3.5 shrink-0" />
      <span className="truncate">{label}: {resource.error}</span>
      {onRetry ? <Button size="sm" variant="ghost" className="ml-auto" onClick={onRetry}>Retry</Button> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="grid h-full min-h-48 place-items-center px-6 py-12 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-3 grid size-8 place-items-center rounded-[var(--radius-2)] bg-sunken text-ink-3">
          <InboxIcon className="size-4" />
        </span>
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-[13px] leading-5 text-ink-3">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  )
}

export function RowSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading" role="status" className="border-t border-border">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid min-h-[var(--row-task)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5">
          <Skeleton className="size-6" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-44 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-[80%]" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  )
}

export function PaneHeading({
  title,
  description,
  count,
  actions,
}: {
  title: string
  description?: string
  count?: number
  actions?: ReactNode
}) {
  return (
    <div className="flex min-h-[var(--row-decision)] shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[16px] leading-5 font-semibold text-ink">{title}</h1>
          {count != null ? <span className="font-mono text-[11px] tabular-nums text-ink-3">{count}</span> : null}
        </div>
        {description ? <p className="mt-0.5 truncate text-[13px] text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

export function DefinitionRow({
  label,
  value,
  children,
  className,
}: {
  label: string
  value?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("grid min-h-10 grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2 text-[13px]", className)}>
      <div className="text-ink-3">{label}</div>
      <div className="min-w-0 text-ink">{children || value}</div>
    </div>
  )
}

export function SectionHeading({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-3 border-b border-border bg-sunken px-4">
      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{children}</h2>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  )
}

export function KeyboardKey({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex min-w-5 items-center justify-center rounded-[4px] bg-sunken px-1.5 font-mono text-[10px] leading-5 text-ink-3 shadow-[var(--elev-ring)]", className)}
      {...props}
    />
  )
}
