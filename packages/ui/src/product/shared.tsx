import type { ComponentProps, ReactNode } from "react"
import { AlertCircleIcon, InboxIcon } from "lucide-react"

import { StatusChip } from "@humanctl/ui/blocks/status"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@humanctl/ui/components/alert"
import { Button } from "@humanctl/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@humanctl/ui/components/empty"
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
        "grid size-6 shrink-0 place-items-center rounded-[var(--radius-1)] text-xs font-medium",
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
    <Alert variant="destructive" className="border-t-0">
      <AlertCircleIcon />
      <AlertTitle className="sr-only">{label}</AlertTitle>
      <AlertDescription className="truncate">{label}: {resource.error}</AlertDescription>
      {onRetry ? <AlertAction><Button size="sm" variant="ghost" onClick={onRetry}>Retry</Button></AlertAction> : null}
    </Alert>
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
    <Empty className="h-full min-h-48 px-6 py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription className="text-sm leading-5 text-ink-3">{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function RowSkeletons({ count = 6 }: { count?: number }) {
  return (
    <div aria-label="Loading" role="status" className="border-t border-border">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid h-[var(--row-task)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-1.5">
          <Skeleton className="size-6" />
          <div className="flex flex-col gap-2">
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
          {count != null ? <span className="text-xs tabular-nums text-ink-3">{count}</span> : null}
        </div>
        {description ? <p className="mt-0.5 truncate text-sm text-ink-3">{description}</p> : null}
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
    <div className={cn("grid min-h-10 grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2 text-sm", className)}>
      <div className="text-ink-3">{label}</div>
      <div className="min-w-0 text-ink">{children || value}</div>
    </div>
  )
}

export function SectionHeading({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-3 border-b border-border bg-sunken px-4">
      <h2 className="text-xs font-medium text-ink-3">{children}</h2>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  )
}

export function KeyboardKey({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex min-w-5 items-center justify-center rounded-[4px] bg-sunken px-1.5 font-mono text-xs leading-5 text-ink-3 shadow-[var(--elev-ring)]", className)}
      {...props}
    />
  )
}
