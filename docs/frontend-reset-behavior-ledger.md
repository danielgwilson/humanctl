# Frontend reset behavior ledger

Status: required parity ledger for deleting and rebuilding the renderer.

The reset may delete every file under the current renderer implementation. It
may not silently delete behavior. This ledger separates durable application
behavior from disposable pixels.

## 1. Preserve these authoritative modules

| Area | Authority | Reset rule |
|---|---|---|
| Command declarations and validation | `lib/commands.ts` | No renderer-only mutation or observation bypasses the registry. |
| Session, note, inbox, quota, skill, and timeline reads | `lib/`, `electron/reader-service.ts` | Keep work off the Electron main process. |
| Native window and IPC handlers | `electron/main.ts` | Preserve the existing window, watcher, and utility-process behavior. |
| Locked browser interface | `electron/preload.ts` | Keep method names, parameters, return shapes, and unsubscribe contracts stable. |
| CLI and event receipts | `bin/`, `lib/commands.ts` | UI actions remain CLI-addressable and event-logged where the command contract requires it. |
| Packaged-app and performance gates | `scripts/`, `docs/perf.md` | The new renderer must pass the same release gates. |

The runtime adapter may narrow and normalize these interfaces for the UI. It
must not reimplement their domain logic.

## 2. Intentionally disposable

The following are not parity requirements:

- the current React tree, CSS, primitive source, tokens, class names, and file
  layout
- the current graphite and violet palette
- mono-first typography
- the current sidebar, row, card, chip, and header anatomy
- current loading copy, including any temporary sample label during real boot
- current Radix implementation details
- current pixel dimensions that conflict with the new foundation contract

Behavior, accessibility, data honesty, performance, and command routing are
the parity surface. Old pixels are not.

## 3. Boot and resource behavior

| ID | Required behavior | Acceptance proof |
|---|---|---|
| BOOT-01 | With no preload bridge, the browser build uses synthetic fixtures and never reads real local data. | Fixture browser smoke and screenshot run. |
| BOOT-02 | With the preload bridge present, the shell paints immediately and never labels the real app as a fixture while version or status is loading. | Slow-reader fixture screenshot before and after status resolves. |
| BOOT-03 | Status, sessions, notes, and inbox reads start concurrently. Claude quota starts independently and is not awaited for fleet first paint. | Runtime-adapter test with deferred promises. |
| BOOT-04 | The app has one declared fleet poll at 20 seconds. Session-change and inbox-fast pushes reuse the same coalesced refresh path. | Fake-clock test and idle performance gate. |
| BOOT-05 | A failed resource preserves last-known data, marks only that resource stale or errored, and retries on its next valid trigger. | Per-resource failure tests. |
| BOOT-06 | Results with unchanged identity do not replace state or rebuild their subtree. | Three unchanged refreshes produce zero mutation batches. |
| BOOT-07 | Subscriptions, timers, hot-session state, and in-flight generation guards clean up on unmount or identity change. | Runtime lifecycle test. |
| BOOT-08 | Skills aggregation runs only while Metrics is active. Summary-budget reads run only while Settings is active. | Route activation test. |

Resource state is explicit:

```ts
type Resource<T> = {
  status: "idle" | "loading" | "ready" | "error";
  data: T;
  error: string | null;
  updatedAt: number | null;
};
```

`ready` plus an empty value is the empty state. `ready` plus an error keeps
last-known data visible while marking it stale. Operation state identifies an
active refresh without replacing the resource data.

## 4. Persisted and ephemeral state

| ID | Required behavior | Acceptance proof |
|---|---|---|
| STATE-01 | Default state is Inbox, dark theme, navigation open, chief-of-staff rail closed, no pins, and no read markers. | Cold-state fixture. |
| STATE-02 | Theme supports light, dark, and system. System follows the OS while selected. | Theme fixture plus media-query test. |
| STATE-03 | View, navigation state, right-rail state, pins, theme, summarizer, selected session, budget, and read markers hydrate from `app.state`. A versioned shell-only cache mirrors view, theme, and rail state for synchronous first paint; durable `app.state` remains authoritative and reconciles it. | Hydration and first-paint tests with a full state fixture. |
| STATE-04 | A state intent updates optimistically, persists through `app.set-state`, and merges later `state:changed` events without dropping unrelated keys. | Runtime-adapter round-trip test. |
| STATE-05 | Search, filters, sort, focus, hover, draft text, selection within a list, and scroll position are renderer ephemera. They do not become commands. | Command-registry audit. |

## 5. Navigation and global input

