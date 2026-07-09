import * as React from "react"

import { cn } from "@/lib/utils"

// Stage 2 (#68): the resting ring is `hairline` (P3 -- boxes get the
// hairline utility, never a literal `border`), and the invalid state layers
// a second, colored inset box-shadow on top rather than swapping `border-*`
// (which does not exist as a box-drawing device in this system any more).
// No `dark:` variant and no `focus-visible:border-ring`/per-primitive focus
// treatment: the one global :focus-visible rule in globals.css already
// renders this input's focus ring (section 8).
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md hairline bg-transparent px-3 py-1 text-base transition-[color,box-shadow] selection:bg-iris-solid selection:text-on-solid file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
