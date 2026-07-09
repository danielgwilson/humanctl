import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Icon, type IconProps } from "@/components/ui/icon"

// New primitive (docs/design-system.md section 6, issue #71 item 1):
// "IconButton | size: sm 20 / md 28 / lg 32. Glyph always 14px. No ring at
// rest. Ring appears only when it holds a value or is toggled on." Radius
// follows the same control-height table Button's sizes resolve to (section
// 3.2). Replaces header.tsx's two hand-rolled `Button variant="ghost"
// size="icon" className="h-7 w-7 ..."` toggle buttons (which forced a
// NEUTRAL hairline ring at rest, contradicting "no ring at rest" -- fixed
// here, not carried forward) and sessions-view.tsx's pin toggle
// (`size="icon-xs"`, one of the Button icon sizes this stage deletes
// outright since IconButton is now the one icon-only-button primitive).
//
// No `active:translate-y-px` complication for the ring: the ring and the
// press wash are both box-shadow (P3/P4), so they compose in one property
// list exactly like Button's `default` variant.
const iconButtonVariants = cva(
  "inline-flex flex-none items-center justify-center text-ink-4 transition-all hover:wash-hover hover:text-ink-2 active:wash-press active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)]",
  {
    variants: {
      size: {
        sm: "size-5 rounded-1",
        md: "size-7 rounded-2",
        lg: "size-8 rounded-3",
      },
      active: {
        true: "shadow-[inset_0_0_0_var(--hairline-w)_var(--iris-contrast)] text-iris-contrast hover:text-iris-contrast",
        false: "",
      },
    },
    defaultVariants: { size: "md", active: false },
  }
)

export function IconButton({
  icon,
  size = "md",
  active = false,
  className,
  iconProps,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof iconButtonVariants> & {
    icon: LucideIcon
    iconProps?: Omit<IconProps, "icon">
  }) {
  return (
    <button
      type="button"
      data-slot="icon-button"
      data-size={size}
      data-active={active}
      className={cn(iconButtonVariants({ size, active }), className)}
      {...props}
    >
      <Icon icon={icon} aria-hidden="true" {...iconProps} />
    </button>
  )
}

export { iconButtonVariants }
