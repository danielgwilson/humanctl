import { useEffect, useMemo } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NavRail } from '@/components/shell/nav-rail';
import { Header } from '@/components/shell/header';
import { ContextBar } from '@/components/shell/context-bar';
import { CosDrawer } from '@/components/shell/cos-drawer';
import { InboxView } from '@/components/inbox/inbox-view';
import { useAppState, useFleetData } from '@/hooks/use-humanctl';
import type { SessionRow } from '@/lib/types';

// App root for the MIGRATION SPIKE renderer (spike/electron-vite-shadcn).
// Wires the shell (nav rail, header, context bar, CoS drawer) around the
// Inbox view -- the one view this spike ports to parity, per the spike scope
// (Sessions/Metrics/Fleet/Settings are explicitly out of scope; see the
// spike report for the honest port-the-rest estimate).
export default function App() {
  const { rows, threads, status, demo } = useFleetData();
  const { state, patch } = useAppState();

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

  const selectedCtxPct = null; // no full-width detail overlay in this spike; see report

  return (
    <TooltipProvider delayDuration={350}>
      <div className="grid h-screen grid-rows-[52px_1fr_30px]" style={{ ['--hdr-h' as string]: '52px', ['--ctxbar-h' as string]: '30px' }}>
        <Header demo={demo} rightRailOpen={state.rightRailOpen} onToggleRightRail={() => patch({ rightRailOpen: !state.rightRailOpen })} />
        <div className="relative min-h-0 overflow-hidden">
          <div
            className="h-full transition-[margin-left] duration-150 ease-out"
            style={{ marginLeft: state.navPinned ? 220 : 52 }}
          >
            {state.view === 'inbox' ? (
              <InboxView
                threads={threads}
                byId={byId}
                lastReadTs={lastReadTs}
                pins={pins}
                onMarkRead={markRead}
                onMarkAllRead={markAllRead}
                onTogglePin={togglePin}
                onAsk={askSession}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
                <div className="font-mono text-[44px] font-semibold text-rule2">--</div>
                <div className="text-[16px] font-semibold text-ink2">{state.view} is out of scope for this spike</div>
                <div className="max-w-md text-[12.5px] leading-relaxed text-ink3">
                  This spike ports the Inbox view and shell to parity only. See the spike report for the effort estimate on the rest.
                </div>
              </div>
            )}
          </div>
        </div>
        <ContextBar status={status} navPinned={state.navPinned} ctxPct={selectedCtxPct} />
      </div>
      <NavRail
        view={state.view}
        onNavigate={(v) => patch({ view: v })}
        navPinned={state.navPinned}
        unreadCount={unreadCount}
        theme={state.theme}
        onSetTheme={(t) => patch({ theme: t })}
      />
      <CosDrawer open={state.rightRailOpen} onOpenChange={(open) => patch({ rightRailOpen: open })} />
    </TooltipProvider>
  );
}
