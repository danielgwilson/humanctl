import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ActivityIcon,
  BarChart3Icon,
  CheckCheckIcon,
  InboxIcon,
  KeyboardIcon,
  LayoutListIcon,
  LoaderCircleIcon,
  MenuIcon,
  MessageCircleQuestionIcon,
  PanelLeftCloseIcon,
  PanelRightIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SunMoonIcon,
} from "lucide-react"

import { AppShell } from "@humanctl/ui/blocks/app-shell"
import { Composer } from "@humanctl/ui/blocks/composer"
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
import { IconButton } from "@humanctl/ui/components/icon-button"
import { ScrollArea } from "@humanctl/ui/components/scroll-area"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@humanctl/ui/components/sheet"
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
import { formatTime, operationPending, quotaReset, sessionRepo, sessionTitle, threadUnread } from "./helpers"
import { SessionDetail } from "./session-detail"
import { KeyboardKey } from "./shared"

declare global {
  interface Window {
    __humanctlPerf?: {
      setView: (view: HumanctlView) => void
      refresh: () => void
      setTheme: (theme: "dark" | "light") => void
      openDetail: (id?: string) => void
      setKitchenSink: (open: boolean) => void
    }
  }
}

const NAVIGATION: Array<{ view: HumanctlView; label: string; icon: LucideIcon; key?: string }> = [
  { view: "inbox", label: "Inbox", icon: InboxIcon, key: "1" },
  { view: "metrics", label: "Metrics", icon: BarChart3Icon, key: "2" },
  { view: "fleet", label: "Fleet", icon: ActivityIcon, key: "3" },
  { view: "sessions", label: "Sessions", icon: LayoutListIcon, key: "4" },
  { view: "settings", label: "Settings", icon: SettingsIcon },
]

const FoundationCatalog = lazy(async () => {
  const catalog = await import("@humanctl/ui/catalog")
  return { default: catalog.FoundationCatalog }
})

const MetricsView = lazy(async () => ({ default: (await import("./metrics-view")).MetricsView }))
const FleetView = lazy(async () => ({ default: (await import("./fleet-view")).FleetView }))
const SessionsView = lazy(async () => ({ default: (await import("./sessions-view")).SessionsView }))
const SettingsView = lazy(async () => ({ default: (await import("./settings-view")).SettingsView }))

const VIEW_FOR_KEY: Record<string, HumanctlView> = { "1": "inbox", "2": "metrics", "3": "fleet", "4": "sessions" }
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
  onClose,
  overlay = false,
}: {
  view: HumanctlView
  unread: number
  needsYou: number
  onNavigate: (view: HumanctlView) => void
  onClose: () => void
  overlay?: boolean
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", overlay ? "h-full" : "-mt-[var(--chrome)] h-[calc(100%+var(--chrome))]")}>
      <div className="flex h-[var(--chrome)] shrink-0 items-center gap-2 border-b border-border pl-[var(--traffic-light-inset)] pr-2">
        <div className="grid size-5 place-items-center rounded-[5px] bg-primary text-[10px] font-semibold text-primary-foreground">H</div>
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Humanctl</span>
        <IconButton aria-label="Close navigation" size="sm" variant="ghost" className="ml-auto" onClick={onClose}><PanelLeftCloseIcon /></IconButton>
      </div>
      <div className="px-2 py-3">
        <div className="px-2 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-ink-4">Control</div>
        {NAVIGATION.map((item) => {
          const Icon = item.icon
          const active = item.view === view
          const count = item.view === "inbox" ? unread : item.view === "fleet" ? needsYou : 0
          return (
            <button
              key={item.view}
              type="button"
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-[var(--radius-2)] px-2 text-left text-[13px] outline-none transition-colors duration-[var(--duration-color)] hover:bg-[var(--overlay-hover)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                active ? "bg-[var(--overlay-selected)] text-ink" : "text-ink-2",
              )}
              onClick={() => onNavigate(item.view)}
            >
              <Icon className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-ink-3")} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {count > 0 ? <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] leading-4 tabular-nums text-primary-foreground">{count}</span> : null}
              {item.key ? <span className="font-mono text-[10px] text-ink-4">{item.key}</span> : null}
            </button>
          )
        })}
      </div>
      <div className="mt-auto border-t border-border px-3 py-3">
        <div className="flex items-center gap-2 text-[11px] text-ink-3"><KeyboardIcon className="size-3.5" /><span>Command palette</span><KeyboardKey className="ml-auto">⌘K</KeyboardKey></div>
        <div className="mt-2 text-[11px] leading-4 text-ink-4">Tasks stay in their source harness. Humanctl reads and directs them from one place.</div>
      </div>
    </div>
  )
}

