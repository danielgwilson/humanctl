import { AlertTriangleIcon, InboxIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@humanctl/ui/components/alert"
import { Badge } from "@humanctl/ui/components/badge"
import { Button } from "@humanctl/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@humanctl/ui/components/empty"
import { Progress, ProgressLabel, ProgressTrack, ProgressValue } from "@humanctl/ui/components/progress"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { Spinner } from "@humanctl/ui/components/spinner"

import type { CatalogEntry } from "../registry"

export const feedbackEntries: CatalogEntry[] = [
  {
    id: "alert",
    name: "Alert",
    kind: "component",
    category: "Feedback",
    importPath: "components/alert",
    exports: ["Alert", "AlertTitle", "AlertDescription", "AlertAction"],
    blurb: "An in-flow notice for a resource that is stale, degraded, or failed, with an optional recovery action.",
    tags: ["notice", "resource-state"],
    states: [
      {
        name: "With action",
        description: "title, description, and a retry",
        render: () => (
          <Alert className="w-full max-w-md">
            <AlertTriangleIcon />
            <AlertTitle>Quota data is stale</AlertTitle>
            <AlertDescription>The last successful refresh was 18 minutes ago.</AlertDescription>
            <AlertAction>
              <Button size="sm" variant="ghost">
                Retry
              </Button>
            </AlertAction>
          </Alert>
        ),
      },
    ],
    accessibility: [
      "Concise text plus an explicit retry where retry is possible.",
      "In-flow, never a shadowed overlay: it does not steal focus.",
    ],
    usage: `<Alert>
  <AlertTriangleIcon />
  <AlertTitle>Quota data is stale</AlertTitle>
  <AlertDescription>Last refresh was 18 minutes ago.</AlertDescription>
  <AlertAction><Button size="sm" variant="ghost">Retry</Button></AlertAction>
</Alert>`,
  },
  {
    id: "badge",
    name: "Badge",
    kind: "component",
    category: "Feedback",
    importPath: "components/badge",
    exports: ["Badge"],
    blurb: "A small pill for a count or a secondary tag. StatusChip owns session state; Badge is for everything else.",
    tags: ["pill", "count"],
    states: [
      {
        name: "Variants",
        description: "default, secondary, destructive, outline",
        render: () => (
          <div className="flex flex-wrap items-center gap-2">
            <Badge>12 results</Badge>
            <Badge variant="secondary">Local</Badge>
            <Badge variant="destructive">1 blocked</Badge>
            <Badge variant="outline">Automation</Badge>
          </div>
        ),
      },
    ],
    props: [{ name: "variant", type: '"default" | "secondary" | "destructive" | "outline"', note: "Destructive is reserved for genuine problem counts." }],
    usage: `<Badge variant="secondary">Local</Badge>
<Badge variant="destructive">1 blocked</Badge>`,
  },
  {
    id: "spinner",
    name: "Spinner",
    kind: "component",
    category: "Feedback",
    importPath: "components/spinner",
    exports: ["Spinner"],
    blurb: "A small indeterminate activity mark for inline refreshes, never a full-screen blocker.",
    tags: ["loading", "inline"],
    states: [
      {
        name: "Inline",
        description: "beside a label",
        render: () => (
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner /> Refreshing fleet
          </div>
        ),
      },
    ],
    accessibility: ["Decorative on its own; pair it with visible text describing what is loading."],
    usage: `<Spinner /> Refreshing fleet`,
  },
  {
    id: "skeleton",
    name: "Skeleton",
    kind: "component",
    category: "Feedback",
    importPath: "components/skeleton",
    exports: ["Skeleton"],
    blurb: "A placeholder shaped like the final content, so a slow resource reserves its geometry instead of jumping.",
    tags: ["loading", "placeholder"],
    states: [
      {
        name: "Row skeleton",
        description: "matches a final list row",
        render: () => (
          <div className="grid w-full max-w-md grid-cols-[minmax(0,1fr)_4rem] items-center gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="ml-auto h-5 w-14" />
          </div>
        ),
      },
    ],
    accessibility: ["Hidden from assistive technology; it conveys layout, not content."],
    usage: `<Skeleton className="h-3.5 w-40" />`,
  },
  {
    id: "progress",
    name: "Progress",
    kind: "component",
    category: "Feedback",
    importPath: "components/progress",
    exports: ["Progress", "ProgressLabel", "ProgressTrack", "ProgressValue"],
    blurb: "A labeled determinate bar for a bounded quantity like quota used. QuotaRow composes it per account.",
    tags: ["determinate", "quota"],
    states: [
      {
        name: "Labeled",
        description: "label, track, and value",
        render: () => (
          <Progress value={63} className="w-full max-w-md">
            <ProgressLabel>Codex workspace</ProgressLabel>
            <ProgressValue className="ml-auto" />
            <ProgressTrack className="basis-full" />
          </Progress>
        ),
      },
    ],
    props: [{ name: "value", type: "number | null", note: "0-100. null renders the indeterminate track." }],
    accessibility: ["Exposes the value to assistive tech; the label names what is being measured."],
    usage: `<Progress value={63}>
  <ProgressLabel>Codex workspace</ProgressLabel>
  <ProgressValue className="ml-auto" />
  <ProgressTrack className="basis-full" />
</Progress>`,
  },
  {
    id: "empty",
    name: "Empty",
    kind: "component",
    category: "Feedback",
    importPath: "components/empty",
    exports: ["Empty", "EmptyHeader", "EmptyMedia", "EmptyTitle", "EmptyDescription", "EmptyContent"],
    blurb: "The ready-but-nothing state: a calm icon, a title, one line of context, and a way forward.",
    tags: ["empty-state"],
    states: [
      {
        name: "With action",
        description: "the standard empty anatomy",
        render: () => (
          <div className="w-full max-w-md">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <InboxIcon />
                </EmptyMedia>
                <EmptyTitle>No tasks need you</EmptyTitle>
                <EmptyDescription>Working and completed tasks remain available in Sessions.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm">Open sessions</Button>
              </EmptyContent>
            </Empty>
          </div>
        ),
      },
    ],
    accessibility: ["A ready empty value, not a spinner: it states the situation and offers the next step."],
    usage: `<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
    <EmptyTitle>No tasks need you</EmptyTitle>
    <EmptyDescription>Working tasks remain in Sessions.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent><Button size="sm">Open sessions</Button></EmptyContent>
</Empty>`,
  },
]
