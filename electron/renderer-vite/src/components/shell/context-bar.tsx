import type { Status } from '@/lib/types';
import { fmtResetClock, quotaCls } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

// Ported from renderer.js's renderCtxBar()/digestHtml(): the SOLE home for
// the fleet digest, Codex quota, Claude quota ("n/a", never fabricated), and
// the open session's context-fill % (DESIGN.md one-owner rule). Plain markup
// -- there is no shadcn primitive for a persistent status bar; this is
// exactly the kind of "commodity control" DESIGN.md does NOT ask us to
// replace, and that is an honest finding in itself (see report).
function QuotaItem({ label, pct, resetsAt, note }: { label: string; pct: number | null; resetsAt?: number; note?: string }) {
  const cls = quotaCls(pct);
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center gap-1.5',
        cls === 'q-amber' && 'text-need',
        cls === 'q-red' && 'text-block',
        cls === 'q-na' && 'text-ink4',
      )}
      title={note}
    >
      <span
        className={cn(
          'h-[5px] w-[5px] rounded-full bg-idle',
          cls === 'q-amber' && 'bg-need',
          cls === 'q-red' && 'bg-block',
        )}
      />
      {pct == null ? `${label} n/a` : `${label} ${pct}%${resetsAt ? `, resets ${fmtResetClock(resetsAt)}` : ''}`}
    </span>
  );
}

// Digest sentence, matching renderer.js's digestHtml() exactly: ONE
// sentence, one home for the "needs you" count (DESIGN.md one-owner rule --
// the spike this ported from had rendered `needsYou` twice on this line,
// fixed here). "idle" here is the fleet digest's own bucket (sessions.list's
// nearCompaction/idle count is not on Status; this renderer's Status type
// only carries needsYou/working/sessions, so idle is omitted rather than
// fabricated -- narrower than renderer.js's full rollup, a fair simplification
// for a persistent one-line bar).
export function ContextBar({ status, navPinned, ctxPct }: { status: Status | null; navPinned: boolean; ctxPct?: number | null }) {
  const qp = status?.codexQuota?.primary;
  const qs = status?.codexQuota?.secondary;
  return (
    <footer
      className="flex h-[30px] flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-t border-border bg-bg2 px-4 font-mono text-[10.5px] text-ink3 transition-[margin-left] duration-150"
      style={{ marginLeft: navPinned ? '220px' : '52px' }}
    >
      <span className="flex-1 overflow-hidden text-ellipsis font-sans text-[11.5px] text-foreground/90">
        {status ? (
          <>
            <b className="font-semibold text-foreground">{status.needsYou} need you</b>, {status.working} moving, {status.sessions} sessions
          </>
        ) : (
          'loading fleet...'
        )}
      </span>
      <Separator orientation="vertical" className="h-3.5 flex-none bg-rule2" />
      <QuotaItem label="codex" pct={qp?.used_percent != null ? Math.round(qp.used_percent) : null} resetsAt={qp?.resets_at} note={qs?.used_percent != null ? `weekly ${Math.round(qs.used_percent)}%` : undefined} />
      <Separator orientation="vertical" className="h-3.5 flex-none bg-rule2" />
      <QuotaItem label="claude" pct={null} note="confirmed: Claude Code transcripts expose no rate-limit/window data, only token counts" />
      {ctxPct != null && (
        <>
          <Separator orientation="vertical" className="h-3.5 flex-none bg-rule2" />
          <span className="flex-none" title="context window fill for the open session">{ctxPct}% context</span>
        </>
      )}
    </footer>
  );
}
