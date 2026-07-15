import { useState } from "react"
import "@humanctl/ui/styles/catalog.css"

import {
  AlertTriangleIcon,
  BellIcon,
  ChevronDownIcon,
  CircleEllipsisIcon,
  CommandIcon,
  FilterIcon,
  InboxIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react"

import { Composer } from "@humanctl/ui/blocks/composer"
import { ConversationMarker, ConversationMessage } from "@humanctl/ui/blocks/conversation"
import { DetailPane } from "@humanctl/ui/blocks/detail-pane"
import { FilterSearch, FilterToolbar } from "@humanctl/ui/blocks/filter-toolbar"
import { ListRow } from "@humanctl/ui/blocks/list-row"
import { QuotaRow } from "@humanctl/ui/blocks/quota"
import { StatusChip } from "@humanctl/ui/blocks/status"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@humanctl/ui/components/alert"
import { Badge } from "@humanctl/ui/components/badge"
import { Button } from "@humanctl/ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@humanctl/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@humanctl/ui/components/dialog"
import { IconButton } from "@humanctl/ui/components/icon-button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@humanctl/ui/components/empty"
import { Field, FieldDescription, FieldLabel } from "@humanctl/ui/components/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@humanctl/ui/components/input-group"
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@humanctl/ui/components/menu"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@humanctl/ui/components/message-scroller"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@humanctl/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@humanctl/ui/components/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@humanctl/ui/components/sheet"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { Spinner } from "@humanctl/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@humanctl/ui/components/tabs"
import { Toggle } from "@humanctl/ui/components/toggle"
import { ToggleGroup, ToggleGroupItem } from "@humanctl/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@humanctl/ui/components/tooltip"

function CatalogSection({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="grid grid-cols-[12rem_minmax(0,1fr)] gap-8 border-b border-border px-6 py-7 max-[760px]:grid-cols-1 max-[760px]:gap-4">
      <div>
        <h2 className="text-[14px] font-semibold text-ink">{label}</h2>
        <p className="mt-1 max-w-48 text-[13px] leading-5 text-ink-3">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function FoundationCatalog() {
  const [selectedHarness, setSelectedHarness] = useState("all")
  const [query, setQuery] = useState("")
  const [composerValue, setComposerValue] = useState("")
  const [commandOpen, setCommandOpen] = useState(false)
  const [sentCount, setSentCount] = useState(0)
  const [density, setDensity] = useState<string[]>(["compact"])
  const harnessItems = [
    { label: "All harnesses", value: "all" },
    { label: "Codex", value: "codex" },
    { label: "Claude Code", value: "claude" },
  ]

  return (
    <TooltipProvider>
      <div data-slot="foundation-catalog" className="min-h-dvh bg-background text-ink">
        <header className="flex min-h-16 items-end justify-between gap-6 border-b border-border px-6 py-4">
          <div>
            <div className="font-mono text-[11px] text-ink-3">UI foundation / executable catalog</div>
            <h1 className="mt-1 text-[20px] leading-6 font-semibold">Humanctl control surface</h1>
          </div>
          <span className="font-mono text-[11px] text-ink-3">Registry foundation / dense viewport</span>
        </header>

        <CatalogSection label="Controls" description="28 and 32 pixel actions. Primary color is reserved for the next action.">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Resume session</Button>
            <Button>Open artifact</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="destructive">Stop run</Button>
            <Tooltip>
              <TooltipTrigger render={<IconButton aria-label="Notifications" variant="ghost" />}>
                <BellIcon />
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>
            <Toggle aria-label="Show active only">
              <FilterIcon />
              Active only
            </Toggle>
          </div>
        </CatalogSection>

        <CatalogSection label="Inputs" description="Field owns labels and help text. InputGroup owns compound controls.">
          <div className="grid max-w-3xl grid-cols-3 gap-4 max-[900px]:grid-cols-1">
            <Field>
              <FieldLabel htmlFor="catalog-search">Search</FieldLabel>
              <InputGroup>
                <InputGroupAddon><SearchIcon /></InputGroupAddon>
                <InputGroupInput id="catalog-search" placeholder="Search sessions" />
              </InputGroup>
              <FieldDescription>Matches title, workspace, and task ID.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Harness</FieldLabel>
              <Select items={harnessItems} value={selectedHarness} onValueChange={(value) => setSelectedHarness(value ?? "all")}>
                <SelectTrigger aria-label="Harness">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {harnessItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Uses operator labels, not enum values.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Density</FieldLabel>
              <ToggleGroup value={density} onValueChange={setDensity} variant="outline" size="sm" spacing={0} aria-label="Catalog density">
                <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
                <ToggleGroupItem value="roomy">Roomy</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>One mutually exclusive selection.</FieldDescription>
            </Field>
          </div>
          <div className="mt-4 flex max-w-3xl flex-wrap items-center gap-2 border-t border-border pt-4">
            <Menu>
              <MenuTrigger render={<Button />}>
                Actions
                <ChevronDownIcon />
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Session</MenuLabel>
                <MenuGroup>
                  <MenuItem>Open workspace <MenuShortcut>↵</MenuShortcut></MenuItem>
                  <MenuItem>Copy task ID</MenuItem>
                </MenuGroup>
                <MenuSeparator />
                <MenuGroup><MenuItem>Archive</MenuItem></MenuGroup>
              </MenuContent>
            </Menu>
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" />}>Why this status?</PopoverTrigger>
              <PopoverContent>
                <PopoverHeader>
                  <PopoverTitle>Needs input</PopoverTitle>
                  <PopoverDescription>The worker asked a bounded question 18 minutes ago.</PopoverDescription>
                </PopoverHeader>
                Open the task to answer it.
              </PopoverContent>
            </Popover>
          </div>
        </CatalogSection>

        <CatalogSection label="Overlays" description="Only floating surfaces cast a shadow. Focus and dismissal come from Base UI.">
          <div className="flex flex-wrap items-center gap-2">
            <Dialog>
              <DialogTrigger render={<Button />}>Open dialog</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Stop this automation?</DialogTitle>
                  <DialogDescription>The current run can finish, but no new runs will start.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost">Cancel</Button>
                  <Button variant="destructive">Stop automation</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger render={<Button />}>
                <PanelRightIcon />
                Open panel
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Task detail</SheetTitle>
                  <SheetDescription>Viewport state shown without moving runtime ownership into the UI.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Button onClick={() => setCommandOpen(true)}>
              <CommandIcon />
              Command palette
            </Button>
            <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
              <Command>
                <CommandInput placeholder="Search actions" />
                <CommandList>
                  <CommandEmpty>No actions found.</CommandEmpty>
                  <CommandGroup heading="Navigation">
                    <CommandItem><SearchIcon />Open sessions<CommandShortcut>⌘1</CommandShortcut></CommandItem>
                    <CommandItem><CircleEllipsisIcon />Open automations<CommandShortcut>⌘2</CommandShortcut></CommandItem>
                    <CommandItem><SettingsIcon />Open settings<CommandShortcut>⌘,</CommandShortcut></CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </CommandDialog>
          </div>
        </CatalogSection>

        <CatalogSection label="Tabs and filters" description="Flat chrome. Rules change scope; gaps change topic.">
          <Tabs defaultValue="tasks" className="max-w-3xl">
            <TabsList>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="automations">Automations</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            </TabsList>
            <TabsContent value="tasks" className="pt-4">
              <FilterToolbar
                search={<FilterSearch aria-label="Filter tasks" placeholder="Filter tasks" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />}
                filters={<Button size="sm" variant="ghost"><FilterIcon />Running</Button>}
                resultCount={12}
                actions={<IconButton aria-label="More filter actions" size="sm" variant="ghost"><MoreHorizontalIcon /></IconButton>}
              />
            </TabsContent>
            <TabsContent value="automations" className="pt-4 text-ink-3">Automation filters use the same toolbar.</TabsContent>
            <TabsContent value="artifacts" className="pt-4 text-ink-3">Artifact filters use the same toolbar.</TabsContent>
          </Tabs>
        </CatalogSection>

        <CatalogSection label="Messaging" description="MessageScroller owns follow, prepend preservation, and the return-to-latest control.">
          <div className="h-[26rem] max-w-3xl border border-border">
            <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
              <MessageScroller>
                <MessageScrollerViewport aria-label="Registry conversation example">
                  <MessageScrollerContent className="gap-0">
                    <ConversationMessage messageId="catalog-agent-1" role="agent" label="Agent" timestamp="09:41">
                      <p>I checked the current branch and found one pending review.</p>
                    </ConversationMessage>
                    <ConversationMarker messageId="catalog-tools" timestamp="09:42">3 tool calls</ConversationMarker>
                    <ConversationMessage messageId="catalog-human-1" role="human" label="You" timestamp="09:43" tone="tinted">
                      <p>Address it, then rerun the browser proof.</p>
                    </ConversationMessage>
                    <ConversationMessage messageId="catalog-agent-2" role="agent" label="Agent" timestamp="09:45" receipt="Delivered to the task transcript">
                      <p>The review is resolved. Both theme screenshots pass.</p>
                    </ConversationMessage>
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
        </CatalogSection>

        <CatalogSection label="Resource states" description="Alert, Empty, Badge, and Spinner keep loading and failure anatomy consistent.">
          <div className="flex max-w-3xl flex-col gap-4">
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>Quota data is stale</AlertTitle>
              <AlertDescription>The last successful refresh was 18 minutes ago.</AlertDescription>
              <AlertAction><Button size="sm" variant="ghost">Retry</Button></AlertAction>
            </Alert>
            <div className="flex items-center gap-2 border-y border-border px-4 py-3 text-[12px] text-ink-3">
              <Spinner /> Refreshing fleet
              <Badge variant="secondary" className="ml-auto">Local</Badge>
              <Badge variant="destructive">1 blocked</Badge>
            </div>
            <div className="min-h-52 border-y border-border">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
                  <EmptyTitle>No tasks need you</EmptyTitle>
                  <EmptyDescription>Working and completed tasks remain available in Sessions.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><Button size="sm">Open sessions</Button></EmptyContent>
              </Empty>
            </div>
          </div>
        </CatalogSection>

        <CatalogSection label="Rows and states" description="One continuous ruled field. Status keeps a text label when color disappears.">
          <div className="max-w-3xl border-t border-border">
            <ListRow title="Release monitor" summary="Waiting for CI before continuing" metadata="AUTOMATION · 4m" status={<StatusChip state="running" />} trailing="72%" />
            <ListRow selected title="Desktop viewport reset" summary="Choose whether to preserve the current command contract" metadata="CODEX · NOW" status={<StatusChip state="needs-input" />} trailing="18m" />
            <ListRow title="Dependency audit" summary="Blocked by an unavailable registry" metadata="AUTOMATION · 31m" status={<StatusChip state="blocked" />} />
            <ListRow title="Quota reconciliation" summary="All accounts refreshed" metadata="AUTOMATION · 1h" status={<StatusChip state="complete" />} />
          </div>
        </CatalogSection>

        <CatalogSection label="Quota" description="Each account loads independently and keeps its final geometry while pending.">
          <div className="max-w-3xl border-t border-border">
            <QuotaRow label="Codex workspace" value={63} detail="3h window" reset="Resets in 42m" />
            <QuotaRow label="Claude workspace" value={28} detail="weekly" reset="Resets Friday" />
            <QuotaRow label="Secondary account" loading />
          </div>
        </CatalogSection>

        <CatalogSection label="Progressive loading" description="Skeletons match the final row instead of blocking the shell.">
          <div className="max-w-3xl border-t border-border">
            {[0, 1, 2].map((index) => (
              <div key={index} className="grid min-h-[var(--row-decision)] grid-cols-[minmax(0,1fr)_5rem] items-center gap-4 border-b border-border px-4">
                <div className="flex flex-col gap-2"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-72 max-w-full" /></div>
                <Skeleton className="ml-auto h-5 w-16" />
              </div>
            ))}
          </div>
        </CatalogSection>

        <CatalogSection label="Detail and composer" description="The block owns viewport geometry. Runtime state still arrives as props.">
          <div className="h-[30rem] max-w-3xl border border-border">
            <DetailPane
              title="Desktop viewport reset"
              eyebrow="Task 019f"
              meta="Updated just now"
              actions={<IconButton aria-label="Task options" variant="ghost" size="sm"><MoreHorizontalIcon /></IconButton>}
              footer={
                <Composer
                  value={composerValue}
                  onValueChange={setComposerValue}
                  onSubmit={() => { setSentCount((count) => count + 1); setComposerValue("") }}
                  hint={sentCount > 0 ? `${sentCount} local send${sentCount === 1 ? "" : "s"}` : undefined}
                />
              }
            >
              <div className="flex flex-col gap-4 text-[13px] leading-5 text-ink-2">
                <p>The shell rendered immediately. Sessions, quota, and activity filled independently.</p>
                <p>Only the runtime adapter reads the desktop bridge. This surface receives serializable state and emits intents.</p>
                <div className="border-y border-border py-3 font-mono text-[11px] text-ink-3">OFFLINE 18M · RERAMP REQUIRED</div>
                <p>The worker should re-read current files and process state before continuing.</p>
              </div>
            </DetailPane>
          </div>
        </CatalogSection>
      </div>
    </TooltipProvider>
  )
}

export { FoundationCatalog }
