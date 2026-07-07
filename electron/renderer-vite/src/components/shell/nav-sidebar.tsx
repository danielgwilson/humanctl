import type React from 'react';
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
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AppState } from '@/lib/types';

// STAGE 2B: replaces nav-rail.tsx's hand-rolled hover-expand icon strip with
// the shadcn Sidebar primitive (components/ui/sidebar.tsx), collapsible=icon
// -- a deliberate, DESIGN.md-recorded deviation from shell v3's "hovering the
// strip for >=150ms expands it" behavior. The rail is now always an icon
// strip when collapsed (default) or a widened fixed column when expanded
// (Cmd+\, DESIGN.md's documented chord, persisted via AppState.navPinned);
// labels appear as a per-item tooltip on hover instead of a whole-rail
// overlay. This deletes the bespoke fixed-position/hover-timer/pin code in
// favor of Radix a11y (keyboard nav, focus management) for free.
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
    // components/ui/sidebar.tsx): that border used to run the ENTIRE
    // window height, including straight through the traffic-light band
    // below, since the collapsed icon rail (3rem/48px) is narrower than the
    // macOS hiddenInset traffic-light cluster's own footprint (~80-90px
    // including its left inset) -- the vertical rule literally bisected the
    // lights ("overlapping lines over the stoplight"). The border now lives
    // on SidebarContent + SidebarFooter instead (below), so it starts
    // cleanly BELOW the header band rather than cutting across it.
    <Sidebar collapsible="icon" className="border-r-0">
      {/* The macOS traffic lights sit over this top-left band (frameless
          titleBarStyle in electron/main.ts). This header is a pure drag
          region: no interactive control lives in the same vertical band as
          the lights, so there is no no-drag island to carve out here
          (contrast Header, which DOES have one for its own controls). No
          border here (dropped the old border-b) so the lights get clean,
          rule-free space -- the seam with the inset header to the right
          resumes cleanly below, on SidebarContent/SidebarFooter, never
          crossing the lights. Height matches Header's own compact height so
          the two panes still read as one level row. */}
      <SidebarHeader
        className="h-[44px] shrink-0 justify-center p-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        aria-hidden="true"
      />
      <SidebarContent className="gap-0 border-r border-sidebar-border py-2">
        <SidebarMenu className="gap-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const active = view === item.view;
            const Icon = item.icon;
            const unread = item.view === 'inbox' && unreadCount > 0;
            return (
              <SidebarMenuItem key={item.view}>
                <SidebarMenuButton
                  isActive={active}
                  tooltip={`${item.label} (${item.key})`}
                  onClick={() => onNavigate(item.view)}
                  aria-label={`${item.label}${unread ? `, ${unreadCount} unread` : ''}`}
                  // The primitive's default active treatment is
                  // data-[active=true]:bg-sidebar-accent (same hue as
                  // hover). Forced (!) so the humanctl iris active language
                  // wins over that default regardless of Tailwind's
                  // generated rule order, since both rules share the same
                  // data-[active=true] variant scope and CSS specificity
                  // alone would not reliably decide the winner.
                  className={cn(active && '!bg-iris/16 !text-foreground')}
                >
                  <Icon className={cn('size-4', active && 'text-iris')} aria-hidden="true" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
                {unread && (
                  <SidebarMenuBadge
                    className={cn(
                      'rounded-full bg-iris font-mono text-[8.5px] font-semibold text-primary-foreground',
                      // The primitive hides menu badges when collapsed
                      // (group-data-[collapsible=icon]:hidden) since most
                      // consumers only want counts in the expanded label
                      // row. The unread count is a tracked signal (DESIGN.md
                      // one-owner: Navigation) that must stay visible in the
                      // DEFAULT collapsed icon rail too, so it is forced
                      // back on. The default badge geometry (20px, right-1
                      // top-1.5) is sized for a full-width expanded row and
                      // would sit almost exactly on top of the centered 16px
                      // icon in the 32px collapsed button, so it also
                      // shrinks to a small corner pill (12px, flush corner)
                      // specifically in icon mode.
                      'group-data-[collapsible=icon]:!flex group-data-[collapsible=icon]:!right-0 group-data-[collapsible=icon]:!top-0 group-data-[collapsible=icon]:!h-3 group-data-[collapsible=icon]:!min-w-3 group-data-[collapsible=icon]:!px-0',
                    )}
                  >
                    {unreadCount}
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="border-r border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton aria-label="theme, settings">
              <span className="flex size-4 flex-none items-center justify-center rounded-full bg-iris font-mono text-[7px] font-bold text-primary-foreground">
                Y
              </span>
              <span className="flex-1 truncate text-[12.5px] font-semibold text-foreground">You</span>
              <Settings2 className="text-muted-foreground" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuLabel className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Theme</DropdownMenuLabel>
            {(['light', 'dark', 'system'] as const).map((t) => (
              <DropdownMenuItem key={t} onSelect={() => onSetTheme(t)} className={cn(theme === t && 'bg-iris text-primary-foreground')}>
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
