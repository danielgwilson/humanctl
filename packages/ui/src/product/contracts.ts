export type HumanctlHarness = "claude-code" | "codex"
export type HumanctlSessionState = "work" | "need" | "block" | "idle" | "done"
export type HumanctlTier = "hot" | "drifting" | "archived"
export type HumanctlView = "inbox" | "metrics" | "fleet" | "brain" | "sessions" | "settings"
export type HumanctlTheme = "system" | "light" | "dark"

export interface HumanctlSessionSummary {
  text: string
  engine?: string
  at?: number
}

export interface HumanctlSession {
  id: string
  harness: HumanctlHarness
  repo?: string
  cwd?: string
  path?: string
  title?: string
  customTitle?: string
  state: HumanctlSessionState
  stateReason?: string
  tier: HumanctlTier
  age?: string
  ageMs: number
  createdMs?: number
  contextPct?: number | null
  costUSD?: number | null
  apiEquivUSD?: number | null
  model?: string
  reasoningEffort?: string | null
  ultracode?: boolean
  lastUser?: string
  prevAgent?: string
  lastRole?: string
  summary?: HumanctlSessionSummary | null
}

export interface HumanctlNote {
  id: string
  ts: string
  level: "fyi" | "review" | "blocked" | "done"
  message: string
  repo?: string
  session?: string
}

export type HumanctlThreadItem =
  | { kind: "note"; level: HumanctlNote["level"]; message: string; ts: string; id: string }
  | { kind: "ask"; level?: string; reason: string; ts: string }
  | { kind: "ask-interrupted"; question?: string; ts: string }
  | { kind: "qa"; question: string; answer: string; engine?: string; ts: string }
  | { kind: "answer"; text: string; askId?: string; delivery?: string; actor?: string; ts: string }

export interface HumanctlInboxThread {
  sessionId: string
  repo?: string
  harness?: HumanctlHarness
  cwd?: string
  path: string
  title?: string
  session?: HumanctlSession
  items: HumanctlThreadItem[]
  lastTs: string
}

export interface HumanctlQuotaWindow {
  used_percent: number
  window_minutes?: number
  resets_at?: number
  resets_at_text?: string
  label?: string
}

export interface HumanctlClaudeQuota {
  windows: HumanctlQuotaWindow[]
  at: number
}

export interface HumanctlStatus {
  per: Record<string, {
    sessions: number
    generated: number
    totalTokens: number
    costUSD?: number
    apiEquivUSD?: number
  }>
  codexQuota?: {
    plan_type: string
    primary?: HumanctlQuotaWindow
    secondary?: HumanctlQuotaWindow
  }
  needsYou: number
  working: number
  nearCompaction: number
  sessions: number
  pricingAsOf?: string
  generatedAt: string
  version?: string
}

export type HumanctlTimelineEvent =
  | { k: "user" | "assistant" | "interrupt"; t?: string; ts: number | null }
  | { k: "tools"; n: number; ts: number | null }

export interface HumanctlTimelineMeta {
  customTitle?: string
  model?: string
  effort?: string
}

export interface HumanctlTimeline {
  session: Pick<HumanctlSession, "id" | "path" | "harness">
  items: ReadonlyArray<{ key: number; event: HumanctlTimelineEvent }>
  start: number | null
  end: number | null
  size: number | null
  atStart: boolean
  capped: boolean
  estEarlier: number | null
  loadingOlder: boolean
  live: boolean
  meta: HumanctlTimelineMeta | null
  changeKind: "initial" | "append" | "prepend" | "reset"
  changeSeq: number
}

export interface HumanctlSkillAggregate {
  skills: Record<string, number>
  sessionsWithSkills: number
  totalInvocations: number
}

export interface HumanctlBudgetStatus {
  day: string
  spentUSD: number
  dailyBudgetUSD: number
  paused: boolean
  remainingUSD: number
}

export interface HumanctlAtlasExchange {
  id: number
  question: string
  answer: string
  engine?: string
  at: number
}

export interface HumanctlAnswerResult {
  ok: boolean
  delivery?: "codex-rollout" | "staged" | "file"
  delivered?: boolean
  deliverError?: string
  clipped?: boolean
  clipboardError?: string
  resumed?: boolean
  resumeError?: string
  needsAck?: boolean
  error?: string
  sessionId?: string
  at?: number
}

export interface HumanctlAppState {
  pins: string[]
  theme: HumanctlTheme
  view: HumanctlView
  navPinned: boolean
  rightRailOpen: boolean
  lastReadTs?: Record<string, number>
  summarizer?: "claude" | "codex"
  selectedId?: string
  summaryBudgetUSD?: number
  askCodexAck?: boolean
}

export type HumanctlResourceStatus = "idle" | "loading" | "ready" | "error"

export interface HumanctlResource<T> {
  status: HumanctlResourceStatus
  data: T
  error: string | null
  updatedAt: number | null
}

export interface HumanctlOperation {
  status: "pending" | "succeeded" | "failed"
  error: string | null
  updatedAt: number
}

export interface HumanctlApplicationModel {
  mode: "desktop" | "fixture"
  resources: {
    appState: HumanctlResource<HumanctlAppState>
    status: HumanctlResource<HumanctlStatus | null>
    sessions: HumanctlResource<ReadonlyArray<HumanctlSession>>
    notes: HumanctlResource<ReadonlyArray<HumanctlNote>>
    inbox: HumanctlResource<ReadonlyArray<HumanctlInboxThread>>
    quota: HumanctlResource<HumanctlClaudeQuota | null>
    skills: HumanctlResource<HumanctlSkillAggregate | null>
    budget: HumanctlResource<HumanctlBudgetStatus | null>
    timeline: HumanctlResource<HumanctlTimeline | null>
    atlas: HumanctlResource<ReadonlyArray<HumanctlAtlasExchange>>
  }
  operations: Readonly<Record<string, HumanctlOperation>>
}

export type HumanctlIntent =
  | { type: "fleet.refresh" }
  | { type: "app.patch"; patch: Partial<HumanctlAppState> }
  | { type: "session.togglePin"; id: string }
  | { type: "thread.markRead"; threadId: string; at?: number }
  | { type: "threads.markAllRead"; at?: number }
  | { type: "metrics.loadSkills" }
  | { type: "settings.loadBudget"; dailyBudgetUSD: number }
  | { type: "atlas.ask"; question: string; engine?: "claude" | "codex" }
  | { type: "session.ask"; session: HumanctlSession; question: string }
  | { type: "ask.answer"; session: HumanctlSession; text: string; askId?: string }
  | { type: "session.summarize"; session: HumanctlSession }
  | { type: "session.resume"; session: HumanctlSession }
  | { type: "session.reveal"; path: string }
  | { type: "app.openExternal"; url: string }
  | { type: "app.openPath"; path: string }
  | { type: "timeline.open"; session: HumanctlSession }
  | { type: "timeline.close" }
  | { type: "timeline.loadOlder" }

export type HumanctlDispatchOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

export type HumanctlDispatch = (intent: HumanctlIntent) => Promise<HumanctlDispatchOutcome>

export interface HumanctlApplicationProps {
  model: HumanctlApplicationModel
  dispatch: HumanctlDispatch
  version: string
}
