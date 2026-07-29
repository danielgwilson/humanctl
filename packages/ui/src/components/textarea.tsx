import type { ComponentProps } from "react"

import { cn } from "@humanctl/ui/lib/cn"

function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-20 w-full resize-none rounded-[var(--radius-3)] bg-sunken px-2.5 py-2 font-sans text-sm leading-5 text-ink shadow-[var(--elev-ring)] outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 aria-invalid:shadow-[inset_0_0_0_1px_var(--block-contrast)]",
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
