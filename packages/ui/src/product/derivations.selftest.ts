import type { HumanctlInboxThread, HumanctlSession, HumanctlSessionState } from "./contracts"
import { deriveVaultFreshness, filterVaultEntities, formatVaultAge, formatVaultDate, parseVaultInstant } from "./vault-derivations"
import type { VaultEntity, VaultSnapshot } from "./vault-snapshot"
import {
  filterInboxThreads,
  filterSessions,
  nextNeedsAttentionId,
  pinSessionsFirst,
  selectedSessionForView,
  sessionMessage,
  threadSession,
  threadState,
  threadTitle,
  threadUnread,
  type InboxSort,
  type SessionSort,
} from "./helpers"

const NOW = 1_750_000_000_000

equal(formatVaultDate("2026-08-18", "en-US"), "Aug 18", "date-only values retain their calendar day")
equal(formatVaultDate("not-a-date", "en-US"), null, "non-date values are not formatted")

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
    threadId: sessionRow.id,
    scope: "session",
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

const generalThread: HumanctlInboxThread = {
  threadId: "general-updates",
  scope: "general",
  path: "",
  title: "General updates",
  items: [
    { kind: "note", level: "fyi", message: "Synthetic deployment receipt is ready", repo: "fixture-release", ts: "2025-06-16T12:00:00.000Z", id: "general-1" },
    { kind: "note", level: "review", message: "Review the synthetic release packet", repo: "fixture-release", ts: "2025-06-16T12:05:00.000Z", id: "general-2" },
  ],
  lastTs: "2025-06-16T12:05:00.000Z",
}
equal(threadTitle(generalThread), "General updates", "general thread has an explicit human-facing title")
equal(threadSession(generalThread, sessionsById), undefined, "general thread never resolves to a session")
equal(threadState(generalThread, sessionsById), "need", "general thread derives state from its newest note level")
const hostileGeneralPayload: HumanctlInboxThread = { ...generalThread, sessionId: rows[3].id, session: rows[3] }
equal(threadSession(hostileGeneralPayload, sessionsById), undefined, "general scope ignores a hostile embedded session payload")
equal(threadTitle(hostileGeneralPayload), "General updates", "general scope never borrows an embedded session title")
equal(threadState(hostileGeneralPayload, sessionsById), "need", "general scope derives state from notes even when a session payload is present")
equal(threadUnread(generalThread, { "general-updates": Date.parse("2025-06-16T12:04:00.000Z") }), true, "general thread unread state uses its thread id")
equal(threadUnread(generalThread, { "general-updates": Date.parse("2025-06-16T12:06:00.000Z") }), false, "general thread read marker clears every visible item")
equal(filterInboxThreads({
  threads: [generalThread],
  sessionsById,
  query: "deployment receipt",
  harness: "all",
  state: "need",
  sort: "needs",
  pins: new Set<string>(),
  lastReadTs: {},
}).map((row) => row.threadId), ["general-updates"], "general thread search covers older messages and state derives from the newest note")
equal(filterInboxThreads({
  threads: [generalThread],
  sessionsById,
  query: "",
  harness: "codex",
  state: "all",
  sort: "recent",
  pins: new Set<string>(),
  lastReadTs: {},
}).map((row) => row.threadId), [], "harness filters exclude the general thread")

const reservedIdSession = session("general-updates", "need", NOW - 1_000, { title: "Reserved id task" })
const reservedIdThread: HumanctlInboxThread = {
  ...thread(reservedIdSession, "2025-06-16T12:06:00.000Z", "Reserved id task needs review"),
  threadId: "session:general-updates",
}
const reservedSessionsById = new Map([[reservedIdSession.id, reservedIdSession]])
equal(
  selectedSessionForView("inbox", "general-updates", [generalThread, reservedIdThread], reservedSessionsById)?.id,
  undefined,
  "palette exposes no task actions when General is selected beside a colliding session id",
)
equal(
  selectedSessionForView("inbox", "session:general-updates", [generalThread, reservedIdThread], reservedSessionsById)?.id,
  "general-updates",
  "palette resolves task actions through the escaped session thread id",
)
equal(
  selectedSessionForView("sessions", "general-updates", [generalThread, reservedIdThread], reservedSessionsById)?.id,
  "general-updates",
  "non-Inbox routes resolve direct session selections by raw session id",
)
equal(filterInboxThreads({
  threads: [generalThread, reservedIdThread],
  sessionsById: reservedSessionsById,
  query: "",
  harness: "all",
  state: "all",
  sort: "recent",
  pins: new Set(["general-updates"]),
  lastReadTs: {},
}).map((row) => row.threadId), ["session:general-updates", "general-updates"], "escaped session threads retain raw-session pin ordering")

