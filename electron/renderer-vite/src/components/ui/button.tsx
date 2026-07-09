import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Theme-agnostic against the humanctl tokens (globals.css flips every
// --color-* value between :root and .light). The app themes by toggling a
// `.light` class on <html> -- dark is the DEFAULT with no `.dark` ancestor,
// so stock shadcn's `dark:` utilities silently never fired. Every `dark:`
// prefix is dropped; the CSS vars already carry the theme swap.
//
// Stage 5 (#71) item 2: nine variants collapse to five, six heights collapse
// to three, and radius is a function of height (docs/design-system.md
// section 6): "Button | variant: primary (iris solid, on-solid, one per
// screen region) / default (hairline ring, transparent, ink) / quiet (no
// ring, --ink-3) / danger (block solid) / danger-quiet. size: sm 20px/r6,
// md 28px/r8 (default), lg 32px/r10." The old `outline`, `done`, and
// `accent-outline` variants -- a neutral ring and two COLOURED rings (done-
// hue, iris-hue) used interchangeably for "ask" actions -- all collapse onto
// the one neutral `default` ring: section 6's five-variant table has no room
// left for a per-hue outline dialect, and P2's colour-has-four-jobs rule
// does not list "which affirmative action this is" as one of them. This is
// the literal mechanism behind the acceptance test named in the issue: the
// session-detail "Ask" composer button (previously `variant="done"`) and the
// chief-of-staff "Ask" button (previously `variant="accent-outline"`) both
// become `variant="primary"` (the composer's own primary submit action, a
// distinct screen region from any other primary fill on the same view) and
// therefore render identically -- same fill, same height, same radius, same
// press -- with no special-casing required to make them match. `secondary`
// and `link` (unused anywhere in this app; grep confirmed) are dropped
// outright rather than folded into a nearby variant that would misrepresent
// them.
//
// Icon-only sizing (`icon`/`icon-xs`/`icon-sm`/`icon-lg`) is deleted
// entirely: that role now belongs to the dedicated `IconButton` primitive
// (icon-button.tsx, issue #71 item 1), so Button itself never needs
// has-[>svg] padding compensation again.
//
// Press transform (section 5): "Press is transform: var(--motion-press)
// over --motion-fast... Every interactive control has one." `translate-y-px`
// is Tailwind's static 1px utility (not a bracketed arbitrary length), so it
// satisfies the no-arbitrary-length lint rule while matching
// --motion-press's translateY(1px) exactly. It composes with
// `wash-press`/`ring-wash-press` (box-shadow, a different property) with no
// conflict.
const buttonVariants = cva(
  // No `focus-visible:` ring/outline override here (section 7 forbids
  // `outline-none` in a cva base string): the one global :focus-visible
  // rule in globals.css already renders every button's focus ring.
  // Section 6: "Label is row" for every Button size -- the three size
  // variants below differ only in box height/padding/radius, never in font
  // size.
  "inline-flex shrink-0 items-center justify-center font-mono text-row whitespace-nowrap transition-all active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-iris-solid text-on-solid hover:wash-hover active:wash-press",
        // `ring-wash-hover`/`ring-wash-press`, not the plain `wash-*` pair:
        // this variant's `hairline` ring and its hover/press wash both
        // paint via box-shadow, and two classes writing the same property
        // would let hover's higher-specificity rule silently blank the
        // ring out from under it -- see globals.css's comment on these two
        // utilities.
        default: "hairline bg-transparent text-ink hover:ring-wash-hover active:ring-wash-press",
        quiet: "bg-transparent text-ink-3 hover:wash-hover hover:text-ink active:wash-press",
        danger: "bg-block-solid text-on-solid hover:wash-hover active:wash-press",
        "danger-quiet": "bg-transparent text-block-contrast hover:wash-hover active:wash-press",
      },
      size: {
        sm: "h-5 gap-1 rounded-1 px-2",
        md: "h-7 gap-1.5 rounded-2 px-3",
        lg: "h-8 gap-2 rounded-3 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "md",
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
