// Typed React client for the window.humanctl IPC bridge (electron/preload.ts).
// When window.humanctl is absent (this app opened in a plain browser, no
// Electron preload attached), falls back to the synthetic fixtures in
// lib/fixtures.ts -- the whole UI renders and is fully driveable without
// launching Electron.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, InboxThread, NoteItem, SessionRow, Status } from '../lib/types';
import { FIXTURE_NOTES, FIXTURE_ROWS, fixtureStatus, fixtureThreads } from '../lib/fixtures';

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.humanctl;
}

export interface FleetData {
  rows: SessionRow[];
  notes: NoteItem[];
  threads: InboxThread[];
  status: Status | null;
  loading: boolean;
  demo: boolean;
  refresh: () => Promise<void>;
}

/**
 * Polls three IPC calls (sessions.list, notes.list, inbox.threads via
 * getInboxThreads), or serves fixtures when there is no bridge. See the
 * declared 20s idle timer below (DESIGN.md: "declare every timer").
 */
export function useFleetData(): FleetData {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const demo = !isElectron();

  const refresh = useCallback(async () => {
    if (!window.humanctl) {
      setRows(FIXTURE_ROWS);
      setNotes(FIXTURE_NOTES);
      setThreads(fixtureThreads());
      setStatus(fixtureStatus());
      setLoading(false);
      return;
    }
    const [s, l, nt, it] = await Promise.all([
      window.humanctl.getStatus({ maxAgeH: 72, limit: 40 }),
      window.humanctl.listSessions({ maxAgeH: 72, limit: 40, withUsage: true }),
      window.humanctl.getNotes({ limit: 100 }),
      window.humanctl.getInboxThreads({ limit: 200 }),
    ]);
    if (s?.ok && s.status) setStatus(s.status);
    if (l?.ok && l.rows) setRows(l.rows);
    if (nt?.ok && nt.notes) setNotes(nt.notes);
    if (it?.ok && it.threads) setThreads(it.threads);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    if (!window.humanctl) return;
    // Declared timer: the single idle poll, fires every 20s at rest.
    const id = setInterval(refresh, 20000);
    const offList = window.humanctl.onSessionsChanged?.(refresh);
    const offInbox = window.humanctl.onInboxFast?.(refresh);
    return () => {
      clearInterval(id);
      offList?.();
      offInbox?.();
    };
  }, [refresh]);

  return { rows, notes, threads, status, loading, demo, refresh };
}

const DEFAULT_STATE: AppState = {
  pins: [],
  theme: 'dark',
  view: 'inbox',
  navPinned: false,
  rightRailOpen: false,
  lastReadTs: {},
  summarizer: 'claude',
};

/** Persisted app UI state (theme/view/pins/etc), backed by app.state / app.set-state. */
export function useAppState() {
  const [state, setStateLocal] = useState<AppState>(DEFAULT_STATE);
  const hydrated = useRef(false);

  useEffect(() => {
    (async () => {
      if (!window.humanctl) { hydrated.current = true; return; }
      const r = await window.humanctl.getState();
      if (r?.ok && r.state) setStateLocal((prev) => ({ ...prev, ...r.state }));
      hydrated.current = true;
    })();
    const off = window.humanctl?.onStateChanged?.((s) => setStateLocal((prev) => ({ ...prev, ...s })));
    return () => off?.();
  }, []);

  const patch = useCallback((next: Partial<AppState>) => {
    setStateLocal((prev) => ({ ...prev, ...next }));
    window.humanctl?.setState(next);
  }, []);

  return { state, patch };
}

/** Ask-the-chief-of-staff (atlas.ask), same mechanics as atlas.js's runAsk. */
export function useAtlasAsk() {
  const [history, setHistory] = useState<{ q: string; a: string; engine?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const ask = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    if (!window.humanctl) {
      await new Promise((r) => setTimeout(r, 700));
      setHistory((h) => [...h, { q, a: 'Demo answer: in the real app this grounds in pulse --json, recent notes, and the top session states, and cites which sessions or lanes it means.', engine: 'claude' }]);
      setLoading(false);
      return;
    }
    const r = await window.humanctl.askAtlas({ question: q, engine: 'claude' });
    if (r?.ok && r.answer) setHistory((h) => [...h, { q, a: r.answer!, engine: r.engine }]);
    else setHistory((h) => [...h, { q, a: r?.error || 'could not reach the chief of staff.' }]);
    setLoading(false);
  }, []);
  return { history, ask, loading };
}

/**
 * Generate/refresh the per-session AI summary (session:summarize): loading
 * state while in flight, error surfaced with a retry trigger, and the
 * fixture path returns a canned demo summary so the block is fully
 * explorable without Electron.
 */
export function useSessionSummarize() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const summarize = useCallback(async (row: SessionRow): Promise<{ text: string; engine?: string } | null> => {
    setLoadingId(row.id);
    setErrors((e) => { const n = { ...e }; delete n[row.id]; return n; });
    if (!window.humanctl) {
      await new Promise((r) => setTimeout(r, 500));
      setLoadingId(null);
      return { text: 'Demo summary: in the real app this sends recent messages to your local Claude/Codex CLI and returns a grounded recap.', engine: 'claude' };
    }
    const r = await window.humanctl.summarize({ id: row.id, path: row.path, harness: row.harness });
    setLoadingId(null);
    if (r?.ok && r.summary) return { text: r.summary, engine: r.engine };
    setErrors((e) => ({ ...e, [row.id]: r?.error || 'summary failed' }));
    return null;
  }, []);

  return { summarize, loadingId, errors };
}
