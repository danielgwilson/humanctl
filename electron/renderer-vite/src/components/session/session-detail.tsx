import { Fragment, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Chip } from '@/components/ui/chip';
import { Empty, EmptyDescription } from '@/components/ui/empty';
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
import { useAnswerAsk } from '@/hooks/use-humanctl';
import { agoTxt, NOTE_LEVEL_HUE } from '@/lib/format';
import type { AnswerAskResult, InboxThread, SessionRow, ThreadItem } from '@/lib/types';

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
// Honest per-channel delivery description for a PERSISTED 'answer' thread
// item (docs/ask-session.md's "Delivery, per harness" table). The durable
// asks/<sessionId>.jsonl record (inboxThreads' own source, lib/commands.ts)
// only ever carries the delivery CHANNEL, never the live call's
// delivered/clipped/resumed outcome booleans -- those exist only on the
// immediate AnswerAskResult a submit resolves with (see
// answerToastMessage below) and are never persisted. A reload/poll can
// therefore only describe what the channel MEANS, never whether that one
// call succeeded -- which is still the honest thing to say, never a
// fabricated "delivered".
function describeDelivery(delivery?: string): string | null {
  if (delivery === 'codex-rollout') return 'delivered to session';
  if (delivery === 'staged') return 'copied to clipboard, session resumed in Terminal';
  if (delivery === 'file') return 'recorded only (no live delivery channel)';
  return null;
}

// Honest per-channel toast text for the LIVE submit result, including its
// delivered/clipped/resumed/error fields: a spawn failure still leaves the
// reply durably recorded (AskAnswerParams' own contract), and the toast says
// so instead of a bare "sent" that would misrepresent a failed delivery.
function answerToastMessage(r: AnswerAskResult): string {
  if (!r.ok) return r.error || 'reply failed.';
  if (r.delivery === 'codex-rollout') {
    return r.delivered ? 'delivered to session' : `recorded; delivery failed (${r.deliverError || 'unknown error'})`;
  }
  if (r.delivery === 'staged') {
    if (!r.clipped) return `recorded; clipboard copy failed (${r.clipboardError || 'unknown error'})`;
    return r.resumed ? 'copied to clipboard, session resumed in Terminal' : 'copied to clipboard (resume failed; paste it in manually)';
  }
  return 'reply recorded';
}

// The reply composer bound to a pending ask (docs/ask-session.md's
// "Replying to an ask" section, ask.answer). Renders INSIDE the 'ask' stream
// item it answers -- never as a second, floating composer elsewhere on the
// screen. One owner per signal (DESIGN.md): this owns ANSWERING the pending
// ask; the foot "Ask the session" composer further down owns PROBING the
// session with a throwaway question. They are not duplicates of the same
// signal -- see the PR body's one-owner audit.
function AskReplyComposer({
  row,
  sessionId,
  askId,
  onAnswered,
}: {
  row: SessionRow | null;
  sessionId: string;
  askId?: string;
  onAnswered: (item: ThreadItem) => void;
}) {
  const { answer, pendingId } = useAnswerAsk();
  const [text, setText] = useState('');
  const submitting = pendingId === sessionId;

  async function send() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    const r = await answer({ id: sessionId, path: row?.path, harness: row?.harness, cwd: row?.cwd, text: trimmed, askId });
    toast(answerToastMessage(r));
    if (r.ok) {
      onAnswered({ kind: 'answer', text: trimmed, askId, delivery: r.delivery, actor: 'human', ts: new Date(r.at || Date.now()).toISOString() });
      setText('');
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
        }}
        placeholder="Reply to this ask..."
        aria-label="Reply to this ask"
        disabled={submitting}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-micro text-ink-4">cmd+enter to send &middot; esc to leave the reply box</span>
        {/* Button label is `row` at every size (section 6): no per-instance
            size override here any more. Stage 5 (#71) item 2: `iris` merges
            into `primary` (the collapsed five-variant set); the old inline
            px-3.5/py-1.5 override is deleted along with it -- size="md"'s
            own padding is correct now. */}
        <Button
          type="button"
          variant="primary"
          onClick={send}
          disabled={submitting || !text.trim()}
          className="flex-none"
        >
          {submitting ? 'sending...' : 'Reply'}
        </Button>
      </div>
    </div>
  );
}

