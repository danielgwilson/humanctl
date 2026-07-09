import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Stage 2 (#68): retargeted onto the new token bridge (see button.tsx's
// header comment for the shared reasoning -- every variant uses
// `wash-hover`/`wash-press`, the box-shadow overlay, never a plain
// `hover:bg-*` background-color swap). No `dark:` variants (section 7): the
// app themes via a `.light` class on `<html>`, so `dark:` can never fire.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-iris-solid text-on-solid [a&]:hover:wash-hover",
        secondary:
          "bg-surface-2 text-ink [a&]:hover:wash-hover",
        destructive:
          "bg-block-solid text-on-solid [a&]:hover:wash-hover",
        outline:
          "hairline text-ink [a&]:hover:ring-wash-hover",
        ghost: "[a&]:hover:wash-hover",
        link: "text-iris-contrast underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
