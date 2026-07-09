import type React from 'react';
import { useEffect, useRef } from 'react';
import { Inbox, LayoutGrid, Command, List, Settings2 } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { CountToken } from '@/components/ui/count-token';
import { cn } from '@/lib/utils';
import type { AppState } from '@/lib/types';

// STAGE 2B: replaces nav-rail.tsx's hand-rolled hover-expand icon strip with
// the shadcn Sidebar primitive (components/ui/sidebar.tsx). This deletes the
// bespoke fixed-position/hover-timer/pin code in favor of Radix a11y
// (keyboard nav, focus management) for free.
//
// STAGE-OFFCANVAS (0.17.4): collapsible switched from "icon" to "offcanvas".
// The collapsed icon rail was 48px (SIDEBAR_WIDTH_ICON) but the macOS
// hiddenInset traffic-light cluster's own footprint is ~80-90px including its
// left inset, so the lights spilled past the rail's right edge no matter how
// its borders were arranged. Offcanvas removes the rail entirely when
// collapsed (default, AppState.navPinned starts false): the sidebar is fully
// hidden, content goes full width, and the Header (header.tsx) takes over
// ownership of the traffic-light band since it now spans from x=0. Cmd+\
// still toggles the persisted expanded/collapsed state; the per-item
// tooltip-on-hover pattern from stage 2b is gone with it (there is no longer
// a visible collapsed rail to hover over -- when the sidebar is visible at
// all, it is fully expanded, so labels are always shown as text next to the
// icon, never hidden behind a tooltip). See DESIGN.md's "Deliberate
// deviations" for the recorded conformance note.
const NAV_ITEMS: { view: AppState['view']; label: string; key: string; icon: typeof Inbox }[] = [
  { view: 'inbox', label: 'Inbox', key: '1', icon: Inbox },
  { view: 'metrics', label: 'Metrics', key: '2', icon: LayoutGrid },
  { view: 'fleet', label: 'Fleet', key: '3', icon: Command },
  { view: 'sessions', label: 'Sessions', key: '4', icon: List },
];

