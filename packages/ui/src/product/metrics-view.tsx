import { useMemo } from "react"
import { BarChart3Icon, CoinsIcon, RefreshCwIcon, SparklesIcon } from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { QuotaRow } from "@humanctl/ui/blocks/quota"
import { Button } from "@humanctl/ui/components/button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Skeleton } from "@humanctl/ui/components/skeleton"

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
                  <div className="grid grid-cols-5 border-b border-border max-[1200px]:grid-cols-3">
                    <div className="border-r border-border px-4 py-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Sessions</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{status.sessions}</div>
                    </div>
                    <div className="border-r border-border px-4 py-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Tokens</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{compactNumber(totalTokens)}</div>
                    </div>
                    <div className="px-4 py-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Est. cost</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{formatMoney(totalCost)}</div>
                    </div>
                    <div className="border-r border-border px-4 py-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Avg. context</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{averageContext == null ? "N/A" : `${Math.round(averageContext)}%`}</div>
                    </div>
                    <div className="px-4 py-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Near compaction</div>
                      <div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums text-ink">{status.nearCompaction}</div>
                    </div>
                  </div>
                  <div className="grid min-h-9 grid-cols-[minmax(8rem,1.2fr)_5rem_6rem_6rem] items-center gap-3 border-b border-border bg-sunken px-4 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">
                    <span>Harness</span><span className="text-right">Sessions</span><span className="text-right">Tokens</span><span className="text-right">Est. cost</span>
                  </div>
                  {totals.map((item) => (
                    <div key={item.harness} className="grid min-h-[var(--row)] grid-cols-[minmax(8rem,1.2fr)_5rem_6rem_6rem] items-center gap-3 border-b border-border px-4 text-[12px]">
                      <span className="truncate text-ink-2">{item.harness === "codex" ? "Codex" : "Claude Code"}</span>
                      <span className="text-right font-mono tabular-nums text-ink">{item.sessions}</span>
                      <span className="text-right font-mono tabular-nums text-ink">{compactNumber(item.totalTokens)}</span>
                      <span className="text-right font-mono tabular-nums text-ink">{formatMoney(item.costUSD || item.apiEquivUSD)}</span>
                    </div>
                  ))}
                  {status.pricingAsOf ? <div className="px-4 py-2 font-mono text-[10px] text-ink-4">Pricing snapshot {status.pricingAsOf}</div> : null}
                </>
              ) : (
                <EmptyState title="No usage data" description="Run a fleet refresh to read the current session totals." />
              )}

              <SectionHeading><span className="flex items-center gap-2"><CoinsIcon className="size-3.5" />Quota</span></SectionHeading>
              {status?.codexQuota?.primary ? (
                <QuotaRow label="Codex primary" value={status.codexQuota.primary.used_percent} detail={status.codexQuota.primary.label || status.codexQuota.plan_type} reset={quotaReset(status.codexQuota.primary)} />
              ) : statusResource.status === "loading" ? <QuotaRow label="Codex primary" loading /> : null}
              {status?.codexQuota?.secondary ? (
                <QuotaRow label="Codex secondary" value={status.codexQuota.secondary.used_percent} detail={status.codexQuota.secondary.label} reset={quotaReset(status.codexQuota.secondary)} />
              ) : null}
              {quotaResource.status === "loading" && !quotaResource.data ? <QuotaRow label="Claude workspace" loading /> : null}
              {quotaResource.data?.windows.map((window, index) => (
                <QuotaRow
                  key={`${window.label || "window"}-${index}`}
                  label={`Claude ${window.label || (window.window_minutes ? `${Math.round(window.window_minutes / 60)} hour` : `window ${index + 1}`)}`}
                  value={window.used_percent}
                  detail={window.window_minutes ? `${Math.round(window.window_minutes / 60)}h window` : undefined}
                  reset={quotaReset(window, true)}
                />
              ))}
              {quotaResource.status !== "loading" && (!quotaResource.data || quotaResource.data.windows.length === 0) ? <div className="px-4 py-3 text-[12px] text-ink-3">Claude subscription quota unavailable.</div> : null}
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
                    <div className="border-r border-border px-4 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Invocations</div><div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums">{skillsResource.data.totalInvocations}</div></div>
                    <div className="px-4 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Sessions using skills</div><div className="mt-1 text-[24px] leading-7 font-semibold tabular-nums">{skillsResource.data.sessionsWithSkills}</div></div>
                  </div>
                  <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_4rem] items-center border-b border-border bg-sunken px-4 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4"><span>Skill</span><span className="text-right">Uses</span></div>
                  {skills.map(([skill, count], index) => {
                    const width = skills[0]?.[1] ? Math.max(4, Math.round((count / skills[0][1]) * 100)) : 0
                    return (
                      <div key={skill} className="relative grid min-h-[var(--row)] grid-cols-[minmax(0,1fr)_4rem] items-center border-b border-border px-4 text-[12px]">
                        <span className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${width}%`, opacity: 0.45 }} aria-hidden="true" />
                        <span className="relative truncate text-ink-2"><span className="mr-2 font-mono text-[10px] text-ink-4">{String(index + 1).padStart(2, "0")}</span>{skill}</span>
                        <span className="relative text-right font-mono tabular-nums text-ink">{count}</span>
                      </div>
                    )
                  })}
                  {skills.length === 0 ? <div className="px-4 py-5 text-[13px] text-ink-3">No skill invocations were found in the current window.</div> : null}
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
