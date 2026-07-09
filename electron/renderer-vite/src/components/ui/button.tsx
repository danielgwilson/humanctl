import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Theme-agnostic against the humanctl tokens (globals.css flips every
// --color-* value between :root and .light). The app themes by toggling a
// `.light` class on <html> -- dark is the DEFAULT with no `.dark` ancestor,
// so stock shadcn's `dark:` utilities silently never fired. Every `dark:`
// prefix is dropped; the CSS vars already carry the theme swap (section 7:
// "A dark: variant. ... dark: can never fire.").
//
// Stage 2 (#68): `default`/`outline`/`ghost` retarget onto the new token
// bridge (surface-*/ink/hairline/hover/press), never the retired shadcn
// bridge (--primary/--input/--accent/...). `default` and `iris` both read
// as the ONE primary-action fill (P4: hover/press are the `wash-hover`/
// `wash-press` overlay utilities over the iris-solid fill, never a second
// hardcoded hex or a `hover:bg-primary/90` opacity hack -- section 1.5:
// "There is no <hue>-solid-hover"). EVERY variant below, including the
// transparent-resting ones (`outline`/`ghost`/`quiet`-shaped states), uses
// `hover:wash-hover`/`active:wash-press` -- never a plain `hover:bg-hover`
// background-color swap. A plain swap only composes correctly when nothing
// else on the element is also setting background-color; the day a `Button`
// call site adds a `bg-selected` override (as several row/menu primitives
// already do), a plain hover swap would erase it outright, reproducing
// #66's exact bug. `wash-hover`/`wash-press` are box-shadow, a different
// CSS property from background-color, so they compose correctly no matter
// what is painted underneath (see globals.css's comment on them).
const buttonVariants = cva(
  // No `focus-visible:` ring/outline override here (section 7 forbids
  // `outline-none` in a cva base string): the one global :focus-visible
  // rule in globals.css already renders every button's focus ring.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_var(--hairline-w)_var(--block-contrast)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-iris-solid text-on-solid hover:wash-hover active:wash-press",
        destructive:
          "bg-block-solid text-on-solid hover:wash-hover active:wash-press",
        // `ring-wash-hover`/`ring-wash-press`, not the plain `wash-*` pair:
        // this variant's `hairline` ring and its hover/press wash both
        // paint via box-shadow, and two classes writing the same property
        // would let hover's higher-specificity rule silently blank the
        // ring out from under it -- see globals.css's comment on these
        // two variants.
        outline:
          "hairline bg-transparent text-ink hover:ring-wash-hover active:ring-wash-press",
        secondary:
          "bg-surface-2 text-ink hover:wash-hover active:wash-press",
        ghost:
          "hover:wash-hover active:wash-press",
        link: "text-iris-contrast underline-offset-4 hover:underline",
        // Primary accent action (session-detail's "Resume in Codex/Claude"),
        // replacing the inline `bg-iris text-primary-foreground
        // hover:brightness-110` one-off className restyle. Same fill as
        // `default` above -- `iris` is kept as its own named variant (no
        // component API change this stage) rather than folded into
        // `default`, since call sites already select it by name.
        iris: "bg-iris-solid text-on-solid hover:wash-hover active:wash-press",
        // "Ask the session" / "Ask the chief of staff" accent-outline
        // actions: a deliberate COLORED ring (not the neutral hairline), so
        // the ring itself stays the zero-layout-shift inset box-shadow
        // technique (P3) rather than reverting to a literal `border`.
        // `hover:bg-<hue>-soft` uses the tinted-background role (1.5)
        // instead of an invented `/10` opacity fraction.
        done: "shadow-[inset_0_0_0_var(--hairline-w)_var(--done-contrast)] bg-transparent text-done-contrast hover:bg-done-soft",
        "accent-outline": "shadow-[inset_0_0_0_var(--hairline-w)_var(--iris-contrast)] bg-transparent text-iris-contrast hover:bg-iris-soft",
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
