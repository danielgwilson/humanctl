import type { ComponentProps, ReactNode } from "react"
import { XIcon } from "lucide-react"

import { IconButton } from "@humanctl/ui/components/icon-button"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@humanctl/ui/components/message-scroller"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { cn } from "@humanctl/ui/lib/cn"

type DetailPaneProps = ComponentProps<"section"> & {
  title: ReactNode
  eyebrow?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  onClose?: () => void
  scrollMode?: "content" | "messages"
  bodyLabel?: string
}

function DetailPane({
  className,
  title,
  eyebrow,
  meta,
  actions,
  footer,
  onClose,
  scrollMode = "content",
  bodyLabel = "Task detail",
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
        <div className="flex min-w-0 flex-1 self-stretch flex-col justify-center">
          {eyebrow ? <div className="truncate text-xs text-ink-3">{eyebrow}</div> : null}
          <h2 className="line-clamp-2 text-[15px] leading-5 font-semibold text-ink">{title}</h2>
          {meta ? <div className="mt-0.5 truncate text-xs text-ink-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        {onClose ? (
          <IconButton aria-label="Close detail" variant="ghost" size="sm" onClick={onClose}>
            <XIcon />
          </IconButton>
        ) : null}
      </header>
      {scrollMode === "messages" ? (
        <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport aria-label={bodyLabel} preserveScrollOnPrepend>
              <MessageScrollerContent className="gap-0">{children}</MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="w-full px-4 py-4">{children}</div>
        </ScrollArea>
      )}
      {footer ? (
        <footer className="shrink-0 border-t border-border p-3">
          <div className="w-full">{footer}</div>
        </footer>
      ) : null}
    </section>
  )
}

export { DetailPane, type DetailPaneProps }
