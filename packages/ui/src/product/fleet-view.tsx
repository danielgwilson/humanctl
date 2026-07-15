import { useMemo } from "react"
import { ActivityIcon, AlertTriangleIcon, RefreshCwIcon } from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { Button } from "@humanctl/ui/components/button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"

import type { HumanctlApplicationModel, HumanctlDispatch, HumanctlHarness, HumanctlSessionState, HumanctlTier } from "./contracts"
import { formatTime } from "./helpers"
import { ResourceNotice, SectionHeading } from "./shared"

const STATE_ORDER: HumanctlSessionState[] = ["need", "block", "work", "idle", "done"]
const HARNESS_ORDER: HumanctlHarness[] = ["codex", "claude-code"]
const TIER_ORDER: HumanctlTier[] = ["hot", "drifting", "archived"]

function DistributionRows({ rows, total }: { rows: Array<{ key: string; label: string; count: number; detail: string }>; total: number }) {
  return (
    <div className="border-t border-border">
      {rows.map((row) => {
        const share = total > 0 ? Math.round((row.count / total) * 100) : 0
        return (
          <div key={row.key} className="relative grid min-h-[var(--row-decision)] grid-cols-[minmax(9rem,1fr)_minmax(12rem,2fr)_4rem_4rem] items-center gap-4 overflow-hidden border-b border-border px-4 max-[720px]:grid-cols-[minmax(8rem,1fr)_4rem]">
            <span className="relative text-[13px] font-medium text-ink">{row.label}</span>
            <span className="relative truncate text-[12px] text-ink-3 max-[720px]:hidden">{row.detail}</span>
            <span className="relative text-right font-mono text-[12px] tabular-nums text-ink">{row.count}</span>
            <span className="relative text-right font-mono text-[11px] tabular-nums text-ink-3 max-[720px]:hidden">{share}%</span>
            <span className="absolute inset-x-0 bottom-0 h-px bg-border" aria-hidden="true"><span className="block h-full bg-primary" style={{ width: `${share}%` }} /></span>
          </div>
        )
      })}
    </div>
  )
}

export function FleetView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const sessionsResource = model.resources.sessions
  const statusResource = model.resources.status
  const sessions = sessionsResource.data
  const status = statusResource.data
  const counts = useMemo(() => Object.fromEntries(STATE_ORDER.map((state) => [state, sessions.filter((session) => session.state === state).length])) as Record<HumanctlSessionState, number>, [sessions])
  const harnessRows = useMemo(() => HARNESS_ORDER.map((harness) => ({
    key: harness,
    label: harness === "codex" ? "Codex" : "Claude Code",
    count: sessions.filter((session) => session.harness === harness).length,
    detail: harness === "codex" ? "Codex tasks in the current 72-hour inventory" : "Claude Code tasks in the current 72-hour inventory",
  })), [sessions])
  const tierRows = useMemo(() => TIER_ORDER.map((tier) => ({
    key: tier,
    label: tier === "hot" ? "Hot" : tier === "drifting" ? "Drifting" : "Archived",
    count: sessions.filter((session) => session.tier === tier).length,
    detail: tier === "hot" ? "Active within 24 hours" : tier === "drifting" ? "Inactive for 1 to 7 days" : "Inactive for more than 7 days",
  })), [sessions])

  return (
    <PageFrame>
      <PageHeader>
        <PageHeading>
          <PageTitle>Fleet</PageTitle>
          <PageDescription>Current worker state, pressure, and failure signals</PageDescription>
        </PageHeading>
        <PageActions><Button size="sm" onClick={() => { void dispatch({ type: "fleet.refresh" }) }}><RefreshCwIcon /> Refresh</Button></PageActions>
      </PageHeader>
      <ResourceNotice resource={sessionsResource} label="Fleet rows are degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
      <ResourceNotice resource={statusResource} label="Fleet rollup is degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
      <PageBody>
        <ScrollArea className="h-full">
          <section aria-labelledby="fleet-state-heading">
            <SectionHeading><span id="fleet-state-heading" className="flex items-center gap-2"><ActivityIcon className="size-3.5" />Current state</span></SectionHeading>
            <div className="grid grid-cols-5 border-b border-border max-[760px]:grid-cols-2">
              {STATE_ORDER.map((state, index) => (
                <div key={state} className="border-r border-border px-4 py-4 last:border-r-0 max-[760px]:border-b">
                  <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">{state === "need" ? "Needs you" : state === "block" ? "Blocked" : state === "work" ? "Working" : state === "done" ? "Complete" : "Idle"}</div>
                  <div className="mt-1 flex items-baseline gap-2"><span className="text-[24px] leading-7 font-semibold tabular-nums text-ink">{counts[state]}</span>{index === 0 && status?.needsYou ? <span className="font-mono text-[11px] text-need">{status.needsYou === 1 ? "action" : "actions"}</span> : null}</div>
                </div>
              ))}
            </div>
            {status?.nearCompaction ? (
              <div className="flex min-h-10 items-center gap-2 border-b border-need/30 bg-need-soft px-4 text-[12px] text-need"><AlertTriangleIcon className="size-3.5" />{status.nearCompaction} {status.nearCompaction === 1 ? "session is" : "sessions are"} near compaction.</div>
            ) : null}
          </section>

          <div className="grid grid-cols-2 max-[940px]:grid-cols-1">
            <section className="border-r border-border max-[940px]:border-r-0" aria-labelledby="fleet-harness-heading">
              <SectionHeading><span id="fleet-harness-heading">Harness distribution</span></SectionHeading>
              <DistributionRows rows={harnessRows} total={sessions.length} />
            </section>
            <section aria-labelledby="fleet-tier-heading">
              <SectionHeading><span id="fleet-tier-heading">Freshness distribution</span></SectionHeading>
              <DistributionRows rows={tierRows} total={sessions.length} />
            </section>
          </div>

          <div className="flex min-h-10 items-center border-b border-border px-4 font-mono text-[11px] text-ink-3">
            {sessionsResource.status === "loading" && sessions.length === 0 ? "Loading fleet distribution" : `${sessions.length} sessions in the current inventory`}
            {status?.generatedAt ? <span className="ml-auto">Updated {formatTime(status.generatedAt)}</span> : null}
          </div>
        </ScrollArea>
      </PageBody>
    </PageFrame>
  )
}
