import type { ComponentProps, ReactNode } from "react"

import { cn } from "@humanctl/ui/lib/cn"

type AppShellProps = ComponentProps<"div"> & {
  navigation?: ReactNode
  topbar?: ReactNode
  detail?: ReactNode
  statusbar?: ReactNode
}

function AppShell({
  className,
  navigation,
  topbar,
  detail,
  statusbar,
  children,
  ...props
}: AppShellProps) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "grid h-dvh min-h-0 w-full overflow-hidden bg-background text-ink max-[960px]:grid-cols-[minmax(0,1fr)]",
        navigation
          ? "grid-cols-[var(--rail)_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1fr)]",
        className,
      )}
      {...props}
    >
      {navigation ? (
        <nav
          data-slot="app-navigation"
          aria-label="Primary"
          className="min-h-0 border-r border-border bg-surface pt-[var(--chrome)] max-[960px]:hidden"
        >
          {navigation}
        </nav>
      ) : null}
      <div data-slot="app-stage" className="flex min-h-0 min-w-0 flex-col">
        <div data-slot="app-upper" className="flex min-h-0 min-w-0 flex-1">
          <div data-slot="app-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {topbar ? (
              <header
                data-slot="app-topbar"
                className={cn(
                  "flex h-[var(--chrome)] shrink-0 items-center border-b border-border bg-background px-3 max-[960px]:pl-[var(--traffic-light-inset)]",
                  !navigation && "pl-[var(--traffic-light-inset)]",
                )}
              >
                {topbar}
              </header>
            ) : null}
            <main data-slot="app-main" className="min-h-0 min-w-0 flex-1 overflow-hidden">
              {children}
            </main>
          </div>
          {detail ? (
            <aside
              data-slot="app-detail"
              className="min-h-0 w-[var(--detail)] shrink-0 border-l border-border bg-background max-[1040px]:hidden"
            >
              {detail}
            </aside>
          ) : null}
        </div>
        {statusbar ? (
          <footer
            data-slot="app-statusbar"
            aria-label="Fleet status"
            className="flex h-[var(--status-band)] shrink-0 items-center border-t border-border bg-surface px-3"
          >
            {statusbar}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

export { AppShell, type AppShellProps }
