import { useMemo, useState } from "react"
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { Button } from "@humanctl/ui/components/button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@humanctl/ui/components/select"

import type { HumanctlApplicationModel, HumanctlDispatch, HumanctlSession, HumanctlSessionState } from "./contracts"
import { formatTime, sessionRepo, sessionTitle } from "./helpers"
import { EmptyState, HarnessMark, ResourceNotice, RowSkeletons, SectionHeading, SessionStatus } from "./shared"

// Fleet is a current-state timeline: each session is a marker placed on a shared
// 72h axis at its last-activity time (ageMs, the one reliable time coordinate),
// colored by state and grouped by state (needs-you first). There is no per-session
// state history or production start time, so this is deliberately a state-on-a-
// time-axis view, not a duration/lifespan chart.
const STATE_ORDER: HumanctlSessionState[] = ["need", "block", "work", "idle", "done"]
const GROUP_LABEL: Record<HumanctlSessionState, string> = { need: "Needs you", block: "Blocked", work: "Working", idle: "Idle", done: "Complete" }
const DOT: Record<HumanctlSessionState, string> = { need: "bg-need", block: "bg-block", work: "bg-work", done: "bg-done", idle: "bg-idle" }
const WINDOW_MS = 72 * 3.6e6
const GRIDLINES = [6, 12, 24, 48] as const
const AXIS_LABELS: Array<{ hoursAgo: number; text: string; anchor: "start" | "mid" | "end" }> = [
  { hoursAgo: 72, text: "72h", anchor: "start" },
  { hoursAgo: 24, text: "24h", anchor: "mid" },
  { hoursAgo: 0, text: "now", anchor: "end" },
]

const LANE_GRID = "grid grid-cols-[minmax(11rem,20rem)_minmax(0,1fr)_3.5rem] items-center gap-3"

// x% within the 72h window; clamp defends the edges. Recent activity sits at the
// right (now), older to the left.
const xForMs = (ms: number, now: number) => Math.min(100, Math.max(0, ((ms - (now - WINDOW_MS)) / WINDOW_MS) * 100))
const xForHoursAgo = (hoursAgo: number) => (1 - hoursAgo / 72) * 100

function AxisGridlines() {
  return (
    <>
      {GRIDLINES.map((hoursAgo) => (
        <span key={hoursAgo} className="absolute inset-y-0 w-px bg-separator" style={{ left: `${xForHoursAgo(hoursAgo)}%` }} aria-hidden="true" />
      ))}
    </>
  )
}

function TimelineAxis() {
  return (
    <div className={`${LANE_GRID} sticky top-0 z-10 h-8 border-b border-border bg-background px-3`}>
      <span className="text-[10px] font-medium tracking-[0.04em] text-ink-4 uppercase">Session</span>
      <span className="relative h-full">
        <AxisGridlines />
        {AXIS_LABELS.map((label) => (
          <span
            key={label.hoursAgo}
            className={`absolute bottom-1 text-[10px] tabular-nums text-ink-4 ${label.anchor === "end" ? "-translate-x-full" : label.anchor === "mid" ? "-translate-x-1/2" : ""}`}
            style={{ left: `${xForHoursAgo(label.hoursAgo)}%` }}
          >
            {label.text}
          </span>
        ))}
      </span>
      <span aria-hidden="true" />
    </div>
  )
}

