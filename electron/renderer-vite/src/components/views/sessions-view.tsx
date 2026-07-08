import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { List, Bookmark } from 'lucide-react';
import { HarnessGlyph, StateChip } from '@/components/state-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { ViewHeader } from '@/components/shell/view-header';
import { cn } from '@/lib/utils';
import { cwdBase, firstSentence, fmtUSD } from '@/lib/format';
import type { SessionRow } from '@/lib/types';

// Sessions is the SOLE home for "complete fleet" (DESIGN.md one-owner table:
// "Complete fleet | Sessions view | none"). Every session in the 72h scan
// renders here as one row -- Inbox only surfaces threads with an active
// ask/note, Fleet only shows shape/counts, Metrics only shows spend/tokens.
const STATE_ORDER: Record<string, number> = { need: 0, block: 1, work: 2, idle: 3, done: 4 };

interface SessionsFilter {
  q: string;
  state: string;
  harness: string;
  sort: 'recent' | 'needs-first' | 'alpha';
}

const DEFAULT_FILTER: SessionsFilter = { q: '', state: '', harness: '', sort: 'recent' };

// A real fleet is 100+ sessions, all rendered here (DESIGN.md: "Complete
// fleet | Sessions view"), re-reconciling on every 20s poll -- exactly the
// long list AGENTS.md's perf SLOs care about. Virtualized below via ONE
// `@tanstack/react-virtual` instance over a single combined array (the
// "Pinned" section header plus both row groups, in render order) so there
// is still exactly one scroll region and the pinned/rest grouping, click-
// to-open, pin toggling, and state chips all behave identically to the
// unvirtualized version -- only which DOM rows are mounted changes.
const ROW_ESTIMATE_PX = 76;
const HEADER_ESTIMATE_PX = 28;

type SessionVirtualItem =
  | { kind: 'pinned-header'; key: string; count: number }
  | { kind: 'row'; key: string; row: SessionRow; pinned: boolean };

function displayTitle(row: SessionRow): string {
  return row.customTitle || row.title || row.id.slice(0, 10);
}

// The row's "message to the human": the same natural-language state reason
// the row chip already carries (row.stateReason, e.g. "asks you a
// question"), falling back to the prior agent turn -- there is no per-thread
// note/ask stream to draw from here (that is Inbox's own derivation over
// InboxThread, thread-row.tsx's messageToHuman), only the raw session row.
function messageFor(row: SessionRow): string {
  return firstSentence(row.stateReason || row.prevAgent || '') || 'no recent activity';
}

function rowCost(row: SessionRow): string | null {
  const v = row.harness === 'codex' ? row.apiEquivUSD : row.costUSD;
  return v != null ? fmtUSD(v) : null;
}

