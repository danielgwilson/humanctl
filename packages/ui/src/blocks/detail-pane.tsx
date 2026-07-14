import type { ComponentProps, ReactNode } from "react"
import { XIcon } from "lucide-react"

import { IconButton } from "@humanctl/ui/components/icon-button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { cn } from "@humanctl/ui/lib/cn"

type DetailPaneProps = ComponentProps<"section"> & {
  title: ReactNode
  eyebrow?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  onClose?: () => void
}

function DetailPane({
  className,
  title,
  eyebrow,
  meta,
  actions,
  footer,
  onClose,
  children,
  ...props
}: DetailPaneProps) {
  return (
    <section
      data-slot="detail-pane"
      className={cn("flex h-full min-h-0 min-w-0 flex-col bg-background", className)}
      {...props}
    >
      <header className="flex min-h-[var(--row-decision)] shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="truncate font-mono text-[11px] text-ink-3">{eyebrow}</div> : null}
          <h2 className="truncate text-[15px] leading-5 font-semibold text-ink">{title}</h2>
          {meta ? <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        {onClose ? (
          <IconButton aria-label="Close detail" variant="ghost" size="sm" onClick={onClose}>
            <XIcon />
          </IconButton>
        ) : null}
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="w-full max-w-[var(--measure-prose)] px-4 py-4">{children}</div>
      </ScrollArea>
      {footer ? (
        <footer className="shrink-0 border-t border-border p-3">
          <div className="w-full max-w-[var(--measure-prose)]">{footer}</div>
        </footer>
      ) : null}
    </section>
  )
}

export { DetailPane, type DetailPaneProps }
