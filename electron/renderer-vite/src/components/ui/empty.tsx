import * as React from "react"

import { cn } from "@/lib/utils"

// The one quiet, instructive empty-state primitive (DESIGN.md: "Empty states
// are quiet and instructive, never celebratory"), replacing five hand-rolled
// one-off `<div className="p-... text-ink-3">` placeholders. Hand-ported
// (`npx shadcn add empty` produces a dashed-border, rounded-lg, bg-muted
// icon-medallion card -- DESIGN.md's "flat surfaces, no cards, no
// shadows-as-hierarchy" rules that look out on sight) into a minimal
// Empty/EmptyTitle/EmptyDescription family in the house style instead: flat,
// borderless, centered mono text, nothing celebratory.
//
// Stage 5 (#71) item 7: "Empty gets h-full, two grades, prose body copy, no
// outline." `h-full` (percentage height) replaces `flex-1` (flex-grow) as
// the sizing mechanism: `flex-1` only resolves inside a flex-context parent,
// which is exactly what broke fleet-view.tsx's empty state when nested
// inside `ScrollArea` (Radix's Viewport is a `display: table` box, and
// `flex-1`/percentage-of-flex-basis math does not apply there -- see that
// file's own former comment on the bypass this deletes). `height: 100%`
// resolves against a table-cell's own resolved height instead, which is
// exactly the property Radix's Viewport carries, so `Empty` can now sit
// inside `ScrollArea` like every other pane content and fleet-view.tsx no
// longer needs a parallel non-ScrollArea render path for the total===0 case.
//
// Two grades (docs/design-system.md section 6), both outline-free -- no
// dashed border, no box, in either grade: `slot` (default) is "the slot's
// real height, a centred `row` title at `--ink-2`, one line of `--ink-3`
// prose, no button" -- every current call site in the app (session-detail,
// Inbox, Sessions, Fleet's empty states are all `slot`, most without even a
// title, description only). `view` steps `EmptyTitle` up to the `title` role
// (sans, 20px, the same role ViewHeader owns once per screen -- legal here
// too since an empty *view* has no other title on screen) and caps
// `EmptyDescription` at a hard ~40ch measure (`max-w-[40ch]`, allowed by the
// no-arbitrary-length lint rule: it only bans px/rem/em, not `ch`) for the
// two-line description a fuller empty view earns. No current call site needs
// `view`'s own primary-button row yet (nothing in this app has an obvious
// single action to fabricate for "no sessions in the last 72h"), so it is
// built to spec and left for the next call site that does, per the issue's
// own "stays out of the bundle only if tree-shaken" allowance for primitives
// without a call site yet.
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex h-full min-w-0 flex-col items-center justify-center gap-1.5 p-6 text-center",
        className
      )}
      {...props}
    />
  )
}

function EmptyTitle({
  className,
  size = "slot",
  ...props
}: React.ComponentProps<"div"> & { size?: "slot" | "view" }) {
  return (
    <div
      data-slot="empty-title"
      data-size={size}
      className={cn(
        size === "slot" ? "font-mono text-row text-ink-2" : "font-sans text-title text-ink",
        className
      )}
      {...props}
    />
  )
}

// Empty-state copy is one of docs/design-system.md 2.1's enumerated sans
// call sites verbatim ("empty-state copy"), and section 6 says it plainly:
// "Body copy is prose, and prose is never mono."
function EmptyDescription({
  className,
  size = "slot",
  ...props
}: React.ComponentProps<"div"> & { size?: "slot" | "view" }) {
  return (
    <div
      data-slot="empty-description"
      data-size={size}
      className={cn(
        "font-sans text-prose text-ink-3 [&>code]:rounded-1 [&>code]:bg-surface-2 [&>code]:px-1.5 [&>code]:py-px [&>code]:font-mono",
        size === "slot" ? "max-w-sm" : "max-w-[40ch]",
        className
      )}
      {...props}
    />
  )
}

export { Empty, EmptyTitle, EmptyDescription }
