import type { ComponentProps } from "react"
import type { LucideIcon } from "lucide-react"

// The one choke point for every lucide glyph in the app (docs/design-system.md
// P9 + section 3.4): 14px by default, `size="sm"` at 12px for a glyph inside a
// 20px chip or badge -- the only two sizes permitted, no third. A bare
// `lucide-react` import anywhere else in components/ or views/ is the pattern
// this file exists to replace.
//
// The 1px stroke is set twice on purpose: once here (`strokeWidth={1}`, so a
// call site never has to remember it) and once globally (`svg.lucide {
// stroke-width: 1; }` in globals.css), so it holds even for the rare lucide
// render that still bypasses this wrapper. Size cannot be a single blanket
// CSS rule the same way, since two sizes are legal, so this component is the
// mechanism for that half.
const ICON_PX = {
  default: 14,
  sm: 12,
} as const

export interface IconProps extends Omit<ComponentProps<"svg">, "ref"> {
  icon: LucideIcon
  size?: keyof typeof ICON_PX
}

export function Icon({ icon: Glyph, size = "default", ...props }: IconProps) {
  return <Glyph size={ICON_PX[size]} strokeWidth={1} {...props} />
}
