import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar, SidebarEdgePeek } from '@/components/shell/nav-sidebar';
import { Header } from '@/components/shell/header';
import { ContextBar } from '@/components/shell/context-bar';
import { CosDrawer } from '@/components/shell/cos-drawer';
import { CommandPalette } from '@/components/command-palette';
import { InboxView } from '@/components/inbox/inbox-view';
import { SessionDetail } from '@/components/session/session-detail';
import { MetricsView } from '@/components/views/metrics-view';
import { FleetView } from '@/components/views/fleet-view';
import { SessionsView } from '@/components/views/sessions-view';
import { SettingsView } from '@/components/views/settings-view';
import { useAppState, useFleetData, useSessionSummarize } from '@/hooks/use-humanctl';
import type { AppState, InboxThread, SessionRow, ViewName } from '@/lib/types';

const VIEW_FOR_KEY: Record<string, ViewName> = { '1': 'inbox', '2': 'metrics', '3': 'fleet', '4': 'sessions' };

// App root for the renderer-vite renderer, the sole humanctl desktop
// renderer. Wires the shell (full-height sidebar, inset header, inset
// context bar, CoS drawer) around the Inbox view and the full-width
// session-detail view reached from it, plus the four real
// Sessions/Metrics/Fleet/Settings views (stage 2d); the reply/suggested-
// responses feature is further out.
//
// STAGE 2B: the shell moved from a fixed-position hover-expand nav rail
// (grid-rows layout, deleted nav-rail.tsx) to the shadcn Sidebar primitive
// in a full-height sidebar layout: SidebarProvider wraps a
// Sidebar (nav-sidebar.tsx) and a SidebarInset that owns the
// header/content/context-bar column to its right. See DESIGN.md's
// "Information architecture" section for the conformance statement.
//
// STAGE-OFFCANVAS (0.17.4): the Sidebar is now collapsible="offcanvas"
// (fully hidden when collapsed, not an icon rail); <SidebarEdgePeek/> is
// rendered here as a sibling of <AppSidebar/>, both inside SidebarProvider,
// so it shares the same sidebar context to open it on a left-edge hover
// (see nav-sidebar.tsx for why it cannot live nested inside AppSidebar).
export default function App() {
  const { rows, threads, status, claudeQuota, demo, refresh } = useFleetData();
  const { state, patch } = useAppState();
  const { summarize, loadingId: summaryLoadingId, errors: summaryErrors } = useSessionSummarize();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<string, SessionRow>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  const pins = useMemo(() => new Set(state.pins || []), [state.pins]);
  // Memoized because the `|| {}` fallback otherwise allocates a fresh object on
  // every render, which would re-run the unreadCount useMemo below every time.
  const lastReadTs = useMemo(() => state.lastReadTs || {}, [state.lastReadTs]);

  const unreadCount = useMemo(() => {
    return threads.filter((t) => {
      const last = lastReadTs[t.sessionId] || 0;
      return t.items.some((it) => (Date.parse(it.ts) || 0) > last);
    }).length;
  }, [threads, lastReadTs]);

  // theme application: adds/removes the .light class on <html>, resolves
  // 'system' via prefers-color-scheme.
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

  // Perf-harness hook (scripts/perf-selftest/run.js). The LOCAL perf gate
  // drives the renderer over CDP; it needs a stable way to switch views
  // (click-to-paint) and to force a fleet refresh (idle/signature-gate/heap
  // checks) without depending on the old renderer's window.setView /
  // window.scheduleRefresh globals, which no longer exist. This exposes just
  // those two operations. Benign in normal use (both are already user-
  // reachable via the nav and the 20s poll); it exists so the perf SLOs stay
  // enforceable against the React renderer. Not a registered command:
  // renderer-only view state + a re-fetch of already-registered reads.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__humanctlPerf = {
      setView: (v: ViewName) => patch({ view: v, selectedId: undefined }),
      refresh,
    };
    return () => { delete w.__humanctlPerf; };
  }, [patch, refresh]);

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
    toast('marked all read');
  }
  function togglePin(id: string) {
    const next = new Set(pins);
    if (next.has(id)) next.delete(id); else next.add(id);
    patch({ pins: [...next] });
  }
  // Shared by the nav-sidebar theme picker and the command palette's
  // "Toggle theme" action (both call this same prop, never a duplicated
  // patch({theme}) call) so a theme change ALWAYS gets feedback no matter
  // which entry point triggered it; Settings' own ToggleGroup fires its own
  // toast alongside its own patch call for the same reason (settings-view.tsx).
  function setTheme(theme: AppState['theme']) {
    patch({ theme });
    toast(`theme: ${theme}`);
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
    const engine = row.harness === 'codex' ? 'Codex' : 'Claude';
    if (!window.humanctl) {
      toast(`resume: ${engine} (demo, no bridge)`);
      return;
    }
    if (row.harness === 'codex') window.humanctl.openInApp({ id: row.id, path: row.path, harness: row.harness });
    else window.humanctl.resumeSession({ id: row.id, path: row.path, harness: row.harness, cwd: row.cwd });
    toast(`resume: ${engine}`);
  }
  // AI summary generation is a durable per-session state mutation on the
  // real backend (session:summarize -> lib/commands.ts's registered
  // session.summarize command); this hook just calls it and lets the next
  // sessions:list refresh reflect the persisted summary on the row.
  function generateSummary(row: SessionRow) {
    summarize(row);
  }

  const selectedId = state.selectedId || null;
  const selectedRow = selectedId ? byId.get(selectedId) || null : null;
  const matchedThread = selectedId ? threads.find((t) => t.sessionId === selectedId) || null : null;
  // Sessions view (stage 2d) can open detail on ANY session in the 72h scan,
  // not just ones with an active ask/note -- inboxThreads (lib/commands.ts)
  // only assembles a thread for sessions with a note, a need/block state, or
  // a persisted ask log. When a session has no matching thread, synthesize an
  // empty one from the row alone so SessionDetail still renders (its stream
  // falls back to its own "no updates in this thread yet" empty state); this
  // never touches SessionDetail itself, just what App feeds it.
  const selectedThread: InboxThread | null = matchedThread || (selectedRow ? {
    sessionId: selectedRow.id,
    repo: selectedRow.repo,
    harness: selectedRow.harness,
    cwd: selectedRow.cwd,
    path: selectedRow.path || '',
    title: selectedRow.customTitle || selectedRow.title,
    items: [],
    lastTs: new Date(Date.now() - (selectedRow.ageMs || 0)).toISOString(),
  } : null);

  function openDetail(id: string) {
    patch({ selectedId: id });
  }
  function closeDetail() {
    patch({ selectedId: undefined });
  }

  // Global keyboard shortcuts (DESIGN.md's nav paragraph): 1/2/3/4 switch
  // views (and close any open session detail, matching the old nav rail's
  // onNavigate), 'a' summons/dismisses the chief-of-staff drawer, Cmd/Ctrl+K
  // toggles the command palette. Cmd/Ctrl+\ (the sidebar expand/collapse
  // toggle) is handled inside SidebarProvider itself
  // (components/ui/sidebar.tsx's SIDEBAR_KEYBOARD_SHORTCUT), not here. This
  // is ONE declared `keydown` listener on `window`, mounted for App's
  // lifetime and removed on unmount -- an event listener, not a recurring
  // timer/poller, so it is outside AGENTS.md's declared-cadence rule, but
  // its lifecycle is stated here per that rule's spirit.
  //
  // Cmd/Ctrl+K is checked FIRST, before the modifier/input-focus guards
  // below: unlike the bare 1/2/3/4/a keys (which must stay silent while the
  // human is typing in a search box or composer), a global palette chord
  // should fire everywhere, including while an input has focus -- Esc
  // (handled by cmdk/Dialog itself) is the symmetric way back out.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const nextView = VIEW_FOR_KEY[e.key];
      if (nextView) {
        e.preventDefault();
        closeDetail();
        patch({ view: nextView });
        return;
      }
      if (e.key === 'a') {
        e.preventDefault();
        patch({ rightRailOpen: !state.rightRailOpen });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rightRailOpen]);

  return (
    <TooltipProvider delayDuration={350}>
      <SidebarProvider
        className="h-screen"
        open={state.navPinned}
        onOpenChange={(open) => patch({ navPinned: open })}
      >
        <AppSidebar
          view={state.view}
          onNavigate={(v) => { closeDetail(); patch({ view: v }); }}
          unreadCount={unreadCount}
          theme={state.theme}
          onSetTheme={setTheme}
        />
        <SidebarEdgePeek />
        <SidebarInset className="h-full overflow-hidden">
          <Header demo={demo} version={status?.version} rightRailOpen={state.rightRailOpen} onToggleRightRail={() => patch({ rightRailOpen: !state.rightRailOpen })} />
          <div className="relative min-h-0 flex-1 overflow-hidden">
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
            ) : state.view === 'sessions' ? (
              <SessionsView
                rows={rows}
                pins={pins}
                selectedId={selectedId}
                onSelect={openDetail}
                onTogglePin={togglePin}
              />
            ) : state.view === 'metrics' ? (
              <MetricsView rows={rows} status={status} claudeQuota={claudeQuota} />
            ) : state.view === 'fleet' ? (
              <FleetView rows={rows} status={status} />
            ) : (
              <SettingsView state={state} patch={patch} />
            )}
          </div>
          <ContextBar status={status} claudeQuota={claudeQuota} ctxPct={selectedRow?.contextPct ?? null} />
        </SidebarInset>
        {/* Rendered inside SidebarProvider (not SidebarInset) so it can call
            useSidebar().toggleSidebar() for its "toggle sidebar" action --
            its actual overlay is Radix-portaled to <body>, so this sibling
            position never affects the sidebar/inset flex layout above. */}
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          rows={rows}
          view={state.view}
          onNavigate={(v) => { closeDetail(); patch({ view: v }); }}
          onOpenSession={openDetail}
          onMarkAllRead={markAllRead}
          theme={state.theme}
          onSetTheme={setTheme}
          rightRailOpen={state.rightRailOpen}
          onToggleRightRail={() => patch({ rightRailOpen: !state.rightRailOpen })}
        />
      </SidebarProvider>
      <CosDrawer open={state.rightRailOpen} onOpenChange={(open) => patch({ rightRailOpen: open })} />
      <Toaster />
    </TooltipProvider>
  );
}
