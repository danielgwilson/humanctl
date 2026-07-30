import { GitBranchIcon } from "lucide-react"

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@humanctl/ui/components/item"
import { Marker, MarkerContent, MarkerIcon } from "@humanctl/ui/components/marker"
import { Badge } from "@humanctl/ui/components/badge"

import type { CatalogEntry } from "../registry"

export const disclosureEntries: CatalogEntry[] = [
  {
    id: "item",
    name: "Item",
    kind: "component",
    category: "Disclosure",
    importPath: "components/item",
    exports: ["Item", "ItemMedia", "ItemContent", "ItemTitle", "ItemDescription", "ItemActions"],
    blurb: "The row scaffold behind ListRow: media, a title-plus-description content column, and a trailing actions slot.",
    tags: ["row", "scaffold"],
    states: [
      {
        name: "Media, content, actions",
        description: "the three-slot row",
        render: () => (
          <div className="w-full max-w-lg border-y border-border">
            <Item>
              <ItemMedia variant="icon">
                <GitBranchIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Release monitor</ItemTitle>
                <ItemDescription>Waiting for CI before continuing</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">72%</Badge>
              </ItemActions>
            </Item>
          </div>
        ),
      },
    ],
    props: [
      { name: "variant", type: '"default" | "muted"', note: "Muted lowers emphasis for a secondary row." },
      { name: "size", type: '"default" | "sm"', note: "Row density on the shared 4px grid." },
    ],
    accessibility: ["A structural primitive; give the media aria-hidden and keep the title as real text."],
    usage: `<Item>
  <ItemMedia variant="icon"><GitBranchIcon /></ItemMedia>
  <ItemContent>
    <ItemTitle>Release monitor</ItemTitle>
    <ItemDescription>Waiting for CI</ItemDescription>
  </ItemContent>
  <ItemActions><Badge variant="secondary">72%</Badge></ItemActions>
</Item>`,
  },
  {
    id: "marker",
    name: "Marker",
    kind: "component",
    category: "Disclosure",
    importPath: "components/marker",
    exports: ["Marker", "MarkerIcon", "MarkerContent"],
    blurb: "A compact inline event marker for a transcript: a small icon and label, optionally set off by rules.",
    tags: ["inline", "event"],
    states: [
      {
        name: "Variants",
        description: "default, separator, border",
        render: () => (
          <div className="flex w-full max-w-md flex-col gap-3">
            <Marker>
              <MarkerIcon>
                <GitBranchIcon />
              </MarkerIcon>
              <MarkerContent>Branch checked out</MarkerContent>
            </Marker>
            <Marker variant="separator">
              <MarkerContent>3 tool calls</MarkerContent>
            </Marker>
          </div>
        ),
      },
    ],
    props: [{ name: "variant", type: '"default" | "separator" | "border"', note: "Separator flanks the label with hairlines; border underlines it." }],
    usage: `<Marker variant="separator">
  <MarkerContent>3 tool calls</MarkerContent>
</Marker>`,
  },
]