export function AppSidebar({
  view,
  onNavigate,
  unreadCount,
  theme,
  onSetTheme,
}: {
  view: AppState['view'];
  onNavigate: (v: AppState['view']) => void;
  unreadCount: number;
  theme: AppState['theme'];
  onSetTheme: (t: AppState['theme']) => void;
}) {
  return (
    // `border-r-0` cancels the primitive's own full-height border-r (see
    // components/ui/sidebar.tsx). With offcanvas, collapsed means fully
    // hidden (nothing to bisect), but the override still matters in the
    // EXPANDED state: it keeps the border off this SidebarHeader band (below)
    // so the macOS lights get clean, rule-free space there too. The border
    // lives on SidebarContent + SidebarFooter instead, starting cleanly
    // BELOW the header band rather than cutting across it.
    <Sidebar collapsible="offcanvas" className="border-r-0">
      {/* EXPANDED-state traffic-light band: when the sidebar is open, it
          occupies the window's top-left corner, so the macOS traffic lights
          sit over this band (frameless titleBarStyle in electron/main.ts).
          (When collapsed/offcanvas, this whole component -- and this band
          with it -- is off-window; Header, which spans from x=0 in that
          state, takes over light-clearing duty instead, see header.tsx.)
          This header is a pure drag region: no interactive control lives in
          the same vertical band as the lights, so there is no no-drag island
          to carve out here (contrast Header, which DOES have one for its own
          controls). No border here (dropped the old border-b) so the lights
          get clean, rule-free space -- the seam with the inset header to the
          right resumes cleanly below, on SidebarContent/SidebarFooter, never
          crossing the lights. Height matches Header's own compact height so
          the two panes still read as one level row. */}
      <SidebarHeader
        className="h-[var(--band-top)] shrink-0 justify-center p-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        aria-hidden="true"
      />
      <SidebarContent className="gap-0 border-r border-r-hairline py-2">
        <SidebarMenu className="gap-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const active = view === item.view;
            const NavIcon = item.icon;
            const unread = item.view === 'inbox' && unreadCount > 0;
            return (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  isActive={active}
                  // No `tooltip` prop (stage 2b had one): the primitive only
                  // ever shows it when state==="collapsed", and offcanvas
                  // collapsed means the whole sidebar is off-window, so
                  // there is nothing left to hover for a tooltip to answer.
                  // The label already renders as text next to the icon
                  // whenever this button is visible at all (expanded-only).
                  onClick={() => onNavigate(item.view)}
                  aria-label={`${item.label}${unread ? `, ${unreadCount} unread` : ''}`}
                  // Stage 2 (#68), one of the five selection dialects
                  // unified onto `--overlay-selected`: this used to force a
                  // hardcoded `!bg-iris/16` fill over the primitive's own
                  // `data-[active=true]:bg-sidebar-accent`. The primitive's
                  // own active treatment is now `bg-selected` too (see
                  // sidebar.tsx), so there is nothing left to out-rank and
                  // the `!important` override is deleted along with it.
                  className={cn(active && 'text-ink')}
                >
                  {/* No icon color change for active (section 0, P2: "An
                      icon never changes colour to signal state"). The row's
                      `bg-selected` fill is the one and only selection
                      signal; the icon just inherits it like any other icon. */}
                  <Icon icon={NavIcon} aria-hidden="true" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
                {unread && (
                  // Stage 5 (#71) item 1: SidebarMenuBadge is now a bare
                  // positioning shell (sidebar.tsx); CountToken's own
                  // `tone="alert"` supplies the fill/radius/ink section 6
                  // names for this exact call site ("Only the sidebar
                  // unread badge is alert").
                  <SidebarMenuBadge>
                    <CountToken tone="alert" count={unreadCount} />
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="border-r border-r-hairline border-t border-t-hairline p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton aria-label="theme, settings">
              <span className="flex size-4 flex-none items-center justify-center rounded-full bg-iris-solid font-mono text-label text-on-solid">
                Y
              </span>
              <span className="flex-1 truncate font-mono text-row text-ink">You</span>
              <Icon icon={Settings2} className="text-ink-3" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuLabel className="font-mono text-label uppercase text-ink-3">Theme</DropdownMenuLabel>
            {(['light', 'dark', 'system'] as const).map((t) => (
              // Sixth selection dialect found beyond the five named in #68
              // (issue #66's original audit also flagged this one): the
              // active theme entry used the same hardcoded solid-iris-fill
              // pattern. Unified onto `--overlay-selected` for the same
              // reason as the other five.
              <DropdownMenuItem key={t} onSelect={() => onSetTheme(t)} className={cn(theme === t && 'bg-selected text-ink')}>
                {t[0].toUpperCase() + t.slice(1)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onNavigate('settings')}>All settings...</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

// The "hover the left edge to peek the sidebar" affordance,
// STAGE-OFFCANVAS (0.17.4). Rendered as a sibling of <AppSidebar> (App.tsx),
// not nested inside it: the Sidebar primitive's own collapsed/offcanvas
// state is expressed as a `left` position shift on a `fixed` div (see
// components/ui/sidebar.tsx), so anything rendered as a child of THAT div
// would slide off-window along with it and could never receive the hover
// this affordance depends on. This component instead reads `useSidebar()`
// directly and renders its own always-viewport-anchored `fixed` strip.
//
// It is a thin (6px) hit zone pinned to the true left edge of the window,
// starting BELOW the 44px traffic-light band (top-[var(--band-top)]) so it never
// fights window-drag or the macOS lights themselves, and only rendered at
// all while the sidebar is collapsed (nothing to peek open otherwise).
// Hovering it for HOVER_OPEN_DELAY_MS opens the sidebar via `setOpen(true)`
// -- a debounced `setTimeout`, not a recurring timer/poller in the
// AGENTS.md "declare every timer" sense: it fires at most once per
// mouseenter and is cleared on mouseleave/unmount, so a cursor merely
// passing through the strip (e.g. dragging the window, moving to another
// app) does not pop the sidebar open. This is a pointer-only convenience
// layered on top of, not instead of, the accessible paths: the Header's
// PanelLeft toggle and Cmd+\ (components/ui/sidebar.tsx) remain the
// explicit/keyboard ways to open the sidebar, so this element is
// `aria-hidden` and never receives focus.
const HOVER_OPEN_DELAY_MS = 120;

export function SidebarEdgePeek() {
  const { state, setOpen } = useSidebar();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (state !== 'collapsed') return null;

  return (
    <div
      aria-hidden="true"
      className="fixed left-0 top-[var(--band-top)] bottom-0 z-20 w-1.5"
      onMouseEnter={() => {
        timerRef.current = window.setTimeout(() => {
          setOpen(true);
          timerRef.current = null;
        }, HOVER_OPEN_DELAY_MS);
      }}
      onMouseLeave={() => {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }}
    />
  );
}
