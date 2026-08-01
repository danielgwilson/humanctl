import { useMemo, useState } from "react"
import {
  ArrowLeftIcon,
  BrainIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  GitMergeIcon,
  LinkIcon,
  MailIcon,
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
import { SectionHeading } from "./shared"
import { BRAIN_SAMPLE, cadenceState, type BrainPerson, type BrainProposal, type BrainTier } from "./brain-fixtures"

const TIER_DOT: Record<BrainTier, string> = {
  inner: "bg-primary",
  active: "bg-work",
  peripheral: "bg-idle",
  dormant: "bg-ink-3/50",
}

const TIER_LABEL: Record<BrainTier, string> = {
  inner: "Inner",
  active: "Active",
  peripheral: "Peripheral",
  dormant: "Dormant",
}

function agoLabel(days: number): string {
  if (days <= 0) return "today"
  if (days === 1) return "1d"
  if (days < 45) return `${days}d`
  if (days < 365) return `${Math.round(days / 7)}w`
  return `${Math.round(days / 30)}mo`
}

function TierMark({ tier }: { tier: BrainTier }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("size-1.5 shrink-0 rounded-full", TIER_DOT[tier])} aria-hidden="true" />
      <span className="text-ink-2">{TIER_LABEL[tier]}</span>
    </span>
  )
}

function CadenceState({ person }: { person: BrainPerson }) {
  const state = cadenceState(person)
  const tone = state === "overdue" ? "text-need" : state === "due" ? "text-idle" : "text-work"
  const dot = state === "overdue" ? "bg-need" : state === "due" ? "bg-idle" : "bg-work"
  const label = state === "overdue" ? "Overdue" : state === "due" ? "Due soon" : "On track"
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium", tone)}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden="true" />
      {label}
    </span>
  )
}