function LaneRow({ session, now, selected, showStatus, onSelect }: {
  session: HumanctlSession
  now: number
  selected: boolean
  showStatus: boolean
  onSelect: (id: string) => void
}) {
  const x = xForMs(session.ageMs, now)
  return (
    <button
      type="button"
      data-selected={selected || undefined}
      title={sessionRepo(session)}
      onClick={() => onSelect(session.id)}
      className={`${LANE_GRID} h-8 w-full border-b border-separator px-3 text-left outline-none transition-colors duration-[var(--duration-color)] hover:bg-[var(--overlay-hover)] focus-visible:bg-[var(--overlay-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[selected]:bg-[var(--overlay-selected)] data-[selected]:shadow-[inset_2px_0_0_0_var(--color-primary)]`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <HarnessMark harness={session.harness} />
        <span className="min-w-0 flex-1 truncate text-sm tracking-[-0.006em] text-ink">{sessionTitle(session)}</span>
        {showStatus ? <SessionStatus state={session.state} /> : null}
      </span>
      <span className="relative h-full">
        <AxisGridlines />
        <span
          className={`absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${DOT[session.state]} ${session.state === "need" ? "size-2 ring-2 ring-[var(--need-soft)]" : ""}`}
          style={{ left: `${x}%` }}
          aria-hidden="true"
        />
      </span>
      <span className="text-right text-xs tabular-nums text-ink-3">{session.age || formatTime(session.ageMs)}</span>
    </button>
  )
}

export function FleetView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const [sort, setSort] = useState<"state" | "recency">("state")
  const sessionsResource = model.resources.sessions
  const statusResource = model.resources.status
  const sessions = sessionsResource.data
  const status = statusResource.data
  const selectedId = model.resources.appState.data.selectedId
  // Anchor "now" to the snapshot time so markers do not jitter against the
  // wall clock between renders; if the snapshot has no time, fall back to the
  // most recent activity in the window (pure, data-derived, no Date.now()).
  const snapshotNow = status?.generatedAt ? Date.parse(status.generatedAt) : Number.NaN
  let latestActivity = 0
  for (const session of sessions) if (session.ageMs > latestActivity) latestActivity = session.ageMs
  const now = Number.isFinite(snapshotNow) ? snapshotNow : latestActivity
  const byState = useMemo(() => {
    const map = new Map<HumanctlSessionState, HumanctlSession[]>()
    for (const state of STATE_ORDER) map.set(state, [])
    for (const session of sessions) map.get(session.state)?.push(session)
    for (const rows of map.values()) rows.sort((left, right) => right.ageMs - left.ageMs)
    return map
  }, [sessions])
  const flat = useMemo(() => [...sessions].sort((left, right) => right.ageMs - left.ageMs), [sessions])

  const onSelect = (id: string) => { void dispatch({ type: "app.patch", patch: { selectedId: id } }) }
  const loading = sessionsResource.status === "loading" && sessions.length === 0

  return (
    <PageFrame>
      <PageHeader>
        <PageHeading>
          <PageTitle>Fleet</PageTitle>
          <PageDescription>Every session on a 72 hour timeline, grouped by what it needs</PageDescription>
        </PageHeading>
        <PageActions>
          <Select items={SORT_ITEMS} value={sort} onValueChange={(value) => setSort((value || "state") as "state" | "recency")}>
            <SelectTrigger aria-label="Sort the timeline" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>{SORT_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => { void dispatch({ type: "fleet.refresh" }) }}><RefreshCwIcon /> Refresh</Button>
        </PageActions>
      </PageHeader>
      <ResourceNotice resource={sessionsResource} label="Fleet rows are degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
      <ResourceNotice resource={statusResource} label="Fleet rollup is degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
      {status?.nearCompaction ? (
        <div className="flex min-h-9 items-center gap-2 border-b border-need/30 bg-need-soft px-4 text-sm text-need"><AlertTriangleIcon className="size-3.5" />{status.nearCompaction} {status.nearCompaction === 1 ? "session is" : "sessions are"} near compaction.</div>
      ) : null}
      <PageBody>
        <ScrollArea className="h-full">
          {loading ? (
            <div className="p-4"><RowSkeletons count={8} /></div>
          ) : sessions.length === 0 ? (
            <EmptyState title="No sessions in the last 72 hours" description="Active tasks across your local harnesses will appear on the timeline here." />
          ) : (
            <>
              <TimelineAxis />
              {sort === "state"
                ? STATE_ORDER.filter((state) => (byState.get(state)?.length ?? 0) > 0).map((state) => {
                    const rows = byState.get(state) ?? []
                    return (
                      <section key={state} aria-label={GROUP_LABEL[state]}>
                        <SectionHeading trailing={<span className="tabular-nums text-ink-3">{rows.length}</span>}>
                          <span className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${DOT[state]}`} aria-hidden="true" />{GROUP_LABEL[state]}</span>
                        </SectionHeading>
                        {rows.map((session) => (
                          <LaneRow key={session.id} session={session} now={now} selected={session.id === selectedId} showStatus={false} onSelect={onSelect} />
                        ))}
                      </section>
                    )
                  })
                : flat.map((session) => (
                    <LaneRow key={session.id} session={session} now={now} selected={session.id === selectedId} showStatus onSelect={onSelect} />
                  ))}
            </>
          )}
          <div className="flex min-h-9 items-center border-b border-border px-4 text-xs text-ink-3">
            {loading ? "Loading fleet timeline" : `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} in the last 72 hours`}
            {status?.generatedAt ? <span className="ml-auto tabular-nums">Updated {formatTime(status.generatedAt)}</span> : null}
          </div>
        </ScrollArea>
      </PageBody>
    </PageFrame>
  )
}

const SORT_ITEMS = [
  { label: "By state", value: "state" },
  { label: "By recency", value: "recency" },
]
