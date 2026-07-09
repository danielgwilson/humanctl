import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

// The ONE small-labeled-pill component for the whole app, built on shadcn's
// Badge. Consolidates three prior dialects -- the .hc-chip CSS class
// (globals.css, retired), ~12 raw
// `font-mono text-[9px] uppercase tracking-wider text-<hue>` spans in
// session-detail.tsx, and Badge itself sitting unused -- into one component
// with one set of cva variants.
//
// Stage 2 (#68): retargeted from a runtime `color-mix` recipe (15% hue
// background, 78%-toward-ink text, 23% hue border) onto the pre-computed
// `--<hue>-soft`/`--<hue>-contrast` pair directly (docs/design-system.md
// section 6: "Chip | variant: state (soft bg, contrast ink, 6px contrast
// dot, micro, sentence case)"). Section 10 pins the compositing model
// precisely so the checker and the renderer cannot disagree, which a
// per-component color-mix escape hatch would defeat -- the soft/contrast
// pair IS the one authoritative tinted-chip recipe, verified once by
// tokens:check, not re-derived per call site. No border any more (dropped
// from the base below and from `variant="outline"` -> `variant="ghost"` on
// the underlying Badge): section 6 does not call for a ring on a state
// chip, only the soft fill + contrast text + contrast dot.
const HUE_SOFT: Record<string, string> = {
  work: "var(--work-soft)",
  need: "var(--need-soft)",
  block: "var(--block-soft)",
  idle: "var(--idle-soft)",
  done: "var(--done-soft)",
  fyi: "var(--idle-soft)",
  review: "var(--need-soft)",
};
const HUE_CONTRAST: Record<string, string> = {
  work: "var(--work-contrast)",
  need: "var(--need-contrast)",
  block: "var(--block-contrast)",
  idle: "var(--idle-contrast)",
  done: "var(--done-contrast)",
  fyi: "var(--idle-contrast)",
  review: "var(--need-contrast)",
};

const chipVariants = cva(
  // eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71): Chip primitive rewrite ("twelve variants to two") owns this radius; not on the current radius scale (--radius-xs/sm/md/lg), so no token exists to swap to without inventing one outside this stage's 12.
  "font-mono uppercase tracking-wider whitespace-nowrap rounded-[5px]",
  {
    variants: {
      variant: {
        // session states + note levels (fyi/review/blocked/done): dot +
        // pill, hue driven by the soft/contrast CSS vars set inline below.
        work: "",
        need: "",
        block: "",
        idle: "",
        done: "",
        fyi: "",
        review: "",
        // mono section/stream-tag label, no dot, no pill chrome -- replaces
        // the raw uppercase mono spans (item.level, "asks you",
        // "interrupted", "AI summary", "Conversation", "Ask the session").
        // No font-semibold (section 7: illegal outside title/label, and
        // section 6 assigns Chip's `meta` variant to `micro`, not `label`,
        // "and nothing else"); the hue-contrast colour already carries the
        // demotion/emphasis signal (P2).
        label: "bg-transparent p-0 text-ink-3",
        "label-iris": "bg-transparent p-0 text-iris-contrast",
        "label-need": "bg-transparent p-0 text-need-contrast",
        "label-block": "bg-transparent p-0 text-block-contrast",
        "label-done": "bg-transparent p-0 text-done-contrast",
      },
      size: {
        // Section 6: Chip is `micro` for both the `state` and `meta`
        // variants -- `label` (10px/600/uppercase) is reserved for section
        // labels "and nothing else". Case (uppercase, from the base cva
        // below) is UNCHANGED this stage: docs/design-system.md 2.3 already
        // calls for sentence case here, but issue #69's own Changes list
        // does not enumerate a chip-case pass, so it stays deferred rather
        // than bundled into a type-role PR uninvited.
        // eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71): Chip primitive rewrite owns this geometry; a zero-visual-delta stage can't invent replacement values without changing the chip's rendered size.
        chip: "gap-[5px] px-[7px] py-[2px] font-mono text-micro",
        label: "gap-1 font-mono text-micro",
      },
    },
    defaultVariants: {
      variant: "idle",
      size: "chip",
    },
  }
)

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
  const soft = HUE_SOFT[String(variant ?? "idle")];
  const contrast = HUE_CONTRAST[String(variant ?? "idle")];
  // `dot` was accepted, typed, and then silently ignored (the renderer's new
  // no-unused-vars gate caught it). Every existing `dot={false}` call site also
  // passes `size="label"`, which already suppressed the dot, so honoring the
  // prop is a no-op for today's UI and makes the API honest.
  const showDot = dot && !!soft && size !== "label";
  const hueStyle: React.CSSProperties | undefined = soft
    ? { background: soft, color: contrast }
    : undefined;
  return (
    <Badge
      variant="ghost"
      className={cn(chipVariants({ variant, size }), className)}
      style={hueStyle ? { ...hueStyle, ...style } : style}
      {...props}
    >
      {/* eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71) item 1 names a new "Dot" primitive with no call sites yet; this is exactly the ad-hoc dot it replaces. */}
      {showDot && <span className="h-[5px] w-[5px] flex-none rounded-full bg-current" aria-hidden="true" />}
      {children}
    </Badge>
  )
}

export { chipVariants }
