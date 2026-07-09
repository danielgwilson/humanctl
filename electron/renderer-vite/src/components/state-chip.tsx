import { STATE_META } from '@/lib/format';
import { Chip } from '@/components/ui/chip';
import { cn } from '@/lib/utils';

// Ported from index.html's .chip, now the shared Chip component (built on
// shadcn Badge): one strict color map, STATE_META, drives the variant
// (DESIGN.md: "Colors are semantic and fixed per axis").
export function StateChip({ state, className }: { state: string; className?: string }) {
  const meta = STATE_META[state] || STATE_META.idle;
  return (
    <Chip variant={meta.variant} title={meta.label} className={className}>
      {meta.label}
    </Chip>
  );
}

// Harness identity is conveyed by GLYPH SHAPE, never color or vendor art
// (DESIGN.md; docs/design-system.md section 1.6: "Harness identity is
// conveyed by icon, never by color; a vendor name never enters the token
// layer."). Solid disc = claude, hollow ring = codex; the permanent
// built-in fallback used in fixture mode and whenever runtime icon
// extraction is unavailable (this spike never calls getHarnessIcons, so it
// always renders the neutral glyph -- acceptable for a parity spike; noted
// in the report as a follow-up wire-up for the full port).
//
// Stage 2 (#68) deleted the vendor-named `--color-codex`/`--color-claude`
// tokens (section 1.6 forbids a vendor name in the token layer): this glyph
// used to color itself per-vendor, which was itself the violation the new
// token layer makes impossible to express by accident. Both glyphs now
// inherit `currentColor` like every other icon (section 3.4), so identity
// is carried by shape alone, exactly as the shape choice (solid vs hollow)
// already intended.
export function HarnessGlyph({ harness, className }: { harness: string; className?: string }) {
  const codex = harness === 'codex';
  return (
    <span
      className={cn('font-mono text-[12px] leading-none inline-flex items-center', className)}
      aria-hidden="true"
    >
      {codex ? '◯' : '◉'}
    </span>
  );
}
