import { useCallback, useMemo, useRef, useState } from "react"
import { CheckCheckIcon, PinIcon } from "lucide-react"

import { FilterSearch, FilterToolbar } from "@humanctl/ui/blocks/filter-toolbar"
import { ListRow } from "@humanctl/ui/blocks/list-row"
import { Button } from "@humanctl/ui/components/button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@humanctl/ui/components/select"
import { cn } from "@humanctl/ui/lib/cn"

import type {
  HumanctlApplicationModel,
  HumanctlDispatch,
  HumanctlInboxThread,
  HumanctlSession,
} from "./contracts"
import {
  filterInboxThreads,
  formatTime,
  type HarnessFilter,
  type InboxSort,
  nextNeedsAttentionId,
  type SessionStateFilter,
  sessionRepo,
  threadPreview,
  threadSession,
  threadTitle,
  threadUnread,
} from "./helpers"
import { LazySessionDetail } from "./lazy-session-detail"
import { useWorkLoopKeys } from "./use-workloop-keys"
import {
  EmptyState,
  HarnessMark,
  PaneHeading,
  ResourceNotice,
  RowSkeletons,
  SessionStatus,
} from "./shared"
import { BoundedVirtualList, type VirtualRowComponentProps } from "./virtual-list"

const STATE_ITEMS = [
  { label: "All states", value: "all" },
  { label: "Needs input", value: "need" },
  { label: "Blocked", value: "block" },
  { label: "Running", value: "work" },
  { label: "Idle", value: "idle" },
  { label: "Complete", value: "done" },
]
const HARNESS_ITEMS = [
  { label: "All harnesses", value: "all" },
  { label: "Claude Code", value: "claude-code" },
  { label: "Codex", value: "codex" },
]
const INBOX_SORT_ITEMS = [
  { label: "Needs first", value: "needs" },
  { label: "Recent", value: "recent" },
  { label: "Alphabetic", value: "alphabetic" },
  { label: "Unread", value: "unread" },
]

type InboxRowContext = {
  byId: ReadonlyMap<string, HumanctlSession>
  lastReadTs: Readonly<Record<string, number>>
  pins: ReadonlySet<string>
  selectedThreadId?: string
  onSelect: (thread: HumanctlInboxThread) => void
}

