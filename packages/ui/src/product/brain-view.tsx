import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowLeftIcon,
  BrainIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  GitMergeIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"

import { PageActions, PageBody, PageDescription, PageFrame, PageHeader, PageHeading, PageTitle } from "@humanctl/ui/blocks/page-frame"
import { Badge } from "@humanctl/ui/components/badge"
import { Button } from "@humanctl/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@humanctl/ui/components/empty"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@humanctl/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@humanctl/ui/components/tabs"
import { cn } from "@humanctl/ui/lib/cn"

import type { HumanctlApplicationModel, HumanctlDispatch } from "./contracts"
import { RowSkeletons, SectionHeading } from "./shared"
import type { VaultEntity, VaultProposal, VaultSnapshot, VaultView } from "./vault-snapshot"

// Generic palette roles a producer's `views.labelTones` hint may name, mapped to
// a semantic dot color. The viewer knows the roles, never the domain values.
const TONE_DOT: Record<string, string> = {
  accent: "bg-primary",
  positive: "bg-work",
  notice: "bg-idle",
  warn: "bg-need",
  muted: "bg-idle",
  faint: "bg-ink-3/50",
}

// The one generic status vocabulary the contract documents (a producer-resolved
// cadence state). Tones fall back to this when a snapshot omits a labelTones hint.
const STATUS_TONE: Record<string, string> = {
  "on-track": "positive",
  due: "notice",
  overdue: "warn",
}

const STATUS_LABEL: Record<string, string> = {
  "on-track": "On track",
  due: "Due soon",
  overdue: "Overdue",
}

function initials(label: string): string {
  return label.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()
}

function humanizeKey(key: string): string {
  if (key === "lastContactAt") return "Last contact"
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/

function formatValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "number") return String(value)
  const text = String(value)
  if (DATE_RE.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    }
  }
  return text
}