function SessionRowItem({
  row,
  selected,
  pinned,
  onSelect,
  onTogglePin,
}: {
  row: SessionRow;
  selected: boolean;
  pinned: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const title = displayTitle(row);
  const msg = messageFor(row);
  const cost = rowCost(row);
  const rowLabel = `${title}, ${row.state}, ${msg}${pinned ? ', pinned' : ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={rowLabel}
      title={row.repo || ''}
      onClick={() => onSelect(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.id); }
      }}
      className={cn(
        'grid cursor-pointer grid-cols-[1fr_28px] items-start gap-2 border-b border-border border-l-2 border-l-transparent px-6 py-3 hover:bg-panel',
        selected && 'border-l-iris bg-panel2',
      )}
    >
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <HarnessGlyph harness={row.harness} />
          <span className="flex-1 truncate text-[13px] font-semibold text-foreground">{title}</span>
          <span className="flex-none font-mono text-[9.5px] text-ink4">{row.age}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <StateChip state={row.state} />
          <span className="flex-1 truncate text-[11.5px] text-ink3">{msg}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[9px] text-ink4">
          <span className="truncate">{cwdBase(row.cwd || row.repo)}</span>
          {row.contextPct != null && <span className="flex-none">· {row.contextPct}% ctx</span>}
          {cost && <span className="flex-none">· {cost}</span>}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={(e) => { e.stopPropagation(); onTogglePin(row.id); }}
        aria-label={pinned ? `unpin ${title}` : `pin ${title}`}
        title={pinned ? 'unpin' : 'pin'}
        className={cn(
          'mt-0.5 flex-none rounded text-ink4 hover:bg-transparent hover:text-foreground',
          pinned && 'text-iris hover:text-iris',
        )}
      >
        <Bookmark className="size-[13px]" fill={pinned ? 'currentColor' : 'none'} aria-hidden="true" />
      </Button>
    </div>
  );
}

function SessionsToolbar({ filter, onChange }: { filter: SessionsFilter; onChange: (next: SessionsFilter) => void }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border px-6 py-2">
      <Input
        value={filter.q}
        onChange={(e) => onChange({ ...filter, q: e.target.value })}
        placeholder="Search sessions..."
        aria-label="Search sessions"
        className="min-w-[120px] flex-1 basis-[200px]"
      />
      <Select value={filter.state || 'all'} onValueChange={(v) => onChange({ ...filter, state: v === 'all' ? '' : v })}>
        <SelectTrigger aria-label="Filter by state" className="h-[30px] w-auto font-mono text-[10px]">
          <SelectValue placeholder="all states" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">all states</SelectItem>
          <SelectItem value="need">needs input</SelectItem>
          <SelectItem value="block">blocked</SelectItem>
          <SelectItem value="work">running</SelectItem>
          <SelectItem value="idle">stalled</SelectItem>
          <SelectItem value="done">finished</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filter.harness || 'all'} onValueChange={(v) => onChange({ ...filter, harness: v === 'all' ? '' : v })}>
        <SelectTrigger aria-label="Filter by harness" className="h-[30px] w-auto font-mono text-[10px]">
          <SelectValue placeholder="all harnesses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">all harnesses</SelectItem>
          <SelectItem value="claude-code">claude</SelectItem>
          <SelectItem value="codex">codex</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filter.sort} onValueChange={(v) => onChange({ ...filter, sort: v as SessionsFilter['sort'] })}>
        <SelectTrigger aria-label="Sort sessions" className="h-[30px] w-auto font-mono text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">recent</SelectItem>
          <SelectItem value="needs-first">needs first</SelectItem>
          <SelectItem value="alpha">alpha</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function SessionsView({
  rows,
  pins,
  selectedId,
  onSelect,
  onTogglePin,
}: {
  rows: SessionRow[];
  pins: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const [filter, setFilter] = useState<SessionsFilter>(DEFAULT_FILTER);

  const filtered = useMemo(() => {
    let list = rows.slice();
    const q = filter.q.trim().toLowerCase();
    if (q) list = list.filter((r) => `${displayTitle(r)} ${r.repo || ''} ${messageFor(r)}`.toLowerCase().includes(q));
    if (filter.state) list = list.filter((r) => r.state === filter.state);
    if (filter.harness) list = list.filter((r) => r.harness === filter.harness);
    const cmp: Record<string, (a: SessionRow, b: SessionRow) => number> = {
      recent: (a, b) => a.ageMs - b.ageMs,
      'needs-first': (a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || (a.ageMs - b.ageMs),
      alpha: (a, b) => displayTitle(a).localeCompare(displayTitle(b)),
    };
    return list.sort(cmp[filter.sort] || cmp.recent);
  }, [rows, filter]);

  const { pinnedList, restList } = useMemo(() => {
    const p: SessionRow[] = [];
    const r: SessionRow[] = [];
    for (const row of filtered) (pins.has(row.id) ? p : r).push(row);
    return { pinnedList: p, restList: r };
  }, [filtered, pins]);

  const virtualItems = useMemo<SessionVirtualItem[]>(() => {
    const out: SessionVirtualItem[] = [];
    if (pinnedList.length > 0) {
      out.push({ kind: 'pinned-header', key: '__pinned-header__', count: pinnedList.length });
      for (const row of pinnedList) out.push({ kind: 'row', key: row.id, row, pinned: true });
    }
    for (const row of restList) out.push({ kind: 'row', key: row.id, row, pinned: false });
    return out;
  }, [pinnedList, restList]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (virtualItems[index]?.kind === 'pinned-header' ? HEADER_ESTIMATE_PX : ROW_ESTIMATE_PX),
    overscan: 8,
    getItemKey: (index) => virtualItems[index].key,
  });

  const total = rows.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader icon={List} title="Sessions" subtitle={`${total} ${total === 1 ? 'session' : 'sessions'}`} />
      <SessionsToolbar filter={filter} onChange={setFilter} />
      <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef}>
        {total === 0 ? (
          <Empty className="h-full">
            <EmptyDescription className="text-[12.5px]">no sessions in the last 72h.</EmptyDescription>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty className="h-full">
            <EmptyDescription className="text-[12.5px]">no sessions match.</EmptyDescription>
          </Empty>
        ) : (
          <div style={{ position: 'relative', height: rowVirtualizer.getTotalSize(), width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const item = virtualItems[vRow.index];
              return (
                <div
                  key={item.key}
                  data-index={vRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vRow.start}px)` }}
                >
                  {item.kind === 'pinned-header' ? (
                    <div className="flex items-center gap-2 border-b border-border bg-bg2 px-6 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-ink3">
                      <span className="h-[5px] w-[5px] flex-none rounded-full bg-iris" aria-hidden="true" />
                      Pinned
                      <span className="text-ink4">{item.count}</span>
                    </div>
                  ) : (
                    <SessionRowItem
                      row={item.row}
                      selected={item.row.id === selectedId}
                      pinned={item.pinned}
                      onSelect={onSelect}
                      onTogglePin={onTogglePin}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
