import * as React from "react"

import { cn } from "@/lib/utils"

// Modeled on input.tsx's own idiom (hairline ring, the same disabled/
// aria-invalid handling, no `dark:` variant, no per-primitive focus-visible
// override -- the one global :focus-visible rule in globals.css already
// renders this control's focus ring), with the `--surface-sunken` fill
// docs/design-system.md section 6's Input/Textarea/Select row has always
// specified for Textarea. `max-h-50` is Tailwind's generative spacing scale
// (50 * 0.25rem = 200px) rather than a bracketed arbitrary value, satisfying
// the 200px cap (this file's own long-standing deliberate choice) without a
// bare-length lint violation. `overflow-y-auto` (never a nested ScrollArea)
// is section 6's own documented exception for Textarea specifically, not a
// bespoke-controls violation.
//
// Stage 5 (#71) item 4: radius moves onto the new scale -- Textarea is the
// one primitive in the Input/Textarea/Select row assigned the PANEL radius
// (r12, docs/design-system.md section 6: "Textarea r12"), not the 32px
// control tier Input's own `lg` size uses, because a multi-line well reads
// as a small bounded surface (the composer, section 3.3's "panel" row)
// rather than a single-line control.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "h-16 max-h-50 w-full min-w-0 resize-none overflow-y-auto rounded-4 hairline bg-surface-sunken px-3 py-2 font-sans text-prose text-ink transition-[color,box-shadow] placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
