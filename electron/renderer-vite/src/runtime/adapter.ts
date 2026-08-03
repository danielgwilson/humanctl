import type {
  AnswerAskResult,
  AppState,
  BudgetStatus,
  ClaudeQuota,
  InboxThread,
  NoteItem,
  SessionAppendPayload,
  SessionRow,
  SkillAggregate,
  Status,
  TimelinePage,
  VaultSnapshotModel,
} from './contracts';

export interface BridgeResult {
  ok: boolean;
  error?: string;
}

export interface StatusResult extends BridgeResult { status?: Status }
export interface SessionsResult extends BridgeResult { rows?: SessionRow[] }
export interface NotesResult extends BridgeResult { notes?: NoteItem[] }
export interface InboxResult extends BridgeResult { threads?: InboxThread[] }
export interface QuotaResult extends BridgeResult { quota?: ClaudeQuota | null }
export interface StateResult extends BridgeResult { state?: AppState }
export interface SkillsResult extends BridgeResult { agg?: SkillAggregate }
export interface BudgetResult extends BridgeResult { budget?: BudgetStatus }
export interface TimelineResult extends BridgeResult { page?: TimelinePage }
export interface BrainResult extends BridgeResult { snapshot?: VaultSnapshotModel | null; unsupportedVersion?: boolean }
export interface AskResult extends BridgeResult { answer?: string; engine?: string; at?: number }
export interface SummaryResult extends BridgeResult { summary?: string; engine?: string }

export interface AnswerAskArgs {
  id: string;
  harness?: string;
  path?: string;
  cwd?: string;
  text: string;
  askId?: string;
}

export interface TimelineReadArgs {
  id?: string;
  path?: string;
  harness?: string;
  before?: number;
}

/**
 * The complete runtime-facing transport. Desktop and fixture implementations
 * obey the same contract, so no viewport code branches on environment.
 */
export interface HumanctlAdapter {
  readonly mode: 'desktop' | 'fixture';

  getStatus(opts?: unknown): Promise<StatusResult>;
  listSessions(opts?: unknown): Promise<SessionsResult>;
  getNotes(opts?: unknown): Promise<NotesResult>;
  getInboxThreads(opts?: unknown): Promise<InboxResult>;
  getClaudeQuota(): Promise<QuotaResult>;

  getState(): Promise<StateResult>;
  setState(patch: Partial<AppState>): Promise<BridgeResult>;
  markThreadRead(arg: { threadId: string; at: number }): Promise<BridgeResult>;
  markAllThreadsRead(): Promise<BridgeResult>;

  aggregateSkills(opts?: unknown): Promise<SkillsResult>;
  getBrain(arg?: { path?: string }): Promise<BrainResult>;
  getSummaryBudget(opts?: unknown): Promise<BudgetResult>;
  askAtlas(arg: { question: string; engine?: string }): Promise<AskResult>;
  askSession(arg: {
    id: string;
    path?: string;
    harness: string;
    cwd?: string;
    question: string;
  }): Promise<AskResult>;
  answerAsk(arg: AnswerAskArgs): Promise<AnswerAskResult>;
  summarize(arg: {
    id: string;
    path?: string;
    harness: string;
    engine?: AppState['summarizer'];
  }): Promise<SummaryResult>;
  resumeSession(arg: { id: string; path?: string; harness: string; cwd?: string }): Promise<BridgeResult>;
  openInApp(arg: { id: string; path?: string; harness: string }): Promise<BridgeResult>;
  revealSession(path: string): Promise<BridgeResult>;
  openExternal(url: string): Promise<BridgeResult>;
  openPath(path: string): Promise<BridgeResult>;

  readTimeline(arg: TimelineReadArgs): Promise<TimelineResult>;
  setHotSession(arg: { path: string; harness?: string; from?: number } | null): Promise<BridgeResult>;

  onSessionsChanged(cb: () => void): () => void;
  onInboxFast(cb: () => void): () => void;
  onStateChanged(cb: (state: AppState) => void): () => void;
  onSessionAppend(cb: (payload: SessionAppendPayload) => void): () => void;
}
