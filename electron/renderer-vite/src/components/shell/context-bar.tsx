import type { ClaudeQuota, Status } from '@/lib/types';
import { fmtResetClock, quotaCls } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dot, type Hue } from '@/components/ui/dot';

const QUOTA_HUE: Record<string, Hue> = { 'q-amber': 'need', 'q-red': 'block', 'q-na': 'idle' };

// The SOLE home for the fleet digest, Codex quota, Claude quota (a real
// percentage now, and still "n/a" rather than a fabricated number whenever the
// CLI cannot answer), and
// the open session's context-fill % (DESIGN.md one-owner rule). Plain markup
// -- there is no shadcn primitive for a persistent status bar; this is
// exactly the kind of "commodity control" DESIGN.md does NOT ask us to
// replace, and that is an honest finding in itself (see report).
//
// The two explanatory hovers below were browser-native `title=` attributes,
// i.e. an OS tooltip, which DESIGN.md's bespoke-controls hardline forbids
// wherever a bespoke one exists ("no native tooltip where a bespoke one
// already exists"). They are now the same Radix `Tooltip` primitive
// shell/header.tsx already uses one level up. The truncated-text `title=`
// hints on virtualized list rows (thread-row, sessions-view, metrics-view,
// session-detail) are deliberately left alone: those are overflow hints on
// high-frequency-render rows, where mounting a Radix Tooltip per row would
// add real per-row cost for no bespoke-chrome gain.
function QuotaItem({ label, pct, resetsAt, note }: { label: string; pct: number | null; resetsAt?: number; note?: string }) {
  const cls = quotaCls(pct);
  const body = (
    <span
      data-numeric
      className={cn(
        'inline-flex flex-none items-center gap-1.5',
        cls === 'q-amber' && 'text-need-contrast',
        cls === 'q-red' && 'text-block-contrast',
        cls === 'q-na' && 'text-ink-4',
      )}
    >
      <Dot hue={QUOTA_HUE[cls] ?? 'idle'} />
      {pct == null ? `${label} n/a` : `${label} ${pct}%${resetsAt ? `, resets ${fmtResetClock(resetsAt)}` : ''}`}
    </span>
  );
  // Codex's secondary (weekly) window is absent on plenty of fleets; with no
  // note there is nothing to explain, so no tooltip is mounted at all.
  if (!note) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  );
}

// Digest sentence: ONE sentence, one home for the "needs you" count
// (DESIGN.md one-owner rule). "idle" here is the fleet digest's own bucket
// (sessions.list's nearCompaction/idle count is not on Status; this
// renderer's Status type only carries needsYou/working/sessions, so idle is
// omitted rather than fabricated).
//
// STAGE 2B: this footer now renders full-width WITHIN SidebarInset (right
// of the full-height sidebar), so it no longer needs its own
// navPinned-driven marginLeft shift -- SidebarInset's flex layout owns that
// offset for every row in the inset column, header included.
export function ContextBar({ status, claudeQuota, ctxPct }: { status: Status | null; claudeQuota?: ClaudeQuota | null; ctxPct?: number | null }) {
  const qp = status?.codexQuota?.primary;
  const qs = status?.codexQuota?.secondary;
  // The bar shows ONE Claude percentage: the first window the CLI reports (the
  // session window). Metrics owns every window in detail, so the bar does not
  // grow a second digest -- the remaining windows and the verbatim reset text
  // live in this item's tooltip, exactly as Codex's weekly window already does.
  // Keeping the reset text out of the bar itself matters: Claude's is a full
  // locale string ("Jul 13 at 2am (America/Los_Angeles)"), not Codex's short clock.
  const cq = claudeQuota?.windows[0];
  const cqRest = claudeQuota?.windows.slice(1) ?? [];
  const claudeNote = cq
    ? [
        `${String(cq.label ?? 'current window').toLowerCase()}${cq.resets_at_text ? `, resets ${cq.resets_at_text}` : ''}`,
        ...cqRest.map((w) => `${String(w.label ?? 'window').toLowerCase()} ${Math.round(w.used_percent)}%`),
      ].join(' · ')
    : 'requires a signed-in Claude subscription; read from the Claude Code CLI, never from transcripts';
  return (
    <footer
      // eslint-disable-next-line design-system/no-arbitrary-length -- stage 6 (#72) item 1: "Band height is one number" -- this footer band's 30px is one more value that item unifies against --band-top/--band-toolbar. Zero-visual-delta this stage.
      className="flex h-[30px] flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-t border-t-hairline bg-surface-0 px-4 font-mono text-micro text-ink-3"
    >
      {/* The fleet digest sentence reads as language addressed to the human
          (already sans before this stage); font-semibold on "need you" is
          demoted per section 7 (illegal outside title/label) with no
          substitute signal added -- a restyle, not a new emphasis. */}
      <span className="flex-1 overflow-hidden text-ellipsis font-sans text-prose text-ink/90" data-numeric>
        {status ? (
          <>
            {status.needsYou} need you, {status.working} moving, {status.sessions} sessions
          </>
        ) : (
          'loading fleet...'
        )}
      </span>
      <Separator orientation="vertical" className="h-3.5 flex-none bg-hairline" />
      <QuotaItem label="codex" pct={qp?.used_percent != null ? Math.round(qp.used_percent) : null} resetsAt={qp?.resets_at} note={qs?.used_percent != null ? `weekly ${Math.round(qs.used_percent)}%` : undefined} />
      <Separator orientation="vertical" className="h-3.5 flex-none bg-hairline" />
      <QuotaItem label="claude" pct={cq ? Math.round(cq.used_percent) : null} note={claudeNote} />
      {ctxPct != null && (
        <>
          <Separator orientation="vertical" className="h-3.5 flex-none bg-hairline" />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex-none" data-numeric>{ctxPct}% context</span>
            </TooltipTrigger>
            <TooltipContent>context window fill for the open session</TooltipContent>
          </Tooltip>
        </>
      )}
    </footer>
  );
}