function InboxVirtualRow({
  item: thread,
  context,
  virtualized,
  ...rowProps
}: VirtualRowComponentProps<HumanctlInboxThread, InboxRowContext>) {
  const session = threadSession(thread, context.byId)
  const unread = threadUnread(thread, context.lastReadTs)
  const pinned = context.pins.has(thread.sessionId)
  const ctx = typeof session?.contextPct === "number" ? session.contextPct : null
  return (
    <ListRow
      {...rowProps}
      data-virtualized={virtualized || undefined}
      selected={thread.sessionId === context.selectedThreadId}
      title={threadTitle(thread, session)}
      summary={threadPreview(thread)}
      metadata={session ? sessionRepo(session) : undefined}
      leading={session ? <HarnessMark harness={session.harness} /> : <span className="grid size-6 place-items-center bg-idle-soft text-xs">?</span>}
      status={session ? <SessionStatus state={session.state} /> : undefined}
      trailing={
        <span className="flex items-center gap-2">
          {ctx != null && ctx >= 80 ? <span className={cn("tabular-nums", ctx >= 90 ? "text-block" : "text-need")}>ctx {Math.round(ctx)}%</span> : null}
          {pinned ? <PinIcon className="size-3 fill-current text-primary" aria-label="Pinned" /> : null}
          {unread ? <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" /> : null}
          <span className="tabular-nums text-ink-3">{formatTime(thread.lastTs)}</span>
        </span>
      }
      onClick={() => context.onSelect(thread)}
    />
  )
}

export function InboxView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const [query, setQuery] = useState("")
  const [harness, setHarness] = useState<HarnessFilter>("all")
  const [state, setState] = useState<SessionStateFilter>("all")
  const [sort, setSort] = useState<InboxSort>("needs")
  const resource = model.resources.inbox
  const sessions = model.resources.sessions.data
  const appState = model.resources.appState.data

  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const lastReadTs = useMemo(() => appState.lastReadTs || {}, [appState.lastReadTs])
  const pins = useMemo(() => new Set(appState.pins), [appState.pins])

  const threads = useMemo(
    () => filterInboxThreads({
      threads: resource.data,
      sessionsById: byId,
      query,
      harness,
      state,
      sort,
      pins,
      lastReadTs,
    }),
    [byId, harness, lastReadTs, pins, query, resource.data, sort, state],
  )

  const selectedThread = appState.selectedId
    ? resource.data.find((thread) => thread.sessionId === appState.selectedId) || null
    : threads[0] || null
  const selectedSession = selectedThread
    ? threadSession(selectedThread, byId) || null
    : appState.selectedId ? byId.get(appState.selectedId) || null : null
  const selectedIndex = selectedThread ? threads.findIndex((thread) => thread.sessionId === selectedThread.sessionId) : -1
  const unreadCount = useMemo(
    () => resource.data.filter((thread) => threadUnread(thread, lastReadTs)).length,
    [lastReadTs, resource.data],
  )

  const select = useCallback(async (thread: HumanctlInboxThread) => {
    await dispatch({ type: "app.patch", patch: { selectedId: thread.sessionId } })
    if (threadUnread(thread, lastReadTs)) await dispatch({ type: "thread.markRead", threadId: thread.sessionId })
  }, [dispatch, lastReadTs])

  const rowContext = useMemo<InboxRowContext>(() => ({
    byId,
    lastReadTs,
    pins,
    selectedThreadId: selectedThread?.sessionId,
    onSelect: (thread) => { void select(thread) },
  }), [byId, lastReadTs, pins, select, selectedThread?.sessionId])

  const searchRef = useRef<HTMLInputElement>(null)
  const answeredIds = useRef<Set<string>>(new Set())
  const orderedRows = useMemo(() => threads.map((thread) => ({ id: thread.sessionId, state: threadSession(thread, byId)?.state })), [threads, byId])
  useWorkLoopKeys({
    ordered: orderedRows,
    selectedId: selectedThread?.sessionId,
    selectedSession,
    onSelect: (id) => { const thread = threads.find((row) => row.sessionId === id); if (thread) void select(thread) },
    onFocusSearch: () => searchRef.current?.focus(),
    dispatch,
  })

  return (
    <div className="grid h-full min-h-0 grid-cols-[var(--split-list)_minmax(0,1fr)] max-[1040px]:grid-cols-1">
      <section className={`flex min-h-0 min-w-0 flex-col border-r border-border bg-background max-[1040px]:border-r-0 ${appState.selectedId ? "max-[1040px]:hidden" : ""}`} aria-label="Inbox threads">
        <PaneHeading
          title="Inbox"
          description={unreadCount === 0 ? "No unread decisions" : `${unreadCount} unread ${unreadCount === 1 ? "decision" : "decisions"}`}
          count={resource.status === "ready" ? resource.data.length : undefined}
          actions={
            <Button size="sm" variant="ghost" disabled={resource.data.length === 0} onClick={() => { void dispatch({ type: "threads.markAllRead" }) }}>
              <CheckCheckIcon data-icon="inline-start" /> Mark all read
            </Button>
          }
        />
        <FilterToolbar
          search={
            <FilterSearch ref={searchRef} aria-label="Search inbox" placeholder="Search inbox" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          }
          filters={
            <>
              <Select items={STATE_ITEMS} value={state} onValueChange={(value) => setState((value || "all") as SessionStateFilter)}>
                <SelectTrigger aria-label="Filter inbox by state" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>{STATE_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                </SelectContent>
              </Select>
              <Select items={HARNESS_ITEMS} value={harness} onValueChange={(value) => setHarness((value || "all") as HarnessFilter)}>
                <SelectTrigger aria-label="Filter inbox by harness" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>{HARNESS_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                </SelectContent>
              </Select>
              <div className="col-span-2">
                <Select items={INBOX_SORT_ITEMS} value={sort} onValueChange={(value) => setSort((value || "needs") as InboxSort)}>
                  <SelectTrigger aria-label="Sort inbox" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>{INBOX_SORT_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </>
          }
          className="flex-col items-stretch py-2 [&>div:first-child]:max-w-none [&>div:nth-child(2)]:grid [&>div:nth-child(2)]:grid-cols-2"
        />
        <ResourceNotice resource={resource} label="Inbox is degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
        {threads.length > 0 ? (
          <BoundedVirtualList
            items={threads}
            getKey={(thread) => thread.sessionId}
            rowComponent={InboxVirtualRow}
            rowContext={rowContext}
            selectedIndex={selectedIndex}
            onMoveSelection={(index) => { const thread = threads[index]; if (thread) void select(thread) }}
            ariaLabel="Inbox threads"
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            {resource.status === "loading" && resource.data.length === 0 ? <RowSkeletons count={7} /> : null}
            {resource.status === "error" && resource.data.length === 0 ? (
              <EmptyState title="Inbox unavailable" description={resource.error || "The inbox could not be read."} action={<Button onClick={() => { void dispatch({ type: "fleet.refresh" }) }}>Retry</Button>} />
            ) : null}
            {resource.status === "ready" ? (
              <EmptyState title={resource.data.length === 0 ? "Inbox is clear" : "No matching threads"} description={resource.data.length === 0 ? "Tasks that need a decision or post an update will appear here." : "Change or clear the current filters."} />
            ) : null}
          </ScrollArea>
        )}
      </section>
      <section className={appState.selectedId ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden max-[1040px]:flex" : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden max-[1040px]:hidden"} aria-label="Selected task">
        <div className="hidden h-[var(--chrome)] shrink-0 items-center border-b border-border px-3 max-[1040px]:flex">
          <Button size="sm" variant="ghost" onClick={() => { void dispatch({ type: "app.patch", patch: { selectedId: undefined } }) }}>Back to inbox</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden"><LazySessionDetail key={selectedSession?.id || selectedThread?.sessionId || "empty"} model={model} dispatch={dispatch} session={selectedSession} thread={selectedThread} onAnswered={() => { const id = selectedThread?.sessionId; if (id) answeredIds.current.add(id); void dispatch({ type: "app.patch", patch: { selectedId: nextNeedsAttentionId(orderedRows, id, answeredIds.current) } }) }} /></div>
      </section>
    </div>
  )
}
