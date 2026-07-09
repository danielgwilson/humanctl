import * as React from "react"

import { cn } from "@/lib/utils"

// New primitive: humanctl had no Textarea before this PR (every composer so
// far -- "Ask the session", the chief-of-staff drawer -- used the single-line
// Input). Modeled on input.tsx's own idiom (hairline ring, the same
// disabled/aria-invalid handling, no `dark:` variant, no per-primitive
// focus-visible override -- the one global :focus-visible rule in
// globals.css already renders this control's focus ring), but the fill
// follows docs/design-system.md section 6's Input/Textarea/Select row
// exactly: `--surface-sunken`, not Input's current `bg-transparent` (Input
// predates that row and is untouched stage-5/radius-scale debt, out of
// scope here). `rounded-lg` is the closest existing radius token to that
// row's r12 spec -- the dedicated radius scale is stage 5 (#71), untouched
// by this PR, so this reuses the token every other panel-shaped surface in
// the app already resolves through (command.tsx, dialog.tsx, sidebar.tsx).
// `max-h-[200px]` with plain `overflow-y-auto` (never a nested ScrollArea)
// is section 6's own documented exception for Textarea specifically, not a
// bespoke-controls violation.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71) item 4: Textarea primitive rewrite owns this height ladder; the 200px cap is already deliberate (see this file's own header comment), zero-visual-delta this stage.
        "h-16 max-h-[200px] w-full min-w-0 resize-none overflow-y-auto rounded-lg hairline bg-surface-sunken px-3 py-2 font-sans text-prose text-ink transition-[color,box-shadow] placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
