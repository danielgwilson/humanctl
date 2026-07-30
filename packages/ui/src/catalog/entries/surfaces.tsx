import {
  PageActions,
  PageBody,
  PageDescription,
  PageFrame,
  PageHeader,
  PageHeading,
  PageTitle,
} from "@humanctl/ui/blocks/page-frame"
import { Button } from "@humanctl/ui/components/button"

import type { CatalogEntry } from "../registry"
import { AppShellPreview, DetailPanePreview } from "./previews"

export const surfaceEntries: CatalogEntry[] = [
  {
    id: "app-shell",
    name: "AppShell",
    kind: "block",
    category: "Surfaces",
    importPath: "blocks/app-shell",
    exports: ["AppShell"],
    blurb:
      "The full desktop chrome: navigation rail, top bar, active view, optional detail and assistant rails, and a status band. Shown bounded here; in the app it owns 100dvh.",
    tags: ["shell", "viewport"],
    states: [
      {
        name: "Anatomy",
        description: "representative slots: rail, top bar, view, status band",
        render: () => <AppShellPreview />,
      },
    ],
    props: [
      { name: "navigation", type: "ReactNode", note: "The rail content, usually a Sidebar." },
      { name: "navigationOpen / onNavigationOpenChange", type: "boolean / (open) => void", note: "Controlled rail open state, persisted by the app." },
      { name: "topbar / statusbar", type: "ReactNode", note: "Fixed 48px top chrome and 32px bottom status band." },
      { name: "detail / assistant", type: "ReactNode", note: "Optional right-side detail and chief-of-staff rails." },
    ],
    accessibility: ["Below its breakpoints the rails become Sheets; rail state stays persisted and keyboard reachable."],
    usage: `<AppShell
  navigation={<Sidebar>…</Sidebar>}
  navigationOpen={open}
  onNavigationOpenChange={setOpen}
  topbar={<TopChrome />}
  statusbar={<FleetDigest />}
>
  {activeView}
</AppShell>`,
  },
  {
    id: "page-frame",
    name: "PageFrame",
    kind: "block",
    category: "Surfaces",
    importPath: "blocks/page-frame",
    exports: ["PageFrame", "PageHeader", "PageHeading", "PageTitle", "PageDescription", "PageActions", "PageBody"],
    blurb: "Flat page framing for a single view: a header with title, description, and actions, over a scrolling body. No cards.",
    tags: ["page", "layout"],
    states: [
      {
        name: "Header and body",
        description: "title, description, actions, content",
        render: () => (
          <div className="w-full max-w-xl overflow-hidden rounded-[10px] border border-border">
            <PageFrame>
              <PageHeader>
                <PageHeading>
                  <PageTitle>Metrics</PageTitle>
                  <PageDescription>Spend, tokens, and quota across the fleet.</PageDescription>
                </PageHeading>
                <PageActions>
                  <Button size="sm" variant="ghost">
                    Export
                  </Button>
                </PageActions>
              </PageHeader>
              <PageBody className="p-4 text-[13px] text-ink-2">The view content scrolls within the frame.</PageBody>
            </PageFrame>
          </div>
        ),
      },
    ],
    props: [
      { name: "PageHeading", type: "ReactNode", note: "Wraps PageTitle and PageDescription." },
      { name: "PageActions", type: "ReactNode", note: "Right-aligned header actions; at most one primary." },
      { name: "PageBody", type: "ReactNode", note: "The single scrolling region of the view." },
    ],
    usage: `<PageFrame>
  <PageHeader>
    <PageHeading>
      <PageTitle>Metrics</PageTitle>
      <PageDescription>Spend, tokens, and quota.</PageDescription>
    </PageHeading>
    <PageActions>{/* actions */}</PageActions>
  </PageHeader>
  <PageBody>{/* content */}</PageBody>
</PageFrame>`,
  },
  {
    id: "detail-pane",
    name: "DetailPane",
    kind: "block",
    category: "Surfaces",
    importPath: "blocks/detail-pane",
    exports: ["DetailPane"],
    blurb: "The scrollable detail surface: an eyebrow, title, meta, and actions header over content, with a sticky footer for a Composer.",
    tags: ["detail", "scroll"],
    states: [
      {
        name: "With composer footer",
        description: "header, scrolling body, pinned composer",
        render: () => <DetailPanePreview />,
      },
    ],
    props: [
      { name: "title / eyebrow / meta", type: "ReactNode", note: "The header's three text tiers." },
      { name: "actions", type: "ReactNode", note: "Trailing header controls." },
      { name: "footer", type: "ReactNode", note: "Sticky footer slot, usually a Composer." },
    ],
    accessibility: ["Owns exactly one vertical scroll; the footer stays pinned while the body scrolls."],
    usage: `<DetailPane
  title="Desktop viewport reset"
  eyebrow="Task 019f"
  meta="Updated just now"
  actions={<IconButton aria-label="Task options" variant="ghost" size="sm"><MoreHorizontalIcon /></IconButton>}
  footer={<Composer value={value} onValueChange={setValue} onSubmit={send} />}
>
  {/* detail content */}
</DetailPane>`,
  },
]
