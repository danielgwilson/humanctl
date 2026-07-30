import { ListRow } from "@humanctl/ui/blocks/list-row"
import { QuotaRow } from "@humanctl/ui/blocks/quota"
import { StatusChip } from "@humanctl/ui/blocks/status"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@humanctl/ui/components/table"

import type { CatalogEntry } from "../registry"

export const dataEntries: CatalogEntry[] = [
  {
    id: "table",
    name: "Table",
    kind: "component",
    category: "Data",
    importPath: "components/table",
    exports: ["Table", "TableHeader", "TableBody", "TableHead", "TableRow", "TableCell"],
    blurb: "A ruled data table for dense tabular reads. Rows use hairline rules, not cards or zebra fills.",
    tags: ["tabular", "data"],
    states: [
      {
        name: "Basic",
        description: "header and body rows",
        render: () => (
          <div className="w-full max-w-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Harness</TableHead>
                  <TableHead className="text-right">Context</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Release monitor</TableCell>
                  <TableCell>Codex</TableCell>
                  <TableCell className="text-right tabular-nums">72%</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Dependency audit</TableCell>
                  <TableCell>Claude Code</TableCell>
                  <TableCell className="text-right tabular-nums">44%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        ),
      },
    ],
    accessibility: ["Uses native table semantics so screen readers announce headers with cells."],
    usage: `<Table>
  <TableHeader>
    <TableRow><TableHead>Session</TableHead></TableRow>
  </TableHeader>
  <TableBody>
    <TableRow><TableCell>Release monitor</TableCell></TableRow>
  </TableBody>
</Table>`,
  },
  {
    id: "list-row",
    name: "ListRow",
    kind: "block",
    category: "Data",
    importPath: "blocks/list-row",
    exports: ["ListRow"],
    blurb: "One flat task row: title, summary, metadata, a status mark, and a trailing value, on a single ruled field.",
    tags: ["row", "list", "task"],
    states: [
      {
        name: "States in a field",
        description: "selected, needs-input, blocked, complete",
        render: () => (
          <div className="w-full max-w-xl border-t border-border">
            <ListRow
              title="Release monitor"
              summary="Waiting for CI before continuing"
              metadata="AUTOMATION · 4m"
              status={<StatusChip state="running" />}
              trailing="72%"
            />
            <ListRow
              selected
              title="Desktop viewport reset"
              summary="Choose whether to preserve the current command contract"
              metadata="CODEX · NOW"
              status={<StatusChip state="needs-input" />}
              trailing="18m"
            />
            <ListRow
              title="Dependency audit"
              summary="Blocked by an unavailable registry"
              metadata="AUTOMATION · 31m"
              status={<StatusChip state="blocked" />}
            />
            <ListRow
              title="Quota reconciliation"
              summary="All accounts refreshed"
              metadata="AUTOMATION · 1h"
              status={<StatusChip state="complete" />}
            />
          </div>
        ),
      },
    ],
    props: [
      { name: "title / summary / metadata", type: "ReactNode", note: "The three text tiers of a row." },
      { name: "status", type: "ReactNode", note: "Usually a StatusChip; keeps a text label, not just color." },
      { name: "selected", type: "boolean", note: "Marks the active row in a list-detail split." },
      { name: "trailing", type: "ReactNode", note: "Right-aligned value such as a percentage or age." },
    ],
    accessibility: ["Selection is a visual and semantic state; a chevron signals the row opens a detail."],
    usage: `<ListRow
  title="Release monitor"
  summary="Waiting for CI before continuing"
  metadata="AUTOMATION · 4m"
  status={<StatusChip state="running" />}
  trailing="72%"
/>`,
  },
  {
    id: "status",
    name: "StatusChip",
    kind: "block",
    category: "Data",
    importPath: "blocks/status",
    exports: ["StatusChip"],
    blurb: "The one owner of session state. Each state is a text label plus a semantic mark, so color is never the only signal.",
    tags: ["state", "semantic"],
    states: [
      {
        name: "All states",
        description: "running, needs-input, blocked, complete, idle",
        render: () => (
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip state="running" />
            <StatusChip state="needs-input" />
            <StatusChip state="blocked" />
            <StatusChip state="complete" />
            <StatusChip state="idle" />
          </div>
        ),
      },
    ],
    props: [{ name: "state", type: '"running" | "needs-input" | "blocked" | "complete" | "idle"', note: "Drives both the label text and the semantic mark." }],
    accessibility: ["The label text carries the meaning; the color is redundant, not required."],
    usage: `<StatusChip state="needs-input" />`,
  },
  {
    id: "quota",
    name: "QuotaRow",
    kind: "block",
    category: "Data",
    importPath: "blocks/quota",
    exports: ["QuotaRow"],
    blurb: "One account's quota as a labeled bar with a reset hint. It keeps its final geometry while the value loads.",
    tags: ["quota", "progress", "row"],
    states: [
      {
        name: "Loaded and loading",
        description: "each account resolves independently",
        render: () => (
          <div className="w-full max-w-xl border-t border-border">
            <QuotaRow label="Codex workspace" value={63} detail="3h window" reset="Resets in 42m" />
            <QuotaRow label="Claude workspace" value={28} detail="weekly" reset="Resets Friday" />
            <QuotaRow label="Secondary account" loading />
          </div>
        ),
      },
    ],
    props: [
      { name: "value", type: "number", note: "Percent used, 0-100." },
      { name: "detail / reset", type: "ReactNode", note: "Window label and reset hint." },
      { name: "loading", type: "boolean", note: "Holds the row's final geometry with a skeleton." },
    ],
    usage: `<QuotaRow label="Codex workspace" value={63} detail="3h window" reset="Resets in 42m" />
<QuotaRow label="Secondary account" loading />`,
  },
]
