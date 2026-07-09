"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// The bespoke segmented-control option, generalized from the hand-rolled
// `Segmented` button that used to live in settings-view.tsx into a real
// Radix Toggle: mono label, keyboard operation and `aria-pressed` come from
// Radix for free. Dark is the DEFAULT theme with no `.light` ancestor
// (globals.css flips every `--color-*` value between `:root` and `.light`,
// see button.tsx's header comment for the full rationale), so stock
// shadcn's `dark:` utilities are dropped here too.
//
// Stage 2 (#68), one of the five selection dialects unified onto
// `--overlay-selected`: the active option used to be a hardcoded
// `data-[state=on]:bg-iris` fill. docs/design-system.md's primitive table
// (section 6) assigns ToggleGroup's active state to `--overlay-selected`,
// never a fill -- selection is an overlay everywhere in this app, and a
// segmented control's active option is a selection, not a second "primary
// button" fill.
//
// Stage 5 (#71) item 5: the old three-size ladder (default/sm/lg, none of
// which actually matched a real control-height tier) collapses to the two
// sizes docs/design-system.md section 6's Toggle row names by their
// concentric radius: "r8 group over 20px/r6 options; r10 group over
// 28px/r8 options." `default` (28px/r8) is the real, only call site today
// (Settings' Theme and AI-summary-engine pickers, both unsized -> the
// ToggleGroupContext/cva default).
const toggleVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap font-mono text-row font-medium text-ink-3 transition-colors hover:wash-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)] data-[state=on]:bg-selected data-[state=on]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "hairline bg-transparent hover:ring-wash-hover",
      },
      size: {
        sm: "h-5 rounded-1 px-2",
        default: "h-7 rounded-2 px-3",
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
