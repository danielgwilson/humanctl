import type { CSSProperties, ComponentProps, ReactNode } from "react"

import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@humanctl/ui/components/sidebar"
import { cn } from "@humanctl/ui/lib/cn"

type AppShellProps = Omit<ComponentProps<"div">, "onChange"> & {
  navigation: ReactNode
  navigationOpen: boolean
  onNavigationOpenChange: (open: boolean) => void
  mobileNavigationOpen?: boolean
  onMobileNavigationOpenChange?: (open: boolean) => void
  navigationBreakpoint?: number
  topbar?: ReactNode
  detail?: ReactNode
  assistant?: ReactNode
  statusbar?: ReactNode
  overlays?: ReactNode
}

type AppStageProps = Pick<AppShellProps, "topbar" | "detail" | "statusbar" | "children">

function AppStage({ topbar, detail, statusbar, children }: AppStageProps) {
  const { isMobile, open } = useSidebar()

  return (
    <SidebarInset
      data-slot="app-stage"
      aria-label="Humanctl workspace"
      className="h-dvh min-h-0 min-w-0 overflow-hidden"
    >
      <div data-slot="app-upper" className="flex min-h-0 min-w-0 flex-1">
        <div data-slot="app-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {topbar ? (
            <header
              data-slot="app-topbar"
              className={cn(
                "flex h-[var(--chrome)] shrink-0 items-center border-b border-border bg-background px-3",
                (isMobile || !open) && "pl-[var(--traffic-light-inset)]",
              )}
            >
              {topbar}
            </header>
          ) : null}
          <div data-slot="app-main" className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {children}
          </div>
        </div>
        {detail ? (
          <aside
            data-slot="app-detail"
            aria-label="Selected task detail"
            className="min-h-0 w-[var(--detail)] shrink-0 border-l border-border bg-background"
          >
            {detail}
          </aside>
        ) : null}
      </div>
      {statusbar ? (
        <footer
          data-slot="app-statusbar"
          aria-label="Fleet status"
          className="flex h-[var(--status-band)] shrink-0 items-center border-t border-border bg-sidebar px-3"
        >
          {statusbar}
        </footer>
      ) : null}
    </SidebarInset>
  )
}

function AppShell({
  className,
  navigation,
  navigationOpen,
  onNavigationOpenChange,
  mobileNavigationOpen,
  onMobileNavigationOpenChange,
  navigationBreakpoint = 864,
  topbar,
  detail,
  assistant,
  statusbar,
  overlays,
  children,
  style,
  ...props
}: AppShellProps) {
  return (
    <SidebarProvider
      open={navigationOpen}
      onOpenChange={onNavigationOpenChange}
      mobileOpen={mobileNavigationOpen}
      onMobileOpenChange={onMobileNavigationOpenChange}
      mobileBreakpoint={navigationBreakpoint}
      className={cn("h-dvh min-h-0 overflow-hidden bg-background text-ink", className)}
      style={style}
      {...props}
    >
      <Sidebar side="left" collapsible="offcanvas">
        {navigation}
        <SidebarRail />
      </Sidebar>
      <AppStage topbar={topbar} detail={detail} statusbar={statusbar}>
        {children}
      </AppStage>
      {assistant ? (
        <Sidebar
          side="right"
          collapsible="none"
          data-slot="app-assistant"
          aria-label="Chief of staff"
          className="border-l border-sidebar-border"
          style={{ "--sidebar-width": "var(--assistant-rail)" } as CSSProperties}
        >
          {assistant}
        </Sidebar>
      ) : null}
      {overlays}
    </SidebarProvider>
  )
}

export { AppShell, type AppShellProps }
