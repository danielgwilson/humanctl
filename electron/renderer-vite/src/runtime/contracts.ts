/**
 * Runtime implementation types for the package-owned viewport contract.
 *
 * The UI package owns the model and intent seam. Runtime-specific transport
 * shapes stay here because the viewport never receives them.
 */
import type {
  HumanctlAnswerResult,
  HumanctlAppState,
  HumanctlApplicationModel,
  HumanctlAtlasExchange,
  HumanctlBudgetStatus,
  HumanctlClaudeQuota,
  HumanctlHarness,
  HumanctlInboxThread,
  HumanctlIntent,
  HumanctlNote,
  HumanctlOperation,
  HumanctlQuotaWindow,
  HumanctlResource,
  HumanctlResourceStatus,
  HumanctlSession,
  HumanctlSessionState,
  HumanctlSessionSummary,
  HumanctlSkillAggregate,
  HumanctlStatus,
  HumanctlTheme,
  HumanctlThreadItem,
  HumanctlTier,
  HumanctlTimeline,
  HumanctlTimelineEvent,
  HumanctlTimelineMeta,
  HumanctlView,
  VaultSnapshot,
} from '@humanctl/ui/product';

export type VaultSnapshotModel = VaultSnapshot;

export type Harness = HumanctlHarness;
export type SessionState = HumanctlSessionState;
export type Tier = HumanctlTier;
export type ViewName = HumanctlView;
export type Theme = HumanctlTheme;
export type SessionSummary = HumanctlSessionSummary;
export type SessionRow = HumanctlSession;
export type NoteItem = HumanctlNote;
export type ThreadItem = HumanctlThreadItem;
export type InboxThread = HumanctlInboxThread;
export type QuotaWindow = HumanctlQuotaWindow;
export type ClaudeQuota = HumanctlClaudeQuota;
export type Status = HumanctlStatus;
export type TimelineEvent = HumanctlTimelineEvent;
export type TimelineMeta = HumanctlTimelineMeta;
export type SkillAggregate = HumanctlSkillAggregate;
export type BudgetStatus = HumanctlBudgetStatus;
export type AnswerAskResult = HumanctlAnswerResult;
export type AppState = HumanctlAppState;
export type ResourceStatus = HumanctlResourceStatus;
export type Resource<T> = HumanctlResource<T>;
export type KeyedTimelineEvent = HumanctlTimeline['items'][number];
export type TimelineChangeKind = HumanctlTimeline['changeKind'];
export type TimelineModel = HumanctlTimeline;
export type AtlasExchange = HumanctlAtlasExchange;
export type OperationState = HumanctlOperation;
export type RuntimeResources = HumanctlApplicationModel['resources'];
export type RuntimeModel = HumanctlApplicationModel;
export type RuntimeIntent = HumanctlIntent;

export const DEFAULT_APP_STATE: Readonly<AppState> = Object.freeze({
  pins: [],
  theme: 'dark',
  view: 'inbox',
  navPinned: true,
  rightRailOpen: false,
  lastReadTs: {},
  summarizer: 'claude',
});

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  value?: T;
}

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

export interface IntentResultMap {
  'fleet.refresh': undefined;
  'app.patch': AppState;
  'session.togglePin': AppState;
  'thread.markRead': AppState;
  'threads.markAllRead': AppState;
  'metrics.loadSkills': SkillAggregate | null;
  'brain.load': VaultSnapshot | null;
  'settings.loadBudget': BudgetStatus | null;
  'atlas.ask': { answer: string; engine?: string };
  'session.ask': { answer: string; engine?: string };
  'ask.answer': AnswerAskResult;
  'session.summarize': { summary: string; engine?: string };
  'session.resume': undefined;
  'session.reveal': undefined;
  'app.openExternal': undefined;
  'app.openPath': undefined;
  'timeline.open': TimelineModel | null;
  'timeline.close': undefined;
  'timeline.loadOlder': TimelineModel | null;
}

export type IntentResult<I extends RuntimeIntent> = IntentResultMap[I['type']];

export type DispatchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type RuntimeDispatch = <I extends RuntimeIntent>(
  intent: I,
) => Promise<DispatchOutcome<IntentResult<I>>>;
