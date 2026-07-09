import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Dot, type Hue } from "@/components/ui/dot"

// The ONE small-labeled-pill component for the whole app. Stage 5 (#71) item
// 3 collapses the previous twelve variants (five state hues + two note
// levels + five hue-tinted "label" dialects) to the two the primitive
// vocabulary actually names (docs/design-system.md section 6): "Chip |
// variant: state (soft bg, contrast ink, 6px contrast dot, micro, sentence
// case) / meta (no fill, --ink-3, micro). hue is a prop, one of the eight.
// Height exactly 20px, radius 6px, because --row-list is derived from it."
//
// `hue` only paints `variant="state"` -- `meta` is always flat --ink-3 text,
// no dot, regardless of what hue is passed (the table's own wording: meta is
// "no fill, --ink-3", not "no fill, --<hue>-contrast"). This is a real,
// deliberate simplification, not an oversight: section 1.6's "full 12-row
// map" (eight session states + four note levels) is the complete set of
// things this app colours as a state mark: everything else that used to
// borrow a hue for a plain metadata tag ("asks you" in need-amber,
// "interrupted" in block-red, "your answer" in iris) is meta now,
// uncoloured, per P2 ("nothing is coloured to create hierarchy").
// `session-detail.tsx`'s note-level chip is the one site that gains real
// hue-correctness here: it used to hardcode `variant="label-iris"`
// regardless of the note's actual level (fyi/review/blocked/done); it is now
// `variant="state"` with the level's own hue (format.ts's `NOTE_LEVEL_HUE`),
// which is the fix, not a side effect.
//
// No fixed uppercase transform any more (section 2.3: "Uppercase on
// anything but label" is forbidden, and "State chips are micro, in sentence
// case" is explicit) -- the previous base class force-cased every chip,
// including already-mixed-case metadata text ("AI summary", "Ask the
// session"). Removing it reveals the caller's own text unchanged; no call
// site needed a text edit.
//
// No longer built on shadcn Badge (badge.tsx is deleted this stage, issue
// #71 item 9): Chip was Badge's only real consumer, so it becomes a plain,
// self-contained `<span>`.
const HUE_STATE_CLASS: Record<Hue, string> = {
  iris: "bg-iris-soft text-iris-contrast",
  work: "bg-work-soft text-work-contrast",
  need: "bg-need-soft text-need-contrast",
  block: "bg-block-soft text-block-contrast",
  done: "bg-done-soft text-done-contrast",
  idle: "bg-idle-soft text-idle-contrast",
  "series-1": "bg-series-1-soft text-series-1-contrast",
  "series-2": "bg-series-2-soft text-series-2-contrast",
}

const chipVariants = cva(
  "inline-flex h-5 w-fit flex-none items-center gap-1 rounded-1 px-1.5 font-mono text-micro whitespace-nowrap",
  {
    variants: {
      variant: {
        state: "",
        meta: "bg-transparent text-ink-3",
      },
    },
    defaultVariants: { variant: "state" },
  }
)

export function Chip({
  variant = "state",
  hue = "idle",
  dot,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof chipVariants> & { hue?: Hue; dot?: boolean }) {
  const showDot = variant === "state" && (dot ?? true)
  return (
    <span
      data-slot="chip"
      data-variant={variant}
      data-hue={variant === "state" ? hue : undefined}
      className={cn(chipVariants({ variant }), variant === "state" && HUE_STATE_CLASS[hue], className)}
      {...props}
    >
      {showDot && <Dot hue={hue} />}
      {children}
    </span>
  )
}

export { chipVariants }