const vaultEntities: VaultEntity[] = [
  {
    kind: "person",
    id: "person:mara-voss",
    label: "Mara Voss",
    labels: { group: "inner" },
    annotations: { role: "Climate sensor founder", relationship: "Trusted collaborator" },
    spec: {
      summary: "Preparing a reference architecture",
      nextTouch: "Send the deployment sequence",
      sections: [
        { heading: "Open threads", body: "Pilot design partners", level: 2 },
        { heading: "Decision rights", level: 3, items: ["Owns sensor acceptance", "Escalates deployment exceptions"] },
      ],
    },
  },
  {
    kind: "person",
    id: "person:desmond-ilori",
    label: "Desmond Ilori",
    annotations: { role: "Developer tools investor" },
    spec: { summary: "Reviewing an observability thesis" },
  },
]
equal(filterVaultEntities(vaultEntities, "mara").map((entity) => entity.id), ["person:mara-voss"], "vault search matches a person name")
equal(filterVaultEntities(vaultEntities, "sensor founder").map((entity) => entity.id), ["person:mara-voss"], "vault search matches role terms")
equal(filterVaultEntities(vaultEntities, "pilot partners").map((entity) => entity.id), ["person:mara-voss"], "vault search matches person-page section terms")
equal(filterVaultEntities(vaultEntities, "trusted collaborator").map((entity) => entity.id), ["person:mara-voss"], "vault search matches generic annotations")
equal(filterVaultEntities(vaultEntities, "deployment sequence").map((entity) => entity.id), ["person:mara-voss"], "vault search matches the next action")
equal(filterVaultEntities(vaultEntities, "sensor acceptance").map((entity) => entity.id), ["person:mara-voss"], "vault search matches structured section list items")
equal(filterVaultEntities(vaultEntities, "observability").map((entity) => entity.id), ["person:desmond-ilori"], "vault search matches summary terms")
equal(filterVaultEntities(vaultEntities, "missing person").map((entity) => entity.id), [], "vault search returns an honest empty result")

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

// Freshness: a stale snapshot must never render as healthy. Times sit at UTC
// noon so the formatted calendar day is the same in every common timezone.
const FRESH_NOW = Date.parse("2026-10-08T12:00:00Z")
const HOUR = 3_600_000
const DAY = 24 * HOUR

equal(parseVaultInstant("2026-10-08T10:00:00Z"), FRESH_NOW - 2 * HOUR, "ISO date-times parse to epoch ms")
equal(parseVaultInstant("2026-10-08"), Date.parse("2026-10-08T00:00:00Z"), "date-only values parse as UTC midnight")
equal(parseVaultInstant("2h"), null, "relative labels are not instants")
equal(parseVaultInstant(undefined), null, "missing values are not instants")
equal(parseVaultInstant("2026-13-45"), null, "impossible dates are not instants")

equal(formatVaultAge(FRESH_NOW - 20_000, FRESH_NOW), "just now", "ages under a minute read just now")
equal(formatVaultAge(FRESH_NOW - 5 * 60_000, FRESH_NOW), "5m ago", "minute ages")
equal(formatVaultAge(FRESH_NOW - 2 * HOUR - 59 * 60_000, FRESH_NOW), "2h ago", "hour ages floor so freshness is never overstated")
equal(formatVaultAge(FRESH_NOW - 16 * DAY - 3 * HOUR, FRESH_NOW), "16d ago", "day ages")
equal(formatVaultAge(FRESH_NOW + HOUR, FRESH_NOW), "just now", "future instants (clock skew) read just now")

function freshnessSnapshot(vitals: Record<string, unknown> | undefined, generatedAt = "2026-10-08T11:20:00Z"): VaultSnapshot {
  return { apiVersion: "humanctl.dev/vaultsnapshot/v1alpha1", generatedAt, vitals, entities: [] }
}

