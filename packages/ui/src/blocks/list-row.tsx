import type { ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"

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
        "group/row grid min-h-[var(--row-task)] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-none border-x-0 border-t-0 border-b border-border px-4 py-2 text-left outline-none transition-colors duration-[var(--duration-color)] hover:bg-[var(--overlay-hover)] focus-visible:bg-[var(--overlay-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[selected]:bg-[var(--overlay-selected)] disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
    >
      {leading ? <span className="grid shrink-0 place-items-center text-ink-3">{leading}</span> : null}
      <span className="min-w-0">
        <span className="block truncate text-[13px] leading-5 font-medium text-ink">{title}</span>
        {summary || status ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-2">
            {summary ? <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-2">{summary}</span> : null}
            {status}
          </span>
        ) : null}
        {metadata ? <span className="mt-0.5 block truncate font-mono text-[11px] leading-4 text-ink-3">{metadata}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {trailing}
        <ChevronRightIcon className="size-3.5 text-ink-4 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100" />
      </span>
    </Item>
  )
}

export { ListRow, type ListRowProps }
