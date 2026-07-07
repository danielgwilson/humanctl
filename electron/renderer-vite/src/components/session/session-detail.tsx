import { Fragment, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Chip } from '@/components/ui/chip';
import {
  Item,
  ItemContent,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemSeparator,
} from '@/components/ui/item';
import { HarnessGlyph, StateChip } from '@/components/state-chip';
import { SessionTimeline } from '@/components/session/session-timeline';
import { agoTxt } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InboxThread, SessionRow, ThreadItem } from '@/lib/types';

// The ONE session-detail component family, matching renderer.js's
// renderDetail()/streamItemHtml comment ("the SAME detail component
// rendered into the Inbox's second pane... never a fork"): header (glyph,
// title, state chip, resume action), the notes/asks/qa stream, an AI-summary
// block, the live conversation timeline, and the ask-the-session composer as
// a sticky footer. `backLabel` switches on whether this is the Inbox
// embedded pane (no back breadcrumb) or the full-width session-detail
// overlay reached from a list (breadcrumb present); both render this same
// tree, never a second component.
//
// STAGE-2E scroll-trap fix: this used to wrap header + stream + summary +
// timeline in ONE outer ScrollArea while SessionTimeline ALSO ran its own
// nested `overflow-y-auto` scroll internally -- two independent scroll
// regions, so scrolling the outer one could carry the header out of view
// while the inner one silently ate further scroll input, with no way back up
// without first hovering off the timeline. Fixed by making this a genuine
// three-row flex column: a `flex-none` header (back breadcrumb, glyph/
// title/state/resume, meta line) that is structurally outside any scroll
// region and therefore always visible; ONE `flex-1 min-h-0` ScrollArea that
// is the sole scroller for the stream + summary + conversation timeline,
// flowing inline; and the `flex-none` ask-the-session composer pinned at the
// bottom, unchanged. `bodyViewportRef` is threaded down to SessionTimeline so
// its sticky-bottom-on-append and scroll-position-preservation-on-prepend
// behaviors operate on this ONE shared scroller instead of a nested one (see
// session-timeline.tsx's header comment for the full rationale).
//
// The live-timeline "Conversation" reader (session:timeline / the
// session:append incremental cursor) is stage 3: SessionTimeline
// (session-timeline.tsx) owns that signal exclusively -- it is the sole home
// for the conversation stream in this view, replacing the placeholder that
// used to sit here, and it owns its own state end to end (see that file's
// header comment for the perf rationale).
//
// De-carded (audit punch #1, DESIGN.md "Flat surfaces, no cards, no
// shadows-as-hierarchy"): every `rounded-md border ... bg-panel p-3` box
// below is now a flat `Item` row inside an `ItemGroup`, separated by a
// hairline `ItemSeparator` instead of a bordered box. The per-kind hue still
// reads via the existing `Chip` and, for the stream rows only, a single thin
// left rule -- never a rounded card, background panel, or shadow.
function StreamRow({ item }: { item: ThreadItem }) {
  const ts = agoTxt(Date.parse(item.ts));

  if (item.kind === 'note') {
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-iris pl-3">
        <ItemHeader>
          <Chip variant="label-iris" size="label" dot={false}>{item.level}</Chip>
          <span className="font-mono text-[9.5px] text-ink4">{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{item.message}</div>
        </ItemContent>
      </Item>
    );
  }
  if (item.kind === 'ask') {
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-need pl-3">
        <ItemHeader>
          <Chip variant="label-need" size="label" dot={false}>asks you</Chip>
          <span className="font-mono text-[9.5px] text-ink4">{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{item.reason}</div>
        </ItemContent>
      </Item>
    );
  }
  if (item.kind === 'ask-interrupted') {
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-block pl-3">
        <ItemHeader>
          <Chip variant="label-block" size="label" dot={false}>interrupted</Chip>
          <span className="font-mono text-[9.5px] text-ink4">{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="text-[13px] leading-relaxed text-foreground">
            {item.question || 'a question was interrupted when the app closed.'}
          </div>
        </ItemContent>
      </Item>
    );
  }
  return (
    <Item size="sm" className="flex-col items-stretch border-l-2 border-l-done pl-3">
      <ItemHeader>
        <Chip variant="label-done" size="label" dot={false}>{item.engine || 'answer'}</Chip>
        <span className="font-mono text-[9.5px] text-ink4">{ts}</span>
      </ItemHeader>
      <ItemContent>
        <div className="text-[12.5px] text-ink2">{item.question}</div>
        <div className="whitespace-pre-wrap border-l-2 border-rule2 pl-2 text-[13px] leading-relaxed text-foreground">
          {item.answer}
        </div>
      </ItemContent>
    </Item>
  );
}

