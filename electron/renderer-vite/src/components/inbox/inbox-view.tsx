import { useMemo, useState } from 'react';
import { InboxToolbar } from './inbox-toolbar';
import { ThreadRow } from './thread-row';
import { SessionDetail } from '@/components/session/session-detail';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { InboxThread, SessionRow } from '@/lib/types';
import { visibleThreads, type InboxFilter } from '@/lib/inbox-logic';

// Matches inbox.js's render(): the two-pane Inbox shell (thread list +
// thread detail), built once and kept mounted so the search input never
// loses focus across a refresh (matches the static renderer's stated
// invariant in inbox.js's render() comment). The detail pane renders the
// SAME SessionDetail component family the full-width session-detail view
// uses (renderer.js: "the SAME detail component... never a fork"); this
// pane omits the back breadcrumb since the thread list sits beside it.
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

  function select(id: string) {
    setSelId(id);
    onMarkRead(id);
  }

  return (
    <div className="grid h-full grid-cols-[340px_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-border bg-bg2">
        <div className="flex h-[38px] flex-none items-center gap-2 border-b border-border px-6">
          <span aria-hidden="true">&#9993;</span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-ink2">Inbox</span>
          <span className="font-mono text-[9.5px] text-ink4">{list.length} {list.length === 1 ? 'thread' : 'threads'}</span>
          <Button variant="outline" size="sm" className="ml-auto h-6 px-2 font-mono text-[9px] text-ink3" onClick={onMarkAllRead}>
            mark all read
          </Button>
        </div>
        <InboxToolbar filter={filter} onChange={setFilter} />
        <ScrollArea className="min-h-0 flex-1">
          {list.length === 0 ? (
            <div className="p-6 font-mono text-[12px] text-ink3">
              No agent updates match. Agents post here via <code className="rounded bg-panel2 px-1.5 py-px">humanctl note</code>.
            </div>
          ) : (
            list.map((t) => (
              <ThreadRow
                key={t.sessionId}
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
            ))
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
