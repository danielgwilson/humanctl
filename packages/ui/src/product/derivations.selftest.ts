import type { HumanctlInboxThread, HumanctlSession, HumanctlSessionState } from "./contracts"
import {
  filterInboxThreads,
  filterSessions,
  nextNeedsAttentionId,
  pinSessionsFirst,
  sessionMessage,
  threadSession,
  type InboxSort,
  type SessionSort,
} from "./helpers"

const NOW = 1_750_000_000_000

function equal(actual: unknown, expected: unknown, label: string) {
  const received = JSON.stringify(actual)
  const wanted = JSON.stringify(expected)
  if (received !== wanted) throw new Error(`${label}: expected ${wanted}, received ${received}`)
}

function session(
  id: string,
  state: HumanctlSessionState,
  ageMs: number,
  overrides: Partial<HumanctlSession> = {},
): HumanctlSession {
  return {
    id,
    harness: "codex",
    repo: `/work/${id}`,
    cwd: `/work/${id}`,
    title: id,
    state,
    tier: "hot",
    ageMs,
    ...overrides,
  }
}

function thread(
  sessionRow: HumanctlSession,
  lastTs: string,
  message: string,
): HumanctlInboxThread {
  return {
    sessionId: sessionRow.id,
    repo: sessionRow.repo,
    harness: sessionRow.harness,
    cwd: sessionRow.cwd,
    path: sessionRow.path || `/sessions/${sessionRow.id}`,
    title: sessionRow.title,
    session: sessionRow,
    items: [{ kind: "note", level: "review", message, ts: lastTs, id: `note-${sessionRow.id}` }],
    lastTs,
  }
}

const rows = [
  session("blocked", "block", NOW - 20_000, { title: "Blocked exporter", prevAgent: "Waiting for registry access", costUSD: 1, contextPct: 20 }),
  session("need", "need", NOW - 10_000, { title: "Decision needed", summary: { text: "Choose the persistence path" }, prevAgent: "Hidden fallback", costUSD: 3, contextPct: 60 }),
  session("work", "work", NOW - 5_000, { title: "Active backfill", harness: "claude-code", stateReason: "Applying queue changes", costUSD: 2, contextPct: 80 }),
  session("done", "done", NOW - 30_000, { title: "Archived report", lastUser: "Prepare the audit packet", costUSD: 4, contextPct: 10 }),
]

equal(sessionMessage(rows[1]), "Choose the persistence path", "row message uses summary first")
equal(sessionMessage(rows[0]), "Waiting for registry access", "row message falls back to previous agent text")
equal(filterSessions(rows, "persistence", "all", "all", "recent").map((row) => row.id), ["need"], "session search matches displayed summary")
equal(filterSessions(rows, "registry access", "all", "all", "recent").map((row) => row.id), ["blocked"], "session search matches displayed previous-agent text")
equal(filterSessions(rows, "audit packet", "all", "all", "recent").map((row) => row.id), ["done"], "session search matches user message text")
equal(filterSessions(rows, "", "claude-code", "work", "recent").map((row) => row.id), ["work"], "session filters compose")

const sessionSorts: Record<SessionSort, string[]> = {
  recent: ["work", "need", "blocked", "done"],
  needs: ["need", "blocked", "work", "done"],
  alphabetic: ["work", "done", "blocked", "need"],
  context: ["work", "need", "blocked", "done"],
  cost: ["done", "need", "work", "blocked"],
}
for (const [sort, expected] of Object.entries(sessionSorts) as [SessionSort, string[]][]) {
  equal(filterSessions(rows, "", "all", "all", sort).map((row) => row.id), expected, `session ${sort} sort`)
}
equal(pinSessionsFirst(filterSessions(rows, "", "all", "all", "recent"), new Set(["done"])).map((row) => row.id), ["done", "work", "need", "blocked"], "pins group first without changing remaining order")