const unknownIngest = deriveVaultFreshness(freshnessSnapshot({ entities: 3, lastIngest: "2h" }), FRESH_NOW, "en-US")
equal(unknownIngest.ingestState, "unknown", "a missing ingestOk is unknown, never clean")
equal(unknownIngest.lastIngest, { value: "2h", hint: "unknown", warn: false }, "relative lastIngest labels render as-is with the unknown hint")
equal(unknownIngest.banner, null, "unknown ingest alone does not raise the banner")
equal(deriveVaultFreshness(freshnessSnapshot(undefined), FRESH_NOW, "en-US").lastIngest, { value: "n/a", hint: "unknown", warn: false }, "missing vitals read n/a and unknown")

const healthy = deriveVaultFreshness(freshnessSnapshot({
  lastIngest: "2026-10-08T10:00:00Z",
  ingestOk: true,
  sources: [{ label: "Notes folder", status: "ok" }, { label: "Meeting log", status: "healthy" }],
}), FRESH_NOW, "en-US")
equal(healthy.ingestState, "clean", "ingestOk true is clean")
equal(healthy.lastIngest, { value: "Oct 8", hint: "2h ago · clean", warn: false }, "an ISO lastIngest renders as a date plus its age")
equal(healthy.snapshot?.age, "40m ago", "the header carries the snapshot age")
equal(healthy.snapshot?.stale, false, "a recent snapshot is not flagged")
equal(healthy.banner, null, "a healthy snapshot shows no banner")

const staleSources = [
  { label: "Meeting log", status: "partial", lastSuccessAt: "2026-09-22T12:00:00Z", dataThrough: "2026-09-22T12:00:00Z", note: "4 items waiting" },
  { label: "Message archive", status: "blocked", lastSuccessAt: "2026-10-03T12:00:00Z" },
  { label: "Notes folder", status: "ok", dataThrough: "2026-10-08T11:00:00Z" },
  { status: "error" },
  "not a source",
  null,
]
const stale = deriveVaultFreshness(freshnessSnapshot({
  lastIngest: "2026-09-22T12:00:00Z",
  ingestOk: false,
  notice: "Meeting log ingest is 16 days behind.",
  sources: staleSources,
}), FRESH_NOW, "en-US")
equal(stale.ingestState, "stale", "ingestOk false is stale")
equal(stale.lastIngest, { value: "Sep 22", hint: "16d ago · stale", warn: true }, "a stale tile shows the date, the age, and the warning tone")
equal(stale.banner?.message, "Meeting log ingest is 16 days behind.", "the banner text is the producer notice")
equal(stale.banner?.sources, [
  { label: "Meeting log", status: "partial", through: "data through Sep 22, 16d ago", note: "4 items waiting" },
  { label: "Message archive", status: "blocked", through: "last success Oct 3, 5d ago", note: null },
  { label: "Unnamed source", status: "error", through: null, note: null },
], "the banner lists only sources that are not ok, with their data-through age, and skips malformed entries")

equal(deriveVaultFreshness(freshnessSnapshot({ ingestOk: false, lastIngest: "2026-09-22T12:00:00Z" }), FRESH_NOW, "en-US").banner, { message: "Sources are stale since Sep 22.", sources: [] }, "without a notice the banner falls back to the stale-since date")
equal(deriveVaultFreshness(freshnessSnapshot({ ingestOk: false, lastIngest: "3d" }), FRESH_NOW, "en-US").banner?.message, "Sources are stale. Last ingest: 3d.", "a relative lastIngest still yields an honest fallback")
equal(deriveVaultFreshness(freshnessSnapshot({ ingestOk: false }), FRESH_NOW, "en-US").banner?.message, "Sources are stale.", "a stale snapshot with no lastIngest still raises the banner")
equal(deriveVaultFreshness(freshnessSnapshot({ ingestOk: false, notice: "   ", sources: "bad" }), FRESH_NOW, "en-US").banner, { message: "Sources are stale.", sources: [] }, "blank notices and malformed sources degrade to the fallback")

const oldSnapshot = deriveVaultFreshness(freshnessSnapshot({ ingestOk: true, lastIngest: "2026-10-05T12:00:00Z" }, "2026-10-05T12:00:00Z"), FRESH_NOW, "en-US")
equal(oldSnapshot.snapshot?.stale, true, "a snapshot older than a day is flagged in the header")
equal(oldSnapshot.banner?.message, "This snapshot is 3d old. The producer has not written a new one since Oct 5.", "an old snapshot raises the banner even when its vitals claim health")

console.log("derivations.selftest: ok")
