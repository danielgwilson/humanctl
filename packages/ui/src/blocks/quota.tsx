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
  // The bar's job is to show how close this quota is to spent, so the fill
  // carries the level: calm blue under 70, amber past 70, red past 90. The
  // "% used" figure remains the non-color owner, so color is never alone.
  const indicatorTone = normalized == null ? "bg-idle" : normalized >= 90 ? "bg-block" : normalized >= 70 ? "bg-need" : "bg-primary"

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
        {detail || reset ? <span className="block truncate text-xs text-ink-3">{[detail, reset].filter(Boolean).join(" · ")}</span> : null}
      </div>
      {loading ? <Skeleton className="h-1.5 w-full max-[680px]:col-span-2" /> : (
        <ProgressTrack className="bg-[color-mix(in_oklch,var(--surface-1),var(--ink)_10%)] max-[680px]:order-3 max-[680px]:col-span-2">
          <ProgressIndicator className={indicatorTone} />
        </ProgressTrack>
      )}
      <div className="min-w-16 text-right">
        {loading ? <Skeleton className="ml-auto h-4 w-12" /> : (
          normalized == null ? <span className="text-xs text-ink-3">N/A</span> : (
            <span className="text-xs tabular-nums text-ink">{Math.round(normalized)}% used</span>
          )
        )}
      </div>
    </Progress>
  )
}

export { QuotaRow, type QuotaRowProps }
