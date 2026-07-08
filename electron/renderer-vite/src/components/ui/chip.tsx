import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

// The ONE small-labeled-pill component for the whole app, built on shadcn's
// Badge (installed, previously dead code). Consolidates three prior dialects
// -- the .hc-chip CSS class (globals.css), ~12 raw
// `font-mono text-[9px] uppercase tracking-wider text-<hue>` spans in
// session-detail.tsx, and Badge itself sitting unused -- into one component
// with one set of cva variants. Pixel-identical to the old .hc-chip look:
// same color-mix recipe (15% hue background, 78%-toward-ink text, 23% hue
// border), same size/type. DESIGN.md: "Colors are semantic and fixed per
// axis" -- the hue-per-variant map below is exactly that map, driven by one
// `--c` CSS var per variant so the color-mix math lives in one place.
const HUE_VAR: Record<string, string> = {
  work: "var(--s-work)",
  need: "var(--s-need)",
  block: "var(--s-block)",
  idle: "var(--s-idle)",
  done: "var(--s-done)",
  fyi: "var(--s-idle)",
  review: "var(--s-need)",
};

const chipVariants = cva(
  "font-mono uppercase tracking-wider whitespace-nowrap rounded-[5px] border",
  {
    variants: {
      variant: {
        // session states + note levels (fyi/review/blocked/done): dot +
        // pill, hue driven by the --c var set inline per variant below.
        work: "",
        need: "",
        block: "",
        idle: "",
        done: "",
        fyi: "",
        review: "",
        // mono section/stream-tag label, no dot, no pill chrome -- replaces
        // the raw uppercase mono spans (item.level, "asks you",
        // "interrupted", "AI summary", "Conversation", "Ask the session")
        label: "border-transparent bg-transparent p-0 font-semibold text-ink3",
        "label-iris": "border-transparent bg-transparent p-0 font-semibold text-iris",
        "label-need": "border-transparent bg-transparent p-0 font-semibold text-need",
        "label-block": "border-transparent bg-transparent p-0 font-semibold text-block",
        "label-done": "border-transparent bg-transparent p-0 font-semibold text-done",
      },
      size: {
        // matches .hc-chip exactly: 10px/500/0.02em, 2px 7px padding, 5px gap
        chip: "gap-[5px] px-[7px] py-[2px] text-[10px] font-medium leading-[1.4]",
        // matches the raw label spans: 9px/600/wider tracking, no padding
        label: "gap-1 text-[9px] font-semibold tracking-wider",
      },
    },
    defaultVariants: {
      variant: "idle",
      size: "chip",
    },
  }
)

const HUE_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--c) 15%, transparent)",
  color: "color-mix(in srgb, var(--c) 78%, var(--ink))",
  borderColor: "color-mix(in srgb, var(--c) 23%, transparent)",
};

export function Chip({
  variant,
  size,
  className,
  style,
  children,
  dot = true,
  ...props
}: Omit<React.ComponentProps<typeof Badge>, "variant"> &
  VariantProps<typeof chipVariants> & { dot?: boolean }) {
  const hue = HUE_VAR[String(variant ?? "idle")];
  // `dot` was accepted, typed, and then silently ignored (the renderer's new
  // no-unused-vars gate caught it). Every existing `dot={false}` call site also
  // passes `size="label"`, which already suppressed the dot, so honoring the
  // prop is a no-op for today's UI and makes the API honest.
  const showDot = dot && !!hue && size !== "label";
  return (
    <Badge
      variant="outline"
      className={cn(chipVariants({ variant, size }), className)}
      style={hue ? ({ ...HUE_STYLE, "--c": hue, ...style } as React.CSSProperties) : style}
      {...props}
    >
      {showDot && <span className="h-[5px] w-[5px] flex-none rounded-full bg-current" aria-hidden="true" />}
      {children}
    </Badge>
  )
}

export { chipVariants }
