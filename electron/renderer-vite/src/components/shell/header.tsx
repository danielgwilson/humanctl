import { PanelLeft, PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

// Compact header: wordmark + version + the left-sidebar toggle and the
// right chief-of-staff-drawer toggle only (DESIGN.md signal-ownership:
// digest/resources/theme controls do NOT live here). The Tooltip on each
// icon button is shadcn's Tooltip (a Radix primitive): keyboard focus and
// ARIA wiring (role="tooltip", aria-describedby) come from Radix for free.
//
// STAGE 2B: this header now renders inside SidebarInset, to the RIGHT of
// the full-height sidebar, not spanning the full window from x=0. The old
// `pl-20` left padding existed only to clear the macOS traffic lights when
// this header still spanned the whole window; the lights now sit over the
// sidebar's own SidebarHeader instead (see nav-sidebar.tsx), so this header
// goes back to a plain symmetric px-6. It keeps its own drag region (the
// window is still frameless) with no-drag islands around each interactive
// button, same as before.
//
// STAGE-2E chrome pass: height dropped 52px -> 44px (Linear/Adio-compact;
// the bar had nothing in it but the wordmark and one button) and a `PanelLeft`
// toggle was added on the left, symmetric with the existing `PanelRight`
// toggle on the right -- the right drawer had a visible collapse control and
// the left nav did not, even though both are collapsible panels. Wired to
// the SAME `useSidebar().toggleSidebar()` Cmd+\ already calls
// (components/ui/sidebar.tsx), so the button and the chord can never drift
// out of sync with each other or with the persisted `AppState.navPinned`.
export function Header({ demo, version, rightRailOpen, onToggleRightRail }: { demo: boolean; version?: string; rightRailOpen: boolean; onToggleRightRail: () => void }) {
  const { state: sidebarState, toggleSidebar } = useSidebar();
  const sidebarOpen = sidebarState === 'expanded';
  return (
    <header
      className="flex h-[44px] shrink-0 items-center gap-3 border-b border-border bg-bg2 px-6"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex flex-none items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? 'collapse sidebar' : 'expand sidebar'}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-ink3 transition-colors hover:text-foreground',
                sidebarOpen && 'border-iris-dim text-iris',
              )}
            >
              <PanelLeft className="h-[15px] w-[15px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>toggle sidebar (&#8984;\)</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-none items-baseline gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className="text-[15px] font-bold tracking-tight">
          human<b className="text-iris">ctl</b>
        </span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-ink3">{version ? `v${version}` : 'demo'}</span>
        {demo && (
          <span className="rounded border border-need/40 px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wider text-need">
            demo &middot; fixture
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex flex-none items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleRightRail}
              aria-label="toggle chief-of-staff chat"
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-ink3 transition-colors hover:text-foreground',
                rightRailOpen && 'border-iris-dim text-iris',
              )}
            >
              <PanelRight className="h-[15px] w-[15px]" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>chief-of-staff chat (a)</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
