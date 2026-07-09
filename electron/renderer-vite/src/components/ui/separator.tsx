import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Stage 5 (#71) item 8: docs/design-system.md section 6's Separator row --
// "orientation plus inset... The inset prop is the whole point" -- and
// section 3.6: "A rule inside a bounded container is inset by that
// container's horizontal padding, so a divider always terminates at the
// same x as the content it divides. A rule that marks the end of chrome is
// full-bleed... That distinction is the entire API of Separator." `inset`
// applies the pane-gutter margin (mx-6, matching Item's own default
// horizontal padding) on a horizontal rule; full-bleed (the default) is
// unchanged so every existing call site -- the six enumerated rule sites in
// 3.6, none of which are inset -- keeps its current geometry.
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  inset = false,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root> & { inset?: boolean }) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      data-inset={inset}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-hairline data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        // `w-full` + a plain `mx-6` would overflow the container by 2x the
        // gutter (100% width plus outward margin on both sides) -- the two
        // chained data-attribute selectors here (both already set on this
        // element) out-specificity the single-attribute `w-full` rule above,
        // so `width:auto` correctly wins and the block naturally fills only
        // the space its own margins leave, exactly like `Item`'s own
        // padding does.
        inset && "data-[inset=true]:data-[orientation=horizontal]:mx-6 data-[inset=true]:data-[orientation=horizontal]:w-auto",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