function HealthStrip({ people }: { people: ReadonlyArray<BrainPerson> }) {
  const vitals = BRAIN_SAMPLE.vitals
  const due = people.filter((person) => cadenceState(person) === "overdue").length
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    { label: "Entities", value: String(vitals.entities), hint: "people + orgs" },
    { label: "Canon pages", value: String(vitals.canonPages), hint: "promoted" },
    { label: "Follow-ups due", value: String(due), hint: "past cadence" },
    { label: "Proposals", value: String(BRAIN_SAMPLE.proposals.length), hint: "to review" },
    { label: "Last ingest", value: vitals.lastIngest, hint: vitals.ingestOk ? "clean" : "stale" },
  ]
  return (
    <div className="grid grid-cols-5 border-b border-border max-[900px]:grid-cols-3">
      {tiles.map((tile, index) => (
        <div key={tile.label} className={cn("px-4 py-3", index < tiles.length - 1 && "border-r border-border", index === 2 && "max-[900px]:border-r-0")}>
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

function PeopleTable({ people, onSelect }: { people: ReadonlyArray<BrainPerson>; onSelect: (id: string) => void }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="bg-sunken hover:bg-sunken">
          <TableHead className="h-9 w-[34%] px-4 text-xs text-ink-3">Person</TableHead>
          <TableHead className="h-9 w-24 px-2 text-xs text-ink-3">Tier</TableHead>
          <TableHead className="h-9 w-16 px-2 text-right text-xs text-ink-3">Priority</TableHead>
          <TableHead className="h-9 w-20 px-2 text-right text-xs text-ink-3">Last</TableHead>
          <TableHead className="h-9 w-28 px-4 text-xs text-ink-3">Cadence</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map((person) => (
          <TableRow
            key={person.id}
            className="h-[var(--row)] cursor-pointer hover:bg-[var(--overlay-hover)]"
            onClick={() => onSelect(person.id)}
          >
            <TableCell className="px-4 py-0">
              <div className="truncate text-sm font-medium text-ink">{person.name}</div>
              <div className="truncate text-xs text-ink-3">{person.role}</div>
            </TableCell>
            <TableCell className="px-2 py-0 text-sm"><TierMark tier={person.tier} /></TableCell>
            <TableCell className="px-2 py-0 text-right text-xs tabular-nums text-ink-2">{person.priority}</TableCell>
            <TableCell className="px-2 py-0 text-right text-xs tabular-nums text-ink-2">{agoLabel(person.lastContactDays)}</TableCell>
            <TableCell className="px-4 py-0"><CadenceState person={person} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function PersonPage({ person, onBack }: { person: BrainPerson; onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--row-decision)] shrink-0 items-center gap-2 border-b border-border px-3">
        <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeftIcon /> All people</Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-semibold text-ink">
              {person.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-xl font-semibold tracking-[-0.01em] text-ink">{person.name}</h1>
              <p className="m-0 mt-0.5 text-sm text-ink-2">{person.role}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline"><TierMark tier={person.tier} /></Badge>
                <Badge variant="secondary">{person.lifecycle}</Badge>
                <CadenceState person={person} />
                {person.reach.map((channel) => (
                  <span key={channel} className="inline-flex items-center gap-1 text-xs text-ink-3">
                    {channel === "email" ? <MailIcon className="size-3" /> : <LinkIcon className="size-3" />}{channel}
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-ink-3">Last contact</div>
              <div className="text-sm font-medium tabular-nums text-ink">{agoLabel(person.lastContactDays)} ago</div>
              <div className="mt-1 text-xs text-ink-3">every {person.cadenceDays}d</div>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-border bg-sunken px-4 py-3">
            <div className="text-xs font-medium text-ink-3">Where we left off</div>
            <p className="m-0 mt-1 text-sm leading-5 text-ink-2">{person.summary}</p>
          </div>

          {person.threads.map((thread) => (
            <section key={thread.heading} className="mt-4">
              <h2 className="m-0 text-sm font-semibold text-ink">{thread.heading}</h2>
              <p className="m-0 mt-1 text-sm leading-6 text-ink-2">{thread.body}</p>
            </section>
          ))}

          {person.relationships.length ? (
            <section className="mt-5">
              <h2 className="m-0 flex items-center gap-2 text-xs font-medium tracking-wide text-ink-3 uppercase"><UsersIcon className="size-3.5" /> Connected</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {person.relationships.map((relationship) => (
                  <span key={relationship.name} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-2">
                    <span className="font-medium text-ink">{relationship.name}</span>
                    <span className="text-ink-3">{relationship.kind}</span>
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {person.backlinks.length ? (
            <section className="mt-5">
              <h2 className="m-0 flex items-center gap-2 text-xs font-medium tracking-wide text-ink-3 uppercase"><FileTextIcon className="size-3.5" /> Evidence</h2>
              <div className="mt-2 space-y-2">
                {person.backlinks.map((backlink, index) => (
                  <div key={index} className="border-l-2 border-border pl-3">
                    <p className="m-0 text-sm leading-5 text-ink-2">&ldquo;{backlink.quote}&rdquo;</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      <span className="tabular-nums">{backlink.date}</span>
                      <span className="font-mono">{backlink.source}</span>
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

function FollowUps({ people, onSelect }: { people: ReadonlyArray<BrainPerson>; onSelect: (id: string) => void }) {
  const queue = useMemo(
    () =>
      people
        .filter((person) => cadenceState(person) !== "ok")
        .map((person) => ({ person, over: person.lastContactDays - person.cadenceDays }))
        .sort((left, right) => right.over * right.person.priority - left.over * left.person.priority),
    [people],
  )
  if (!queue.length) {
    return <div className="px-4 py-6 text-sm text-ink-3">Everyone is within cadence. Nothing is owed right now.</div>
  }
  return (
    <div className="divide-y divide-border">
      {queue.map(({ person, over }) => (
        <button
          key={person.id}
          type="button"
          onClick={() => onSelect(person.id)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--overlay-hover)]"
        >
          <ClockIcon className={cn("size-4 shrink-0", cadenceState(person) === "overdue" ? "text-need" : "text-idle")} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{person.name}</div>
            <div className="truncate text-xs text-ink-3">{person.nextTouch}</div>
          </div>
          <div className="shrink-0 text-right">
            <CadenceState person={person} />
            <div className="mt-0.5 text-xs tabular-nums text-ink-3">{over > 0 ? `${over}d over` : `due in ${-over}d`}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

type Decision = "promoted" | "deferred" | "rejected"

function ProposalQueue({ proposals }: { proposals: ReadonlyArray<BrainProposal> }) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  return (
    <div className="divide-y divide-border">
      {proposals.map((proposal) => {
        const decision = decisions[proposal.id]
        return (
          <div key={proposal.id} className={cn("px-4 py-3.5", decision && "opacity-60")}>
            <div className="flex items-start gap-3">
              <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{proposal.kind.replace("-", " ")}</Badge>
                  <span className="text-xs tabular-nums text-ink-3">{Math.round(proposal.confidence * 100)}% confidence</span>
                </div>
                <div className="mt-1.5 text-sm font-medium text-ink">{proposal.title}</div>
                <p className="m-0 mt-0.5 text-sm leading-5 text-ink-2">{proposal.rationale}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-3">
                  {proposal.evidence.map((source) => <span key={source} className="font-mono">{source}</span>)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {decision ? (
                  <span className={cn("text-xs font-medium capitalize", decision === "promoted" ? "text-work" : decision === "rejected" ? "text-need" : "text-ink-3")}>{decision}</span>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setDecisions((prev) => ({ ...prev, [proposal.id]: "deferred" }))}>Defer</Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Reject" onClick={() => setDecisions((prev) => ({ ...prev, [proposal.id]: "rejected" }))}><XIcon /></Button>
                    <Button size="sm" onClick={() => setDecisions((prev) => ({ ...prev, [proposal.id]: "promoted" }))}><CheckIcon /> Promote</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
      <p className="m-0 px-4 py-3 text-xs text-ink-3">Decisions are a preview here. In a connected vault they write to the grooming queue; the brain&rsquo;s promotion pass makes the canon edits.</p>
    </div>
  )
}

function NotConnected() {
  return (
    <PageBody>
      <div className="grid h-full place-items-center px-6">
        <Empty className="max-w-md">
          <EmptyHeader>
            <EmptyMedia variant="icon"><BrainIcon /></EmptyMedia>
            <EmptyTitle>Brain isn&rsquo;t connected</EmptyTitle>
            <EmptyDescription>
              Point Brain at a folder of agent-maintained markdown notes and it will browse the people, threads, and follow-ups your agents keep. The vault reader ships next; this view runs on sample data in the browser build.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Badge variant="outline">Vault reader, coming soon</Badge>
          </EmptyContent>
        </Empty>
      </div>
    </PageBody>
  )
}

export function BrainView({ model }: { model: HumanctlApplicationModel; dispatch: HumanctlDispatch }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const people = BRAIN_SAMPLE.people
  const selected = selectedId ? people.find((person) => person.id === selectedId) || null : null

  return (
    <PageFrame>
      <PageHeader>
        <PageHeading>
          <PageTitle>Brain</PageTitle>
          <PageDescription>The relationship vault your agents maintain: people, threads, and what&rsquo;s owed</PageDescription>
        </PageHeading>
        <PageActions>
          {model.mode === "fixture" ? <Badge variant="outline">Sample vault</Badge> : null}
        </PageActions>
      </PageHeader>

      {model.mode === "desktop" ? (
        <NotConnected />
      ) : selected ? (
        <PageBody>
          <PersonPage person={selected} onBack={() => setSelectedId(null)} />
        </PageBody>
      ) : (
        <PageBody>
          <div className="flex h-full min-h-0 flex-col">
            <HealthStrip people={people} />
            <Tabs defaultValue="people" className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="h-auto shrink-0 justify-start rounded-none border-b border-border bg-transparent px-4 py-0">
                <TabsTrigger value="people" className="gap-1.5"><UsersIcon className="size-3.5" /> People</TabsTrigger>
                <TabsTrigger value="followups" className="gap-1.5"><ClockIcon className="size-3.5" /> Follow-ups</TabsTrigger>
                <TabsTrigger value="proposals" className="gap-1.5"><GitMergeIcon className="size-3.5" /> Proposals</TabsTrigger>
              </TabsList>
              <TabsContent value="people" className="min-h-0 flex-1">
                <ScrollArea className="h-full"><PeopleTable people={people} onSelect={setSelectedId} /></ScrollArea>
              </TabsContent>
              <TabsContent value="followups" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <SectionHeading>Owed a touch</SectionHeading>
                  <FollowUps people={people} onSelect={setSelectedId} />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="proposals" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <SectionHeading>Pending review</SectionHeading>
                  <ProposalQueue proposals={BRAIN_SAMPLE.proposals} />
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        </PageBody>
      )}
    </PageFrame>
  )
}
