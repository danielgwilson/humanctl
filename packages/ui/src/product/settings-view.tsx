import { useState } from "react"
import { RefreshCwIcon } from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { Button } from "@humanctl/ui/components/button"
import { Field, FieldLabel, FieldTitle } from "@humanctl/ui/components/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@humanctl/ui/components/input-group"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Spinner } from "@humanctl/ui/components/spinner"
import { ToggleGroup, ToggleGroupItem } from "@humanctl/ui/components/toggle-group"
import { cn } from "@humanctl/ui/lib/cn"

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
  const [brainPathDraft, setBrainPathDraft] = useState<string | null>(null)
  const brainPathInput = brainPathDraft ?? (appState.brainSnapshotPath || "")

  async function commitBrainPath() {
    const trimmed = brainPathInput.trim()
    await dispatch({ type: "app.patch", patch: { brainSnapshotPath: trimmed ? trimmed : undefined } })
    setBrainPathDraft(null)
  }

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
            {loadingBudget ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />} Refresh budget
          </Button>
        </PageActions>
      </PageHeader>
      <ResourceNotice resource={model.resources.appState} label="Preferences are degraded" />
      <ResourceNotice resource={budgetResource} label="Budget status is degraded" onRetry={() => { void dispatch({ type: "settings.loadBudget", dailyBudgetUSD: dailyBudget }) }} />
      <PageBody>
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-4xl border-x border-border max-[900px]:border-x-0">
            <SectionHeading>Appearance</SectionHeading>
            <Field orientation="horizontal" className="grid min-h-10 grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2 text-sm">
              <FieldTitle id="theme-setting">Theme</FieldTitle>
              <ToggleGroup
                aria-labelledby="theme-setting"
                value={[appState.theme]}
                onValueChange={(values) => { const theme = values[0] as HumanctlTheme | undefined; if (theme) void setTheme(theme) }}
                variant="outline"
                size="sm"
                spacing={0}
              >
                {(["light", "dark", "system"] as HumanctlTheme[]).map((theme) => (
                  <ToggleGroupItem key={theme} value={theme}>{theme[0].toUpperCase() + theme.slice(1)}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <div className="px-4 py-3 text-sm leading-5 text-ink-3">System follows the operating system appearance and updates while Humanctl is open.</div>

            <SectionHeading>AI summary</SectionHeading>
            <Field orientation="horizontal" className="grid min-h-10 grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2 text-sm">
              <FieldTitle id="summary-engine-setting">Engine</FieldTitle>
              <ToggleGroup
                aria-labelledby="summary-engine-setting"
                value={[appState.summarizer || "claude"]}
                onValueChange={(values) => { const engine = values[0] as "claude" | "codex" | undefined; if (engine) void dispatch({ type: "app.patch", patch: { summarizer: engine } }) }}
                variant="outline"
                size="sm"
                spacing={0}
              >
                <ToggleGroupItem value="claude">Claude Code</ToggleGroupItem>
                <ToggleGroupItem value="codex">Codex</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field orientation="horizontal" className="grid min-h-10 grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2 text-sm">
              <FieldLabel htmlFor="summary-budget">Daily budget</FieldLabel>
              <InputGroup className="max-w-60">
                <InputGroupAddon><InputGroupText>$</InputGroupText></InputGroupAddon>
                <InputGroupInput
                  id="summary-budget"
                  aria-label="Always-on summary daily budget in US dollars"
                  className="tabular-nums"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={budgetInput}
                  onFocus={() => setBudgetDraft((current) => current ?? { value: formatBudgetInput(dailyBudget), dirty: false })}
                  onChange={(event) => setBudgetDraft({ value: event.currentTarget.value, dirty: true })}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitBudget() } }}
                />
                <InputGroupAddon align="inline-end"><Button size="sm" variant="ghost" onClick={() => { void commitBudget() }}>Apply</Button></InputGroupAddon>
              </InputGroup>
            </Field>
            {budgetResource.status === "loading" && !budgetResource.data ? <div className="px-4 py-3 text-xs text-ink-3">Reading today&apos;s spend...</div> : null}
            {budgetResource.data ? (
              <div className="grid grid-cols-4 border-b border-border max-[700px]:grid-cols-2">
                <div className="border-r border-border px-4 py-4"><div className="text-xs font-medium text-ink-3">Spent today</div><div className="mt-1 text-[18px] font-semibold tabular-nums">{formatMoney(budgetResource.data.spentUSD)}</div></div>
                <div className="border-r border-border px-4 py-4"><div className="text-xs font-medium text-ink-3">Limit</div><div className="mt-1 text-[18px] font-semibold tabular-nums">{formatMoney(budgetResource.data.dailyBudgetUSD)}</div></div>
                <div className="border-r border-border px-4 py-4"><div className="text-xs font-medium text-ink-3">Remaining</div><div className="mt-1 text-[18px] font-semibold tabular-nums">{formatMoney(budgetResource.data.remainingUSD)}</div></div>
                <div className="px-4 py-4"><div className="text-xs font-medium text-ink-3">Background summaries</div><div className={cn("mt-1 text-sm font-medium", budgetResource.data.paused ? "text-need" : "text-work")}>{budgetResource.data.paused ? "Paused" : "Running"}</div></div>
              </div>
            ) : null}
            <div className="px-4 py-3 text-sm leading-5 text-ink-3">The budget applies to background summaries. Manual summaries and session questions still require an explicit action.</div>

            <SectionHeading>Brain vault</SectionHeading>
            <Field orientation="horizontal" className="grid min-h-10 grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 border-b border-border px-4 py-2 text-sm">
              <FieldLabel htmlFor="brain-snapshot-path">Snapshot path</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="brain-snapshot-path"
                  aria-label="Path to the Brain vault snapshot file"
                  className="font-mono text-xs"
                  type="text"
                  spellCheck={false}
                  placeholder="~/path/to/vault-snapshot.json"
                  value={brainPathInput}
                  onFocus={() => setBrainPathDraft((current) => current ?? (appState.brainSnapshotPath || ""))}
                  onChange={(event) => setBrainPathDraft(event.currentTarget.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commitBrainPath() } }}
                />
                <InputGroupAddon align="inline-end"><Button size="sm" variant="ghost" onClick={() => { void commitBrainPath() }}>Apply</Button></InputGroupAddon>
              </InputGroup>
            </Field>
            <div className="px-4 py-3 text-sm leading-5 text-ink-3">Point Brain at a JSON snapshot in the documented vault format. The file is read locally and never leaves your machine. Leave it blank to disconnect.</div>

            <SectionHeading>Data handling</SectionHeading>
            <DefinitionRow label="Fleet reads" value="Local files and local desktop bridge" />
            <DefinitionRow label="Session actions" value="Your installed harness and its existing authentication" />
            <DefinitionRow label="Preferences" value="Persisted locally" />
            <div className="px-4 py-3 text-sm leading-5 text-ink-3">Reading tasks, inbox updates, transcripts, and quota does not send session content to a new service. Actions that ask or summarize a session run through the selected local harness.</div>
          </div>
        </ScrollArea>
      </PageBody>
    </PageFrame>
  )
}
