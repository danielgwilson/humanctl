import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { InboxToolbar } from './inbox-toolbar';
import { ThreadRow } from './thread-row';
import { SessionDetail } from '@/components/session/session-detail';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { CountToken } from '@/components/ui/count-token';
import type { InboxThread, SessionRow } from '@/lib/types';
import { visibleThreads, type InboxFilter } from '@/lib/inbox-logic';

// A real fleet runs 100+ threads through this list, and it re-reconciles on
// every 20s poll (AGENTS.md perf SLO: DOM rebuilds are signature-gated,
// unchanged data must not rebuild -- an unvirtualized list still means 100+
// live DOM rows sitting around for every reconcile pass to diff against).
// `estimateSize` starts at the row's typical three-line height and
// `measureElement` corrects it against the real rendered height per row, so
// this holds up even if a title wraps oddly; `getItemKey` keys each virtual
// slot to the thread's own sessionId (not the array index) so rows never
// flicker/mismatch when filtering or sorting reorders the list.
//
// Stage 3 (#69): measured via headless CDP against the real built renderer
// (getBoundingClientRect on a mounted row) after the type-role line-height
// changes -- 85px, not the pre-stage-3 76px. See sessions-view.tsx's own
// ROW_ESTIMATE_PX comment for the line-height math.
const ROW_ESTIMATE_PX = 85;

// The two-pane Inbox shell (thread list + thread detail), built once and
// kept mounted so the search input never loses focus across a refresh. The
// detail pane renders the SAME SessionDetail component family the
// full-width session-detail view uses (never a fork); this pane omits the
// back breadcrumb since the thread list sits beside it.
export function InboxView({
  threads,
  byId,
  lastReadTs,
  pins,
  onMarkRead,
  onMarkAllRead,
  onTogglePin,
  onAsk,
  onResume,
  onOpenDetail,
  summaryLoadingId,
  summaryErrors,
  onGenerateSummary,
}: {
  threads: InboxThread[];
  byId: Map<string, SessionRow>;
  lastReadTs: Record<string, number>;
  pins: Set<string>;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onTogglePin: (id: string) => void;
  onAsk: (id: string, q: string) => Promise<string>;
  onResume: (row: SessionRow) => void;
  onOpenDetail: (id: string) => void;
  summaryLoadingId: string | null;
  summaryErrors: Record<string, string>;
  onGenerateSummary: (row: SessionRow) => void;
}) {
  const [filter, setFilter] = useState<InboxFilter>({ q: '', state: '', harness: '', sort: 'recent' });
  const [selId, setSelId] = useState<string | null>(null);

  const list = useMemo(() => visibleThreads(threads, byId, filter), [threads, byId, filter]);
  const effectiveSel = selId && list.some((t) => t.sessionId === selId) ? selId : list[0]?.sessionId || null;
  const selected = list.find((t) => t.sessionId === effectiveSel) || null;
  const selectedRow = selected ? byId.get(selected.sessionId) || null : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: list.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
    getItemKey: (index) => list[index].sessionId,
  });

  function select(id: string) {
    setSelId(id);
    onMarkRead(id);
  }

  return (
    <div className="grid h-full grid-cols-[var(--rail-list)_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-r-hairline bg-surface-0">
        {/* eslint-disable-next-line design-system/no-arbitrary-length -- stage 6 (#72) item 1: "Band height is one number... Today Inbox's list band is 38px" names this exact site. Zero-visual-delta this stage. */}
        <div className="flex h-[38px] flex-none items-center gap-2 border-b border-b-hairline px-6">
          <span aria-hidden="true">&#9993;</span>
          {/* Pane header, a section label -- `label` role (section 2.3),
              dropping the explicit font-semibold/tracking-widest now baked
              into the role token. */}
          <span className="font-mono text-label uppercase text-ink-2">Inbox</span>
          {/* Stage 5 (#71) item 1: CountToken's own "info" tone (this file's
              header comment on the primitive names this exact call site) --
              replaces the hand-rolled count+noun span pair. */}
          <CountToken count={list.length} noun={list.length === 1 ? 'thread' : 'threads'} />
          {/* Stage 5 (#71) item 2: `quiet` (already ink-3) replaces
              `outline` + the old h-6/px-2 override -- size="sm" (20px) is
              already close to the old h-6 (24px), and Button label is `row`
              at every size (section 6), no per-instance override needed. */}
          <Button variant="quiet" size="sm" className="ml-auto" onClick={onMarkAllRead}>
            mark all read
          </Button>
        </div>
        <InboxToolbar filter={filter} onChange={setFilter} />
        <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef}>
          {list.length === 0 ? (
            // Stage 5 (#71) item 7: h-full is Empty's own base now.
            <Empty>
              <EmptyDescription>
                No agent updates match. Agents post here via <code>humanctl note</code>.
              </EmptyDescription>
            </Empty>
          ) : (
            <div style={{ position: 'relative', height: rowVirtualizer.getTotalSize(), width: '100%' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const t = list[vRow.index];
                return (
                  <div
                    key={t.sessionId}
                    data-index={vRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
                  >
                    <ThreadRow
                      thread={t}
                      byId={byId}
                      selected={t.sessionId === effectiveSel}
                      unreadTs={lastReadTs}
                      onSelect={select}
                      onMarkRead={onMarkRead}
                      onPin={onTogglePin}
                      onOpenDetail={onOpenDetail}
                      pinned={pins.has(t.sessionId)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </aside>
      <section className="min-h-0 min-w-0 overflow-hidden">
        <SessionDetail
          thread={selected}
          row={selectedRow}
          onAsk={onAsk}
          onResume={onResume}
          summaryLoading={!!selectedRow && summaryLoadingId === selectedRow.id}
          summaryError={selectedRow ? summaryErrors[selectedRow.id] : undefined}
          onGenerateSummary={onGenerateSummary}
        />
      </section>
    </div>
  );
}
