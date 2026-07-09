import { useMemo } from 'react';
import { Command } from 'lucide-react';
import { ViewHeader } from '@/components/shell/view-header';
import { Progress, type progressIndicatorVariants } from '@/components/ui/progress';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { STATE_META } from '@/lib/format';
import type { Harness, SessionRow, SessionState, Status, Tier } from '@/lib/types';
import type { VariantProps } from 'class-variance-authority';

// Fleet is the SOLE home for "fleet shape" (DESIGN.md: "this view will add
// the shape of the fleet, not a second list"; the complete row-per-session
// list is Sessions' exclusive signal). This ships the flat overview (state /
// harness / tier breakdowns, one headline) -- the live force-directed graph
// of session relationships is a deliberate, called-out follow-up, not
// attempted here.
//
// Declared one-owner EXCEPTION: the headline row below (needs-you / moving /
// total) restates the exact same three numbers the bottom context bar always
// shows (DESIGN.md's stated sole home for the fleet digest). It reads from
// the SAME `status` object as the context bar, not a re-derivation that could
// drift, and is presented as three stat tiles (the fleet's own headline
// framing) rather than the context bar's one-sentence digest. This mirrors
// DESIGN.md's existing pattern for the Codex-quota exception (Metrics owns
// quota in detail; the context bar also shows it) and should be added to
// DESIGN.md's signal-ownership table alongside that one.

type ProgressIndicator = NonNullable<VariantProps<typeof progressIndicatorVariants>['indicator']>;

const STATE_ORDER: SessionState[] = ['need', 'block', 'work', 'idle', 'done'];
const HARNESS_ORDER: Harness[] = ['claude-code', 'codex'];
const TIER_ORDER: Tier[] = ['hot', 'drifting', 'archived'];
const TIER_LABEL: Record<Tier, string> = { hot: 'hot (recent)', drifting: 'drifting', archived: 'archived' };
// Tier (hot/drifting/archived) has no hue of its own in
// docs/design-system.md section 1.6's table -- it is an activity-recency
// axis, not a session state or a harness, so it is never a state hue or a
// series hue (section 1.6: "A state hue and a series hue never appear in
// one figure"). Stage 2 (#68) replaces the old ad hoc `iris`/`ink3`/`rule2`
// mix (an invented, un-owned "fake intensity" ramp using the identity hue
// for emphasis, which P2 forbids -- iris signals identity/selection/focus,
// nothing else) with a genuine ink-alpha intensity ladder: P1, "Hierarchy
// is carried by ink alpha."
const TIER_INDICATOR: Record<Tier, ProgressIndicator> = { hot: 'ink2', drifting: 'ink3', archived: 'ink4' };
const HARNESS_LABEL: Record<Harness, string> = { 'claude-code': 'claude', codex: 'codex' };
// By-harness is a chart-series figure, not a state figure (section 1.6),
// so its colour comes from the series pair, never a vendor-named hue --
// see components/ui/progress.tsx's header comment for where `claude`/
// `codex` are repointed onto `--series-1`/`--series-2`.
const HARNESS_INDICATOR: Record<Harness, ProgressIndicator> = { 'claude-code': 'claude', codex: 'codex' };
const STATE_INDICATOR: Record<SessionState, ProgressIndicator> = { need: 'need', block: 'block', work: 'work', idle: 'idle', done: 'done' };

function CountBar({ label, count, total, indicator }: { label: string; count: number; total: number; indicator: ProgressIndicator }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-6 py-1.5">
      <span className="w-28 flex-none truncate font-mono text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
      <Progress value={pct} indicator={indicator} aria-label={`${label}: ${count} of ${total}`} className="flex-1" />
      <span className="w-8 flex-none text-right font-mono text-[11px] text-ink-3">{count}</span>
    </div>
  );
}

function HeadlineTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 py-4">
      <span className="font-mono text-[28px] font-semibold leading-none text-ink">{value}</span>
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink-4">{label}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-6 pb-1 pt-5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink-4">{children}</div>;
}

export function FleetView({ rows, status }: { rows: SessionRow[]; status: Status | null }) {
  const total = rows.length;

  const byState = useMemo(() => {
    const counts: Record<SessionState, number> = { need: 0, block: 0, work: 0, idle: 0, done: 0 };
    for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
    return counts;
  }, [rows]);

  const byHarness = useMemo(() => {
    const counts: Record<Harness, number> = { 'claude-code': 0, codex: 0 };
    for (const r of rows) counts[r.harness] = (counts[r.harness] || 0) + 1;
    return counts;
  }, [rows]);

  const byTier = useMemo(() => {
    const counts: Record<Tier, number> = { hot: 0, drifting: 0, archived: 0 };
    for (const r of rows) counts[r.tier] = (counts[r.tier] || 0) + 1;
    return counts;
  }, [rows]);

  const tiles = (
    <div className="flex divide-x divide-hairline border-b border-b-hairline">
      <HeadlineTile value={status?.needsYou ?? 0} label="need you" />
      <HeadlineTile value={status?.working ?? 0} label="moving" />
      <HeadlineTile value={status?.sessions ?? total} label="total" />
    </div>
  );

  const nextNote = (
    <div className="px-6 pt-6 font-mono text-[10px] leading-relaxed text-ink-4">
      next: a live force-directed graph of session relationships. this pass ships the flat shape overview only.
    </div>
  );

  // An empty fleet has nothing to scroll, so it deliberately does NOT go inside
  // a ScrollArea. Radix wraps its viewport children in a `display: table` box,
  // and a percentage/flex height does not resolve against that, so `Empty`
  // (which centers itself with `flex-1`) collapsed from the full pane to a
  // single line of text jammed under the tiles: measured 218px -> 66.5px. A
  // plain flex column gives `Empty` the definite height it needs. Do not
  // "fix" this by moving the height onto viewportClassName; the table box
  // still intervenes.
  if (total === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <ViewHeader icon={Command} title="Fleet" subtitle={`${total} sessions · the fleet's shape`} />
        <div className="flex min-h-0 flex-1 flex-col">
          {tiles}
          <Empty>
            <EmptyDescription className="text-[12.5px]">no sessions in the last 72h.</EmptyDescription>
          </Empty>
          {nextNote}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader icon={Command} title="Fleet" subtitle={`${total} ${total === 1 ? 'session' : 'sessions'} · the fleet's shape`} />
      <ScrollArea className="min-h-0 flex-1" viewportClassName="pb-8">
        {tiles}

        <SectionLabel>By state</SectionLabel>
        <div>
          {STATE_ORDER.map((s) => (
            <CountBar key={s} label={STATE_META[s]?.label || s} count={byState[s]} total={total} indicator={STATE_INDICATOR[s]} />
          ))}
        </div>

        <SectionLabel>By harness</SectionLabel>
        <div>
          {HARNESS_ORDER.map((h) => (
            <CountBar key={h} label={HARNESS_LABEL[h]} count={byHarness[h]} total={total} indicator={HARNESS_INDICATOR[h]} />
          ))}
        </div>

        <SectionLabel>By tier</SectionLabel>
        <div>
          {TIER_ORDER.map((t) => (
            <CountBar key={t} label={TIER_LABEL[t]} count={byTier[t]} total={total} indicator={TIER_INDICATOR[t]} />
          ))}
        </div>

        {nextNote}
      </ScrollArea>
    </div>
  );
}
