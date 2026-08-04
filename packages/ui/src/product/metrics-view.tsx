import { useMemo } from "react"
import { BarChart3Icon, CoinsIcon, RefreshCwIcon, SparklesIcon } from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { QuotaRow } from "@humanctl/ui/blocks/quota"
import { Button } from "@humanctl/ui/components/button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@humanctl/ui/components/table"

import type { HumanctlApplicationModel, HumanctlDispatch } from "./contracts"
import { compactNumber, formatMoney, quotaReset } from "./helpers"
import { EmptyState, ResourceNotice, SectionHeading } from "./shared"

export function MetricsView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const statusResource = model.resources.status
  const quotaResource = model.resources.quota
  const skillsResource = model.resources.skills
  const status = statusResource.data

  const totals = useMemo(() => Object.entries(status?.per || {}).map(([harness, value]) => ({ harness, ...value })), [status?.per])
  const totalTokens = useMemo(() => totals.reduce((sum, item) => sum + item.totalTokens, 0), [totals])
  const totalCost = useMemo(() => totals.reduce((sum, item) => sum + (item.costUSD || item.apiEquivUSD || 0), 0), [totals])
  const averageContext = useMemo(() => {
    const values = model.resources.sessions.data
      .map((session) => session.contextPct)
      .filter((value): value is number => value != null && Number.isFinite(value))
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  }, [model.resources.sessions.data])
  const skills = useMemo(() => Object.entries(skillsResource.data?.skills || {}).sort((left, right) => right[1] - left[1]), [skillsResource.data])
  // Quota reads worst-first within each provider group, so the tightest window
  // is always at the top of its lane. Grouped (not one global sort) so the two
  // providers keep their independent progressive-load lanes without reflowing
  // across each other when the slower Claude resource lands.
  const codexQuotaRows = useMemo(() => {
    const q = status?.codexQuota
    const out: Array<{ key: string; label: string; value: number; detail?: string; reset?: string }> = []
    if (q?.primary) out.push({ key: "codex-primary", label: "Codex primary", value: q.primary.used_percent, detail: q.primary.label || q.plan_type, reset: quotaReset(q.primary) })
    if (q?.secondary) out.push({ key: "codex-secondary", label: "Codex secondary", value: q.secondary.used_percent, detail: q.secondary.label, reset: quotaReset(q.secondary) })
    return out.sort((left, right) => right.value - left.value)
  }, [status?.codexQuota])
  const claudeWindows = useMemo(() => [...(quotaResource.data?.windows ?? [])].sort((left, right) => right.used_percent - left.used_percent), [quotaResource.data])

  return (
    <PageFrame>
      <PageHeader>
        <PageHeading>
          <PageTitle>Metrics</PageTitle>
          <PageDescription>Quota, usage, cost, and skill activity across the current fleet</PageDescription>
        </PageHeading>
        <PageActions>
          <Button size="sm" variant="ghost" onClick={() => { void dispatch({ type: "metrics.loadSkills" }) }}>
            <SparklesIcon /> Refresh skills
          </Button>
          <Button size="sm" onClick={() => { void dispatch({ type: "fleet.refresh" }) }}>
            <RefreshCwIcon /> Refresh
          </Button>
        </PageActions>
      </PageHeader>
      <ResourceNotice resource={statusResource} label="Usage totals are degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
      <ResourceNotice resource={quotaResource} label="Quota is degraded" onRetry={() => { void dispatch({ type: "fleet.refresh" }) }} />
      <PageBody>
        <ScrollArea className="h-full">
          <div className="grid min-h-full grid-cols-2 max-[1000px]:grid-cols-1">
            <section className="min-w-0 border-r border-border max-[1000px]:border-r-0" aria-labelledby="usage-heading">
              <SectionHeading><span id="usage-heading">72 hour usage</span></SectionHeading>
              {statusResource.status === "loading" && !status ? (
                <div className="space-y-px p-4" role="status" aria-label="Loading usage"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              ) : status ? (
                <>
                  <div className="grid grid-cols-2 border-b border-border">
                    <div className="border-r border-border px-4 py-4">
                      <div className="text-xs font-medium text-ink-3">Avg. context</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{averageContext == null ? "N/A" : `${Math.round(averageContext)}%`}</div>
                    </div>
                    <div className="px-4 py-4">
                      <div className="text-xs font-medium text-ink-3">Near compaction</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{status.nearCompaction}</div>
                    </div>
                  </div>
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="bg-sunken hover:bg-sunken">
                        <TableHead className="h-9 w-[40%] px-4 text-xs text-ink-3">Harness</TableHead>
                        <TableHead className="h-9 px-2 text-right text-xs text-ink-3">Sessions</TableHead>
                        <TableHead className="h-9 px-2 text-right text-xs text-ink-3">Tokens</TableHead>
                        <TableHead className="h-9 px-4 text-right text-xs text-ink-3">Est. cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {totals.map((item) => (
                        <TableRow key={item.harness} className="h-[var(--row)] hover:bg-[var(--overlay-hover)]">
                          <TableCell className="truncate px-4 py-0 text-sm text-ink-2">{item.harness === "codex" ? "Codex" : "Claude Code"}</TableCell>
                          <TableCell className="px-2 py-0 text-right text-xs tabular-nums text-ink">{item.sessions}</TableCell>
                          <TableCell className="px-2 py-0 text-right text-xs tabular-nums text-ink">{compactNumber(item.totalTokens)}</TableCell>
                          <TableCell className="px-4 py-0 text-right text-xs tabular-nums text-ink">{formatMoney(item.costUSD || item.apiEquivUSD)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="h-[var(--row)] hover:bg-sunken">
                        <TableCell className="px-4 py-0 text-sm text-ink-2">All harnesses</TableCell>
                        <TableCell className="px-2 py-0 text-right text-xs tabular-nums text-ink">{status.sessions}</TableCell>
                        <TableCell className="px-2 py-0 text-right text-xs tabular-nums text-ink">{compactNumber(totalTokens)}</TableCell>
                        <TableCell className="px-4 py-0 text-right text-xs tabular-nums text-ink">{formatMoney(totalCost)}</TableCell>
                      </TableRow>
                    </TableFooter>
                    {status.pricingAsOf ? <TableCaption className="m-0 px-4 py-2 text-left text-xs tabular-nums text-ink-3">Pricing snapshot {status.pricingAsOf}</TableCaption> : null}
                  </Table>
                </>
              ) : (
                <EmptyState title="No usage data" description="Run a fleet refresh to read the current session totals." />
              )}

              <SectionHeading><span className="flex items-center gap-2"><CoinsIcon className="size-3.5" />Quota</span></SectionHeading>
              {codexQuotaRows.length > 0 ? (
                codexQuotaRows.map((row) => <QuotaRow key={row.key} label={row.label} value={row.value} detail={row.detail} reset={row.reset} />)
              ) : statusResource.status === "loading" ? <QuotaRow label="Codex primary" loading /> : null}
              {quotaResource.status === "loading" && !quotaResource.data ? <QuotaRow label="Claude workspace" loading /> : null}
              {claudeWindows.map((window, index) => (
                <QuotaRow
                  key={`${window.label || "window"}-${index}`}
                  label={`Claude ${window.label || (window.window_minutes ? `${Math.round(window.window_minutes / 60)} hour` : `window ${index + 1}`)}`}
                  value={window.used_percent}
                  detail={window.window_minutes ? `${Math.round(window.window_minutes / 60)}h window` : undefined}
                  reset={quotaReset(window, true)}
                />
              ))}
              {quotaResource.status !== "loading" && (!quotaResource.data || quotaResource.data.windows.length === 0) ? <div className="px-4 py-3 text-sm text-ink-3">Claude subscription quota unavailable.</div> : null}
            </section>

            <section className="min-w-0" aria-labelledby="skills-heading">
              <SectionHeading><span id="skills-heading" className="flex items-center gap-2"><BarChart3Icon className="size-3.5" />Skill usage</span></SectionHeading>
              {skillsResource.status === "loading" && !skillsResource.data ? (
                <div className="space-y-px p-4" role="status" aria-label="Loading skills"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
              ) : skillsResource.error && !skillsResource.data ? (
                <EmptyState title="Skill usage unavailable" description={skillsResource.error} action={<Button onClick={() => { void dispatch({ type: "metrics.loadSkills" }) }}>Retry</Button>} />
              ) : skillsResource.data ? (
                <>
                  <div className="grid grid-cols-2 border-b border-border">
                    <div className="border-r border-border px-4 py-4"><div className="text-xs font-medium text-ink-3">Invocations</div><div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums">{skillsResource.data.totalInvocations}</div></div>
                    <div className="px-4 py-4"><div className="text-xs font-medium text-ink-3">Sessions using skills</div><div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums">{skillsResource.data.sessionsWithSkills}</div></div>
                  </div>
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="bg-sunken hover:bg-sunken">
                        <TableHead className="h-9 px-4 text-xs text-ink-3">Skill</TableHead>
                        <TableHead className="h-9 w-16 px-4 text-right text-xs text-ink-3">Uses</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {skills.map(([skill, count], index) => {
                        const width = skills[0]?.[1] ? Math.max(4, Math.round((count / skills[0][1]) * 100)) : 0
                        return (
                          <TableRow key={skill} className="relative h-[var(--row)] hover:bg-[var(--overlay-hover)]">
                            <TableCell className="relative overflow-hidden px-4 py-0 text-sm">
                              <span className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${width}%`, opacity: 0.45 }} aria-hidden="true" />
                              <span className="relative block truncate text-ink-2"><span className="mr-2 text-xs tabular-nums text-ink-3">{String(index + 1).padStart(2, "0")}</span>{skill}</span>
                            </TableCell>
                            <TableCell className="relative px-4 py-0 text-right text-xs tabular-nums text-ink">{count}</TableCell>
                          </TableRow>
                        )
                      })}
                      {skills.length === 0 ? <TableRow><TableCell colSpan={2} className="px-4 py-5 text-sm text-ink-3">No skill invocations were found in the current window.</TableCell></TableRow> : null}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <EmptyState title="Load skill usage" description="Skill aggregation runs only when this view is opened." action={<Button onClick={() => { void dispatch({ type: "metrics.loadSkills" }) }}>Load skills</Button>} />
              )}
            </section>
          </div>
        </ScrollArea>
      </PageBody>
    </PageFrame>
  )
}
