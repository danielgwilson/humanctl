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
// string themselves. Track stays flat: no shadow, no border, same
// `bg-panel2` well as every other bar in the app.
const progressIndicatorVariants = cva("h-full w-full flex-1 transition-all", {
  variants: {
    indicator: {
      iris: "bg-iris",
      ink3: "bg-ink3",
      rule2: "bg-rule2",
      claude: "bg-claude",
      codex: "bg-codex",
      need: "bg-need",
      block: "bg-block",
      work: "bg-work",
      idle: "bg-idle",
      done: "bg-done",
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
        "relative h-[6px] w-full overflow-hidden rounded-full bg-panel2",
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
