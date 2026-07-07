// Typed shapes for the EXISTING window.humanctl IPC surface
// (electron/preload.ts). This renderer consumes that bridge UNCHANGED: no
// new IPC channel, no new main process handler. Types here are intentionally
// loose (mirrors what lib/sessions.ts / lib/commands.ts actually return)
// rather than a full re-derivation of the backend's internal shapes.

export type Harness = 'claude-code' | 'codex';
export type SessionState = 'work' | 'need' | 'block' | 'idle' | 'done';
export type Tier = 'hot' | 'drifting' | 'archived';

export interface SessionSummary {
  text: string;
  engine?: string;
  at?: number;
}

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
  summary?: SessionSummary | null;
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

// Live timeline (stage 3): mirrors lib/sessions.ts's TimelineEvent /
// TimelinePage exactly (the backend types the renderer never redeclares
// independently, per this file's header comment). `t` is the clipped preview
// text for user/assistant/interrupt rows; `n` is the collapsed tool-call
// count for a run of tool activity. `ts` is a epoch-ms timestamp or null.
export type TimelineEvent =
  | { k: 'user' | 'assistant' | 'interrupt'; t?: string; ts: number | null }
  | { k: 'tools'; n: number; ts: number | null };

export interface TimelineMeta {
  customTitle?: string;
  model?: string;
  effort?: string;
}

// A bounded backward page: [start, end) is the exact byte range scanned,
// `atStart` says whether it reached byte 0 of the file, `estEarlier` is a
// density-based estimate (never exact) of substantive events not shown.
export interface TimelinePage {
  harness: Harness | string;
  events: TimelineEvent[];
  start: number;
  end: number;
  size: number;
  mtimeMs: number;
  atStart: boolean;
  scannedBytes: number;
  estEarlier: number | null;
  meta: TimelineMeta | null;
}

// The session:append IPC payload (electron/main.ts's pumpHot): either a
// reset (rotation/truncation/oversized gap -- re-read a full page) or an
// incremental batch of newly-appended events for the ONE hot session.
export type SessionAppendPayload =
  | { path: string; reset: true; reason?: string }
  | {
      path: string;
      events: TimelineEvent[];
      meta?: TimelineMeta | null;
      need?: { state?: SessionState; reason?: string; tier?: Tier } | null;
      end?: number;
      size?: number;
      at?: number;
    };

// Mirrors lib/sessions.ts's SkillAggregate exactly (skills.aggregate ->
// aggregateSkills). Claude-only (Codex has no structured skill calls).
export interface SkillAggregate {
  skills: Record<string, number>;
  sessionsWithSkills: number;
  totalInvocations: number;
}

// Mirrors lib/summary-budget.ts's BudgetStatus exactly (summary.budget ->
// budgetStatus). Today's always-on-summary spend vs the configured daily cap.
export interface BudgetStatus {
  day: string;
  spentUSD: number;
  dailyBudgetUSD: number;
  paused: boolean;
  remainingUSD: number;
}

export type ViewName = 'inbox' | 'metrics' | 'fleet' | 'sessions' | 'settings';

export interface AppState {
  pins: string[];
  theme: 'system' | 'light' | 'dark';
  view: ViewName;
  navPinned: boolean;
  rightRailOpen: boolean;
  lastReadTs?: Record<string, number>;
  summarizer?: 'claude' | 'codex';
  selectedId?: string;
  summaryBudgetUSD?: number;
}

// The subset of window.humanctl this renderer actually calls. Everything
// here exists verbatim in electron/preload.ts; stage 3 adds the live-timeline
// trio (readTimeline / setHotSession / onSessionAppend) -- no new IPC channel,
// the bridge already exposed these (electron/preload.ts lines 17-18, 52-56).
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
  // Metrics/Settings-only reads (skills.aggregate / summary.budget). Heavier
  // than the fleet poll (full transcript reads for skills; a small JSON file
  // for budget) -- called once per view visit, never on the 20s poll.
  aggregateSkills: (opts?: unknown) => Promise<{ ok: boolean; agg?: SkillAggregate }>;
  getSummaryBudget: (opts?: unknown) => Promise<{ ok: boolean; budget?: BudgetStatus }>;
  resumeSession: (arg: unknown) => Promise<{ ok: boolean }>;
  openInApp: (arg: unknown) => Promise<{ ok: boolean }>;
  revealSession: (path: string) => Promise<{ ok: boolean }>;
  onSessionsChanged: (cb: () => void) => () => void;
  onInboxFast: (cb: () => void) => () => void;
  onStateChanged: (cb: (state: AppState) => void) => () => void;
  // Bounded backward page (sessions:timeline -> session.timeline). Omitting
  // `before` reads the newest page (ending at EOF); passing a previous page's
  // `start` walks one page further back.
  readTimeline: (arg: {
    id?: string;
    path?: string;
    harness?: string;
    before?: number;
  }) => Promise<{ ok: boolean; page?: TimelinePage; error?: string }>;
  // Names which session's transcript the main-process watcher should pump
  // incremental appends for (session:hot). Pass null/omit `path` to stop the
  // hot-append pump (main.ts: `hotPath = arg && arg.path ? ... : null`).
  setHotSession: (
    arg: { path: string; harness?: string; from?: number } | null
  ) => Promise<{ ok: boolean; error?: string }>;
  onSessionAppend: (cb: (payload: SessionAppendPayload) => void) => () => void;
}

declare global {
  interface Window {
    humanctl?: HumanctlBridge;
  }
}
