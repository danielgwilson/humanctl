import { useState } from "react"
import { CheckIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { Button } from "@humanctl/ui/components/button"
import { Input } from "@humanctl/ui/components/input"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"

import { budgetInputValue, decideBudgetCommit, formatBudgetInput, type BudgetDraft } from "./budget-draft"
import type { HumanctlApplicationModel, HumanctlDispatch, HumanctlTheme } from "./contracts"
import { formatMoney, operationPending } from "./helpers"
import { DefinitionRow, ResourceNotice, SectionHeading } from "./shared"

const DEFAULT_BUDGET = 1

export function SettingsView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const appState = model.resources.appState.data
  const budgetResource = model.resources.budget
  const dailyBudget = appState.summaryBudgetUSD ?? DEFAULT_BUDGET
  const [budgetDraft, setBudgetDraft] = useState<BudgetDraft | null>(null)
  const budgetInput = budgetInputValue(budgetDraft, dailyBudget)
  const loadingBudget = operationPending(model.operations, "settings.loadBudget")

  async function setTheme(theme: HumanctlTheme) {
    await dispatch({ type: "app.patch", patch: { theme } })
  }

  async function commitBudget() {
    const decision = decideBudgetCommit(budgetDraft, dailyBudget, DEFAULT_BUDGET)
    if (decision.kind === "discard") {
      setBudgetDraft(null)
      return
    }

    setBudgetDraft({ value: decision.displayValue, dirty: false })
    const persisted = await dispatch({ type: "app.patch", patch: { summaryBudgetUSD: decision.value } })
    if (!persisted.ok) {
      setBudgetDraft((current) => current?.value === decision.displayValue && !current.dirty ? { ...current, dirty: true } : current)
      return
    }
    await dispatch({ type: "settings.loadBudget", dailyBudgetUSD: decision.value })
    setBudgetDraft((current) => current?.value === decision.displayValue && !current.dirty ? null : current)
  }

  return (
    <PageFrame>
      <PageHeader>
        <PageHeading>
          <PageTitle>Settings</PageTitle>
          <PageDescription>Local appearance, summary behavior, and spend limits</PageDescription>
        </PageHeading>
        <PageActions>
          <Button size="sm" variant="ghost" disabled={loadingBudget} onClick={() => { void dispatch({ type: "settings.loadBudget", dailyBudgetUSD: dailyBudget }) }}>
            {loadingBudget ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <RefreshCwIcon />} Refresh budget
          </Button>
        </PageActions>
      </PageHeader>
      <ResourceNotice resource={model.resources.appState} label="Preferences are degraded" />
      <ResourceNotice resource={budgetResource} label="Budget status is degraded" onRetry={() => { void dispatch({ type: "settings.loadBudget", dailyBudgetUSD: dailyBudget }) }} />
      <PageBody>
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl border-x border-border max-[900px]:border-x-0">
            <SectionHeading>Appearance</SectionHeading>
            <DefinitionRow label="Theme">
              <div className="flex flex-wrap items-center gap-1.5">
                {(["light", "dark", "system"] as HumanctlTheme[]).map((theme) => (
                  <Button key={theme} size="sm" aria-pressed={appState.theme === theme} variant={appState.theme === theme ? "neutral" : "ghost"} onClick={() => { void setTheme(theme) }}>
                    {appState.theme === theme ? <CheckIcon /> : null}{theme[0].toUpperCase() + theme.slice(1)}
                  </Button>
                ))}
              </div>
            </DefinitionRow>
            <div className="px-4 py-3 text-[12px] leading-5 text-ink-3">System follows the operating system appearance and updates while Humanctl is open.</div>

            <SectionHeading>AI summary</SectionHeading>
            <DefinitionRow label="Engine">
              <div className="flex flex-wrap items-center gap-1.5">
                {(["claude", "codex"] as const).map((engine) => (
                  <Button key={engine} size="sm" aria-pressed={(appState.summarizer || "claude") === engine} variant={(appState.summarizer || "claude") === engine ? "neutral" : "ghost"} onClick={() => { void dispatch({ type: "app.patch", patch: { summarizer: engine } }) }}>
                    {(appState.summarizer || "claude") === engine ? <CheckIcon /> : null}{engine === "claude" ? "Claude Code" : "Codex"}
                  </Button>
                ))}
              </div>
            </DefinitionRow>
            <DefinitionRow label="Daily budget">
              <div className="flex items-center gap-2">
                <span className="text-ink-3">$</span>
                <Input
                  aria-label="Always-on summary daily budget in US dollars"
                  className="w-28 font-mono tabular-nums"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={budgetInput}
                  onFocus={() => setBudgetDraft((current) => current ?? { value: formatBudgetInput(dailyBudget), dirty: false })}
                  onChange={(event) => setBudgetDraft({ value: event.currentTarget.value, dirty: true })}
                  onBlur={(event) => {
                    if ((event.relatedTarget as HTMLElement | null)?.dataset.budgetApply === "true") return
                    void commitBudget()
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitBudget() } }}
                />
                <Button data-budget-apply="true" size="sm" variant="ghost" onClick={() => { void commitBudget() }}>Apply</Button>
              </div>
            </DefinitionRow>
            {budgetResource.status === "loading" && !budgetResource.data ? <div className="px-4 py-3 font-mono text-[11px] text-ink-3">Reading today&apos;s spend...</div> : null}
            {budgetResource.data ? (
              <div className="grid grid-cols-4 border-b border-border max-[700px]:grid-cols-2">
                <div className="border-r border-border px-4 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Spent today</div><div className="mt-1 text-[18px] font-semibold tabular-nums">{formatMoney(budgetResource.data.spentUSD)}</div></div>
                <div className="border-r border-border px-4 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Limit</div><div className="mt-1 text-[18px] font-semibold tabular-nums">{formatMoney(budgetResource.data.dailyBudgetUSD)}</div></div>
                <div className="border-r border-border px-4 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Remaining</div><div className="mt-1 text-[18px] font-semibold tabular-nums">{formatMoney(budgetResource.data.remainingUSD)}</div></div>
                <div className="px-4 py-4"><div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">Background summaries</div><div className={`mt-1 text-[13px] font-medium ${budgetResource.data.paused ? "text-need" : "text-work"}`}>{budgetResource.data.paused ? "Paused" : "Running"}</div></div>
              </div>
            ) : null}
            <div className="px-4 py-3 text-[12px] leading-5 text-ink-3">The budget applies to background summaries. Manual summaries and session questions still require an explicit action.</div>

            <SectionHeading>Data handling</SectionHeading>
            <DefinitionRow label="Fleet reads" value="Local files and local desktop bridge" />
            <DefinitionRow label="Session actions" value="Your installed harness and its existing authentication" />
            <DefinitionRow label="Preferences" value="Persisted locally" />
            <div className="px-4 py-3 text-[12px] leading-5 text-ink-3">Reading tasks, inbox updates, transcripts, and quota does not send session content to a new service. Actions that ask or summarize a session run through the selected local harness.</div>
          </div>
        </ScrollArea>
      </PageBody>
    </PageFrame>
  )
}
