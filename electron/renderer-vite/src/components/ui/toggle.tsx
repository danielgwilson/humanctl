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
const toggleVariants = cva(
  // eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71): Toggle/ToggleGroup rewrite owns this radius; zero-visual-delta this stage.
  "inline-flex items-center justify-center whitespace-nowrap rounded-[5px] font-mono font-medium text-ink-3 transition-colors hover:wash-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)] data-[state=on]:bg-selected data-[state=on]:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "hairline bg-transparent hover:ring-wash-hover",
      },
      // Label is `row` regardless of size (section 6's Button pattern,
      // generalized): only the box height/padding differentiates the three
      // sizes now, never the font size -- there is no room for a fourth or
      // fifth mono size under the five-size budget (2.3).
      size: {
        default: "h-7 px-3 font-mono text-row",
        sm: "h-6 px-2 font-mono text-row",
        // eslint-disable-next-line design-system/spacing-steps -- stage 5 (#71): Toggle size ladder rewrite owns this; zero-visual-delta this stage.
        lg: "h-8 px-3.5 font-mono text-row",
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
