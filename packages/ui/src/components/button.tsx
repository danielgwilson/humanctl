import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@humanctl/ui/lib/cn"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap font-sans text-[13px] font-medium outline-none transition-[color,background-color,box-shadow,transform] duration-[var(--duration-color)] ease-[var(--ease-enter)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:not-aria-[haspopup]:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "rounded-[var(--radius-2)] bg-primary text-primary-foreground before:absolute before:inset-0 before:rounded-[inherit] hover:before:bg-[var(--overlay-hover)] active:before:bg-[var(--overlay-press)]",
        neutral:
          "rounded-[var(--radius-2)] bg-surface text-ink shadow-[var(--elev-ring)] hover:bg-[color-mix(in_oklch,var(--surface-1),var(--ink)_4%)] active:bg-[color-mix(in_oklch,var(--surface-1),black_8%)]",
        ghost:
          "rounded-[var(--radius-2)] text-ink-2 hover:bg-[var(--overlay-hover)] hover:text-ink active:bg-[var(--overlay-press)]",
        destructive:
          "rounded-[var(--radius-2)] bg-destructive text-destructive-foreground before:absolute before:inset-0 before:rounded-[inherit] hover:before:bg-[var(--overlay-hover)] active:before:bg-[var(--overlay-press)]",
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