// A producer is only envelope-validated (version + each entity's id/kind/label),
// so any nested field may arrive malformed. These stay defensive so a bad field
// degrades gracefully instead of white-screening the app (there is no error
// boundary), honoring the contract's "malformed never crashes" rule.
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Resolve a column key against an entity generically: labels first (groupable
// values), then spec facets. The viewer never hardcodes a domain field name.
function cellValue(entity: VaultEntity, key: string): unknown {
  if (key === "label") return entity.label
  if (isObject(entity.labels) && key in entity.labels) return entity.labels[key]
  if (isObject(entity.spec) && key in entity.spec) return entity.spec[key]
  return undefined
}

function toneFor(key: string, value: unknown, view?: VaultView): string | null {
  const text = value == null ? "" : String(value)
  const fromHint = view?.labelTones?.[key]?.[text]
  if (fromHint && TONE_DOT[fromHint]) return TONE_DOT[fromHint]
  if (STATUS_TONE[text]) return TONE_DOT[STATUS_TONE[text]]
  return null
}

function displayValue(key: string, value: unknown): string {
  const text = value == null ? "" : String(value)
  if (STATUS_LABEL[text]) return STATUS_LABEL[text]
  return formatValue(value)
}

function compareBy(key: string, dir: "asc" | "desc") {
  return (left: VaultEntity, right: VaultEntity): number => {
    const a = cellValue(left, key)
    const b = cellValue(right, key)
    let result: number
    if (typeof a === "number" && typeof b === "number") result = a - b
    else result = String(a ?? "").localeCompare(String(b ?? ""))
    return dir === "desc" ? -result : result
  }
}

function useEntityIndex(entities: ReadonlyArray<VaultEntity>): Map<string, VaultEntity> {
  return useMemo(() => {
    const map = new Map<string, VaultEntity>()
    for (const entity of entities) {
      map.set(entity.id, entity)
      const bare = entity.id.includes(":") ? entity.id.slice(entity.id.indexOf(":") + 1) : entity.id
      if (!map.has(bare)) map.set(bare, entity)
    }
    return map
  }, [entities])
}

function resolveRef(index: Map<string, VaultEntity>, ref: string): VaultEntity | undefined {
  return index.get(ref) || index.get(ref.split(":").pop() || "")
}

function StatusText({ status }: { status?: string }) {
  if (!status) return null
  const tone = toneFor("status", status)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-ink-2">
      {tone ? <span className={cn("size-1.5 rounded-full", tone)} aria-hidden="true" /> : null}
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function HealthStrip({ snapshot }: { snapshot: VaultSnapshot }) {
  const vitals = isObject(snapshot.vitals) ? snapshot.vitals : {}
  const followups = asArray(snapshot.queues?.followups).length
  const proposals = asArray(snapshot.queues?.proposals).length
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Entities", value: String(vitals.entities ?? snapshot.entities.length), hint: "people + orgs" },
    { label: "Canon pages", value: vitals.canonPages != null ? String(vitals.canonPages) : "n/a", hint: "promoted" },
    { label: "Follow-ups due", value: String(followups), hint: "past cadence" },
    { label: "Proposals", value: String(proposals), hint: "to review" },
    { label: "Last ingest", value: vitals.lastIngest || "n/a", hint: vitals.ingestOk === false ? "stale" : "clean" },
  ]
  return (
    <div className="grid grid-cols-5 border-b border-border max-[900px]:grid-cols-3">
      {tiles.map((tile, i) => (
        <div key={tile.label} className={cn("px-4 py-3", i < tiles.length - 1 && "border-r border-border", i === 2 && "max-[900px]:border-r-0")}>
          <div className="text-xs font-medium text-ink-3">{tile.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-[22px] leading-7 font-semibold tabular-nums text-ink">{tile.value}</span>
            {tile.hint ? <span className="text-xs text-ink-3">{tile.hint}</span> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function PeopleTable({ snapshot, onSelect }: { snapshot: VaultSnapshot; onSelect: (id: string) => void }) {
  const view = snapshot.views?.people
  const columns = Array.isArray(view?.columns) && view.columns.length ? view.columns : ["priority", "lastContactAt", "status"]
  const entities = useMemo(() => {
    const rows = asArray<VaultEntity>(snapshot.entities)
    const sort = view?.sort
    if (sort) {
      const [key, dir] = sort.split(":")
      rows.sort(compareBy(key, dir === "asc" ? "asc" : "desc"))
    }
    return rows
  }, [snapshot.entities, view?.sort])
  const sample = entities[0]

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="bg-sunken hover:bg-sunken">
          <TableHead className="h-9 w-[34%] px-4 text-xs text-ink-3">Person</TableHead>
          {columns.map((key) => (
            <TableHead key={key} className={cn("h-9 px-2 text-xs text-ink-3", sample && typeof cellValue(sample, key) === "number" && "text-right")}>
              {humanizeKey(key)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entities.map((entity) => (
          <TableRow
            key={entity.id}
            className="h-[var(--row)] cursor-pointer hover:bg-[var(--overlay-hover)]"
            onClick={() => onSelect(entity.id)}
          >
            <TableCell className="px-4 py-0">
              <div className="truncate text-sm font-medium text-ink">{entity.label}</div>
              {entity.annotations?.role ? <div className="truncate text-xs text-ink-3">{entity.annotations.role}</div> : null}
            </TableCell>
            {columns.map((key) => {
              const value = cellValue(entity, key)
              const numeric = typeof value === "number"
              const tone = toneFor(key, value, view)
              return (
                <TableCell key={key} className={cn("px-2 py-0 text-xs", numeric ? "text-right tabular-nums text-ink-2" : "text-ink-2")}>
                  <span className="inline-flex items-center gap-1.5">
                    {tone && !numeric ? <span className={cn("size-1.5 rounded-full", tone)} aria-hidden="true" /> : null}
                    {displayValue(key, value)}
                  </span>
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PersonPage({ entity, index, onBack }: { entity: VaultEntity; index: Map<string, VaultEntity>; onBack: () => void }) {
  const spec = isObject(entity.spec) ? entity.spec : {}
  const labels = isObject(entity.labels) ? entity.labels : {}
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--row-decision)] shrink-0 items-center gap-2 border-b border-border px-3">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeftIcon /> All people</Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-semibold text-ink">{initials(entity.label)}</div>
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-xl font-semibold tracking-[-0.01em] text-ink">{entity.label}</h1>
              {entity.annotations?.role ? <p className="m-0 mt-0.5 text-sm text-ink-2">{entity.annotations.role}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {Object.entries(labels).map(([key, value]) => {
                  const tone = toneFor(key, value, undefined)
                  return (
                    <Badge key={key} variant="outline" className="capitalize">
                      {tone ? <span className={cn("mr-1 size-1.5 rounded-full", tone)} aria-hidden="true" /> : null}
                      {value}
                    </Badge>
                  )
                })}
                <StatusText status={spec.status} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              {spec.lastContactAt ? <><div className="text-xs text-ink-3">Last contact</div><div className="text-sm font-medium tabular-nums text-ink">{formatValue(spec.lastContactAt)}</div></> : null}
              {spec.cadenceDays != null ? <div className="mt-1 text-xs text-ink-3">every {spec.cadenceDays}d</div> : null}
            </div>
          </div>

          {spec.summary ? (
            <div className="mt-4 rounded-md border border-border bg-sunken px-4 py-3">
              <div className="text-xs font-medium text-ink-3">Where we left off</div>
              <p className="m-0 mt-1 text-sm leading-5 text-ink-2">{spec.summary}</p>
            </div>
          ) : null}

          {asArray<{ heading?: string; body?: string }>(spec.sections).map((section, i) => (
            <section key={`${section.heading || "section"}-${i}`} className="mt-4">
              {section.heading ? <h2 className="m-0 text-sm font-semibold text-ink">{String(section.heading)}</h2> : null}
              {section.body ? <p className="m-0 mt-1 text-sm leading-6 text-ink-2">{String(section.body)}</p> : null}
            </section>
          ))}

          {asArray(entity.relations).length ? (
            <section className="mt-5">
              <h2 className="m-0 flex items-center gap-2 text-xs font-medium tracking-wide text-ink-3 uppercase"><UsersIcon className="size-3.5" /> Connected</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {asArray<{ targetRef?: string; note?: string; type?: string }>(entity.relations).map((relation, i) => {
                  const ref = String(relation.targetRef || "")
                  const target = resolveRef(index, ref)
                  return (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-2">
                      <span className="font-medium text-ink">{target?.label || ref}</span>
                      <span className="text-ink-3">{String(relation.note || relation.type || "")}</span>
                    </span>
                  )
                })}
              </div>
            </section>
          ) : null}

          {asArray(spec.evidence).length ? (
            <section className="mt-5">
              <h2 className="m-0 flex items-center gap-2 text-xs font-medium tracking-wide text-ink-3 uppercase"><FileTextIcon className="size-3.5" /> Evidence</h2>
              <div className="mt-2 space-y-2">
                {asArray<{ quote?: string; date?: string; source?: string }>(spec.evidence).map((item, i) => (
                  <div key={i} className="border-l-2 border-border pl-3">
                    <p className="m-0 text-sm leading-5 text-ink-2">&ldquo;{String(item.quote || "")}&rdquo;</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      {item.date ? <span className="tabular-nums">{String(item.date)}</span> : null}
                      {item.source ? <span className="font-mono">{String(item.source)}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

function FollowUps({ snapshot, index, onSelect }: { snapshot: VaultSnapshot; index: Map<string, VaultEntity>; onSelect: (id: string) => void }) {
  const followups = asArray<{ entityRef?: string; reason?: string; status?: string; overdueDays?: number }>(snapshot.queues?.followups)
  if (!followups.length) {
    return <div className="px-4 py-6 text-sm text-ink-3">Everyone is within cadence. Nothing is owed right now.</div>
  }
  return (
    <div className="divide-y divide-border">
      {followups.map((followup, i) => {
        const ref = String(followup.entityRef || "")
        const entity = resolveRef(index, ref)
        const overdue = followup.status === "overdue"
        return (
          <button
            key={`${ref}-${i}`}
            type="button"
            onClick={() => entity && onSelect(entity.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--overlay-hover)]"
          >
            <ClockIcon className={cn("size-4 shrink-0", overdue ? "text-need" : "text-idle")} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{entity?.label || ref}</div>
              {followup.reason ? <div className="truncate text-xs text-ink-3">{String(followup.reason)}</div> : null}
            </div>
            <div className="shrink-0 text-right">
              <StatusText status={followup.status} />
              {followup.overdueDays != null ? <div className="mt-0.5 text-xs tabular-nums text-ink-3">{followup.overdueDays > 0 ? `${followup.overdueDays}d over` : "due now"}</div> : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}

type Decision = "promoted" | "deferred" | "rejected"

function ProposalQueue({ proposals }: { proposals: ReadonlyArray<VaultProposal> }) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  if (!proposals.length) {
    return <div className="px-4 py-6 text-sm text-ink-3">No pending proposals. The vault is reconciled.</div>
  }
  return (
    <div className="divide-y divide-border">
      {proposals.map((proposal, i) => {
        const pid = String(proposal.id || i)
        const decision = decisions[pid]
        return (
          <div key={pid} className={cn("px-4 py-3.5", decision && "opacity-60")}>
            <div className="flex items-start gap-3">
              <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{String(proposal.kind).replace(/-/g, " ")}</Badge>
                  {typeof proposal.confidence === "number" ? <span className="text-xs tabular-nums text-ink-3">{Math.round(proposal.confidence * 100)}% confidence</span> : null}
                </div>
                <div className="mt-1.5 text-sm font-medium text-ink">{String(proposal.title || "")}</div>
                {proposal.rationale ? <p className="m-0 mt-0.5 text-sm leading-5 text-ink-2">{String(proposal.rationale)}</p> : null}
                {asArray(proposal.evidence).length ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
                    {asArray<string>(proposal.evidence).map((source, i) => <span key={`${source}-${i}`} className="font-mono">{String(source)}</span>)}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {decision ? (
                  <span className={cn("text-xs font-medium capitalize", decision === "promoted" ? "text-work" : decision === "rejected" ? "text-need" : "text-ink-3")}>{decision}</span>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setDecisions((prev) => ({ ...prev, [pid]: "deferred" }))}>Defer</Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Reject" onClick={() => setDecisions((prev) => ({ ...prev, [pid]: "rejected" }))}><XIcon /></Button>
                    <Button size="sm" onClick={() => setDecisions((prev) => ({ ...prev, [pid]: "promoted" }))}><CheckIcon /> Promote</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <p className="m-0 px-4 py-3 text-xs text-ink-3">Decisions are a preview here. In a connected vault they write to the producer&rsquo;s grooming queue; the producer&rsquo;s promotion pass makes the canon edits.</p>
    </div>
  )
}

function BrainShell({ badge, children }: { badge?: ReactNode; children: ReactNode }) {
  return (
    <PageFrame>
      <PageHeader>
        <PageHeading>
          <PageTitle>Brain</PageTitle>
          <PageDescription>The relationship vault your agents maintain: people, threads, and what&rsquo;s owed</PageDescription>
        </PageHeading>
        <PageActions>{badge}</PageActions>
      </PageHeader>
      {children}
    </PageFrame>
  )
}

export function BrainView({ model, dispatch }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const resource = model.resources.brain
  const snapshot = resource.data
  const index = useEntityIndex(snapshot?.entities || [])
  const selected = selectedId && snapshot ? snapshot.entities.find((entity) => entity.id === selectedId) || null : null
  const sampleBadge = model.mode === "fixture" ? <Badge variant="outline">Sample vault</Badge> : null

  // Treat idle like loading: the load is dispatched from an effect after the
  // first paint, so showing skeletons (not the onboarding state) until the
  // resource actually resolves avoids a one-frame "not connected" flash.
  if ((resource.status === "loading" || resource.status === "idle") && !snapshot) {
    return (
      <BrainShell>
        <PageBody><div className="p-4"><RowSkeletons count={8} /></div></PageBody>
      </BrainShell>
    )
  }

  if (resource.error && !snapshot) {
    return (
      <BrainShell>
        <PageBody>
          <div className="grid h-full place-items-center px-6">
            <Empty className="max-w-md">
              <EmptyHeader>
                <EmptyMedia variant="icon"><BrainIcon /></EmptyMedia>
                <EmptyTitle>Couldn&rsquo;t read the vault snapshot</EmptyTitle>
                <EmptyDescription>{resource.error}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { void dispatch({ type: "brain.load" }) }}>Retry</Button>
                  <Button size="sm" onClick={() => { void dispatch({ type: "app.patch", patch: { view: "settings" } }) }}>Open settings</Button>
                </div>
              </EmptyContent>
            </Empty>
          </div>
        </PageBody>
      </BrainShell>
    )
  }

  if (!snapshot) {
    return (
      <BrainShell>
        <PageBody>
          <div className="grid h-full place-items-center px-6">
            <Empty className="max-w-md">
              <EmptyHeader>
                <EmptyMedia variant="icon"><BrainIcon /></EmptyMedia>
                <EmptyTitle>Brain isn&rsquo;t connected</EmptyTitle>
                <EmptyDescription>
                  Point Brain at a vault snapshot file and it browses the people, threads, and follow-ups your agents keep. Any producer that writes the documented snapshot format works, and the vault stays on your machine.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" onClick={() => { void dispatch({ type: "app.patch", patch: { view: "settings" } }) }}>Set the snapshot path</Button>
              </EmptyContent>
            </Empty>
          </div>
        </PageBody>
      </BrainShell>
    )
  }

  if (selected) {
    return (
      <BrainShell badge={sampleBadge}>
        <PageBody><PersonPage entity={selected} index={index} onBack={() => setSelectedId(null)} /></PageBody>
      </BrainShell>
    )
  }

  return (
    <BrainShell badge={sampleBadge}>
      <PageBody>
        <div className="flex h-full min-h-0 flex-col">
          <HealthStrip snapshot={snapshot} />
          <Tabs defaultValue="people" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="h-auto shrink-0 justify-start rounded-none border-b border-border bg-transparent px-4 py-0">
              <TabsTrigger value="people" className="gap-1.5"><UsersIcon className="size-3.5" /> People</TabsTrigger>
              <TabsTrigger value="followups" className="gap-1.5"><ClockIcon className="size-3.5" /> Follow-ups</TabsTrigger>
              <TabsTrigger value="proposals" className="gap-1.5"><GitMergeIcon className="size-3.5" /> Proposals</TabsTrigger>
            </TabsList>
            <TabsContent value="people" className="min-h-0 flex-1">
              <ScrollArea className="h-full"><PeopleTable snapshot={snapshot} onSelect={setSelectedId} /></ScrollArea>
            </TabsContent>
            <TabsContent value="followups" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <SectionHeading>Owed a touch</SectionHeading>
                <FollowUps snapshot={snapshot} index={index} onSelect={setSelectedId} />
              </ScrollArea>
            </TabsContent>
            <TabsContent value="proposals" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <SectionHeading>Pending review</SectionHeading>
                <ProposalQueue proposals={snapshot.queues?.proposals || []} />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </PageBody>
    </BrainShell>
  )
}
