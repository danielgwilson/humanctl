"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// The bespoke segmented-control option, generalized from the hand-rolled
// `Segmented` button that used to live in settings-view.tsx into a real
// Radix Toggle: mono label, no fill at rest, an iris fill on the active
// option -- pixel-matching the old look, but keyboard operation and
// `aria-pressed` now come from Radix for free instead of a hand-tracked
// `aria-pressed={active}` prop. Dark is the DEFAULT theme with no `.light`
// ancestor (globals.css flips every `--color-*` value between `:root` and
// `.light`, see button.tsx's header comment for the full rationale), so
// stock shadcn's `dark:` utilities are dropped here too.
const toggleVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-[5px] font-mono font-medium text-ink3 transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-iris data-[state=on]:text-primary-foreground data-[state=on]:hover:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-border bg-transparent hover:bg-panel2",
      },
      size: {
        default: "h-7 px-3 text-[10.5px]",
        sm: "h-6 px-2 text-[9.5px]",
        lg: "h-8 px-3.5 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
