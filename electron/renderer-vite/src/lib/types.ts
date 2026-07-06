// Typed shapes for the EXISTING window.humanctl IPC surface (electron/preload.js).
// This spike consumes that bridge UNCHANGED: no new IPC channel, no new main
// process handler. Types here are intentionally loose (mirrors what
// lib/sessions.js / lib/commands.js actually return) rather than a full
// re-derivation of the backend's internal shapes.

export type Harness = 'claude-code' | 'codex';
export type SessionState = 'work' | 'need' | 'block' | 'idle' | 'done';
export type Tier = 'hot' | 'drifting' | 'archived';

export interface SessionRow {
  id: string;
  harness: Harness;
  repo?: string;
  cwd?: string;
  path?: string;
  title?: string;
  customTitle?: string;
  state: SessionState;
  stateReason?: string;
  tier: Tier;
  age?: string;
  ageMs: number;
  createdMs?: number;
  contextPct?: number | null;
  costUSD?: number | null;
  apiEquivUSD?: number | null;
  model?: string;
  reasoningEffort?: string | null;
  ultracode?: boolean;
  lastUser?: string;
  prevAgent?: string;
  lastRole?: string;
}

export interface NoteItem {
  id: string;
  ts: string;
  level: 'fyi' | 'review' | 'blocked' | 'done';
  message: string;
  repo?: string;
  session?: string;
}

export type ThreadItem =
  | { kind: 'note'; level: NoteItem['level']; message: string; ts: string; id: string }
  | { kind: 'ask'; level?: string; reason: string; ts: string }
  | { kind: 'ask-interrupted'; question?: string; ts: string }
  | { kind: 'qa'; question: string; answer: string; engine?: string; ts: string };

export interface InboxThread {
  sessionId: string;
  repo?: string;
  harness: Harness;
  cwd?: string;
  path: string;
  title?: string;
  items: ThreadItem[];
  lastTs: string;
}

export interface QuotaWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number;
}
export interface Status {
  per: Record<string, { sessions: number; generated: number; totalTokens: number; costUSD?: number; apiEquivUSD?: number }>;
  codexQuota?: { plan_type: string; primary?: QuotaWindow; secondary?: QuotaWindow };
  needsYou: number;
  working: number;
  nearCompaction: number;
  sessions: number;
  pricingAsOf?: string;
  generatedAt: string;
  version?: string;
}

export interface AppState {
  pins: string[];
  theme: 'system' | 'light' | 'dark';
  view: 'inbox' | 'metrics' | 'fleet' | 'sessions' | 'settings';
  navPinned: boolean;
  rightRailOpen: boolean;
  lastReadTs?: Record<string, number>;
  summarizer?: 'claude' | 'codex';
  selectedId?: string;
  summaryBudgetUSD?: number;
}

// The subset of window.humanctl this spike actually calls. Everything here
// exists verbatim in electron/preload.js; the spike adds no new channel.
export interface HumanctlBridge {
  getStatus: (opts?: unknown) => Promise<{ ok: boolean; status?: Status }>;
  listSessions: (opts?: unknown) => Promise<{ ok: boolean; rows?: SessionRow[] }>;
  getNotes: (opts?: unknown) => Promise<{ ok: boolean; notes?: NoteItem[] }>;
  getInboxThreads: (opts?: unknown) => Promise<{ ok: boolean; threads?: InboxThread[] }>;
  getState: () => Promise<{ ok: boolean; state?: AppState }>;
  setState: (patch: Partial<AppState>) => Promise<{ ok: boolean }>;
  setView: (view: AppState['view']) => Promise<{ ok: boolean }>;
  markThreadRead: (arg: { threadId: string; at: number }) => Promise<{ ok: boolean }>;
  markAllThreadsRead: () => Promise<{ ok: boolean }>;
  askAtlas: (arg: { question: string; engine?: string }) => Promise<{ ok: boolean; answer?: string; engine?: string; at?: number; error?: string }>;
  askSession: (arg: unknown) => Promise<{ ok: boolean; answer?: string; engine?: string; error?: string }>;
  summarize: (arg: unknown) => Promise<{ ok: boolean; summary?: string; engine?: string; error?: string }>;
  resumeSession: (arg: unknown) => Promise<{ ok: boolean }>;
  openInApp: (arg: unknown) => Promise<{ ok: boolean }>;
  revealSession: (path: string) => Promise<{ ok: boolean }>;
  onSessionsChanged: (cb: () => void) => () => void;
  onInboxFast: (cb: () => void) => () => void;
  onStateChanged: (cb: (state: AppState) => void) => () => void;
}

declare global {
  interface Window {
    humanctl?: HumanctlBridge;
  }
}
