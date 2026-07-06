import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HarnessGlyph, StateChip } from '@/components/state-chip';
import { agoTxt } from '@/lib/format';
import { displayTitle, repoBase, threadState } from '@/lib/inbox-logic';
import type { InboxThread, SessionRow, ThreadItem } from '@/lib/types';
import { cn } from '@/lib/utils';

// Ported from renderer.js's renderDetail/streamItemHtml + inbox.js's
// renderThreadDetail: header (glyph, title, state chip) + resume action,
// the notes/asks/qa stream prominent at top, an AI-summary block, and the
// ask-the-session composer as a sticky footer. This spike renders these as
// ONE component tree for the Inbox two-pane preview (parity target for this
// spike); the full-width session-detail overlay + Sessions view reuse of the
// same component is listed as follow-up work in the report, not built here.
function StreamItem({ item }: { item: ThreadItem }) {
  if (item.kind === 'note') {
    return (
      <div className="rounded-md border border-border border-l-2 border-l-iris bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-iris">{item.level}</span>
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
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-need">asks you</span>
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
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-block">interrupted</span>
          <span className="ml-auto font-mono text-[9.5px] text-ink4">{agoTxt(Date.parse(item.ts))}</span>
        </div>
        <div className="mt-1.5 text-[13px] leading-relaxed text-foreground">{item.question || 'a question was interrupted when the app closed.'}</div>
      </div>
    );
  }
  // qa
  return (
    <div className="rounded-md border border-border border-l-2 border-l-done bg-panel p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-done">{item.engine || 'answer'}</span>
        <span className="ml-auto font-mono text-[9.5px] text-ink4">{agoTxt(Date.parse(item.ts))}</span>
      </div>
      <div className="mt-1.5 text-[12.5px] text-ink2">{item.question}</div>
      <div className="mt-1 whitespace-pre-wrap border-l-2 border-rule2 pl-2 text-[13px] leading-relaxed text-foreground">{item.answer}</div>
    </div>
  );
}

export function ThreadDetail({
  thread,
  byId,
  onAsk,
}: {
  thread: InboxThread | null;
  byId: Map<string, SessionRow>;
  onAsk: (id: string, question: string) => Promise<string>;
}) {
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  if (!thread) {
    return <div className="p-6 font-mono text-[12px] text-ink3">Select a thread to open it.</div>;
  }
  const a = byId.get(thread.sessionId) || null;
  const state = threadState(thread, byId);
  const title = displayTitle(thread, byId);
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
      <div className="flex-1 overflow-y-auto px-6 pb-4 pt-3">
        <div className="flex items-start gap-3">
          <HarnessGlyph harness={thread.harness} className="mt-0.5 text-[26px]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[21px] font-bold tracking-tight">{title}</h1>
              <StateChip state={state} />
            </div>
            <div className="mt-1 font-mono text-[10.5px] text-ink3">{repoBase(thread, byId)}{a?.model ? ` · ${a.model}` : ''}</div>
          </div>
          <Button
            className="flex-none bg-iris text-primary-foreground hover:brightness-110"
            disabled={!a}
            title={a ? 'Resume in terminal' : 'session no longer in the recent scan'}
          >
            Resume
          </Button>
        </div>

        <div className={cn('mt-4 flex flex-col gap-3')}>
          {stream.length ? stream.map((it, i) => <StreamItem key={i} item={it} />) : (
            <div className="font-mono text-[11px] text-ink4">no updates in this thread yet.</div>
          )}
        </div>
      </div>

      <div className="mx-6 flex max-h-[45vh] flex-none flex-col rounded-t-md border border-b-0 border-l-2 border-border border-l-done bg-panel2 p-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-done">Ask the session</span>
        </div>
        {answer && (
          <div className="mt-3 flex-1 overflow-y-auto">
            <div className="grid gap-1">
              <div className="pl-2 text-[12.5px] text-ink2">{q || 'your question'}</div>
              <div className="whitespace-pre-wrap border-l-2 border-rule2 pl-2 text-[13px] leading-relaxed text-foreground">{answer}</div>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-none gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
            placeholder="Ask the session a question..."
            aria-label="Ask the session a question"
            disabled={asking || !a}
            className="flex-1 focus-visible:border-done"
          />
          <button
            type="button"
            onClick={send}
            disabled={asking || !a || !q.trim()}
            className="flex-none rounded-md border border-done/45 px-3.5 py-1.5 font-mono text-[10.5px] text-done transition-colors hover:bg-done/10 disabled:opacity-40"
          >
            {asking ? 'asking...' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
