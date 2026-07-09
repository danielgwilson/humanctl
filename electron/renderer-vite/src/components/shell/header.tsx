import { PanelLeft, PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconButton } from '@/components/ui/icon-button';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

// Compact header: wordmark + version + the left-sidebar toggle and the
// right chief-of-staff-drawer toggle only (DESIGN.md signal-ownership:
// digest/resources/theme controls do NOT live here). The Tooltip on each
// icon button is shadcn's Tooltip (a Radix primitive): keyboard focus and
// ARIA wiring (role="tooltip", aria-describedby) come from Radix for free.
//
// STAGE 2B: this header renders inside SidebarInset, to the RIGHT of the
// sidebar WHEN THE SIDEBAR IS EXPANDED -- see the offcanvas note below for
// why that is no longer the whole story.
//
// STAGE-2E chrome pass: height dropped 52px -> 44px (compact chrome;
// the bar had nothing in it but the wordmark and one button) and a `PanelLeft`
// toggle was added on the left, symmetric with the existing `PanelRight`
// toggle on the right -- the right drawer had a visible collapse control and
// the left nav did not, even though both are collapsible panels. Wired to
// the SAME `useSidebar().toggleSidebar()` Cmd+\ already calls
// (components/ui/sidebar.tsx), so the button and the chord can never drift
// out of sync with each other or with the persisted `AppState.navPinned`.
//
// STAGE-OFFCANVAS (0.17.4): the sidebar is now `collapsible="offcanvas"`
// (nav-sidebar.tsx), not "icon" -- collapsed means FULLY HIDDEN, no rail, so
// SidebarInset (and this Header inside it) spans the WHOLE window from x=0
// whenever the sidebar is collapsed, sliding this header's top-left corner
// directly under the macOS traffic lights (frameless titleBarStyle,
// electron/main.ts; the lights + their left inset occupy roughly the
// window's first ~76px). "Who owns the traffic-light band" is therefore
// state-aware, read from `useSidebar().state`:
//   - collapsed: THIS header owns the corner. It gets left padding (pl-76px)
//     that clears the lights, drops its bottom border entirely (no rule may
//     cross the light band -- same reasoning as nav-sidebar.tsx's borderless
//     SidebarHeader), and its PanelLeft toggle -- the first flex child --
//     naturally lands just to the right of the lights, the "collapsed
//     title bar" layout.
//   - expanded: the SIDEBAR's own header owns the corner (nav-sidebar.tsx);
//     this header is inset to the sidebar's right and goes back to plain
//     symmetric padding and its normal bottom border.
// Both states keep the existing drag region (the window is still frameless)
// with no-drag islands around each interactive button.
export function Header({ demo, version, rightRailOpen, onToggleRightRail }: { demo: boolean; version?: string; rightRailOpen: boolean; onToggleRightRail: () => void }) {
  const { state: sidebarState, toggleSidebar } = useSidebar();
  const sidebarOpen = sidebarState === 'expanded';
  return (
    <header
      className={cn(
        'flex h-[var(--band-top)] shrink-0 items-center gap-3 bg-surface-0 pr-6',
        sidebarOpen ? 'border-b border-b-hairline pl-6' : 'pl-[var(--traffic-light-inset)]',
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex flex-none items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Stage 5 (#71) item 1: the new IconButton primitive owns "no
                ring at rest, ring appears only when toggled on" natively
                (icon-button.tsx) -- this used to force a NEUTRAL hairline
                ring even at rest ('hairline text-ink-3'), which contradicted
                that contract; deleted rather than carried forward. */}
            <IconButton
              icon={PanelLeft}
              active={sidebarOpen}
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? 'collapse sidebar' : 'expand sidebar'}
            />
          </TooltipTrigger>
          <TooltipContent>toggle sidebar (&#8984;\)</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-none items-baseline gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Brand wordmark, not "the view name" (view-header.tsx's
            ViewHeader owns `title`, once per screen) -- demoted from bold to
            plain `row` weight, identity carried by the iris-contrast colour
            split alone (P1: demotion is alpha/colour, never weight). */}
        <span className="font-mono text-row">
          human<b className="font-medium text-iris-contrast">ctl</b>
        </span>
        <span className="font-mono text-label uppercase text-ink-3">{version ? `v${version}` : 'demo'}</span>
        {demo && (
          <span className="rounded-1 shadow-[inset_0_0_0_var(--hairline-w)_var(--need-contrast)] px-1.5 py-px font-mono text-label uppercase text-need-contrast">
            demo &middot; fixture
          </span>
        )}
      </div>
      <div className="flex-1" />
      <div className="flex flex-none items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              icon={PanelRight}
              active={rightRailOpen}
              onClick={onToggleRightRail}
              aria-label="toggle chief-of-staff chat"
            />
          </TooltipTrigger>
          <TooltipContent>chief-of-staff chat (a)</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
