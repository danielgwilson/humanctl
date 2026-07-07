import { useMemo } from 'react';
import { Command } from 'lucide-react';
import { ViewHeader } from '@/components/shell/view-header';
import { STATE_META } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Harness, SessionRow, SessionState, Status, Tier } from '@/lib/types';

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

const STATE_ORDER: SessionState[] = ['need', 'block', 'work', 'idle', 'done'];
const HARNESS_ORDER: Harness[] = ['claude-code', 'codex'];
const TIER_ORDER: Tier[] = ['hot', 'drifting', 'archived'];
const TIER_LABEL: Record<Tier, string> = { hot: 'hot (recent)', drifting: 'drifting', archived: 'archived' };
const TIER_BAR_CLASS: Record<Tier, string> = { hot: 'bg-iris', drifting: 'bg-ink3', archived: 'bg-rule2' };
const HARNESS_LABEL: Record<Harness, string> = { 'claude-code': 'claude', codex: 'codex' };
const HARNESS_BAR_CLASS: Record<Harness, string> = { 'claude-code': 'bg-claude', codex: 'bg-codex' };
const STATE_BAR_CLASS: Record<SessionState, string> = { need: 'bg-need', block: 'bg-block', work: 'bg-work', idle: 'bg-idle', done: 'bg-done' };

function CountBar({ label, count, total, barClass }: { label: string; count: number; total: number; barClass: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 px-6 py-1.5">
      <span className="w-28 flex-none truncate font-mono text-[10px] uppercase tracking-wider text-ink3">{label}</span>
      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-panel2">
        <div className={cn('h-full rounded-full', barClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 flex-none text-right font-mono text-[11px] text-ink3">{count}</span>
    </div>
  );
}

function HeadlineTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 py-4">
      <span className="font-mono text-[28px] font-semibold leading-none text-foreground">{value}</span>
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink4">{label}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-6 pb-1 pt-5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink4">{children}</div>;
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader icon={Command} title="Fleet" subtitle={`${total} ${total === 1 ? 'session' : 'sessions'} · the fleet's shape`} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <div className="flex divide-x divide-border border-b border-border">
          <HeadlineTile value={status?.needsYou ?? 0} label="need you" />
          <HeadlineTile value={status?.working ?? 0} label="moving" />
          <HeadlineTile value={status?.sessions ?? total} label="total" />
        </div>

        {total === 0 ? (
          <div className="p-12 text-center text-[12.5px] text-ink3">no sessions in the last 72h.</div>
        ) : (
          <>
            <SectionLabel>By state</SectionLabel>
            <div>
              {STATE_ORDER.map((s) => (
                <CountBar key={s} label={STATE_META[s]?.label || s} count={byState[s]} total={total} barClass={STATE_BAR_CLASS[s]} />
              ))}
            </div>

            <SectionLabel>By harness</SectionLabel>
            <div>
              {HARNESS_ORDER.map((h) => (
                <CountBar key={h} label={HARNESS_LABEL[h]} count={byHarness[h]} total={total} barClass={HARNESS_BAR_CLASS[h]} />
              ))}
            </div>

            <SectionLabel>By tier</SectionLabel>
            <div>
              {TIER_ORDER.map((t) => (
                <CountBar key={t} label={TIER_LABEL[t]} count={byTier[t]} total={total} barClass={TIER_BAR_CLASS[t]} />
              ))}
            </div>
          </>
        )}

        <div className="px-6 pt-6 font-mono text-[10px] leading-relaxed text-ink4">
          next: a live force-directed graph of session relationships. this pass ships the flat shape overview only.
        </div>
      </div>
    </div>
  );
}
