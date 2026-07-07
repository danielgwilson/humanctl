import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Chip } from '@/components/ui/chip';
import { HarnessGlyph, StateChip } from '@/components/state-chip';
import { agoTxt } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InboxThread, SessionRow, ThreadItem } from '@/lib/types';

// The ONE session-detail component family, matching renderer.js's
// renderDetail()/streamItemHtml comment ("the SAME detail component
// rendered into the Inbox's second pane... never a fork"): header (glyph,
// title, state chip, resume action), the notes/asks/qa stream, an AI-summary
// block, and the ask-the-session composer as a sticky footer. `backLabel`
// switches on whether this is the Inbox embedded pane (no back breadcrumb)
// or the full-width session-detail overlay reached from a list (breadcrumb
// present); both render this same tree, never a second component.
//
// The live-timeline "Conversation" reader (session:timeline / the
// session:append incremental cursor) is explicitly STAGE 3 scope per
// docs/ts-migration-plan.md -- the react re-render model vs. the hand-tuned
// signature-gating in renderer.js is the highest-risk item in that stage,
// so it gets a dedicated, closely reviewed PR rather than a naive port here.
// This view shows a quiet, honest placeholder in its place.
function StreamItem({ item }: { item: ThreadItem }) {
  if (item.kind === 'note') {
    return (
      <div className="rounded-md border border-border border-l-2 border-l-iris bg-panel p-3">
        <div className="flex items-center gap-2">
          <Chip variant="label-iris" size="label" dot={false}>{item.level}</Chip>
          <span className="ml-auto font-mono text-[9.5px] text-ink4">{agoTxt(Date.parse(item.ts))}</span>
        </div>
        <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{item.message}</div>
      </div>
    );
  }
  if (item.kind === 'ask') {
    return (
      <div className="rounded-md border border-border border-l-2 border-l-need bg-panel p-3">
        <div className="flex items-center gap-2">
          <Chip variant="label-need" size="label" dot={false}>asks you</Chip>
          <span className="ml-auto font-mono text-[9.5px] text-ink4">{agoTxt(Date.parse(item.ts))}</span>
        </div>
        <div className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{item.reason}</div>
      </div>
    );
  }
  if (item.kind === 'ask-interrupted') {
    return (
      <div className="rounded-md border border-border border-l-2 border-l-block bg-panel p-3">
        <div className="flex items-center gap-2">
          <Chip variant="label-block" size="label" dot={false}>interrupted</Chip>
          <span className="ml-auto font-mono text-[9.5px] text-ink4">{agoTxt(Date.parse(item.ts))}</span>
        </div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-foreground">{item.question || 'a question was interrupted when the app closed.'}</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border border-l-2 border-l-done bg-panel p-3">
      <div className="flex items-center gap-2">
        <Chip variant="label-done" size="label" dot={false}>{item.engine || 'answer'}</Chip>
        <span className="ml-auto font-mono text-[9.5px] text-ink4">{agoTxt(Date.parse(item.ts))}</span>
      </div>
      <div className="mt-1.5 text-[12.5px] text-ink2">{item.question}</div>
      <div className="mt-1 whitespace-pre-wrap border-l-2 border-rule2 pl-2 text-[13px] leading-relaxed text-foreground">{item.answer}</div>
    </div>
  );
}

function SummaryBlock({
  row,
  loading,
  error,
  onGenerate,
}: {
  row: SessionRow;
  loading: boolean;
  error?: string;
  onGenerate: () => void;
}) {
  const label = row.summary ? 'Refresh AI summary' : error ? 'Retry AI summary' : 'Generate AI summary';
  if (loading) {
    return (
      <div className="rounded-md border border-border bg-panel2 p-3">
        <div className="flex items-center gap-2">
          <Chip variant="label" size="label" dot={false}>AI summary</Chip>
          <span className="font-mono text-[9.5px] text-ink4">via {row.summary?.engine || 'claude'} CLI</span>
        </div>
        <div className="mt-1.5 font-mono text-[11px] text-ink3">summarizing recent activity...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-block/40 bg-panel2 p-3">
        <Chip variant="label-block" size="label" dot={false}>AI summary failed</Chip>
        <div className="mt-1.5 text-[12.5px] text-ink3">{error}</div>
        <Button variant="outline" size="sm" className="mt-2 h-6 font-mono text-[9px] text-ink3" onClick={onGenerate}>{label}</Button>
      </div>
    );
  }
  if (!row.summary) {
    return (
      <div className="rounded-md border border-border bg-panel2 p-3">
        <Chip variant="label" size="label" dot={false}>AI summary</Chip>
        <Button variant="outline" size="sm" className="mt-2 h-6 font-mono text-[9px] text-ink3" onClick={onGenerate}>{label}</Button>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-panel2 p-3">
      <div className="flex items-center gap-2">
        <Chip variant="label" size="label" dot={false}>AI summary</Chip>
        <span className="font-mono text-[9.5px] text-ink4">via {row.summary.engine || 'claude'}{row.summary.at ? ` · ${agoTxt(row.summary.at)}` : ''}</span>
      </div>
      <div className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">{row.summary.text}</div>
      <Button variant="outline" size="sm" className="mt-2 h-6 font-mono text-[9px] text-ink3" onClick={onGenerate}>{label}</Button>
    </div>
  );
}

export function SessionDetail({
  thread,
  row,
  backLabel,
  onBack,
  onAsk,
  onResume,
  summaryLoading,
  summaryError,
  onGenerateSummary,
}: {
  thread: InboxThread | null;
  row: SessionRow | null;
  backLabel?: string;
  onBack?: () => void;
  onAsk: (id: string, question: string) => Promise<string>;
  onResume?: (row: SessionRow) => void;
  summaryLoading?: boolean;
  summaryError?: string;
  onGenerateSummary?: (row: SessionRow) => void;
}) {
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  if (!thread) {
    return <div className="p-6 font-mono text-[12px] text-ink3">Select a thread to open it.</div>;
  }
  const title = row?.customTitle || row?.title || thread.title || thread.sessionId.slice(0, 10);
  const state = row?.state || 'idle';
  const repoBase = (() => {
    const raw = (row && (row.cwd || row.repo)) || thread.cwd || thread.repo || '';
    const parts = String(raw).replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || raw;
  })();
  const stream = thread.items.slice().reverse();

  async function send() {
    if (!q.trim() || asking) return;
    setAsking(true);
    setAnswer(null);
    const ans = await onAsk(thread!.sessionId, q);
    setAnswer(ans);
    setAsking(false);
    setQ('');
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[840px] flex-col overflow-hidden">
      <ScrollArea className="min-h-0 flex-1">
      <div className="px-6 pb-4 pt-3">
        {onBack && (
          <button type="button" onClick={onBack} className="mb-2 font-mono text-[10.5px] text-ink3 hover:text-foreground">
            &#8592; {backLabel || 'back'}
          </button>
        )}
        <div className="flex items-start gap-3">
          <HarnessGlyph harness={thread.harness} className="mt-0.5 text-[26px]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[21px] font-bold tracking-tight">{title}</h1>
              <StateChip state={state} />
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-ink3">
              {repoBase}{row?.model ? ` · ${row.model}` : ''}{row?.contextPct != null ? ` · ${row.contextPct}% context` : ''}
            </div>
          </div>
          <Button
            variant="iris"
            className="flex-none"
            disabled={!row}
            onClick={() => row && onResume?.(row)}
            title={row ? 'Resume this session' : 'session no longer in the recent scan'}
          >
            {row?.harness === 'codex' ? 'Resume in Codex' : 'Resume in Claude'}
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {stream.length ? stream.map((it, i) => <StreamItem key={i} item={it} />) : (
            <div className="font-mono text-[11px] text-ink4">no updates in this thread yet.</div>
          )}
        </div>

        {row && (
          <div className="mt-3">
            <SummaryBlock
              row={row}
              loading={!!summaryLoading}
              error={summaryError}
              onGenerate={() => onGenerateSummary?.(row)}
            />
          </div>
        )}

        <div className="mt-3 rounded-md border border-border bg-panel/60 p-3">
          <div className="flex items-center gap-2">
            <Chip variant="label" size="label" dot={false}>Conversation</Chip>
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-ink4">
            The live conversation timeline arrives in stage 3 of the TypeScript migration (see docs/ts-migration-plan.md).
          </div>
        </div>
      </div>
      </ScrollArea>

      <div className="mx-6 flex max-h-[45vh] flex-none flex-col rounded-t-md border border-b-0 border-l-2 border-border border-l-done bg-panel2 p-3">
        <div className="flex items-center gap-3">
          <Chip variant="label-done" size="label" dot={false}>Ask the session</Chip>
        </div>
        {answer && (
          <ScrollArea className="mt-3 min-h-0 flex-1">
            <div className="grid gap-1">
              <div className="pl-2 text-[12.5px] text-ink2">{q || 'your question'}</div>
              <div className="whitespace-pre-wrap border-l-2 border-rule2 pl-2 text-[13px] leading-relaxed text-foreground">{answer}</div>
            </div>
          </ScrollArea>
        )}
        <div className="mt-2 flex flex-none gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
            placeholder="Ask the session a question..."
            aria-label="Ask the session a question"
            disabled={asking || !row}
            className={cn('flex-1 focus-visible:border-done')}
          />
          <Button
            type="button"
            variant="done"
            onClick={send}
            disabled={asking || !row || !q.trim()}
            className="flex-none px-3.5 py-1.5 font-mono text-[10.5px]"
          >
            {asking ? 'asking...' : 'Ask'}
          </Button>
        </div>
      </div>
    </div>
  );
}
