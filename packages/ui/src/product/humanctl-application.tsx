import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ActivityIcon,
  BarChart3Icon,
  BrainIcon,
  CheckCheckIcon,
  InboxIcon,
  KeyboardIcon,
  LayoutListIcon,
  PanelLeftCloseIcon,
  PanelRightIcon,
  PinIcon,
  PlayIcon,
  RefreshCwIcon,
  ReplyIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunMoonIcon,
} from "lucide-react"

import { AppShell } from "@humanctl/ui/blocks/app-shell"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@humanctl/ui/components/dialog"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@humanctl/ui/components/command"
import { Button } from "@humanctl/ui/components/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@humanctl/ui/components/sheet"
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@humanctl/ui/components/sidebar"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@humanctl/ui/components/tooltip"
import { cn } from "@humanctl/ui/lib/cn"

import type {
  HumanctlApplicationProps,
  HumanctlSession,
  HumanctlTheme,
  HumanctlView,
} from "./contracts"
import { InboxView } from "./inbox-view"
import { formatTime, nextNeedsAttentionId, quotaReset, sessionRepo, sessionTitle, threadUnread } from "./helpers"
import { LazySessionDetail } from "./lazy-session-detail"
import { KeyboardKey } from "./shared"
import { focusComposer } from "./use-workloop-keys"

declare global {
  interface Window {
    __humanctlPerf?: {
      setView: (view: HumanctlView) => void
      refresh: () => void
      setTheme: (theme: "dark" | "light") => void
      openDetail: (id?: string) => void
      setChiefOfStaff: (open: boolean) => void
    }
  }
}

const NAVIGATION: Array<{ view: HumanctlView; label: string; icon: LucideIcon; key?: string }> = [
  { view: "inbox", label: "Inbox", icon: InboxIcon, key: "1" },
  { view: "metrics", label: "Metrics", icon: BarChart3Icon, key: "2" },
  { view: "fleet", label: "Fleet", icon: ActivityIcon, key: "3" },
  { view: "brain", label: "Brain", icon: BrainIcon, key: "4" },
  { view: "sessions", label: "Sessions", icon: LayoutListIcon, key: "5" },
  { view: "settings", label: "Settings", icon: SettingsIcon },
]

const MetricsView = lazy(async () => ({ default: (await import("./metrics-view")).MetricsView }))
const FleetView = lazy(async () => ({ default: (await import("./fleet-view")).FleetView }))
const BrainView = lazy(async () => ({ default: (await import("./brain-view")).BrainView }))
const SessionsView = lazy(async () => ({ default: (await import("./sessions-view")).SessionsView }))
const SettingsView = lazy(async () => ({ default: (await import("./settings-view")).SettingsView }))
const ChiefOfStaff = lazy(async () => ({ default: (await import("./chief-of-staff")).ChiefOfStaff }))

const VIEW_FOR_KEY: Record<string, HumanctlView> = { "1": "inbox", "2": "metrics", "3": "fleet", "4": "brain", "5": "sessions" }
const THEME_ORDER: HumanctlTheme[] = ["dark", "light", "system"]

function nextTheme(theme: HumanctlTheme): HumanctlTheme {
  return THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])
  return matches
}

function RouteFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col" role="status" aria-label="Loading view">
      <div className="flex h-[var(--row-decision)] shrink-0 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
      <div className="flex h-[var(--toolbar)] shrink-0 items-center gap-2 border-b border-border px-4">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="min-h-0 flex-1 px-4 py-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="mt-px h-14 w-full" />
        <Skeleton className="mt-px h-14 w-full" />
      </div>
    </div>
  )
}

