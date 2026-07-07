import { useCallback, useLayoutEffect, useRef } from 'react';
import { Chip } from '@/components/ui/chip';
import { Item, ItemContent, ItemHeader } from '@/components/ui/item';
import { useTimeline } from '@/hooks/use-timeline';
import { agoTxt } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SessionRow, TimelineEvent } from '@/lib/types';

// Upward-infinite-scroll trigger distance, matching the reference renderer's
// `scrollTop < 60` threshold exactly.
const NEAR_TOP_PX = 60;
// "Close enough to the bottom" to count as sticky: a live append auto-scrolls
// only when the reader was already at (or very near) the bottom.
const NEAR_BOTTOM_PX = 48;

// One row per timeline event, in the STAGE-2C flat-Item language (no cards,
// no shadows -- DESIGN.md). user/assistant get the full note-style row
// (chip + relative time header, wrapped text below, a colored left rule);
// interrupt/tools are compact single-line rows, matching the brief.
function TimelineRow({ event }: { event: TimelineEvent }) {
  const ts = event.ts != null ? agoTxt(event.ts) : '';
  if (event.k === 'tools') {
    return (
      <Item size="sm" className="gap-2">
        <Chip variant="label" size="label" dot={false}>tools</Chip>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink4">
          {event.n} tool call{event.n === 1 ? '' : 's'}
        </span>
        {ts && <span className="flex-none font-mono text-[9.5px] text-ink4">{ts}</span>}
      </Item>
    );
  }
  if (event.k === 'interrupt') {
    return (
      <Item size="sm" className="gap-2">
        <Chip variant="label-block" size="label" dot={false}>interrupted</Chip>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink3">
          {event.t || 'the session was interrupted'}
        </span>
        {ts && <span className="flex-none font-mono text-[9.5px] text-ink4">{ts}</span>}
      </Item>
    );
  }
  const isUser = event.k === 'user';
  return (
    <Item size="sm" className={cn('flex-col items-stretch border-l-2 pl-3', isUser ? 'border-l-iris' : 'border-l-done')}>
      <ItemHeader>
        <Chip variant={isUser ? 'label-iris' : 'label-done'} size="label" dot={false}>
          {isUser ? 'you' : 'agent'}
        </Chip>
        {ts && <span className="font-mono text-[9.5px] text-ink4">{ts}</span>}
      </ItemHeader>
      <ItemContent>
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
          {event.t || '(no text)'}
        </div>
      </ItemContent>
    </Item>
  );
}

// The live conversation reader: a bounded backward page on open (scrolled to
// the bottom), upward infinite scroll for older history (scroll position
// preserved across the prepend), and event-driven live appends for the one
// hot session with sticky-bottom auto-scroll. This is the sole owner of the
// conversation-stream signal in detail (DESIGN.md one-owner-per-signal); it
// replaces the stage-3 placeholder and is never duplicated elsewhere on this
// screen.
export function SessionTimeline({ row }: { row: SessionRow | null }) {
  const tl = useTimeline(row);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll-restore bookkeeping. Both refs are read/written OUTSIDE React
  // state on purpose: they track transient scroll position, the same class
  // of renderer ephemera as the rest of the app's scroll/selection state
  // (AGENTS.md's command-registry carve-out), not data that needs to
  // re-render anything itself.
  const wasNearBottomRef = useRef(true);
  const prevScrollRef = useRef<{ height: number; top: number } | null>(null);

  const handleLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (el) prevScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    tl.loadOlder();
  }, [tl]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (el.scrollTop < NEAR_TOP_PX && !tl.atStart && !tl.loadingOlder && !tl.loading) {
      handleLoadOlder();
    }
  }, [tl.atStart, tl.loadingOlder, tl.loading, handleLoadOlder]);

  // Runs after the DOM reflects the new `items`, before paint: the ONE place
  // that decides where the scroll region ends up, keyed on `changeSeq` (a
  // fresh stamp per state transition) rather than diffing `items` itself.
  //   initial -> jump to bottom (newest at the bottom, per the brief).
  //   prepend -> restore position: keep the same content under the viewport
  //              by offsetting scrollTop by exactly the height added above it.
  //   append  -> jump to bottom ONLY if the reader was already there
  //              (sticky bottom); otherwise leave scroll position untouched.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (tl.changeKind === 'initial') {
      el.scrollTop = el.scrollHeight;
      wasNearBottomRef.current = true;
      return;
    }
    if (tl.changeKind === 'prepend') {
      const prev = prevScrollRef.current;
      if (prev) el.scrollTop = prev.top + (el.scrollHeight - prev.height);
      prevScrollRef.current = null;
      return;
    }
    if (tl.changeKind === 'append' && wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.changeSeq]);

  const olderLabel = tl.loadingOlder
    ? 'loading earlier events...'
    : tl.capped
      ? 'earlier events trimmed from view · reload timeline'
      : `${tl.estEarlier != null ? `~${tl.estEarlier}` : ''} earlier events not shown · load older`.trim();

  return (
    <Item size="sm" role="group" className="flex-col items-stretch">
      <ItemHeader>
        <Chip variant="label" size="label" dot={false}>Conversation</Chip>
        {tl.live && <Chip variant="label-done" size="label" dot={false} className="ml-auto">live</Chip>}
      </ItemHeader>
      <ItemContent>
        {!row ? (
          <div className="py-2 font-mono text-[11px] text-ink4">session no longer in the recent scan; conversation is unavailable.</div>
        ) : tl.loading ? (
          <div className="py-2 font-mono text-[11px] text-ink4">reading timeline...</div>
        ) : tl.error ? (
          <div className="py-2 font-mono text-[11px] text-ink4">{tl.error}</div>
        ) : (
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-[420px] min-h-[120px] overflow-y-auto overflow-x-hidden"
          >
            {tl.atStart ? (
              <div className="py-2 text-center font-mono text-[9.5px] uppercase tracking-wider text-ink4">
                start of session
              </div>
            ) : (
              <div className="flex justify-center py-1.5">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={tl.loadingOlder}
                  className="font-mono text-[10px] tracking-wide text-ink3 hover:text-foreground disabled:cursor-default disabled:opacity-60"
                >
                  {olderLabel}
                </button>
              </div>
            )}
            {tl.items.length === 0 ? (
              <div className="py-2 font-mono text-[11px] text-ink4">no substantive events in this slice.</div>
            ) : (
              tl.items.map(({ key, event }) => <TimelineRow key={key} event={event} />)
            )}
          </div>
        )}
      </ItemContent>
    </Item>
  );
}
