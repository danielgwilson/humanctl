import type { ComponentProps } from "react"

import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack } from "@humanctl/ui/components/progress"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { cn } from "@humanctl/ui/lib/cn"

type QuotaRowProps = Omit<ComponentProps<typeof Progress>, "value" | "children"> & {
  label: string
  value?: number | null
  detail?: string
  reset?: string
  loading?: boolean
}

function QuotaRow({
  className,
  label,
  value,
  detail,
  reset,
  loading = false,
  ...props
}: QuotaRowProps) {
  const normalized = value == null ? null : Math.max(0, Math.min(100, value))

  return (
    <Progress
      data-slot="quota-row"
      value={normalized}
      showTrack={false}
      aria-label={`${label} quota`}
      aria-valuetext={normalized == null ? "Not available" : `${Math.round(normalized)} percent`}
      className={cn("grid min-h-[var(--row-decision)] grid-cols-[minmax(9rem,1fr)_minmax(8rem,1.4fr)_auto] items-center gap-4 border-b border-border px-4 py-2 max-[680px]:grid-cols-[1fr_auto]", className)}
      {...props}
    >
      <div className="min-w-0">
        <ProgressLabel className="block truncate text-ink">{label}</ProgressLabel>
        {reset ? <span className="block truncate font-mono text-[11px] text-ink-3">{reset}</span> : null}
      </div>
      {loading ? <Skeleton className="h-1 w-full max-[680px]:col-span-2" /> : <ProgressTrack className="max-[680px]:order-3 max-[680px]:col-span-2"><ProgressIndicator /></ProgressTrack>}
      <div className="min-w-16 text-right">
        {loading ? <Skeleton className="ml-auto h-4 w-12" /> : (
          <>
            <span className="font-mono text-[12px] tabular-nums text-ink">{normalized == null ? "N/A" : `${Math.round(normalized)}%`}</span>
            {detail ? <span className="ml-2 font-mono text-[11px] text-ink-3">{detail}</span> : null}
          </>
        )}
      </div>
    </Progress>
  )
}

export { QuotaRow, type QuotaRowProps }