function ProductNavigation({
  view,
  unread,
  needsYou,
  onNavigate,
}: {
  view: HumanctlView
  unread: number
  needsYou: number
  onNavigate: (view: HumanctlView) => void
}) {
  const { isMobile, setOpen, setOpenMobile } = useSidebar()

  const close = () => {
    if (isMobile) setOpenMobile(false)
    else setOpen(false)
  }

  return (
    <>
      <SidebarHeader className="h-[var(--chrome)] shrink-0 flex-row items-center gap-2 border-b border-sidebar-border pl-[var(--traffic-light-inset)] pr-2">
        <div className="grid size-5 place-items-center rounded-[5px] bg-primary text-xs font-semibold text-primary-foreground">H</div>
        <span className="text-sm font-semibold tracking-[-0.01em] text-sidebar-foreground">Humanctl</span>
        <Button aria-label="Close navigation" size="icon-sm" variant="ghost" className="ml-auto" onClick={close}><PanelLeftCloseIcon /></Button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="py-3">
          <SidebarGroupLabel>Control</SidebarGroupLabel>
          <SidebarMenu>
            {NAVIGATION.map((item) => {
              const Icon = item.icon
              const active = item.view === view
              const count = item.view === "inbox" ? unread : item.view === "fleet" ? needsYou : 0
              return (
                <SidebarMenuItem key={item.view}>
                  <SidebarMenuButton
                    isActive={active}
                    aria-current={active ? "page" : undefined}
                    className="relative data-active:text-sidebar-foreground data-active:before:absolute data-active:before:inset-y-1.5 data-active:before:left-0 data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-primary"
                    onClick={() => {
                      if (isMobile) setOpenMobile(false)
                      onNavigate(item.view)
                    }}
                  >
                    <Icon className={active ? "text-sidebar-foreground/80" : "text-sidebar-foreground/65"} />
                    <span>{item.label}</span>
                    {!count && item.key ? <kbd className="ml-auto rounded-[4px] border border-sidebar-border px-1 font-mono text-[10px] leading-4 font-normal text-sidebar-foreground/40">{item.key}</kbd> : null}
                  </SidebarMenuButton>
                  {count > 0 ? <SidebarMenuBadge className={item.view === "fleet" ? "text-need" : "text-sidebar-foreground/70"}>{count}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/60"><KeyboardIcon className="size-3.5" /><span>Command palette</span><KeyboardKey className="ml-auto">⌘K</KeyboardKey></div>
        <p className="m-0 text-xs leading-4 text-sidebar-foreground/45">Tasks stay in their source harness. Humanctl reads and directs them from one place.</p>
      </SidebarFooter>
    </>
  )
}

function ProductTopbar({
  view,
  version,
  rightRailOpen,
  onOpenPalette,
  onToggleRightRail,
  onRefresh,
}: {
  view: HumanctlView
  version: string
  rightRailOpen: boolean
  onOpenPalette: () => void
  onToggleRightRail: () => void
  onRefresh: () => void
}) {
  const { isMobile, open, openMobile } = useSidebar()
  const navigationOpen = isMobile ? openMobile : open
  const label = NAVIGATION.find((item) => item.view === view)?.label || "Humanctl"
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger aria-label={navigationOpen ? "Close navigation" : "Open navigation"} />} />
        <TooltipContent>{navigationOpen ? "Close navigation" : "Open navigation"} <span className="ml-1 opacity-70">⌘B</span></TooltipContent>
      </Tooltip>
      <span className="truncate text-sm font-semibold text-ink">{navigationOpen ? label : `Humanctl / ${label}`}</span>
      <span className="text-xs tabular-nums text-ink-3">v{version.replace(/^v/, "")}</span>
      <Button
        size="sm"
        variant="neutral"
        className="mx-auto w-full max-w-sm justify-start bg-sunken text-xs font-normal text-ink-3 max-[760px]:hidden"
        onClick={onOpenPalette}
      >
        <SearchIcon className="size-3.5" /><span className="flex-1">Search tasks and actions</span><KeyboardKey>⌘K</KeyboardKey>
      </Button>
      <Tooltip>
        <TooltipTrigger render={<Button aria-label="Refresh fleet" size="icon-sm" variant="ghost" onClick={onRefresh} />}><RefreshCwIcon /></TooltipTrigger>
        <TooltipContent>Refresh fleet</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button aria-label={rightRailOpen ? "Close chief of staff" : "Open chief of staff"} size="icon-sm" variant={rightRailOpen ? "neutral" : "ghost"} onClick={onToggleRightRail} />}><PanelRightIcon /></TooltipTrigger>
        <TooltipContent>Chief of staff <span className="ml-1 opacity-70">⌘⌥B</span></TooltipContent>
      </Tooltip>
    </div>
  )
}

function ProductStatusbar({
  model,
}: Pick<HumanctlApplicationProps, "model">) {
  const statusResource = model.resources.status
  const quotaResource = model.resources.quota
  const status = statusResource.data
  const coldStatusFailure = !status && statusResource.status === "error"
  const codex = status?.codexQuota?.primary
  const claude = quotaResource.data?.windows[0]
  const latestFailure = useMemo(
    () => Object.entries(model.operations).filter(([, value]) => value.status === "failed").sort((left, right) => right[1].updatedAt - left[1].updatedAt)[0],
    [model.operations],
  )
  return (
    <div className="flex w-full min-w-0 items-center gap-4 text-xs tabular-nums text-ink-3" aria-live="polite">
      <span className="flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", statusResource.error || coldStatusFailure ? "bg-need" : "bg-work")} />{statusResource.error || coldStatusFailure ? "Degraded" : "Local"}</span>
      {status ? <><span><strong className="font-medium text-need">{status.needsYou}</strong> need you</span><span><strong className="font-medium text-work">{status.working}</strong> working</span></> : coldStatusFailure ? <span className="text-block">Fleet status unavailable</span> : <><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-16" /></>}
      {codex ? <span className="max-[720px]:hidden">Codex <strong className="font-medium tabular-nums text-ink-2">{Math.round(codex.used_percent)}%</strong>{quotaReset(codex) ? ` · ${quotaReset(codex)}` : ""}</span> : null}
      {claude ? <span className="max-[980px]:hidden">Claude <strong className="font-medium tabular-nums text-ink-2">{Math.round(claude.used_percent)}%</strong>{quotaReset(claude, true) ? ` · ${quotaReset(claude, true)}` : ""}</span> : quotaResource.status === "loading" ? <Skeleton className="h-3 w-24 max-[980px]:hidden" /> : <span className="max-[980px]:hidden">Claude unavailable</span>}
      {latestFailure ? <span className="ml-auto max-w-72 truncate text-block">{latestFailure[0]}: {latestFailure[1].error}</span> : statusResource.error ? <span className="ml-auto max-w-72 truncate text-block" title={statusResource.error}>{statusResource.error}</span> : <span className="ml-auto">{status?.generatedAt ? `Updated ${formatTime(status.generatedAt)}` : "Starting"}</span>}
    </div>
  )
}

function ProductCommandPalette({
  open,
  onOpenChange,
  model,
  dispatch,
  onNavigate,
  onOpenSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: HumanctlApplicationProps["model"]
  dispatch: HumanctlApplicationProps["dispatch"]
  onNavigate: (view: HumanctlView) => void
  onOpenSession: (session: HumanctlSession) => void
}) {
  const { open: navigationOpen, toggleSidebar } = useSidebar()
  const state = model.resources.appState.data
  const sessions = useMemo(() => model.resources.sessions.data.slice().sort((left, right) => right.ageMs - left.ageMs).slice(0, 12), [model.resources.sessions.data])
  const selected = state.selectedId ? model.resources.sessions.data.find((session) => session.id === state.selectedId) : undefined
  const pinned = selected ? state.pins.includes(selected.id) : false
  const replyable = selected?.state === "need" || selected?.state === "block"
  const close = () => onOpenChange(false)
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder="Search views, tasks, and actions" aria-label="Command palette search" />
        <CommandList>
          <CommandEmpty>No matching views, tasks, or actions.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {NAVIGATION.map((item) => {
              const Icon = item.icon
              return <CommandItem key={item.view} value={`go ${item.label}`} onSelect={() => { onNavigate(item.view); close() }}><Icon /><span>{item.label}</span>{item.key ? <CommandShortcut>{item.key}</CommandShortcut> : null}</CommandItem>
            })}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Recent tasks">
            {sessions.map((session) => (
              <CommandItem key={session.id} value={`${sessionTitle(session)} ${sessionRepo(session)} ${session.id}`} onSelect={() => { onOpenSession(session); close() }}>
                <span className={cn("size-1.5 shrink-0 rounded-full", session.state === "need" ? "bg-need" : session.state === "block" ? "bg-block" : session.state === "work" ? "bg-work" : "bg-idle")} />
                <span className="min-w-0 flex-1 truncate">{sessionTitle(session)}</span>
                <span className="max-w-28 truncate font-mono text-xs text-ink-3">{sessionRepo(session)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          {selected ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Task actions">
                {replyable ? (
                  <CommandItem value={`answer reply ${sessionTitle(selected)}`} onSelect={() => { onOpenSession(selected); close(); requestAnimationFrame(() => requestAnimationFrame(focusComposer)) }}>
                    <ReplyIcon /><span>Answer</span>
                  </CommandItem>
                ) : null}
                <CommandItem value={`summarize ${sessionTitle(selected)}`} onSelect={() => { void dispatch({ type: "session.summarize", session: selected }); close() }}>
                  <SparklesIcon /><span>Summarize</span>
                </CommandItem>
                <CommandItem value={`resume ${sessionTitle(selected)}`} onSelect={() => { void dispatch({ type: "session.resume", session: selected }); close() }}>
                  <PlayIcon /><span>Resume</span>
                </CommandItem>
                <CommandItem value={`${pinned ? "unpin" : "pin"} ${sessionTitle(selected)}`} onSelect={() => { void dispatch({ type: "session.togglePin", id: selected.id }); close() }}>
                  <PinIcon /><span>{pinned ? "Unpin task" : "Pin task"}</span>
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem value="mark all read inbox" onSelect={() => { void dispatch({ type: "threads.markAllRead" }); close() }}>
              <CheckCheckIcon /><span>Mark all read</span>
            </CommandItem>
            <CommandItem value="cycle theme light dark system" onSelect={() => { void dispatch({ type: "app.patch", patch: { theme: nextTheme(state.theme) } }); close() }}>
              <SunMoonIcon /><span>Cycle theme</span><CommandShortcut>{state.theme}</CommandShortcut>
            </CommandItem>
            <CommandItem value="toggle navigation sidebar" onSelect={() => { toggleSidebar(); close() }}>
              <PanelLeftCloseIcon /><span>{navigationOpen ? "Close navigation" : "Open navigation"}</span><CommandShortcut>⌘B</CommandShortcut>
            </CommandItem>
            <CommandItem value="toggle chief of staff assistant" onSelect={() => { void dispatch({ type: "app.patch", patch: { rightRailOpen: !state.rightRailOpen } }); close() }}>
              <PanelRightIcon /><span>Toggle chief of staff</span><CommandShortcut>⌘⌥B</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

const WORKLOOP_SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["/"], label: "Search the current list" },
  { keys: ["j"], label: "Next task" },
  { keys: ["k"], label: "Previous task" },
  { keys: ["Enter"], label: "Answer the selected task" },
  { keys: ["⌘", "Enter"], label: "Send, then advance to the next that needs you" },
  { keys: ["r"], label: "Resume the selected task" },
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "B"], label: "Toggle navigation" },
  { keys: ["⌘", "⌥", "B"], label: "Toggle chief of staff" },
  { keys: ["?"], label: "This help" },
]

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rows = [
    ...NAVIGATION.filter((item) => item.key).map((item) => ({ keys: [item.key as string], label: item.label })),
    ...WORKLOOP_SHORTCUTS,
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Drive the fleet without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-6 border-b border-separator py-1.5 last:border-b-0">
              <span className="text-sm text-ink-2">{row.label}</span>
              <span className="flex shrink-0 items-center gap-1">{row.keys.map((key, index) => <KeyboardKey key={index}>{key}</KeyboardKey>)}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function HumanctlApplication({ model, dispatch, version }: HumanctlApplicationProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const state = model.resources.appState.data
  const compactAssistant = useMediaQuery("(max-width: 1040px)")
  const reservedShellWidth = (state.navPinned ? 275 : 0) + (state.rightRailOpen && !compactAssistant ? 360 : 0)
  const compactDetail = useMediaQuery(`(max-width: ${1040 + reservedShellWidth}px)`)
  const sessions = model.resources.sessions.data
  const selected = state.selectedId ? sessions.find((session) => session.id === state.selectedId) || null : null
  const lastReadTs = useMemo(() => state.lastReadTs || {}, [state.lastReadTs])
  const unread = useMemo(() => model.resources.inbox.data.filter((thread) => threadUnread(thread, lastReadTs)).length, [lastReadTs, model.resources.inbox.data])

  const navigate = useCallback((view: HumanctlView) => {
    setMobileNavigationOpen(false)
    void dispatch({ type: "app.patch", patch: { view, selectedId: undefined } })
  }, [dispatch])

  const openSession = useCallback((session: HumanctlSession) => {
    void dispatch({ type: "app.patch", patch: { selectedId: session.id } })
  }, [dispatch])

  const closeSession = useCallback(() => {
    void dispatch({ type: "app.patch", patch: { selectedId: undefined } })
  }, [dispatch])

  const skillsRequested = useRef(false)
  const budgetRequested = useRef(false)
  const brainRequestedPath = useRef<string | null | undefined>(null)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => root.classList.toggle("light", state.theme === "light" || (state.theme === "system" && !media.matches))
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [state.theme])

  useEffect(() => {
    if (state.view === "metrics" && model.resources.skills.status === "idle" && !skillsRequested.current) {
      skillsRequested.current = true
      void dispatch({ type: "metrics.loadSkills" })
    }
    if (state.view === "settings" && model.resources.budget.status === "idle" && !budgetRequested.current) {
      budgetRequested.current = true
      void dispatch({ type: "settings.loadBudget", dailyBudgetUSD: state.summaryBudgetUSD ?? 1 })
    }
    if (state.view === "brain" && (model.resources.brain.status === "idle" || brainRequestedPath.current !== state.brainSnapshotPath)) {
      brainRequestedPath.current = state.brainSnapshotPath
      void dispatch({ type: "brain.load" })
    }
  }, [dispatch, model.resources.brain.status, model.resources.budget.status, model.resources.skills.status, state.brainSnapshotPath, state.summaryBudgetUSD, state.view])

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === "KeyK") {
        event.preventDefault()
        setPaletteOpen((value) => !value)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey && !event.repeat && event.code === "KeyB") {
        event.preventDefault()
        void dispatch({ type: "app.patch", patch: { rightRailOpen: !state.rightRailOpen } })
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return
      if (event.key === "?") {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }
      const view = VIEW_FOR_KEY[event.key]
      if (view) {
        event.preventDefault()
        navigate(view)
      }
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [dispatch, navigate, state.rightRailOpen])

  useEffect(() => {
    window.__humanctlPerf = {
      setView: (view) => { void dispatch({ type: "app.patch", patch: { view, selectedId: undefined } }) },
      refresh: () => { void dispatch({ type: "fleet.refresh" }) },
      setTheme: (theme) => { void dispatch({ type: "app.patch", patch: { theme } }) },
      openDetail: (id) => {
        const session = sessions.find((item) => item.id === id) || sessions[0]
        if (session) openSession(session)
      },
      setChiefOfStaff: (open) => { void dispatch({ type: "app.patch", patch: { rightRailOpen: open } }) },
    }
    return () => { delete window.__humanctlPerf }
  }, [dispatch, openSession, sessions])

  const routeContent = state.view === "inbox"
    ? <InboxView model={model} dispatch={dispatch} />
    : state.view === "metrics"
      ? <MetricsView model={model} dispatch={dispatch} />
      : state.view === "fleet"
        ? <FleetView model={model} dispatch={dispatch} />
        : state.view === "brain"
          ? <BrainView model={model} dispatch={dispatch} />
          : state.view === "sessions"
            ? <SessionsView model={model} dispatch={dispatch} />
            : <SettingsView model={model} dispatch={dispatch} />
  const content = state.view === "inbox"
    ? routeContent
    : <Suspense fallback={<RouteFallback />}>{routeContent}</Suspense>
  const routeOwnsDetail = state.view === "inbox" || state.view === "sessions"
  const selectedThread = selected ? model.resources.inbox.data.find((thread) => thread.sessionId === selected.id) || null : null
  const externalDetail = selected && !routeOwnsDetail
  const visibleContent = externalDetail && compactDetail ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[var(--chrome)] shrink-0 items-center border-b border-border px-3">
        <Button size="sm" variant="ghost" onClick={closeSession}>Back to {NAVIGATION.find((item) => item.view === state.view)?.label || "view"}</Button>
      </div>
      <div className="min-h-0 flex-1"><LazySessionDetail key={selected.id} model={model} dispatch={dispatch} session={selected} thread={selectedThread} onAnswered={() => { void dispatch({ type: "app.patch", patch: { selectedId: nextNeedsAttentionId(sessions.map((session) => ({ id: session.id, state: session.state })), selected.id) } }) }} /></div>
    </div>
  ) : content
  const assistant = state.rightRailOpen && !compactAssistant ? (
    <Suspense fallback={<div className="h-full bg-sidebar" aria-label="Loading chief of staff" />}>
      <ChiefOfStaff model={model} dispatch={dispatch} />
    </Suspense>
  ) : undefined

  return (
    <TooltipProvider delay={350}>
      <AppShell
        navigation={
          <ProductNavigation
            view={state.view}
            unread={unread}
            needsYou={model.resources.status.data?.needsYou || 0}
            onNavigate={navigate}
          />
        }
        navigationOpen={state.navPinned}
        onNavigationOpenChange={(open) => { void dispatch({ type: "app.patch", patch: { navPinned: open } }) }}
        mobileNavigationOpen={mobileNavigationOpen}
        onMobileNavigationOpenChange={setMobileNavigationOpen}
        navigationBreakpoint={state.rightRailOpen && !compactAssistant ? 1224 : 864}
        detail={externalDetail && !compactDetail ? <LazySessionDetail key={selected.id} model={model} dispatch={dispatch} session={selected} thread={selectedThread} onClose={closeSession} onAnswered={() => { void dispatch({ type: "app.patch", patch: { selectedId: nextNeedsAttentionId(sessions.map((session) => ({ id: session.id, state: session.state })), selected.id) } }) }} /> : undefined}
        assistant={assistant}
        topbar={
          <ProductTopbar
            view={state.view}
            version={version}
            rightRailOpen={state.rightRailOpen}
            onOpenPalette={() => setPaletteOpen(true)}
            onToggleRightRail={() => { void dispatch({ type: "app.patch", patch: { rightRailOpen: !state.rightRailOpen } }) }}
            onRefresh={() => { void dispatch({ type: "fleet.refresh" }) }}
          />
        }
        statusbar={<ProductStatusbar model={model} />}
        overlays={
          <>
            <Sheet open={state.rightRailOpen && compactAssistant} onOpenChange={(open) => { void dispatch({ type: "app.patch", patch: { rightRailOpen: open } }) }}>
              <SheetContent
                side="right"
                showCloseButton={false}
                className="p-0"
                style={{ width: "min(var(--assistant-rail), 92vw)" }}
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>Chief of staff</SheetTitle>
                  <SheetDescription>Advisory answers grounded in the current local fleet snapshot.</SheetDescription>
                </SheetHeader>
                <Suspense fallback={<div className="h-full bg-sidebar" aria-label="Loading chief of staff" />}>
                  <ChiefOfStaff model={model} dispatch={dispatch} />
                </Suspense>
              </SheetContent>
            </Sheet>
            <ProductCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} model={model} dispatch={dispatch} onNavigate={navigate} onOpenSession={openSession} />
            <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          </>
        }
      >
        {visibleContent}
      </AppShell>
    </TooltipProvider>
  )
}
