import { STATE_META } from '@/lib/format';
import { cn } from '@/lib/utils';

// Ported from index.html's .chip: one shared chip component, one strict
// color map (DESIGN.md: "Colors are semantic and fixed per axis").
export function StateChip({ state, className }: { state: string; className?: string }) {
  const meta = STATE_META[state] || STATE_META.idle;
  return (
    <span className={cn('hc-chip', meta.cls, className)} title={meta.label}>
      <span className="dt" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

// Harness identity is conveyed by GLYPH SHAPE, never color or vendor art
// (DESIGN.md). Solid disc = claude, hollow ring = codex; the permanent
// built-in fallback used in fixture mode and whenever runtime icon
// extraction is unavailable (this spike never calls getHarnessIcons, so it
// always renders the neutral glyph -- acceptable for a parity spike; noted
// in the report as a follow-up wire-up for the full port).
export function HarnessGlyph({ harness, className }: { harness: string; className?: string }) {
  const codex = harness === 'codex';
  return (
    <span
      className={cn('font-mono text-[12px] leading-none inline-flex items-center', codex ? 'text-codex' : 'text-claude', className)}
      aria-hidden="true"
    >
      {codex ? '◯' : '◉'}
    </span>
  );
}