| ID | Required behavior | Acceptance proof |
|---|---|---|
| NAV-01 | Inbox, Metrics, Fleet, and Sessions remain routes 1, 2, 3, and 4. Settings remains routable from the settings entry and command palette. | Keyboard and route tests. |
| NAV-02 | Bare route keys do nothing while an input, textarea, or editable region has focus. | Keyboard test in every composer and search field. |
| NAV-03 | Command or Control plus K opens the command palette from anywhere, including a focused input. Escape closes it and returns focus. | Keyboard and focus-return test. |
| NAV-04 | Command or Control plus B toggles the left navigation rail. The explicit Sidebar trigger provides the same action. | Exact-modifier keyboard and pointer test. |
| NAV-05 | Command or Control plus Option or Alt plus B toggles the chief-of-staff right rail. At compact widths the same state controls a Sheet. | Exact-modifier keyboard, docked-rail, and Sheet focus-return tests. |
| NAV-06 | Opening a session from any route produces one detail interface. Back returns to the originating route. | Route-origin matrix. |
| NAV-07 | The command palette searches views, bounded recent sessions, and actions without starting a second fetch or timer. | Palette fixture with more than 150 sessions. |
| NAV-08 | Palette actions include navigate, open session, mark all read, cycle theme, toggle navigation, and toggle chief-of-staff. | Palette action test. |

## 6. Inbox

| ID | Required behavior | Acceptance proof |
|---|---|---|
| INBOX-01 | Inbox shows one thread per session assembled by the backend from notes, asks, interrupted asks, answers, and session state. | Fixture for every thread-item kind. |
| INBOX-02 | Search matches title, repo, and message to the human. Filters cover state and harness. Sorts are recent, needs-first, and alphabetic. | `npm run ui:derivations:selftest`. |
| INBOX-03 | Needs-first uses `need`, `block`, `work`, `idle`, `done`, then recency within a state. | `npm run ui:derivations:selftest`. |
| INBOX-04 | Unread means at least one item timestamp is newer than that session's persisted last-read timestamp. | `npm run ui:derivations:selftest`. |
| INBOX-05 | Selecting a thread marks it read and shows its detail without remounting the search field. | Focus-preservation test. |
| INBOX-06 | Mark-all-read persists every visible thread through the registered command and updates the unread digest immediately. | Command spy plus UI assertion. |
| INBOX-07 | Pin and unpin persist through the registered state path. Opening, full-detail opening, and mark-read remain available by keyboard or menu. | Keyboard and context-menu test. |
| INBOX-08 | The list remains responsive with at least 200 threads and mounts only a bounded window of rows. | `npm run ui:virtual-list:selftest` plus the local click-to-paint gate. |
| INBOX-09 | Empty and no-match states explain the next action without inventing data. | Empty fixtures. |
| INBOX-10 | Inbox keeps the authoritative session row from its 30-day scan, including pending decisions older than the 72-hour Sessions inventory. | `npm run commands:selftest` plus `npm run ui:derivations:selftest`. |

## 7. Sessions and detail

| ID | Required behavior | Acceptance proof |
|---|---|---|
| SESSION-01 | Sessions is the complete recent inventory from the 72-hour, 40-row default read until the backend contract changes explicitly. | Reader argument spy. |
| SESSION-02 | Search matches title, repo, and message. State and harness filters plus recent, needs-first, and alphabetic sorts match Inbox semantics. | `npm run ui:derivations:selftest`. |
| SESSION-03 | Pinned sessions group first without changing the order within each sort. The list remains virtualized at fleet scale. | `npm run ui:derivations:selftest` plus `npm run ui:virtual-list:selftest`. |
| SESSION-04 | Any session can open detail, even when it has no Inbox thread. The UI synthesizes an empty thread shell from the session row. | Session-without-thread fixture. |
| SESSION-05 | Detail exposes title, harness, state, repo, model, context fill, summary, notes and asks, conversation, resume, and ask-session behavior without duplicate owners. | Detail fixture matrix. |
| SESSION-06 | Resume opens Codex in its app and resumes Claude Code through its existing registered path. Errors remain honest. | Bridge command spy by harness. |
| SESSION-07 | Ask-session submits only nonblank input, disables duplicate submission, clears after completion, and surfaces the returned answer or error. | Composer interaction test. |
| SESSION-08 | Reply-to-ask appears only for `need` or `block`. It records the registered `ask.answer` result and describes the actual delivery channel without claiming more. | Delivery matrix for live, staged, file, clipped, and failed results. |
| SESSION-09 | A sent answer appears optimistically, then deduplicates by the persisted answer when the next inbox refresh arrives. | Deferred refresh test. |
| SESSION-10 | Manual summary has one in-flight session ID, visible loading, retryable error, and persisted result on the next fleet refresh. | Summary success and error tests. |

