import type { ReactNode } from "react"

import { Item } from "@humanctl/ui/components/item"
import { cn } from "@humanctl/ui/lib/cn"

type ListRowProps = Omit<React.ComponentProps<"button">, "title" | "ref"> & {
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
    <Item
      render={<button {...props} type="button" />}
      data-slot="list-row"
      data-selected={selected || undefined}
      className={cn(
        // Two readable lines. The title owns the whole first line so it reads
        // in full (recency sits at its right); the state and the message to
        // the human share the second line. Nothing competes with the title
        // for width, so it truncates late instead of after a couple of words.
        // Selected is an inset tint plus a left accent rule, not a card box.
        "group/row grid h-[var(--row-list)] w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 overflow-hidden rounded-none border-x-0 border-t-0 border-b border-separator px-3 text-left outline-none transition-colors duration-[var(--duration-color)] hover:bg-[var(--overlay-hover)] focus-visible:bg-[var(--overlay-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[selected]:bg-[var(--overlay-selected)] data-[selected]:shadow-[inset_2px_0_0_0_var(--color-primary)] disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
    >
      {leading ? (
        <span className="grid shrink-0 place-items-center text-ink-3">{leading}</span>
      ) : (
        <span aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-col justify-center gap-0.5">
        <span className="flex min-w-0 items-center gap-2 [&_[data-slot=status-chip]]:h-4">
          <span className="min-w-0 flex-1 truncate text-sm leading-5 font-medium tracking-[-0.01em] text-ink">{title}</span>
          {status}
          {trailing ? <span className="shrink-0 text-xs leading-4 tabular-nums text-ink-3">{trailing}</span> : null}
        </span>
        {summary || metadata ? (
          <span className="flex min-w-0 items-baseline gap-2">
            {summary ? <span className="min-w-0 flex-1 truncate text-sm leading-4 tracking-[-0.006em] text-ink-3">{summary}</span> : null}
            {metadata ? <span className="max-w-28 shrink-0 truncate font-mono text-xs leading-4 text-ink-4">{metadata}</span> : null}
          </span>
        ) : null}
      </span>
    </Item>
  )
}

export { ListRow, type ListRowProps }