const inboxRows = [
  thread(rows[0], "2025-06-16T12:00:00.000Z", "Credential still missing"),
  thread(rows[1], "2025-06-16T12:03:00.000Z", "Please pick Postgres or SQLite"),
  thread(rows[2], "2025-06-16T12:02:00.000Z", "Backfill reached 80 percent"),
  thread(rows[3], "2025-06-16T12:01:00.000Z", "Audit packet complete"),
]
const sessionsById = new Map(rows.map((row) => [row.id, row]))
const deriveInbox = (query: string, sort: InboxSort, overrides: Partial<Parameters<typeof filterInboxThreads>[0]> = {}) => filterInboxThreads({
  threads: inboxRows,
  sessionsById,
  query,
  harness: "all",
  state: "all",
  sort,
  pins: new Set<string>(),
  lastReadTs: {},
  ...overrides,
})

equal(deriveInbox("postgres", "recent").map((row) => row.sessionId), ["need"], "inbox search matches human-facing message")
equal(deriveInbox("active backfill", "recent").map((row) => row.sessionId), ["work"], "inbox search matches title")
equal(deriveInbox("", "recent", { harness: "claude-code", state: "work" }).map((row) => row.sessionId), ["work"], "inbox filters compose")
equal(deriveInbox("", "needs").map((row) => row.sessionId), ["need", "blocked", "work", "done"], "inbox needs-first sort")
equal(deriveInbox("", "recent").map((row) => row.sessionId), ["need", "work", "done", "blocked"], "inbox recent sort")
equal(deriveInbox("", "alphabetic").map((row) => row.sessionId), ["work", "done", "blocked", "need"], "inbox alphabetic sort")
equal(deriveInbox("", "unread", { lastReadTs: { need: Date.parse("2025-06-16T12:04:00.000Z") } }).map((row) => row.sessionId), ["work", "done", "blocked", "need"], "inbox unread sort keeps read threads after unread threads")
equal(deriveInbox("", "recent", { pins: new Set(["blocked"]) }).map((row) => row.sessionId), ["blocked", "need", "work", "done"], "inbox pins group first")

const oldInboxSession = session("old-inbox-decision", "need", NOW - (4 * 86_400_000), {
  harness: "claude-code",
  title: "Four-day-old decision",
  stateReason: "awaiting your decision",
})
const oldInboxThread = thread(oldInboxSession, "2025-06-12T12:00:00.000Z", "Choose the recovery path")
const noRecentSessions = new Map<string, HumanctlSession>()
equal(threadSession(oldInboxThread, noRecentSessions)?.state, "need", "thread carries authoritative state outside the recent-session window")
equal(filterInboxThreads({
  threads: [oldInboxThread],
  sessionsById: noRecentSessions,
  query: "recovery",
  harness: "claude-code",
  state: "need",
  sort: "needs",
  pins: new Set<string>(),
  lastReadTs: {},
}).map((row) => row.sessionId), ["old-inbox-decision"], "older inbox decisions remain searchable and filterable without a recent-session row")

const advanceRows: Array<{ id: string; state?: HumanctlSessionState }> = [
  { id: "a", state: "need" },
  { id: "b", state: "work" },
  { id: "c", state: "need" },
  { id: "d", state: "idle" },
]
equal(nextNeedsAttentionId(advanceRows, "a"), "c", "advance skips non-need and lands on the next need")
equal(nextNeedsAttentionId(advanceRows, "c"), "a", "advance wraps past the end to the first need")
equal(nextNeedsAttentionId(advanceRows, "d"), "a", "advance from a non-need row finds the next need")
equal(nextNeedsAttentionId(advanceRows, undefined), "a", "advance with no current selection finds the first need")
equal(nextNeedsAttentionId([{ id: "a", state: "need" }], "a"), undefined, "advance excludes the current row so the last need clears the detail")
equal(nextNeedsAttentionId([{ id: "a", state: "work" }], undefined), undefined, "advance returns undefined when nothing needs you")
equal(nextNeedsAttentionId([], "a"), undefined, "advance on an empty list returns undefined")
equal(nextNeedsAttentionId(advanceRows, "c", new Set(["a"])), undefined, "advance skips already-answered ids, so answering c after a clears the detail instead of bouncing back")
equal(nextNeedsAttentionId(advanceRows, "a", new Set(["c"])), undefined, "advance with the only other need already answered returns undefined")

console.log("derivations.selftest: ok")