// De-carded (audit punch #1, DESIGN.md "Flat surfaces, no cards, no
// shadows-as-hierarchy"): every `rounded-md border ... bg-panel p-3` box
// below is now a flat `Item` row inside an `ItemGroup`, separated by a
// hairline `ItemSeparator` instead of a bordered box. The per-kind hue still
// reads via the existing `Chip` and, for the stream rows only, a single thin
// left rule -- never a rounded card, background panel, or shadow.
//
// `canReply`/`row`/`sessionId`/`onAnswered` are only consumed by the 'ask'
// branch below (AskReplyComposer): SessionDetail passes them for every row,
// but they are no-ops for every other item kind.
function StreamRow({
  item,
  canReply,
  row,
  sessionId,
  onAnswered,
}: {
  item: ThreadItem;
  canReply?: boolean;
  row?: SessionRow | null;
  sessionId?: string;
  onAnswered?: (item: ThreadItem) => void;
}) {
  const ts = agoTxt(Date.parse(item.ts));

  // Every body below (note.message, ask.reason, answer.text, an interrupted
  // ask's own question, a qa item's question/answer) is language addressed to
  // or from the human -- docs/design-system.md 2.1's "a note body" and
  // "chat" call sites verbatim, the same category as thread-row.tsx's line 2
  // and cos-drawer.tsx's chat history. `ts` stays mono/micro: a relative
  // timestamp is machine output, not language.
  if (item.kind === 'note') {
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-iris-contrast pl-3">
        <ItemHeader>
          {/* Stage 5 (#71) item 3: a note's level (fyi/review/blocked/done)
              is one of section 1.6's 12-row map, so it renders `state`
              through NOTE_LEVEL_HUE -- a real fix, not a rename: this used
              to hardcode `variant="label-iris"` regardless of the note's
              actual level. */}
          <Chip variant="state" hue={NOTE_LEVEL_HUE[item.level] ?? 'idle'}>{item.level}</Chip>
          <span className="font-mono text-micro text-ink-4" data-numeric>{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="whitespace-pre-wrap font-sans text-prose text-ink">{item.message}</div>
        </ItemContent>
      </Item>
    );
  }
  if (item.kind === 'ask') {
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-need-contrast pl-3">
        <ItemHeader>
          {/* Stage 5 (#71) item 3: not one of the 12-row state/level map
              (section 1.6) -- a plain stream-kind label, `meta`, uncoloured. */}
          <Chip variant="meta">asks you</Chip>
          <span className="font-mono text-micro text-ink-4" data-numeric>{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="whitespace-pre-wrap font-sans text-prose text-ink">{item.reason}</div>
          {canReply && sessionId && onAnswered && (
            <AskReplyComposer row={row ?? null} sessionId={sessionId} onAnswered={onAnswered} />
          )}
        </ItemContent>
      </Item>
    );
  }
  if (item.kind === 'answer') {
    const line = describeDelivery(item.delivery);
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-iris-contrast pl-3">
        <ItemHeader>
          <Chip variant="meta">your answer</Chip>
          <span className="font-mono text-micro text-ink-4" data-numeric>{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="whitespace-pre-wrap font-sans text-prose text-ink">{item.text}</div>
          {/* Delivery-channel description is a system status line, not
              language addressed to the human -- stays mono/micro. */}
          {line && <div className="font-mono text-micro text-ink-4">{line}</div>}
        </ItemContent>
      </Item>
    );
  }
  if (item.kind === 'ask-interrupted') {
    return (
      <Item size="sm" className="flex-col items-stretch border-l-2 border-l-block-contrast pl-3">
        <ItemHeader>
          <Chip variant="meta">interrupted</Chip>
          <span className="font-mono text-micro text-ink-4" data-numeric>{ts}</span>
        </ItemHeader>
        <ItemContent>
          <div className="font-sans text-prose text-ink">
            {item.question || 'a question was interrupted when the app closed.'}
          </div>
        </ItemContent>
      </Item>
    );
  }
  return (
    <Item size="sm" className="flex-col items-stretch border-l-2 border-l-done-contrast pl-3">
      <ItemHeader>
        <Chip variant="meta">{item.engine || 'answer'}</Chip>
        <span className="font-mono text-micro text-ink-4" data-numeric>{ts}</span>
      </ItemHeader>
      <ItemContent>
        <div className="font-sans text-prose text-ink-2">{item.question}</div>
        <div className="whitespace-pre-wrap border-l-2 border-l-hairline pl-2 font-sans text-prose text-ink">
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
          <Chip variant="meta">AI summary failed</Chip>
        ) : (
          <Chip variant="meta">AI summary</Chip>
        )}
        {!error && (
          <span className="font-mono text-micro text-ink-4" data-numeric>
            {loading
              ? `via ${row.summary?.engine || 'claude'} CLI`
              : row.summary
                ? `via ${row.summary.engine || 'claude'}${row.summary.at ? ` · ${agoTxt(row.summary.at)}` : ''}`
                : ''}
          </span>
        )}
      </ItemHeader>
      <ItemContent>
        {/* "summarizing..." is a transient loading placeholder (chrome), same
            call as cos-drawer.tsx's "thinking..."; the error line is a system
            status too. The summary BODY is prose: it is AI-generated text
            meant to be read like a note, docs/design-system.md 2.1's "a note
            body". */}
        {loading && <div className="font-mono text-micro text-ink-3">summarizing recent activity...</div>}
        {!loading && error && <div className="font-mono text-micro text-ink-3">{error}</div>}
        {!loading && !error && row.summary && (
          <div className="whitespace-pre-wrap font-sans text-prose text-ink">{row.summary.text}</div>
        )}
      </ItemContent>
      {!loading && (
        <ItemFooter className="justify-start">
          {/* Stage 5 (#71) item 2: `quiet` (no ring, ink-3) replaces
              `outline` + the old h-6 height override -- `quiet` is already
              ink-3, so the colour override is redundant too. */}
          <Button variant="quiet" size="sm" onClick={onGenerate}>
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
  // Optimistic reply echo (AskReplyComposer's onAnswered below): the real
  // persisted 'answer' item only reaches `thread.items` on the NEXT
  // inbox.threads poll (electron/main.ts's asks/ watcher; sub-second in the
  // real app). Fixture mode never polls at all, so this local echo is the
  // only way the reply affordance is screenshotable there (docs/ask-session
  // .md's "Thread shape" section: rendering a reply is UI-only, the record
  // itself is backend). `localAnswersFor` scopes/resets the echo per thread
  // (see the render-time reset just below the early return); deduped against
  // `thread.items` by exact text match once the real record lands, so the
  // echo never doubles up with the poll-delivered one.
  const [localAnswers, setLocalAnswers] = useState<ThreadItem[]>([]);
  const [localAnswersFor, setLocalAnswersFor] = useState<string | null>(null);
  // The single shared body scroller (see the STAGE-2E header comment):
  // SessionTimeline reads/writes this element directly for sticky-bottom and
  // scroll-restore, rather than owning a second nested scroll region.
  const bodyViewportRef = useRef<HTMLDivElement | null>(null);

  if (!thread) {
    return (
      // Stage 5 (#71) item 7: h-full is Empty's own base now (its className
      // override here is redundant, cleaned up in the same change).
      <Empty>
        <EmptyDescription>Select a thread to open it.</EmptyDescription>
      </Empty>
    );
  }

  // Reset the echo when the OPEN thread changes: React's documented "adjust
  // state during render" pattern (an effect calling setState synchronously
  // trips this renderer's own react-hooks/set-state-in-effect gate; see
  // eslint.config.mjs's header comment on that rule for the file list this
  // repo already scopes it off for -- this avoids joining that list). A
  // no-op render once `localAnswersFor` already matches the open thread.
  if (thread.sessionId !== localAnswersFor) {
    setLocalAnswersFor(thread.sessionId);
    setLocalAnswers([]);
  }

  const title = row?.customTitle || row?.title || thread.title || thread.sessionId.slice(0, 10);
  const state = row?.state || 'idle';
  const repoBase = (() => {
    const raw = (row && (row.cwd || row.repo)) || thread.cwd || thread.repo || '';
    const parts = String(raw).replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || raw;
  })();
  const knownAnswerTexts = new Set(
    thread.items.filter((it): it is Extract<ThreadItem, { kind: 'answer' }> => it.kind === 'answer').map((it) => it.text)
  );
  const mergedItems = [
    ...thread.items,
    ...localAnswers.filter((it) => it.kind === 'answer' && !knownAnswerTexts.has(it.text)),
  ];
  const stream = mergedItems.slice().reverse();
  // Session states: `needs input`/`needs approval`/`blocked` -> internal
  // codes 'need'/'block' (lib/types.ts's SessionState). The 'ask' stream
  // item itself is already gated on this same condition on the backend
  // (lib/commands.ts's inboxThreads only ever adds a kind:'ask' item while
  // the row is 'need'/'block'), so this is belt-and-suspenders, not the
  // only gate -- stated explicitly per the task's own wording.
  const canReplyToAsk = state === 'need' || state === 'block';

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
    // eslint-disable-next-line design-system/no-arbitrary-length -- stage 6 (#72) item 7: this centred 840px column is the exact defect item 7 fixes ("the same session's left edge moves depending on how you opened it"). That is a structural left-anchor rewrite, not a token swap -- --measure-prose (560px) caps prose blocks only, not this whole column -- so it stays exactly as-is, zero-visual-delta, until that stage.
    <div className="mx-auto flex h-full w-full max-w-[840px] flex-col overflow-hidden">
      {/* Pinned header: back breadcrumb + glyph/title/state/resume + meta
          line. Structurally outside the scroll region below -- never
          scrolls, always visible, the fix for the scroll-trap symptom. */}
      <div className="flex-none px-6 pb-3 pt-3">
        {onBack && (
          // Stage 5 (#71) item 2: `quiet` replaces `ghost` (already ink-3,
          // so the colour override is redundant). `h-auto w-fit px-0 py-0`
          // is a deliberate, documented deviation from the fixed 20/28/32
          // control-height ladder: this is an inline text breadcrumb link,
          // not a boxed control, the same category as session-timeline.tsx's
          // "load older" affordance below.
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={onBack}
            className="mb-2 h-auto w-fit justify-start px-0 py-0 hover:bg-transparent hover:text-ink"
          >
            &#8592; {backLabel || 'back'}
          </Button>
        )}
        <div className="flex items-start gap-3">
          {/* 26px was not a legal size (five sizes only, section 2.3); `stat`
              (20, the largest role) is the ceiling. The glyph stays mono, not
              a font-family choice this is a single Unicode glyph, but
              HarnessGlyph's own base role is `row`/mono (state-chip.tsx),
              and the glyph is chrome (identity), never language. */}
          <HarnessGlyph harness={thread.harness} className="mt-0.5 text-stat" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              {/* The session's OWN title, not "the view name" (view-header.tsx
                  owns `title`/sans) -- session titles are branch-shaped
                  machine output (2.1's central example) even blown up to a
                  detail-page hero size, so this stays mono. `stat` is the
                  largest legal mono size; `font-bold`/`tracking-tight` are
                  both forbidden (section 7), demoted to `stat`'s own 500
                  weight and zero tracking, same demotion pattern as
                  header.tsx's wordmark and cos-drawer.tsx's "need you". */}
              <h1 className="font-mono text-stat">{title}</h1>
              <StateChip state={state} />
            </div>
            <div className="mt-1 font-mono text-micro text-ink-3" data-numeric>
              {repoBase}{row?.model ? ` · ${row.model}` : ''}{row?.contextPct != null ? ` · ${row.contextPct}% context` : ''}
            </div>
          </div>
          <Button
            variant="primary"
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
      {/* Stage 5 (#71) item 6: no more px-6 here -- Item's own base now
          carries the pane gutter directly (every row inside, including
          SummarySection's and SessionTimeline's own Item, supplies its own
          px-6), so this wrapper doubling it would have inset every row by
          48px on each side instead of 24px. */}
      <div className="pb-4">
        <ItemGroup>
          {stream.length ? (
            stream.map((it, i) => (
              <Fragment key={i}>
                <StreamRow
                  item={it}
                  canReply={canReplyToAsk}
                  row={row}
                  sessionId={thread.sessionId}
                  onAnswered={(a) => setLocalAnswers((prev) => [...prev, a])}
                />
                {i < stream.length - 1 && <ItemSeparator />}
              </Fragment>
            ))
          ) : (
            <Empty className="p-3">
              <EmptyDescription className="text-ink-4">no updates in this thread yet.</EmptyDescription>
            </Empty>
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
          <Chip variant="meta">Ask the session</Chip>
        </div>
        {answer && (
          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-1 pr-2">
              <div className="pl-2 font-sans text-prose text-ink-2">{q || 'your question'}</div>
              <div className="whitespace-pre-wrap border-l-2 border-l-hairline pl-2 font-sans text-prose text-ink">{answer}</div>
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
            className="flex-1"
          />
          {/* Stage 5 (#71) item 2: this is the OTHER acceptance-test button
              -- `done` merges into `primary`, same as cos-drawer.tsx's Ask
              button, so the two render identically (same fill, height,
              radius, press). The custom done-contrast focus ring on the
              Input above is deleted too: it existed to tie the field to its
              (now retired) done-hue button, and the global focus ring is
              already iris-contrast, which now matches `primary` directly. */}
          <Button
            type="button"
            variant="primary"
            onClick={send}
            disabled={asking || !row || !q.trim()}
            className="flex-none"
          >
            {asking ? 'asking...' : 'Ask'}
          </Button>
        </div>
      </div>
    </div>
  );
}
