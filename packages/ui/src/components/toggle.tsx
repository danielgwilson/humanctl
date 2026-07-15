import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@humanctl/ui/lib/cn"

const toggleVariants = cva(
  "inline-flex select-none items-center justify-center gap-1.5 rounded-[var(--radius-2)] font-sans text-[13px] text-ink-2 outline-none transition-[color,background-color,box-shadow] duration-[var(--duration-color)] hover:bg-[var(--overlay-hover)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 data-[pressed]:bg-[var(--overlay-selected)] data-[pressed]:text-ink [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "",
        outline: "bg-surface shadow-[var(--elev-ring)]",
      },
      size: {
        sm: "h-[var(--control-sm)] min-w-[var(--control-sm)] px-2",
        default: "h-[var(--control)] min-w-[var(--control)] px-2.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

type ToggleProps = TogglePrimitive.Props & VariantProps<typeof toggleVariants>

function Toggle({ className, variant = "default", size = "default", ...props }: ToggleProps) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Toggle, toggleVariants, type ToggleProps }
