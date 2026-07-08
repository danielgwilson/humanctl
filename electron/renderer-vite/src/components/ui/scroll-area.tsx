"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportClassName,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  // Exposes the Radix Viewport's own scrollable div so a consumer can read/
  // set scrollTop directly (session-detail.tsx's single shared body scroller
  // needs this: the conversation timeline's sticky-bottom-on-append and
  // scroll-position-preservation-on-prepend behaviors operate on THIS
  // element once the timeline no longer owns its own nested scroll region).
  // Optional and additive -- every existing `<ScrollArea>` call site is
  // unaffected.
  viewportRef?: React.Ref<HTMLDivElement>
  viewportClassName?: string
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] transition-[color,box-shadow]",
          viewportClassName
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        // Styled onto the humanctl palette (globals.css previously did this
        // via ::-webkit-scrollbar-thumb { background: var(--rule2) }, 8px
        // wide, transparent track): same width and thumb color, now applied
        // consistently in every pane via this one shared primitive instead
        // of relying on browser-default scrollbar chrome.
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-rule2 transition-colors hover:bg-ink4"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
