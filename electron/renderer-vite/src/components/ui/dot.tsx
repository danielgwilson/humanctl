import { cn } from "@/lib/utils"

// docs/design-system.md section 1.6's eight hues. The single source of truth
// for the `Hue` type: Chip's `hue` prop and CountToken/Progress's own hue
// concerns all trace back to this list, never a re-typed duplicate.
export type Hue =
  | "iris"
  | "work"
  | "need"
  | "block"
  | "done"
  | "idle"
  | "series-1"
  | "series-2"

// One class per hue, never a computed/interpolated string: Tailwind's
// scanner needs static text to see a class and keep it in the build, and
// `bg-${hue}-contrast` would not survive that scan.
const HUE_CONTRAST_BG: Record<Hue, string> = {
  iris: "bg-iris-contrast",
  work: "bg-work-contrast",
  need: "bg-need-contrast",
  block: "bg-block-contrast",
  done: "bg-done-contrast",
  idle: "bg-idle-contrast",
  "series-1": "bg-series-1-contrast",
  "series-2": "bg-series-2-contrast",
}

// New primitive (docs/design-system.md section 6, issue #71 item 1): "Dot |
// 6px circle, --<hue>-contrast. No sizes, no variants beyond hue. It never
// appears without an adjacent text label." Replaces the four ad hoc
// `h-[5px] w-[5px] rounded-full bg-<hue>-contrast` spans this stage's
// grandfathered eslint-disable comments named as its worklist (chip.tsx's
// own state dot, thread-row.tsx's unread dot, context-bar.tsx's quota-status
// dot, sessions-view.tsx's pinned-header dot). Always `aria-hidden`: a Dot
// is a colour mark riding alongside a text label that already says the same
// thing (P2's job 3, "a state mark"), never the sole carrier of the signal.
//
// `inline-block` is load-bearing, not decorative: a bare `<span>` is
// `display: inline` by default, and `size-1.5`'s width/height have no effect
// on an inline box. Every call site so far happened to render Dot as a
// direct flex child (Chip's own `inline-flex` root, thread-row.tsx/context-
// bar.tsx/sessions-view.tsx's flex rows), where the flex layout spec
// "blockifies" a child's display and the bug never surfaced -- until
// dropdown-menu.tsx/context-menu.tsx's RadioItem, which nests Dot one level
// inside Radix's own plain (non-flex) `ItemIndicator` span: there, `size-1.5`
// silently collapsed to a real 0x0 box (confirmed via getBoundingClientRect
// while building the kitchen-sink page -- the checked radio's dot rendered
// in the DOM with the right classes and was completely invisible). `Dot`
// must be correct regardless of its container, so the fix belongs on the
// primitive, not on every call site that happens to need it.
export function Dot({ hue, className }: { hue: Hue; className?: string }) {
  return (
    <span
      data-slot="dot"
      aria-hidden="true"
      className={cn("inline-block size-1.5 flex-none rounded-full", HUE_CONTRAST_BG[hue], className)}
    />
  )
}
