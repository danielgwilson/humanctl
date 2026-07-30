import { FilterIcon, InboxIcon, LayersIcon, MoreHorizontalIcon, SettingsIcon } from "lucide-react"

import { FilterSearch, FilterToolbar } from "@humanctl/ui/blocks/filter-toolbar"
import { Button } from "@humanctl/ui/components/button"
import { IconButton } from "@humanctl/ui/components/icon-button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Separator } from "@humanctl/ui/components/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@humanctl/ui/components/sidebar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@humanctl/ui/components/tabs"

import type { CatalogEntry } from "../registry"

export const navigationEntries: CatalogEntry[] = [
  {
    id: "tabs",
    name: "Tabs",
    kind: "component",
    category: "Navigation",
    importPath: "components/tabs",
    exports: ["Tabs", "TabsList", "TabsTrigger", "TabsContent"],
    blurb: "Flat scope switching within one surface. Rules change scope; whitespace changes topic.",
    tags: ["scope", "flat"],
    states: [
      {
        name: "Three scopes",
        description: "one active tab at a time",
        render: () => (
          <Tabs defaultValue="tasks" className="w-full max-w-lg">
            <TabsList>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="automations">Automations</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            </TabsList>
            <TabsContent value="tasks" className="pt-4 text-[13px] text-ink-2">
              Ranked work that needs a human decision.
            </TabsContent>
            <TabsContent value="automations" className="pt-4 text-[13px] text-ink-3">
              Scheduled and recurring runs.
            </TabsContent>
            <TabsContent value="artifacts" className="pt-4 text-[13px] text-ink-3">
              Previews and evidence attached to sessions.
            </TabsContent>
          </Tabs>
        ),
      },
    ],
    accessibility: ["Arrow keys move between triggers; the active panel is associated with its tab."],
    usage: `<Tabs defaultValue="tasks">
  <TabsList>
    <TabsTrigger value="tasks">Tasks</TabsTrigger>
    <TabsTrigger value="automations">Automations</TabsTrigger>
  </TabsList>
  <TabsContent value="tasks">…</TabsContent>
</Tabs>`,
  },
  {
    id: "separator",
    name: "Separator",
    kind: "component",
    category: "Navigation",
    importPath: "components/separator",
    exports: ["Separator"],
    blurb: "A single hairline rule between groups. The primary structural device, since surfaces are flat and cardless.",
    tags: ["hairline", "divider"],
    states: [
      {
        name: "Horizontal and vertical",
        description: "orientation follows layout",
        render: () => (
          <div className="w-full max-w-md">
            <div className="text-[13px] text-ink-2">Session summary</div>
            <Separator className="my-3" />
            <div className="flex items-center gap-3 text-[13px] text-ink-2">
              <span>Codex</span>
              <Separator orientation="vertical" className="h-4" />
              <span>3h window</span>
              <Separator orientation="vertical" className="h-4" />
              <span className="tabular-nums">72%</span>
            </div>
          </div>
        ),
      },
    ],
    props: [{ name: "orientation", type: '"horizontal" | "vertical"', note: "Vertical needs an explicit height from the layout." }],
    usage: `<Separator />
<Separator orientation="vertical" className="h-4" />`,
  },
  {
    id: "scroll-area",
    name: "ScrollArea",
    kind: "component",
    category: "Navigation",
    importPath: "components/scroll-area",
    exports: ["ScrollArea", "ScrollBar"],
    blurb: "A bounded scroll region with a quiet custom scrollbar, for a pane that owns exactly one vertical scroll.",
    tags: ["scroll", "bounded"],
    states: [
      {
        name: "Bounded list",
        description: "one scroll owner",
        render: () => (
          <ScrollArea className="h-40 w-full max-w-sm rounded-[8px] border border-border">
            <div className="flex flex-col">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="border-b border-border px-3 py-2 text-[13px] text-ink-2 last:border-b-0">
                  Session {index + 1}
                </div>
              ))}
            </div>
          </ScrollArea>
        ),
      },
    ],
    accessibility: ["Keeps native keyboard scrolling; the custom bar is a visual layer over it."],
    usage: `<ScrollArea className="h-40">
  {/* bounded content, one scroll owner */}
</ScrollArea>`,
  },
  {
    id: "sidebar",
    name: "Sidebar",
    kind: "component",
    category: "Navigation",
    importPath: "components/sidebar",
    exports: ["SidebarProvider", "Sidebar", "SidebarHeader", "SidebarContent", "SidebarMenu", "SidebarMenuButton", "SidebarInset"],
    blurb: "The collapsible navigation rail primitive behind AppShell. Shown bounded here; in the app it owns full-height chrome.",
    tags: ["navigation", "rail"],
    states: [
      {
        name: "Bounded preview",
        description: "rail plus inset, clipped to the stage",
        render: () => (
          <div className="h-64 w-full max-w-xl overflow-hidden rounded-[10px] border border-border">
            <SidebarProvider className="min-h-full">
              <Sidebar collapsible="none" className="border-r border-border">
                <SidebarHeader className="px-3 py-2 font-mono text-[11px] text-ink-3">humanctl</SidebarHeader>
                <SidebarContent>
                  <SidebarGroup>
                    <SidebarGroupLabel>Fleet</SidebarGroupLabel>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>
                          <InboxIcon />
                          Inbox
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <LayersIcon />
                          Sessions
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>
                          <SettingsIcon />
                          Settings
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroup>
                </SidebarContent>
              </Sidebar>
              <SidebarInset className="p-4 text-[13px] text-ink-3">
                The inset holds the active view beside the rail.
              </SidebarInset>
            </SidebarProvider>
          </div>
        ),
      },
    ],
    accessibility: ["Collapsible with a keyboard-reachable trigger; the active item carries a current state."],
    usage: `<SidebarProvider>
  <Sidebar>
    <SidebarHeader>…</SidebarHeader>
    <SidebarContent>
      <SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton isActive>Inbox</SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu>
    </SidebarContent>
  </Sidebar>
  <SidebarInset>{/* active view */}</SidebarInset>
</SidebarProvider>`,
  },
  {
    id: "filter-toolbar",
    name: "FilterToolbar",
    kind: "block",
    category: "Navigation",
    importPath: "blocks/filter-toolbar",
    exports: ["FilterToolbar", "FilterSearch"],
    blurb: "The 40px filter band above a list: a search slot, filter chips, a result count, and an actions slot.",
    tags: ["filter", "toolbar"],
    states: [
      {
        name: "Search, filter, count",
        description: "the standard band anatomy",
        render: () => (
          <div className="w-full max-w-xl">
            <FilterToolbar
              search={<FilterSearch aria-label="Filter tasks" placeholder="Filter tasks" defaultValue="" />}
              filters={
                <Button size="sm" variant="ghost">
                  <FilterIcon />
                  Running
                </Button>
              }
              resultCount={12}
              actions={
                <IconButton aria-label="More filter actions" size="sm" variant="ghost">
                  <MoreHorizontalIcon />
                </IconButton>
              }
            />
          </div>
        ),
      },
    ],
    props: [
      { name: "search", type: "ReactNode", note: "Usually a FilterSearch; the toolbar owns its placement." },
      { name: "resultCount", type: "number", note: "Shown as a count beside the filters." },
      { name: "filters / actions", type: "ReactNode", note: "Chip controls and a trailing actions slot." },
    ],
    usage: `<FilterToolbar
  search={<FilterSearch placeholder="Filter tasks" value={q} onChange={onChange} />}
  filters={<Button size="sm" variant="ghost"><FilterIcon />Running</Button>}
  resultCount={12}
/>`,
  },
]
