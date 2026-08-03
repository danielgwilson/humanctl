import type {
  HumanctlInboxThread,
  HumanctlHarness,
  HumanctlQuotaWindow,
  HumanctlSession,
  HumanctlSessionState,
  HumanctlThreadItem,
} from "./contracts"
import type { StatusState } from "@humanctl/ui/blocks/status"

export type HarnessFilter = "all" | "claude-code" | "codex"
export type SessionStateFilter = "all" | HumanctlSessionState
export type SessionSort = "recent" | "needs" | "alphabetic" | "context" | "cost"
export type InboxSort = "needs" | "recent" | "alphabetic" | "unread"

export type InboxDerivationInput = {
  threads: ReadonlyArray<HumanctlInboxThread>
  sessionsById: ReadonlyMap<string, HumanctlSession>
  query: string
  harness: HarnessFilter
  state: SessionStateFilter
  sort: InboxSort
  pins: ReadonlySet<string>
  lastReadTs: Readonly<Record<string, number>>
}

export function sessionTitle(session: HumanctlSession): string {
  return session.customTitle || session.title || session.id.slice(0, 12)
}

export function sessionMessage(session: HumanctlSession): string | undefined {
  return session.summary?.text || session.prevAgent || session.stateReason
}

export function basename(value?: string): string {
  if (!value) return "No workspace"
  const clean = value.replace(/\/$/, "")
  return clean.split("/").filter(Boolean).pop() || clean
}

export function sessionRepo(session: HumanctlSession): string {
  return basename(session.repo || session.cwd)
}

export function harnessLabel(harness?: HumanctlHarness): string {
  if (harness === "codex") return "Codex"
  if (harness === "claude-code") return "Claude Code"
  return "Unknown harness"
}