function ProductTopbar({
  view,
  version,
  navigationOpen,
  rightRailOpen,
  onToggleNavigation,
  onOpenPalette,
  onToggleRightRail,
  onRefresh,
}: {
  view: HumanctlView
  version: string
  navigationOpen: boolean
  rightRailOpen: boolean
  onToggleNavigation: () => void
  onOpenPalette: () => void
  onToggleRightRail: () => void
  onRefresh: () => void
}) {
  const label = NAVIGATION.find((item) => item.view === view)?.label || "Humanctl"
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Tooltip>
        <TooltipTrigger render={<IconButton aria-label={navigationOpen ? "Close navigation" : "Open navigation"} size="sm" variant="ghost" onClick={onToggleNavigation} />}>
          {navigationOpen ? <PanelLeftCloseIcon /> : <MenuIcon />}
        </TooltipTrigger>
        <TooltipContent>{navigationOpen ? "Close navigation" : "Open navigation"} <span className="ml-1 opacity-70">⌘\</span></TooltipContent>
      </Tooltip>
      <span className="truncate text-[13px] font-semibold text-ink">{navigationOpen ? label : `Humanctl / ${label}`}</span>
      <span className="font-mono text-[10px] text-ink-4">v{version.replace(/^v/, "")}</span>
      <button
        type="button"
        className="mx-auto flex h-[var(--control-sm)] w-full max-w-sm items-center gap-2 rounded-[var(--radius-2)] bg-sunken px-2.5 text-left text-[12px] text-ink-3 shadow-[var(--elev-ring)] outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-[760px]:hidden"
        onClick={onOpenPalette}
      >
        <SearchIcon className="size-3.5" /><span className="flex-1">Search tasks and actions</span><KeyboardKey>⌘K</KeyboardKey>
      </button>
      <Tooltip>
        <TooltipTrigger render={<IconButton aria-label="Refresh fleet" size="sm" variant="ghost" onClick={onRefresh} />}><RefreshCwIcon /></TooltipTrigger>
        <TooltipContent>Refresh fleet</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<IconButton aria-label="Open chief of staff" size="sm" variant={rightRailOpen ? "neutral" : "ghost"} onClick={onToggleRightRail} />}><PanelRightIcon /></TooltipTrigger>
        <TooltipContent>Chief of staff <span className="ml-1 opacity-70">A</span></TooltipContent>
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
    <div className="flex w-full min-w-0 items-center gap-4 font-mono text-[10px] text-ink-3" aria-live="polite">
      <span className="flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", statusResource.error || coldStatusFailure ? "bg-need" : "bg-work")} />{statusResource.error || coldStatusFailure ? "Degraded" : "Local"}</span>
      {status ? <><span><strong className="font-medium text-need">{status.needsYou}</strong> need you</span><span><strong className="font-medium text-work">{status.working}</strong> working</span></> : coldStatusFailure ? <span className="text-block">Fleet status unavailable</span> : <><Skeleton className="h-3 w-16" /><Skeleton className="h-3 w-16" /></>}
      {codex ? <span className="max-[720px]:hidden">Codex <strong className="font-medium tabular-nums text-ink-2">{Math.round(codex.used_percent)}%</strong>{quotaReset(codex) ? ` · ${quotaReset(codex)}` : ""}</span> : null}
      {claude ? <span className="max-[980px]:hidden">Claude <strong className="font-medium tabular-nums text-ink-2">{Math.round(claude.used_percent)}%</strong>{quotaReset(claude, true) ? ` · ${quotaReset(claude, true)}` : ""}</span> : quotaResource.status === "loading" ? <Skeleton className="h-3 w-24 max-[980px]:hidden" /> : <span className="max-[980px]:hidden">Claude unavailable</span>}
      {latestFailure ? <span className="ml-auto max-w-72 truncate text-block">{latestFailure[0]}: {latestFailure[1].error}</span> : statusResource.error ? <span className="ml-auto max-w-72 truncate text-block" title={statusResource.error}>{statusResource.error}</span> : <span className="ml-auto">{status?.generatedAt ? `Updated ${formatTime(status.generatedAt)}` : "Starting"}</span>}
    </div>
  )
}

