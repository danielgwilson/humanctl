import { useCallback, useMemo, useState } from "react"
import { CheckCheckIcon, PinIcon, SearchIcon } from "lucide-react"

import { FilterToolbar } from "@humanctl/ui/blocks/filter-toolbar"
import { ListRow } from "@humanctl/ui/blocks/list-row"
import { Button } from "@humanctl/ui/components/button"
import { Input } from "@humanctl/ui/components/input"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@humanctl/ui/components/select"

import type {
  HumanctlApplicationModel,
  HumanctlDispatch,
  HumanctlInboxThread,
  HumanctlSession,
} from "./contracts"
import {
  filterInboxThreads,
  formatTime,
  harnessLabel,
  type HarnessFilter,
  type InboxSort,
  sessionMeta,
  type SessionStateFilter,
  threadPreview,
  threadSession,
  threadTitle,
  threadUnread,
} from "./helpers"
import { SessionDetail } from "./session-detail"
import {
  EmptyState,
  HarnessMark,
  PaneHeading,
  ResourceNotice,
  RowSkeletons,
  SessionStatus,
} from "./shared"
import { BoundedVirtualList, type VirtualRowComponentProps } from "./virtual-list"

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
  return (
    <ListRow
      {...rowProps}
      data-virtualized={virtualized || undefined}
      selected={thread.sessionId === context.selectedThreadId}
      title={threadTitle(thread, session)}
      summary={threadPreview(thread)}
      metadata={session ? sessionMeta(session) : `${harnessLabel(thread.harness)} · ${formatTime(thread.lastTs)}`}
      leading={session ? <HarnessMark harness={session.harness} /> : <span className="grid size-6 place-items-center bg-idle-soft font-mono text-[10px]">?</span>}
      status={session ? <SessionStatus state={session.state} /> : undefined}
      trailing={
        <span className="flex items-center gap-2">
          {pinned ? <PinIcon className="size-3 fill-current text-primary" aria-label="Pinned" /> : null}
          {unread ? <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" /> : null}
          <span className="font-mono text-[10px] text-ink-4">{formatTime(thread.lastTs)}</span>
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

  return (
    <div className="grid h-full min-h-0 grid-cols-[var(--split-list)_minmax(0,1fr)] max-[1040px]:grid-cols-1">
      <section className={`flex min-h-0 min-w-0 flex-col border-r border-border bg-background max-[1040px]:border-r-0 ${appState.selectedId ? "max-[1040px]:hidden" : ""}`} aria-label="Inbox threads">
        <PaneHeading
          title="Inbox"
          description={unreadCount === 0 ? "No unread decisions" : `${unreadCount} unread ${unreadCount === 1 ? "decision" : "decisions"}`}
          count={resource.status === "ready" ? resource.data.length : undefined}
          actions={
            <Button size="sm" variant="ghost" disabled={resource.data.length === 0} onClick={() => { void dispatch({ type: "threads.markAllRead" }) }}>
              <CheckCheckIcon /> Mark all read
            </Button>
          }
        />
        <FilterToolbar
          search={
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
              <Input aria-label="Search inbox" placeholder="Search inbox" value={query} onChange={(event) => setQuery(event.currentTarget.value)} className="pl-8" />
            </div>
          }
          filters={
            <>
              <Select value={state} onValueChange={(value) => setState((value || "all") as SessionStateFilter)}>
                <SelectTrigger aria-label="Filter inbox by state" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  <SelectItem value="need">Needs input</SelectItem>
                  <SelectItem value="block">Blocked</SelectItem>
                  <SelectItem value="work">Running</SelectItem>
                  <SelectItem value="idle">Idle</SelectItem>
                  <SelectItem value="done">Complete</SelectItem>
                </SelectContent>
              </Select>
              <Select value={harness} onValueChange={(value) => setHarness((value || "all") as HarnessFilter)}>
                <SelectTrigger aria-label="Filter inbox by harness" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All harnesses</SelectItem>
                  <SelectItem value="claude-code">Claude Code</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(value) => setSort((value || "needs") as InboxSort)}>
                <SelectTrigger aria-label="Sort inbox" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="needs">Needs first</SelectItem>
                  <SelectItem value="recent">Recent</SelectItem>
                  <SelectItem value="alphabetic">Alphabetic</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
          className="flex-col items-stretch py-2 [&>div:first-child]:max-w-none [&>div:nth-child(2)]:grid [&>div:nth-child(2)]:grid-cols-3"
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
        <div className="min-h-0 flex-1 overflow-hidden"><SessionDetail key={selectedSession?.id || selectedThread?.sessionId || "empty"} model={model} dispatch={dispatch} session={selectedSession} thread={selectedThread} /></div>
      </section>
    </div>
  )
}