export function formatMoney(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "$0.00"
  return `$${value.toFixed(2)}`
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export function formatTime(value?: number | string | null): string {
  if (value == null) return "Unknown"
  const time = typeof value === "string" ? Date.parse(value) : value
  if (!Number.isFinite(time)) return "Unknown"
  const delta = Math.max(0, Date.now() - time)
  if (delta < 60_000) return "now"
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.round(delta / 86_400_000)}d`
}

export function quotaReset(window?: HumanctlQuotaWindow, preferText = false): string | undefined {
  if (!window) return undefined
  if (preferText && window.resets_at_text) return window.resets_at_text
  if (window.resets_at) {
    const remaining = window.resets_at * 1000 - Date.now()
    if (remaining <= 0) return "Reset time passed"
    if (remaining < 3_600_000) return `Resets in ${Math.max(1, Math.ceil(remaining / 60_000))}m`
    if (remaining < 86_400_000) return `Resets in ${Math.ceil(remaining / 3_600_000)}h`
    return `Resets in ${Math.ceil(remaining / 86_400_000)}d`
  }
  if (window.resets_at_text) return window.resets_at_text
  return undefined
}

export function threadLatest(thread: HumanctlInboxThread): HumanctlThreadItem | undefined {
  return thread.items[thread.items.length - 1]
}

export function threadPreview(thread: HumanctlInboxThread): string {
  const item = threadLatest(thread)
  if (!item) return "No updates in this thread"
  if (item.kind === "note") return item.message
  if (item.kind === "ask") return item.reason
  if (item.kind === "ask-interrupted") return item.question || "The session question was interrupted"
  if (item.kind === "qa") return item.answer
  return item.text
}

export function threadUnread(thread: HumanctlInboxThread, lastReadTs: Record<string, number>): boolean {
  const readAt = lastReadTs[thread.sessionId] || 0
  return thread.items.some((item) => (Date.parse(item.ts) || 0) > readAt)
}

export function filterSessions(
  sessions: ReadonlyArray<HumanctlSession>,
  query: string,
  harness: HarnessFilter,
  state: SessionStateFilter,
  sort: SessionSort,
): HumanctlSession[] {
  const needle = query.trim().toLowerCase()
  const visible = sessions.filter((session) => {
    if (harness !== "all" && session.harness !== harness) return false
    if (state !== "all" && session.state !== state) return false
    if (!needle) return true
    const haystack = [
      sessionTitle(session),
      session.repo,
      session.cwd,
      session.summary?.text,
      session.prevAgent,
      session.lastUser,
      session.stateReason,
      session.model,
      session.id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return haystack.includes(needle)
  })

  const priority: Record<HumanctlSessionState, number> = { need: 0, block: 1, work: 2, idle: 3, done: 4 }
  return visible.sort((left, right) => {
    if (sort === "needs") return priority[left.state] - priority[right.state] || right.ageMs - left.ageMs
    if (sort === "alphabetic") return sessionTitle(left).localeCompare(sessionTitle(right))
    if (sort === "context") return (right.contextPct || 0) - (left.contextPct || 0)
    if (sort === "cost") return ((right.costUSD || right.apiEquivUSD) || 0) - ((left.costUSD || left.apiEquivUSD) || 0)
    return right.ageMs - left.ageMs
  })
}

export function pinSessionsFirst(
  sessions: ReadonlyArray<HumanctlSession>,
  pins: ReadonlySet<string>,
): HumanctlSession[] {
  return sessions.slice().sort((left, right) => Number(pins.has(right.id)) - Number(pins.has(left.id)))
}

export function threadSession(
  thread: HumanctlInboxThread,
  sessionsById: ReadonlyMap<string, HumanctlSession>,
): HumanctlSession | undefined {
  return sessionsById.get(thread.sessionId) || thread.session
}

export function filterInboxThreads({
  threads,
  sessionsById,
  query,
  harness,
  state,
  sort,
  pins,
  lastReadTs,
}: InboxDerivationInput): HumanctlInboxThread[] {
  const needle = query.trim().toLowerCase()
  const values = threads.filter((thread) => {
    const session = threadSession(thread, sessionsById)
    if (harness !== "all" && (session?.harness || thread.harness) !== harness) return false
    if (state !== "all" && session?.state !== state) return false
    if (!needle) return true
    const haystack = [
      threadTitle(thread, session),
      thread.repo,
      thread.cwd,
      threadPreview(thread),
      session ? sessionMessage(session) : undefined,
      session?.stateReason,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return haystack.includes(needle)
  })

  const priority: Record<HumanctlSessionState, number> = { need: 0, block: 1, work: 2, idle: 3, done: 4 }
  return values.slice().sort((left, right) => {
    const leftPinned = pins.has(left.sessionId) ? 1 : 0
    const rightPinned = pins.has(right.sessionId) ? 1 : 0
    if (leftPinned !== rightPinned) return rightPinned - leftPinned
    if (sort === "unread") {
      const leftUnread = threadUnread(left, lastReadTs) ? 1 : 0
      const rightUnread = threadUnread(right, lastReadTs) ? 1 : 0
      if (leftUnread !== rightUnread) return rightUnread - leftUnread
    }
    if (sort === "alphabetic") {
      return threadTitle(left, threadSession(left, sessionsById))
        .localeCompare(threadTitle(right, threadSession(right, sessionsById)))
    }
    if (sort === "needs") {
      const leftState = threadSession(left, sessionsById)?.state || "idle"
      const rightState = threadSession(right, sessionsById)?.state || "idle"
      const stateDelta = priority[leftState] - priority[rightState]
      if (stateDelta !== 0) return stateDelta
    }
    return Date.parse(right.lastTs) - Date.parse(left.lastTs)
  })
}

export function operationPending(operations: Readonly<Record<string, { status: string }>>, key: string): boolean {
  return operations[key]?.status === "pending"
}

export function stateLabel(state: HumanctlSessionState): string {
  if (state === "need") return "Needs input"
  if (state === "block") return "Blocked"
  if (state === "work") return "Running"
  if (state === "done") return "Complete"
  return "Idle"
}

export function stateTone(state: HumanctlSessionState): StatusState {
  if (state === "work") return "running"
  if (state === "need") return "needs-input"
  if (state === "block") return "blocked"
  if (state === "done") return "complete"
  return "idle"
}

export function sessionMeta(session: HumanctlSession): string {
  // Recency (the age) is owned by the row's trailing slot, so it is not
  // repeated here. The meta line stays to repo and harness only.
  return [sessionRepo(session), harnessLabel(session.harness)]
    .filter(Boolean)
    .join(" · ")
}

export function threadTitle(thread: HumanctlInboxThread, session?: HumanctlSession): string {
  const resolved = session || thread.session
  return resolved ? sessionTitle(resolved) : thread.title || thread.sessionId.slice(0, 12)
}
