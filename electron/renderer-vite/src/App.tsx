import { useEffect, useMemo } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NavRail } from '@/components/shell/nav-rail';
import { Header } from '@/components/shell/header';
import { ContextBar } from '@/components/shell/context-bar';
import { CosDrawer } from '@/components/shell/cos-drawer';
import { PlaceholderView } from '@/components/shell/placeholder-view';
import { InboxView } from '@/components/inbox/inbox-view';
import { SessionDetail } from '@/components/session/session-detail';
import { useAppState, useFleetData, useSessionSummarize } from '@/hooks/use-humanctl';
import type { SessionRow } from '@/lib/types';

const STAGE_FOR_VIEW: Record<string, number> = { metrics: 2, fleet: 2, sessions: 2, settings: 2 };
const LABEL_FOR_VIEW: Record<string, string> = { metrics: 'Metrics', fleet: 'Fleet', sessions: 'Sessions', settings: 'Settings' };

// App root for the renderer-vite renderer (STAGE 1b, gated behind
// HUMANCTL_VITE; see docs/ts-migration-plan.md). Wires the shell (nav rail,
// header, context bar, CoS drawer) around the Inbox view and the full-width
// session-detail view reached from it, at parity with the current
// electron/renderer/ app. Sessions/Metrics/Fleet/Settings are quiet
// placeholders this stage (stage 2 scope); the live-timeline reader and the
// reply/suggested-responses feature are stage 3.
export default function App() {
  const { rows, threads, status, demo } = useFleetData();
  const { state, patch } = useAppState();
  const { summarize, loadingId: summaryLoadingId, errors: summaryErrors } = useSessionSummarize();

  const byId = useMemo(() => {
    const m = new Map<string, SessionRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const pins = useMemo(() => new Set(state.pins || []), [state.pins]);
  const lastReadTs = state.lastReadTs || {};

  const unreadCount = useMemo(() => {
    return threads.filter((t) => {
      const last = lastReadTs[t.sessionId] || 0;
      return t.items.some((it) => (Date.parse(it.ts) || 0) > last);
    }).length;
  }, [threads, lastReadTs]);

  // theme application: mirrors renderer.js's applyTheme() (adds/removes the
  // .light class on <html>, resolves 'system' via prefers-color-scheme).
  useEffect(() => {
    const root = document.documentElement;
    const resolve = () => {
      const pref = state.theme;
      const light = pref === 'light' || (pref === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('light', light);
    };
    resolve();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', resolve);
    return () => mq.removeEventListener('change', resolve);
  }, [state.theme]);

  function markRead(threadId: string) {
    const t = threads.find((x) => x.sessionId === threadId);
    if (!t) return;
    const newest = t.items[t.items.length - 1];
    const at = (newest ? Date.parse(newest.ts) : 0) || Date.now();
    if ((lastReadTs[threadId] || 0) >= at) return;
    patch({ lastReadTs: { ...lastReadTs, [threadId]: at } });
    window.humanctl?.markThreadRead({ threadId, at });
  }
  function markAllRead() {
    const now = Date.now();
    const next: Record<string, number> = { ...lastReadTs };
    for (const t of threads) next[t.sessionId] = now;
    patch({ lastReadTs: next });
    window.humanctl?.markAllThreadsRead();
  }
  function togglePin(id: string) {
    const next = new Set(pins);
    if (next.has(id)) next.delete(id); else next.add(id);
    patch({ pins: [...next] });
  }
  async function askSession(id: string, question: string): Promise<string> {
    const row = byId.get(id);
    if (!window.humanctl || !row) {
      await new Promise((r) => setTimeout(r, 600));
      return 'Demo answer: in the real app this resumes the session headlessly through its own CLI and answers from full context.';
    }
    const r = await window.humanctl.askSession({ id: row.id, path: row.path, harness: row.harness, cwd: row.cwd, question });
    return r?.ok ? (r.answer || '') : (r?.error || 'ask failed');
  }
  function resumeSession(row: SessionRow) {
    if (!window.humanctl) return;
    if (row.harness === 'codex') window.humanctl.openInApp({ id: row.id, path: row.path, harness: row.harness });
    else window.humanctl.resumeSession({ id: row.id, path: row.path, harness: row.harness, cwd: row.cwd });
  }
  // AI summary generation is a durable per-session state mutation on the
  // real backend (session:summarize -> lib/commands.ts's registered
  // session.summarize command); this hook just calls it and lets the next
  // sessions:list refresh reflect the persisted summary on the row.
  function generateSummary(row: SessionRow) {
    summarize(row);
  }

  const selectedId = state.selectedId || null;
  const selectedThread = selectedId ? threads.find((t) => t.sessionId === selectedId) || null : null;
  const selectedRow = selectedId ? byId.get(selectedId) || null : null;

  function openDetail(id: string) {
    patch({ selectedId: id });
  }
  function closeDetail() {
    patch({ selectedId: undefined });
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen grid-rows-[52px_1fr_30px]" style={{ ['--hdr-h' as string]: '52px', ['--ctxbar-h' as string]: '30px' }}>
        <Header demo={demo} version={status?.version} rightRailOpen={state.rightRailOpen} onToggleRightRail={() => patch({ rightRailOpen: !state.rightRailOpen })} />
        <div className="relative min-h-0 overflow-hidden">
          <div
            className="h-full transition-[margin-left] duration-150 ease-out"
            style={{ marginLeft: state.navPinned ? 220 : 52 }}
          >
            {selectedThread ? (
              <SessionDetail
                thread={selectedThread}
                row={selectedRow}
                backLabel={state.view === 'inbox' ? 'Inbox' : 'back'}
                onBack={closeDetail}
                onAsk={askSession}
                onResume={resumeSession}
                summaryLoading={!!selectedRow && summaryLoadingId === selectedRow.id}
                summaryError={selectedRow ? summaryErrors[selectedRow.id] : undefined}
                onGenerateSummary={generateSummary}
              />
            ) : state.view === 'inbox' ? (
              <InboxView
                threads={threads}
                byId={byId}
                lastReadTs={lastReadTs}
                pins={pins}
                onMarkRead={markRead}
                onMarkAllRead={markAllRead}
                onTogglePin={togglePin}
                onAsk={askSession}
                onResume={resumeSession}
                onOpenDetail={openDetail}
                summaryLoadingId={summaryLoadingId}
                summaryErrors={summaryErrors}
                onGenerateSummary={generateSummary}
              />
            ) : (
              <PlaceholderView label={LABEL_FOR_VIEW[state.view] || state.view} stage={STAGE_FOR_VIEW[state.view] || 2} />
            )}
          </div>
        </div>
        <ContextBar status={status} navPinned={state.navPinned} ctxPct={selectedRow?.contextPct ?? null} />
      </div>
      <NavRail
        view={state.view}
        onNavigate={(v) => { closeDetail(); patch({ view: v }); }}
        navPinned={state.navPinned}
        unreadCount={unreadCount}
        theme={state.theme}
        onSetTheme={(t) => patch({ theme: t })}
      />
      <CosDrawer open={state.rightRailOpen} onOpenChange={(open) => patch({ rightRailOpen: open })} />
    </TooltipProvider>
  );
}
