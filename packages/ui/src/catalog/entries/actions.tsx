import { BellIcon, FilterIcon, PlusIcon } from "lucide-react"

import { Button } from "@humanctl/ui/components/button"
import { IconButton } from "@humanctl/ui/components/icon-button"
import { Toggle } from "@humanctl/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@humanctl/ui/components/toggle-group"

import type { CatalogEntry } from "../registry"

export const actionEntries: CatalogEntry[] = [
  {
    id: "button",
    name: "Button",
    kind: "component",
    category: "Actions",
    importPath: "components/button",
    exports: ["Button"],
    blurb:
      "The one text action primitive. Primary color is reserved for the single most likely next action on a surface.",
    tags: ["variant", "size"],
    states: [
      {
        name: "Variants",
        description: "primary, default, ghost, destructive",
        render: () => (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Resume session</Button>
            <Button>Open artifact</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="destructive">Stop run</Button>
          </div>
        ),
      },
      {
        name: "Sizes",
        description: "sm and default share the 4px grid",
        render: () => (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">
              <PlusIcon />
              Add watch
            </Button>
            <Button>
              <PlusIcon />
              Add watch
            </Button>
          </div>
        ),
      },
      {
        name: "Disabled",
        description: "non-interactive, keeps its footprint",
        render: () => (
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled>
              Resume session
            </Button>
            <Button disabled>Open artifact</Button>
          </div>
        ),
      },
    ],
    props: [
      { name: "variant", type: '"default" | "primary" | "ghost" | "destructive"', note: "Primary and destructive are the only filled variants; at most one primary per region." },
      { name: "size", type: '"default" | "sm"', note: "Default is 32px, sm is 28px. Both derive from the 4px grid." },
    ],
    accessibility: [
      "Renders a native button element with a visible focus ring.",
      "Icon-plus-text keeps a text label; icon-only actions use IconButton with an aria-label.",
    ],
    usage: `<Button variant="primary">Resume session</Button>
<Button variant="ghost">Dismiss</Button>`,
  },
  {
    id: "icon-button",
    name: "IconButton",
    kind: "component",
    category: "Actions",
    importPath: "components/icon-button",
    exports: ["IconButton"],
    blurb: "A square action for a single icon. Always carries an aria-label because it has no text.",
    tags: ["icon", "square"],
    states: [
      {
        name: "Variants",
        description: "default and ghost, 28 and 32px",
        render: () => (
          <div className="flex items-center gap-2">
            <IconButton aria-label="Notifications">
              <BellIcon />
            </IconButton>
            <IconButton aria-label="Notifications" variant="ghost">
              <BellIcon />
            </IconButton>
            <IconButton aria-label="Notifications" variant="ghost" size="sm">
              <BellIcon />
            </IconButton>
          </div>
        ),
      },
    ],
    props: [
      { name: "aria-label", type: "string", note: "Required. The accessible name, since there is no text child." },
      { name: "variant", type: '"default" | "ghost"', note: "Ghost is the quiet default for toolbars." },
      { name: "size", type: '"default" | "sm"', note: "32px or 28px square." },
    ],
    accessibility: [
      "aria-label is required and surfaced as the accessible name.",
      "The pointer target stays at least 28px in its smaller dimension.",
    ],
    usage: `<IconButton aria-label="Notifications" variant="ghost">
  <BellIcon />
</IconButton>`,
  },
  {
    id: "toggle",
    name: "Toggle",
    kind: "component",
    category: "Actions",
    importPath: "components/toggle",
    exports: ["Toggle"],
    blurb: "A single on/off control for a persistent filter or mode, distinct from a momentary button.",
    tags: ["pressed", "filter"],
    states: [
      {
        name: "Default and pressed",
        description: "aria-pressed carries the state",
        render: () => (
          <div className="flex items-center gap-2">
            <Toggle aria-label="Show active only">
              <FilterIcon />
              Active only
            </Toggle>
            <Toggle aria-label="Show active only" defaultPressed>
              <FilterIcon />
              Active only
            </Toggle>
          </div>
        ),
      },
    ],
    accessibility: [
      "Exposes aria-pressed so assistive tech announces the on/off state.",
      "Keeps a text label; the icon is decorative.",
    ],
    usage: `<Toggle aria-label="Show active only">
  <FilterIcon />
  Active only
</Toggle>`,
  },
  {
    id: "toggle-group",
    name: "ToggleGroup",
    kind: "component",
    category: "Actions",
    importPath: "components/toggle-group",
    exports: ["ToggleGroup", "ToggleGroupItem"],
    blurb: "A segmented set of mutually exclusive choices, for a small closed option list like density.",
    tags: ["segmented", "single-select"],
    states: [
      {
        name: "Single select",
        description: "one active member at a time",
        render: () => (
          <ToggleGroup defaultValue={["compact"]} variant="outline" size="sm" spacing={0} aria-label="Density">
            <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
            <ToggleGroupItem value="roomy">Roomy</ToggleGroupItem>
          </ToggleGroup>
        ),
      },
    ],
    props: [
      { name: "value", type: "string[]", note: "Controlled selection. Pair with onValueChange." },
      { name: "spacing", type: "number", note: "0 renders a joined segmented control." },
      { name: "variant", type: '"default" | "outline"', note: "Outline reads as a segmented control." },
    ],
    accessibility: [
      "Arrow keys move between members; the group has one tab stop.",
      "Each member keeps a text label.",
    ],
    usage: `<ToggleGroup value={density} onValueChange={setDensity} variant="outline" spacing={0}>
  <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
  <ToggleGroupItem value="roomy">Roomy</ToggleGroupItem>
</ToggleGroup>`,
  },
]
