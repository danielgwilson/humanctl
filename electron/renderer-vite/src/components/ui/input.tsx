import * as React from "react"

import { cn } from "@/lib/utils"

// Stage 2 (#68): the resting ring is `hairline` (P3 -- boxes get the
// hairline utility, never a literal `border`), and the invalid state layers
// a second, colored inset box-shadow on top rather than swapping `border-*`
// (which does not exist as a box-drawing device in this system any more).
// No `dark:` variant and no `focus-visible:border-ring`/per-primitive focus
// treatment: the one global :focus-visible rule in globals.css already
// renders this input's focus ring (section 8).
//
// Stage 5 (#71) item 4: one height ladder shared with Textarea/Select
// (docs/design-system.md section 6: "Input md 28px/r8, lg 32px/r10"),
// `--surface-sunken` fill (was `bg-transparent`, predating that row), no
// shadow. `md` is the default -- every Input call site in the app (the two
// composer fields, the two toolbar search fields) drops from the old fixed
// h-9 (36px) to 28px; Settings' daily-budget field is the one that used to
// carry its own `h-8` (32px) override (issue #71 item 4: "the one h-8") and
// now reaches that exact height honestly via `size="lg"` instead.
function Input({
  className,
  type,
  size = "md",
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & { size?: "md" | "lg" }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        "w-full min-w-0 hairline bg-surface-sunken px-3 py-1 font-mono text-row transition-[color,box-shadow] selection:bg-iris-solid selection:text-on-solid file:inline-flex file:h-5 file:border-0 file:bg-transparent file:font-mono file:text-row file:text-ink placeholder:text-ink-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-7 rounded-2" : "h-8 rounded-3",
        "aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
