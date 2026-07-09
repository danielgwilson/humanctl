import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// The one proportional-bar primitive for the app (Metrics' top-skills list,
// Fleet's by-state/by-harness/by-tier breakdowns), replacing three copies of
// a hand-rolled `h-[6px] ... bg-panel2` track plus an inline
// `style={{ width: ... }}` fill. The hue is a cva variant on the INDICATOR
// only, never an inline style or a one-off className (DESIGN.md: "Colors are
// semantic and fixed per axis") -- callers pick a variant name (the state,
// harness, or tier's own hue) instead of writing a `bg-<color>` class
// string themselves.
//
// Stage 2 (#68): the track is `--surface-sunken` with no hairline ring
// (docs/design-system.md section 6: "Track is --surface-sunken, full
// radius, and carries no hairline ring [P3: the indicator would erase it on
// three edges]. Indicator is --<hue>-contrast."), and every indicator paints
// the `-contrast` role (a progress bar is a chart bar, one of the four jobs
// colour is allowed in section 1.5's contrast role). `claude`/`codex` are
// kept as indicator KEY names (no component API change this stage -- the
// primitive-vocabulary rename to a `hue` prop is stage 5, #71) but their
// VALUES are repointed from the retired vendor-named `--color-claude`/
// `--color-codex` tokens onto `--series-1`/`--series-2` (section 1.6: "A
// vendor name never enters the token layer" and "A state hue and a series
// hue never appear in one figure... Fleet renders a by-state figure and a
// by-harness figure ... in different figures" -- harness identity in a
// chart is a chart-series colour, never a vendor hue). `ink2`/`ink4` are
// added alongside the existing `ink3` for the neutral/tier case (section 6:
// "neutral is --ink-3"; Fleet's tier breakdown, which has no hue of its own
// in section 1.6's table, reads as an ink-alpha intensity ladder instead of
// an invented colour -- P1: "Hierarchy is carried by ink alpha").
const progressIndicatorVariants = cva("h-full w-full flex-1 transition-all", {
  variants: {
    indicator: {
      iris: "bg-iris-contrast",
      ink2: "bg-ink-2",
      ink3: "bg-ink-3",
      ink4: "bg-ink-4",
      claude: "bg-series-1-contrast",
      codex: "bg-series-2-contrast",
      need: "bg-need-contrast",
      block: "bg-block-contrast",
      work: "bg-work-contrast",
      idle: "bg-idle-contrast",
      done: "bg-done-contrast",
    },
  },
  defaultVariants: {
    indicator: "iris",
  },
})

function Progress({
  className,
  value,
  indicator,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn(
        "relative h-[6px] w-full overflow-hidden rounded-full bg-surface-sunken",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(progressIndicatorVariants({ indicator }))}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress, progressIndicatorVariants }