function SummarySection({
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
  return (
    <Item size="sm" role="group" className="flex-col items-stretch">
      <ItemHeader>
        {error ? (
          <Chip variant="label-block" size="label" dot={false}>AI summary failed</Chip>
        ) : (
          <Chip variant="label" size="label" dot={false}>AI summary</Chip>
        )}
        {!error && (
          <span className="font-mono text-[9.5px] text-ink4">
            {loading
              ? `via ${row.summary?.engine || 'claude'} CLI`
              : row.summary
                ? `via ${row.summary.engine || 'claude'}${row.summary.at ? ` · ${agoTxt(row.summary.at)}` : ''}`
                : ''}
          </span>
        )}
      </ItemHeader>
      <ItemContent>
        {loading && <div className="font-mono text-[11px] text-ink3">summarizing recent activity...</div>}
        {!loading && error && <div className="text-[12.5px] text-ink3">{error}</div>}
        {!loading && !error && row.summary && (
          <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground">{row.summary.text}</div>
        )}
      </ItemContent>
      {!loading && (
        <ItemFooter className="justify-start">
          <Button variant="outline" size="sm" className="h-6 font-mono text-[9px] text-ink3" onClick={onGenerate}>
            {label}
          </Button>
        </ItemFooter>
      )}
    </Item>
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
  // The single shared body scroller (see the STAGE-2E header comment):
  // SessionTimeline reads/writes this element directly for sticky-bottom and
  // scroll-restore, rather than owning a second nested scroll region.
  const bodyViewportRef = useRef<HTMLDivElement | null>(null);

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
      {/* Pinned header: back breadcrumb + glyph/title/state/resume + meta
          line. Structurally outside the scroll region below -- never
          scrolls, always visible, the fix for the scroll-trap symptom. */}
      <div className="flex-none px-6 pb-3 pt-3">
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
      </div>

      {/* THE single body scroll region: notes/asks stream + summary +
          conversation timeline, all flowing inline. `bodyViewportRef` is the
          element SessionTimeline reads/writes for its scroll behaviors. */}
      <ScrollArea className="min-h-0 flex-1" viewportRef={bodyViewportRef}>
      <div className="px-6 pb-4">
        <ItemGroup>
          {stream.length ? (
            stream.map((it, i) => (
              <Fragment key={i}>
                <StreamRow item={it} />
                {i < stream.length - 1 && <ItemSeparator />}
              </Fragment>
            ))
          ) : (
            <div className="py-3 font-mono text-[11px] text-ink4">no updates in this thread yet.</div>
          )}
        </ItemGroup>

        {row && (
          <>
            <ItemSeparator />
            <SummarySection
              row={row}
              loading={!!summaryLoading}
              error={summaryError}
              onGenerate={() => onGenerateSummary?.(row)}
            />
          </>
        )}

        <ItemSeparator />
        <SessionTimeline row={row} scrollContainerRef={bodyViewportRef} />
      </div>
      </ScrollArea>

      <div className="mx-6 flex max-h-[45vh] flex-none flex-col gap-2 pb-3">
        <Separator />
        <div className="flex items-center gap-3">
          <Chip variant="label-done" size="label" dot={false}>Ask the session</Chip>
        </div>
        {answer && (
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-1 pr-2">
              <div className="pl-2 text-[12.5px] text-ink2">{q || 'your question'}</div>
              <div className="whitespace-pre-wrap border-l-2 border-rule2 pl-2 text-[13px] leading-relaxed text-foreground">{answer}</div>
            </div>
          </ScrollArea>
        )}
        <div className="flex flex-none gap-2">
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