function ChiefOfStaff({ model, dispatch }: Pick<HumanctlApplicationProps, "model" | "dispatch">) {
  const appState = model.resources.appState.data
  const history = model.resources.atlas.data
  const [question, setQuestion] = useState("")
  const [askFailure, setAskFailure] = useState<string | null>(null)
  const asking = operationPending(model.operations, "atlas.ask")
  const operationError = model.operations["atlas.ask"]?.error

  async function ask() {
    const value = question.trim()
    if (!value || asking) return
    setAskFailure(null)
    const outcome = await dispatch({ type: "atlas.ask", question: value, engine: appState.summarizer })
    if (!outcome.ok) {
      setAskFailure(outcome.error)
      return
    }
    setQuestion("")
  }

  return (
    <Sheet open={appState.rightRailOpen} onOpenChange={(open) => { void dispatch({ type: "app.patch", patch: { rightRailOpen: open } }) }}>
      <SheetContent className="w-[min(26rem,92vw)]" side="right">
        <SheetHeader>
          <SheetTitle>Chief of staff</SheetTitle>
          <SheetDescription>Ask about current fleet state, blockers, and what needs your attention.</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3 p-0">
          <ScrollArea className="min-h-0 flex-1">
            {history.length === 0 && !asking ? (
              <div className="px-4 py-6 text-[13px] leading-5 text-ink-3">Try “what needs me right now?” or “which task is most likely to be stale?” Answers are advisory and grounded in the current local fleet snapshot.</div>
            ) : null}
            {history.map((exchange) => (
              <div key={exchange.id} className="border-b border-border px-4 py-3">
                <div className="flex items-start gap-2"><MessageCircleQuestionIcon className="mt-0.5 size-3.5 shrink-0 text-ink-4" /><p className="text-[13px] leading-5 text-ink-2">{exchange.question}</p></div>
                <div className="mt-2 border-l-2 border-primary pl-3 text-[13px] leading-5 whitespace-pre-wrap text-ink">{exchange.answer}</div>
                <div className="mt-1.5 font-mono text-[10px] text-ink-4">{exchange.engine || "local harness"} · {formatTime(exchange.at)}</div>
              </div>
            ))}
            {asking ? <div className="flex items-center gap-2 px-4 py-4 text-[12px] text-ink-3"><LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />Reading the fleet...</div> : null}
          </ScrollArea>
          <div className="shrink-0 border-t border-border p-3">
            <Composer value={question} onValueChange={setQuestion} onSubmit={() => { void ask() }} placeholder="Ask your chief of staff" submitLabel="Ask" submitting={asking} disabled={asking} />
            {askFailure || operationError ? <p className="mt-2 text-[12px] leading-5 text-block">{askFailure || operationError}</p> : null}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

function ProductCommandPalette({
  open,
  onOpenChange,
  model,
  dispatch,
  onNavigate,
  onOpenSession,
  onToggleNavigation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: HumanctlApplicationProps["model"]
  dispatch: HumanctlApplicationProps["dispatch"]
  onNavigate: (view: HumanctlView) => void
  onOpenSession: (session: HumanctlSession) => void
  onToggleNavigation: () => void
}) {
  const state = model.resources.appState.data
  const sessions = useMemo(() => model.resources.sessions.data.slice().sort((left, right) => right.ageMs - left.ageMs).slice(0, 12), [model.resources.sessions.data])
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
                <span className="max-w-28 truncate font-mono text-[10px] text-ink-4">{sessionRepo(session)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem value="mark all read inbox" onSelect={() => { void dispatch({ type: "threads.markAllRead" }); close() }}>
              <CheckCheckIcon /><span>Mark all read</span>
            </CommandItem>
            <CommandItem value="cycle theme light dark system" onSelect={() => { void dispatch({ type: "app.patch", patch: { theme: nextTheme(state.theme) } }); close() }}>
              <SunMoonIcon /><span>Cycle theme</span><CommandShortcut>{state.theme}</CommandShortcut>
            </CommandItem>
            <CommandItem value="toggle navigation sidebar" onSelect={() => { onToggleNavigation(); close() }}>
              {state.navPinned ? <PanelLeftCloseIcon /> : <MenuIcon />}<span>Toggle navigation</span><CommandShortcut>⌘\</CommandShortcut>
            </CommandItem>
            <CommandItem value="toggle chief of staff assistant" onSelect={() => { void dispatch({ type: "app.patch", patch: { rightRailOpen: !state.rightRailOpen } }); close() }}>
              <PanelRightIcon /><span>Toggle chief of staff</span><CommandShortcut>A</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

export function HumanctlApplication({ model, dispatch, version }: HumanctlApplicationProps) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [kitchenSink, setKitchenSink] = useState(false)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const compactNavigation = useMediaQuery("(max-width: 960px)")
  const compactDetail = useMediaQuery("(max-width: 1040px)")
  const state = model.resources.appState.data
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

  const toggleNavigation = useCallback(() => {
    if (compactNavigation) {
      setMobileNavigationOpen((open) => !open)
      return
    }
    void dispatch({ type: "app.patch", patch: { navPinned: !state.navPinned } })
  }, [compactNavigation, dispatch, state.navPinned])

  const skillsRequested = useRef(false)
  const budgetRequested = useRef(false)

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
  }, [dispatch, model.resources.budget.status, model.resources.skills.status, state.summaryBudgetUSD, state.view])

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((value) => !value)
        return
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "\\") {
        event.preventDefault()
        toggleNavigation()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return
      const view = VIEW_FOR_KEY[event.key]
      if (view) {
        event.preventDefault()
        navigate(view)
      } else if (event.key.toLowerCase() === "a") {
        event.preventDefault()
        void dispatch({ type: "app.patch", patch: { rightRailOpen: !state.rightRailOpen } })
      }
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [dispatch, navigate, state.rightRailOpen, toggleNavigation])

  useEffect(() => {
    window.__humanctlPerf = {
      setView: (view) => { setKitchenSink(false); void dispatch({ type: "app.patch", patch: { view, selectedId: undefined } }) },
      refresh: () => { void dispatch({ type: "fleet.refresh" }) },
      setTheme: (theme) => { void dispatch({ type: "app.patch", patch: { theme } }) },
      openDetail: (id) => {
        setKitchenSink(false)
        const session = sessions.find((item) => item.id === id) || sessions[0]
        if (session) openSession(session)
      },
      setKitchenSink,
    }
    return () => { delete window.__humanctlPerf }
  }, [dispatch, openSession, sessions])

  if (kitchenSink) {
    return (
      <Suspense fallback={<div className="h-dvh bg-background" aria-label="Loading component catalog" />}>
        <FoundationCatalog />
      </Suspense>
    )
  }

  const routeContent = state.view === "inbox"
    ? <InboxView model={model} dispatch={dispatch} />
    : state.view === "metrics"
      ? <MetricsView model={model} dispatch={dispatch} />
      : state.view === "fleet"
        ? <FleetView model={model} dispatch={dispatch} />
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
      <div className="min-h-0 flex-1"><SessionDetail key={selected.id} model={model} dispatch={dispatch} session={selected} thread={selectedThread} /></div>
    </div>
  ) : content

  return (
    <TooltipProvider delay={350}>
      <AppShell
        navigation={!compactNavigation && state.navPinned ? (
          <ProductNavigation
            view={state.view}
            unread={unread}
            needsYou={model.resources.status.data?.needsYou || 0}
            onNavigate={navigate}
            onClose={() => { void dispatch({ type: "app.patch", patch: { navPinned: false } }) }}
          />
        ) : undefined}
        detail={externalDetail && !compactDetail ? <SessionDetail key={selected.id} model={model} dispatch={dispatch} session={selected} thread={selectedThread} onClose={closeSession} /> : undefined}
        topbar={
          <ProductTopbar
            view={state.view}
            version={version}
            navigationOpen={compactNavigation ? mobileNavigationOpen : state.navPinned}
            rightRailOpen={state.rightRailOpen}
            onToggleNavigation={toggleNavigation}
            onOpenPalette={() => setPaletteOpen(true)}
            onToggleRightRail={() => { void dispatch({ type: "app.patch", patch: { rightRailOpen: !state.rightRailOpen } }) }}
            onRefresh={() => { void dispatch({ type: "fleet.refresh" }) }}
          />
        }
        statusbar={<ProductStatusbar model={model} />}
      >
        {visibleContent}
      </AppShell>
      <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-[min(var(--rail),90vw)] p-0">
          <ProductNavigation
            overlay
            view={state.view}
            unread={unread}
            needsYou={model.resources.status.data?.needsYou || 0}
            onNavigate={navigate}
            onClose={() => setMobileNavigationOpen(false)}
          />
        </SheetContent>
      </Sheet>
      <ChiefOfStaff model={model} dispatch={dispatch} />
      <ProductCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} model={model} dispatch={dispatch} onNavigate={navigate} onOpenSession={openSession} onToggleNavigation={toggleNavigation} />
    </TooltipProvider>
  )
}
