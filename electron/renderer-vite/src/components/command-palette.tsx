import { useMemo, useState } from 'react';
import {
  CheckCheck,
  Command as FleetIcon,
  Inbox as InboxIcon,
  LayoutGrid,
  List as SessionsIcon,
  PanelLeft,
  PanelRight,
  Settings2,
  SunMoon,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { HarnessGlyph, StateChip } from '@/components/state-chip';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { cwdBase } from '@/lib/format';
import type { AppState, SessionRow, ViewName } from '@/lib/types';

// The Linear/Attio-style Cmd-K command palette: the fast keyboard-first way
// to navigate + act, layered on top of (never instead of) the existing
// mouse-driven nav/sidebar/actions. Consumes App's ALREADY-fetched state
// (rows, view, theme, rightRailOpen) and its existing handlers -- no new
// poll/timer, no duplicate data fetching (AGENTS.md perf rules).
//
// A large fleet (DESIGN.md: "a real fleet is 100+ sessions") could mean
// hundreds of CommandItems mounted at once, which cmdk does not virtualize
// (it filters visibility, it doesn't unmount). Rather than adding a
// virtualizer for one more list in one turn, this caps the CANDIDATE pool
// fed to cmdk (SESSION_POOL_CAP, most-recent-first) and, while idle (no
// search text yet), further caps what's actually rendered to a short
// "recent" list (IDLE_VISIBLE_CAP) -- as soon as the human types, cmdk's own
// fuzzy filter/sort runs over the full capped pool. This keeps the DOM
// small at rest and keeps search results comprehensive for any real fleet
// size without a second data structure.
const SESSION_POOL_CAP = 150;
const IDLE_VISIBLE_CAP = 8;

const GO_TO_ITEMS: { view: ViewName; label: string; icon: typeof InboxIcon; shortcut?: string }[] = [
  { view: 'inbox', label: 'Inbox', icon: InboxIcon, shortcut: '1' },
  { view: 'metrics', label: 'Metrics', icon: LayoutGrid, shortcut: '2' },
  { view: 'fleet', label: 'Fleet', icon: FleetIcon, shortcut: '3' },
  { view: 'sessions', label: 'Sessions', icon: SessionsIcon, shortcut: '4' },
  { view: 'settings', label: 'Settings', icon: Settings2 },
];

const THEME_ORDER: AppState['theme'][] = ['dark', 'light', 'system'];
function nextTheme(current: AppState['theme']): AppState['theme'] {
  const idx = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
}

function displayTitle(row: SessionRow): string {
  return row.customTitle || row.title || row.id.slice(0, 10);
}

// A searchable haystack for cmdk's built-in fuzzy filter: custom title /
// title / repo, per the spec. A short id suffix keeps the value unique
// across rows with identical title+repo (cmdk keys selection off this
// string) without meaningfully diluting match relevance.
function sessionSearchValue(row: SessionRow): string {
  const title = displayTitle(row);
  const repo = row.repo || cwdBase(row.cwd) || '';
  return `${title} ${repo} ${row.id.slice(-6)}`;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: SessionRow[];
  view: ViewName;
  onNavigate: (view: ViewName) => void;
  onOpenSession: (id: string) => void;
  onMarkAllRead: () => void;
  theme: AppState['theme'];
  onSetTheme: (theme: AppState['theme']) => void;
  rightRailOpen: boolean;
  onToggleRightRail: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  rows,
  view,
  onNavigate,
  onOpenSession,
  onMarkAllRead,
  theme,
  onSetTheme,
  rightRailOpen,
  onToggleRightRail,
}: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  // Rendered inside SidebarProvider (App.tsx), so this reads the SAME
  // sidebar context Header's PanelLeft toggle and Cmd+\ already drive --
  // no second source of truth for open/collapsed.
  const { state: sidebarState, toggleSidebar } = useSidebar();

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setSearch('');
  }
  // Every onSelect below closes THROUGH this (not the raw onOpenChange
  // prop) so the search text always resets, matching Esc/outside-click,
  // which already go through handleOpenChange via CommandDialog below.
  function close() {
    handleOpenChange(false);
  }

  const sessionPool = useMemo(() => rows.slice().sort((a, b) => a.ageMs - b.ageMs).slice(0, SESSION_POOL_CAP), [rows]);
  const idle = search.trim().length === 0;
  const visibleSessions = idle ? sessionPool.slice(0, IDLE_VISIBLE_CAP) : sessionPool;

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Search views, sessions, actions..."
        value={search}
        onValueChange={setSearch}
        aria-label="Command palette search"
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {GO_TO_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = view === item.view;
            return (
              <CommandItem
                key={item.view}
                value={`go to ${item.label}`}
                onSelect={() => {
                  onNavigate(item.view);
                  close();
                }}
              >
                <Icon className={cn(active && 'text-iris')} aria-hidden="true" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup
          heading={idle && sessionPool.length > visibleSessions.length ? `Sessions (recent ${visibleSessions.length} of ${rows.length})` : 'Sessions'}
        >
          {visibleSessions.map((row) => (
            <CommandItem
              key={row.id}
              value={sessionSearchValue(row)}
              onSelect={() => {
                onOpenSession(row.id);
                close();
              }}
            >
              <HarnessGlyph harness={row.harness} />
              <span className="flex-1 min-w-0 truncate">{displayTitle(row)}</span>
              <StateChip state={row.state} />
              <span className="flex-none max-w-[110px] truncate font-mono text-[9.5px] text-ink4">
                {cwdBase(row.cwd || row.repo)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="mark all read inbox"
            onSelect={() => {
              onMarkAllRead();
              close();
            }}
          >
            <CheckCheck aria-hidden="true" />
            <span className="flex-1 truncate">Mark all read</span>
          </CommandItem>
          <CommandItem
            value="toggle theme appearance light dark system"
            onSelect={() => {
              onSetTheme(nextTheme(theme));
              close();
            }}
          >
            <SunMoon aria-hidden="true" />
            <span className="flex-1 truncate">Toggle theme</span>
            <CommandShortcut className="normal-case tracking-normal">{theme}</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle sidebar nav"
            onSelect={() => {
              toggleSidebar();
              close();
            }}
          >
            <PanelLeft className={cn(sidebarState === 'expanded' && 'text-iris')} aria-hidden="true" />
            <span className="flex-1 truncate">Toggle sidebar</span>
            <CommandShortcut className="normal-case tracking-normal">
              {sidebarState === 'expanded' ? 'open' : 'closed'}
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            value="toggle chief of staff drawer chat"
            onSelect={() => {
              onToggleRightRail();
              close();
            }}
          >
            <PanelRight className={cn(rightRailOpen && 'text-iris')} aria-hidden="true" />
            <span className="flex-1 truncate">Toggle chief-of-staff drawer</span>
            <CommandShortcut>A</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
