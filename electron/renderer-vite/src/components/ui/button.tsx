import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Theme-agnostic against the humanctl tokens (globals.css flips every
// --color-* value between :root and .light). The app themes by toggling a
// `.light` class on <html> -- dark is the DEFAULT with no `.dark` ancestor,
// so stock shadcn's `dark:` utilities (e.g. `dark:border-input
// dark:bg-input/30`) silently never fired and the outline button rendered
// its light-mode fallback even in the primary dark theme. Fixed by dropping
// every `dark:` prefix below; the CSS vars already carry the theme swap.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20",
        outline:
          "border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Primary accent action (session-detail's "Resume in Codex/Claude"),
        // replacing the inline `bg-iris text-primary-foreground
        // hover:brightness-110` one-off className restyle.
        iris: "bg-iris text-primary-foreground hover:brightness-110",
        // "Ask the session" / "Ask the chief of staff" accent-outline
        // actions, replacing two hand-tuned raw <button> treatments
        // (session-detail's `border-done/45 text-done` and cos-drawer's
        // `border-iris-dim text-iris`) with two named cva variants so the
        // "same" button renders identically wherever it's used.
        done: "border border-done/45 bg-transparent text-done hover:bg-done/10",
        "accent-outline": "border border-iris-dim bg-transparent text-iris hover:bg-iris/10",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