## 8. Conversation timeline

| ID | Required behavior | Acceptance proof |
|---|---|---|
| TIME-01 | Opening detail reads one bounded backward page ending at the live tail. | Timeline bridge spy. |
| TIME-02 | The open session becomes the one hot session. Closing or changing identity clears it. A reader-process reconnect reestablishes it. | Hot-session lifecycle test. |
| TIME-03 | Load-older prepends a page, merges adjacent tool runs at the page seam, and preserves the same content under the viewport. | Paging and scroll-offset test. |
| TIME-04 | Live appends merge adjacent tool runs. They stick to the bottom only when the human was already within 48px of the bottom. | Append tests at near and far scroll positions. |
| TIME-05 | Rotation, truncation, or an oversized gap resets and rereads rather than splicing across a rewritten file. | Reset payload fixture. |
| TIME-06 | A display cap drops the oldest mounted events, marks the view capped, and reloads from the live end before any further backward page. | Cap fixture. |
| TIME-07 | Detail owns one vertical body scroll region. Notes, summary, and conversation do not create a scroll trap. | Wheel, keyboard, and screenshot test. |

## 9. Metrics, fleet, settings, and global status

| ID | Required behavior | Acceptance proof |
|---|---|---|
| METRIC-01 | Metrics owns estimated spend by harness, fleet tokens, every available quota window, average context fill, near-compaction count, and top skill invocations. | Full and missing-data fixtures. |
| METRIC-02 | Claude reset text renders verbatim. Missing subscription quota renders unavailable, never zero or a fabricated percentage. | Quota fixture matrix. |
| METRIC-03 | Codex quota uses its supplied epoch and cadence. Metrics distinguishes estimated cost from actual subscription quota. | Quota fixture matrix. |
| FLEET-01 | Fleet owns distribution by state, harness, and tier. It does not become a second session list. | Fleet fixture. |
| STATUS-01 | The global status band shows a compact fleet digest plus one quota digest per harness. Detailed windows remain in Metrics. | Ownership review and screenshot. |
| SETTINGS-01 | Settings persists light, dark, and system theme; summary engine; and daily summary budget through the state command. | State round-trip test. |
| SETTINGS-02 | Budget clamps to at least USD 0.10, commits on blur or Enter, and shows today's spend and paused state honestly. Clean drafts never overwrite newer external state. | `npm run ui:budget:selftest` plus the Settings interaction fixture. |
| STAFF-01 | Chief-of-staff history is local to the open renderer, submits nonblank questions through `atlas.ask`, shows in-flight state, and surfaces errors. | Overlay interaction test. |

## 10. Bridge coverage

The runtime adapter must cover the existing renderer-facing methods. Renaming
inside the adapter is allowed; deleting coverage is not.

| Read or event | Product use |
|---|---|
| `getStatus`, `listSessions`, `getNotes`, `getInboxThreads` | fleet refresh |
| `getClaudeQuota` | nonblocking quota refresh |
| `getState`, `onStateChanged` | persisted UI state |
| `aggregateSkills`, `getSummaryBudget` | active-route reads |
| `readTimeline`, `setHotSession`, `onSessionAppend` | live detail timeline |
| `onSessionsChanged`, `onInboxFast` | event-driven refresh |

| Action | Product use |
|---|---|
| `setState` | theme, view, navigation, overlay, pins, read markers, engine, budget, selection |
| `markThreadRead`, `markAllThreadsRead` | Inbox read state |
| `askAtlas`, `askSession`, `answerAsk`, `summarize` | human and agent conversations |
| `resumeSession`, `openInApp`, `revealSession` | session actions |

Any newly exposed durable action must be registered in `lib/commands.ts` before
the runtime adapter can dispatch it.

## 11. Reset acceptance order

1. Freeze this ledger and the UI foundation contract.
2. Add runtime-adapter contract tests against a fake bridge.
3. Add package catalog fixtures and the ownership and hygiene gates.
4. Replace the renderer with the new `packages/ui`, `runtime`, and `viewport`
   modules.
5. Prove BOOT, STATE, and NAV before feature work.
6. Prove Inbox and Sessions before removing the old renderer from the branch.
7. Prove timeline and mutation flows against the real bridge.
8. Prove Metrics, Fleet, Settings, global status, and chief-of-staff.
9. Capture every view and detail in both themes using synthetic fixtures.
10. Run renderer typecheck, package catalog tests, ownership, hygiene, bundle,
    packaged smoke, and both local performance gates.

The reset is complete only when every ledger row has proof or an explicit,
reviewed product decision removes it. Absence from the new UI is not proof that
the old behavior was unnecessary.
