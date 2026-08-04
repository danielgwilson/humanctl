import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@humanctl/ui/lib/cn"

const buttonVariants = cva(
  // Focus is a border-radius-following outline (never clipped by an overflow
  // ancestor, never a solid background-colored gap on a non-page ground).
  // Filled variants get a real accent hover/press instead of a neutral overlay
  // that is invisible on blue. Disabled uses a muted fill + muted ink, never
  // opacity, so the label keeps contrast and the control still reads as one.
  "group/button inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-sans text-sm font-medium tracking-[-0.006em] outline-none transition-[color,background-color,box-shadow] duration-[var(--duration-color)] ease-[var(--ease-enter)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)] disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "rounded-[var(--radius-2)] bg-primary text-primary-foreground hover:bg-[var(--accent-hover)] active:bg-[var(--accent-press)] disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-ink)]",
        neutral:
          "rounded-[var(--radius-2)] bg-surface text-ink shadow-[var(--elev-ring)] hover:bg-[color-mix(in_oklch,var(--surface-1),var(--ink)_5%)] active:bg-[var(--overlay-press)] disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-ink)] disabled:shadow-none",
        ghost:
          "rounded-[var(--radius-2)] text-ink-2 hover:bg-[var(--overlay-hover)] hover:text-ink active:bg-[var(--overlay-press)] disabled:text-[var(--disabled-ink)]",
        destructive:
          "rounded-[var(--radius-2)] bg-destructive text-destructive-foreground hover:bg-[var(--block-hover)] active:bg-[var(--block-press)] disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-ink)]",
      },
      size: {
        sm: "h-[var(--control-sm)] px-2",
        default: "h-[var(--control)] px-2.5",
        icon: "size-[var(--control)] p-0",
        "icon-sm": "size-[var(--control-sm)] p-0",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "default",
    },
  },
)

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

function Button({
  className,
  variant = "neutral",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants, type ButtonProps }
