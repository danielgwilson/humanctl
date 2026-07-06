import type { Status } from '@/lib/types';
import { fmtResetClock, quotaCls } from '@/lib/format';
import { cn } from '@/lib/utils';

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

export function ContextBar({ status, navPinned, ctxPct }: { status: Status | null; navPinned: boolean; ctxPct?: number | null }) {
  const qp = status?.codexQuota?.primary;
  const qs = status?.codexQuota?.secondary;
  const digest = status
    ? `${status.needsYou} need you · ${status.working} running · ${status.sessions} sessions`
    : 'loading fleet...';
  return (
    <footer
      className="flex h-[30px] flex-none items-center gap-4 overflow-hidden whitespace-nowrap border-t border-border bg-bg2 px-4 font-mono text-[10.5px] text-ink3 transition-[margin-left] duration-150"
      style={{ marginLeft: navPinned ? '220px' : '52px' }}
    >
      <span className="flex-1 overflow-hidden text-ellipsis font-sans text-[11.5px] text-foreground/90">
        <b className="font-semibold text-foreground">{status?.needsYou ?? 0}</b> need you · {digest}
      </span>
      <span className="h-3.5 w-px flex-none bg-rule2" />
      <QuotaItem label="codex" pct={qp?.used_percent != null ? Math.round(qp.used_percent) : null} resetsAt={qp?.resets_at} note={qs?.used_percent != null ? `weekly ${Math.round(qs.used_percent)}%` : undefined} />
      <span className="h-3.5 w-px flex-none bg-rule2" />
      <QuotaItem label="claude" pct={null} note="confirmed: Claude Code transcripts expose no rate-limit/window data, only token counts" />
      {ctxPct != null && (
        <>
          <span className="h-3.5 w-px flex-none bg-rule2" />
          <span className="flex-none" title="context window fill for the open session">{ctxPct}% context</span>
        </>
      )}
    </footer>
  );
}
