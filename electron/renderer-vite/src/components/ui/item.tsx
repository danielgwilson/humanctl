import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

// The shared "flat row" primitive (shadcn's Item family), hand-ported (npx
// shadcn add was skipped per the migration brief's fallback) and restyled
// onto humanctl tokens from the start -- never stock zinc/new-york. Added to
// de-card session-detail's stream/summary/composer boxes (DESIGN.md: "Flat
// surfaces, no cards, no shadows-as-hierarchy"): the `default` variant below
// is intentionally border-less and shadow-less, a flat row separated from
// its neighbors by `ItemSeparator` (a hairline `Separator`), never a
// bordered box.
function ItemGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="list"
      data-slot="item-group"
      className={cn("group/item-group flex flex-col", className)}
      {...props}
    />
  )
}

// Stage 5 (#71) item 8: `inset` by default -- an ItemGroup is a bounded
// container of related rows (section 3.6: "A rule inside a bounded container
// is inset by that container's horizontal padding, so a divider always
// terminates at the same x as the content it divides"), and Item's own
// horizontal padding (item 6, `px-6`) IS that container padding.
function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      inset
      className={cn("my-0", className)}
      {...props}
    />
  )
}

// Stage 5 (#71) item 6: "Item gets its horizontal padding back; outline and
// muted variants deleted." Flat: no border, no background -- the row
// separator (a hairline ItemSeparator) carries hierarchy, never a box, so
// the two boxed variants (a hairline ring, a filled surface) are dropped
// outright; nothing in the app called either one. The old `px-0` shifted the
// pane gutter onto each call site instead (settings-view.tsx and
// metrics-view.tsx's StatRow both had to re-add `px-6` by hand every time);
// `px-6` here is the same pane-gutter value ViewHeader/ContextBar/ThreadRow
// already use for a top-level row, so those per-call-site overrides become
// redundant (and are cleaned up in the same change). Call sites that nest an
// Item inside an already-inset container (session-detail.tsx's stream, which
// wraps its own `border-l-2 ... pl-3` note-style rows) override the
// horizontal side that needs it, same as any other cva default.
const itemVariants = cva(
  "group/item flex flex-wrap items-center rounded-2 border border-transparent font-mono text-row transition-colors",
  {
    variants: {
      size: {
        default: "gap-3 px-6 py-3",
        sm: "gap-2.5 px-6 py-2",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Item({
  className,
  size = "default",
  asChild = false,
  role = "listitem",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof itemVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="item"
      data-size={size}
      role={role}
      className={cn(itemVariants({ size }), className)}
      {...props}
    />
  )
}

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "size-8 rounded-3 hairline bg-surface-2 [&_svg:not([class*='size-'])]:size-4",
        image: "size-10 overflow-hidden rounded-3 [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant }), className)}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn("flex min-w-0 flex-1 flex-col gap-1", className)}
      {...props}
    />
  )
}

// docs/design-system.md 6, Empty's "slot" grade (the same title/description
// pairing shape as this generic Item primitive): title is `row` at
// --ink (full, since it is the row's own primary content, not a demotion).
function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("flex items-center gap-2 font-mono text-row text-ink", className)}
      {...props}
    />
  )
}

// ...and description is `prose` (Empty's own rule, generalized: "Body copy
// is prose, and prose is never mono").
function ItemDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-description"
      className={cn("whitespace-pre-wrap font-sans text-prose text-ink-3", className)}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn("flex basis-full items-center justify-between gap-2", className)}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn("flex basis-full items-center justify-between gap-2", className)}
      {...props}
    />
  )
}

export {
  ItemGroup,
  ItemSeparator,
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemHeader,
  ItemFooter,
  itemVariants,
  itemMediaVariants,
}
