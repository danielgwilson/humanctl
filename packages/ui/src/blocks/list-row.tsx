import type { ReactNode } from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@humanctl/ui/lib/cn"

type ListRowProps = Omit<ButtonPrimitive.Props, "title"> & {
  title: ReactNode
  summary?: ReactNode
  metadata?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  status?: ReactNode
  selected?: boolean
}

function ListRow({
  className,
  title,
  summary,
  metadata,
  leading,
  trailing,
  status,
  selected = false,
  ...props
}: ListRowProps) {
  return (
    <ButtonPrimitive
      data-slot="list-row"
      data-selected={selected || undefined}
      className={cn(
        "group/row grid min-h-[var(--row-task)] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2 text-left outline-none transition-colors duration-[var(--duration-color)] hover:bg-[var(--overlay-hover)] focus-visible:bg-[var(--overlay-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[selected]:bg-[var(--overlay-selected)] disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    >
      {leading ? <span className="grid shrink-0 place-items-center text-ink-3">{leading}</span> : null}
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] leading-5 font-medium text-ink">{title}</span>
          {status}
        </span>
        {summary ? <span className="mt-0.5 block truncate text-[13px] leading-5 text-ink-2">{summary}</span> : null}
        {metadata ? <span className="mt-0.5 block truncate font-mono text-[11px] leading-4 text-ink-3">{metadata}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {trailing}
        <ChevronRightIcon className="size-3.5 text-ink-4 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100" />
      </span>
    </ButtonPrimitive>
  )
}

export { ListRow, type ListRowProps }
