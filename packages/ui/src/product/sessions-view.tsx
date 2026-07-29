import { useMemo, useState } from "react"
import { PinIcon, RefreshCwIcon } from "lucide-react"

import { FilterSearch, FilterToolbar } from "@humanctl/ui/blocks/filter-toolbar"
import { ListRow } from "@humanctl/ui/blocks/list-row"
import { Button } from "@humanctl/ui/components/button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@humanctl/ui/components/select"

import type { HumanctlApplicationModel, HumanctlDispatch } from "./contracts"
import { filterSessions, formatTime, type HarnessFilter, pinSessionsFirst, type SessionSort, type SessionStateFilter, sessionMessage, sessionMeta, sessionTitle } from "./helpers"
import { LazySessionDetail } from "./lazy-session-detail"
import { EmptyState, HarnessMark, PaneHeading, ResourceNotice, RowSkeletons, SessionStatus } from "./shared"
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
const SESSION_SORT_ITEMS = [
  { label: "Recent", value: "recent" },
  { label: "Needs first", value: "needs" },
  { label: "Alphabetic", value: "alphabetic" },
  { label: "Context", value: "context" },
  { label: "Cost", value: "cost" },
]

type SessionsRowContext = {
  pins: ReadonlySet<string>
  selectedId?: string
  onSelect: (id: string) => void
}

function SessionsVirtualRow({
  item: session,
  context,
  virtualized,
  ...rowProps
}: VirtualRowComponentProps<HumanctlApplicationModel["resources"]["sessions"]["data"][number], SessionsRowContext>) {
  return (
    <ListRow
      {...rowProps}
      data-virtualized={virtualized || undefined}
      selected={session.id === context.selectedId}
      title={sessionTitle(session)}
      summary={sessionMessage(session)}
      metadata={sessionMeta(session)}
      leading={<HarnessMark harness={session.harness} />}
      status={<SessionStatus state={session.state} />}
      trailing={
        <span className="flex items-center gap-2">
          {context.pins.has(session.id) ? <PinIcon className="size-3 fill-current text-primary" aria-label="Pinned" /> : null}
          <span className="text-xs tabular-nums text-ink-3">{session.age || formatTime(session.ageMs)}</span>
        </span>
      }
      onClick={() => context.onSelect(session.id)}
    />
  )
}

export function SessionsView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const [query, setQuery] = useState("")
  const [harness, setHarness] = useState<HarnessFilter>("all")
  const [state, setState] = useState<SessionStateFilter>("all")
  const [sort, setSort] = useState<SessionSort>("recent")
  const resource = model.resources.sessions
  const appState = model.resources.appState.data
  const pins = useMemo(() => new Set(appState.pins), [appState.pins])
  const sessions = useMemo(
    () => pinSessionsFirst(filterSessions(resource.data, query, harness, state, sort), pins),
    [harness, pins, query, resource.data, sort, state],
  )
  const selected = appState.selectedId
    ? resource.data.find((session) => session.id === appState.selectedId) || null
    : sessions[0] || null
  const selectedIndex = selected ? sessions.findIndex((session) => session.id === selected.id) : -1
  const thread = selected ? model.resources.inbox.data.find((item) => item.sessionId === selected.id) || null : null
  const rowContext = useMemo<SessionsRowContext>(() => ({
    pins,
    selectedId: selected?.id,
    onSelect: (id) => { void dispatch({ type: "app.patch", patch: { selectedId: id } }) },
  }), [dispatch, pins, selected?.id])

  return (
    <div className="grid h-full min-h-0 grid-cols-[var(--split-list)_minmax(0,1fr)] max-[1040px]:grid-cols-1">
      <section className={`flex min-h-0 min-w-0 flex-col border-r border-border max-[1040px]:border-r-0 ${appState.selectedId ? "max-[1040px]:hidden" : ""}`} aria-label="Sessions">
        <PaneHeading
          title="Sessions"
          description="Recent work across local harnesses"
          count={resource.status === "ready" ? resource.data.length : undefined}
          actions={
            <Button size="sm" variant="ghost" onClick={() => { void dispatch({ type: "fleet.refresh" }) }}>
              <RefreshCwIcon data-icon="inline-start" /> Refresh
            </Button>
          }
        />
        <FilterToolbar
          search={
            <FilterSearch aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          }
          filters={
            <>
              <Select items={STATE_ITEMS} value={state} onValueChange={(value) => setState((value || "all") as SessionStateFilter)}>
                <SelectTrigger aria-label="Filter sessions by state" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>{STATE_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                </SelectContent>
              </Select>
              <Select items={HARNESS_ITEMS} value={harness} onValueChange={(value) => setHarness((value || "all") as HarnessFilter)}>
                <SelectTrigger aria-label="Filter sessions by harness" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>{HARNESS_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                </SelectContent>
              </Select>
              <div className="col-span-2">
                <Select items={SESSION_SORT_ITEMS} value={sort} onValueChange={(value) => setSort((value || "recent") as SessionSort)}>
                  <SelectTrigger aria-label="Sort sessions" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>{SESSION_SORT_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </>
          }
          className="flex-col items-stretch py-2 [&>div:first-child]:max-w-none [&>div:nth-child(2)]:grid [&>div:nth-child(2)]:grid-cols-2"
        />
        <ResourceNotice resource={resource} label="Session data is degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
        {sessions.length > 0 ? (
          <BoundedVirtualList
            items={sessions}
            getKey={(session) => session.id}
            rowComponent={SessionsVirtualRow}
            rowContext={rowContext}
            selectedIndex={selectedIndex}
            onMoveSelection={(index) => { const session = sessions[index]; if (session) void dispatch({ type: "app.patch", patch: { selectedId: session.id } }) }}
            ariaLabel="Sessions"
          />
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            {resource.status === "loading" && resource.data.length === 0 ? <RowSkeletons count={8} /> : null}
            {resource.status === "error" && resource.data.length === 0 ? <EmptyState title="Sessions unavailable" description={resource.error || "No session data was returned."} /> : null}
            {resource.status === "ready" ? <EmptyState title={resource.data.length ? "No matching sessions" : "No recent sessions"} description={resource.data.length ? "Change or clear the current filters." : "Sessions from the last 72 hours will appear here."} /> : null}
          </ScrollArea>
        )}
      </section>
      <section className={appState.selectedId ? "flex h-full min-h-0 min-w-0 flex-col overflow-hidden max-[1040px]:flex" : "flex h-full min-h-0 min-w-0 flex-col overflow-hidden max-[1040px]:hidden"} aria-label="Selected session">
        <div className="hidden h-[var(--chrome)] shrink-0 items-center border-b border-border px-3 max-[1040px]:flex">
          <Button size="sm" variant="ghost" onClick={() => { void dispatch({ type: "app.patch", patch: { selectedId: undefined } }) }}>Back to sessions</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden"><LazySessionDetail key={selected?.id || "empty"} model={model} dispatch={dispatch} session={selected} thread={thread} /></div>
      </section>
    </div>
  )
}
