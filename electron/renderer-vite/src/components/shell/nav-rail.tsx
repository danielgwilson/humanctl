import { useState } from 'react';
import { Inbox, LayoutGrid, Command, List, Settings2 } from 'lucide-react';
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

// Ported from renderer.js's NAV array + renderNav(): a visible icon strip by
// default (0.15.0's hidden rail was the mistake this shell v3 undoes),
// hover-expands to show labels, Cmd+\ pins it as a fixed column. This spike
// implements the hover/pin behavior with plain state (no Radix primitive
// fits "hover-expand an icon strip" cleanly); the user/settings picker at
// the foot IS a Radix DropdownMenu, which gets full keyboard nav (Arrow keys,
// Home/End, type-ahead, Esc-to-close-and-return-focus) for free versus the
// bespoke .picker popover it replaces.
const NAV_ITEMS: { view: AppState['view']; label: string; key: string; icon: typeof Inbox }[] = [
  { view: 'inbox', label: 'Inbox', key: '1', icon: Inbox },
  { view: 'metrics', label: 'Metrics', key: '2', icon: LayoutGrid },
  { view: 'fleet', label: 'Fleet', key: '3', icon: Command },
  { view: 'sessions', label: 'Sessions', key: '4', icon: List },
];

export function NavRail({
  view,
  onNavigate,
  navPinned,
  unreadCount,
  theme,
  onSetTheme,
}: {
  view: AppState['view'];
  onNavigate: (v: AppState['view']) => void;
  navPinned: boolean;
  unreadCount: number;
  theme: AppState['theme'];
  onSetTheme: (t: AppState['theme']) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const expanded = navPinned || hovering;

  return (
    <nav
      aria-label="views"
      className={cn(
        'fixed left-0 z-[60] flex flex-col gap-0.5 border-r border-border bg-card p-2 transition-[width] duration-150 ease-out overflow-hidden',
        expanded ? 'w-[220px] shadow-[12px_0_40px_-18px_rgba(0,0,0,0.55)]' : 'w-[52px]',
      )}
      style={{ top: 'var(--hdr-h, 52px)', bottom: 'var(--ctxbar-h, 30px)' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {NAV_ITEMS.map((item) => {
        const active = view === item.view;
        const Icon = item.icon;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onNavigate(item.view)}
            aria-current={active ? 'page' : undefined}
            aria-label={`${item.label}${item.view === 'inbox' && unreadCount ? `, ${unreadCount} unread` : ''}`}
            title={`${item.label} (${item.key})`}
            className={cn(
              'group relative flex w-full items-center gap-3 rounded-md py-2 text-[13.5px] font-semibold text-muted-foreground transition-colors',
              active ? 'bg-iris/16 text-foreground' : 'hover:bg-secondary hover:text-foreground',
            )}
          >
            <span className={cn('flex w-9 flex-none items-center justify-center', active && 'text-iris')}>
              <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
            </span>
            <span className={cn('flex-1 whitespace-nowrap text-left transition-opacity', expanded ? 'opacity-100' : 'opacity-0')}>
              {item.label}
            </span>
            {item.view === 'inbox' && unreadCount > 0 && (
              <span
                className={cn(
                  'inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-iris px-1 font-mono text-[8.5px] font-semibold text-primary-foreground',
                  expanded ? 'static ml-auto' : 'absolute left-6 top-1',
                )}
              >
                {unreadCount}
              </span>
            )}
            {!expanded && (
              <span className="pointer-events-none absolute font-mono text-[9px] text-muted-foreground opacity-0">{item.key}</span>
            )}
          </button>
        );
      })}
      <div className="flex-1" />
      <div className="mt-2 border-t border-border pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md py-2 text-left text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="theme, settings"
            >
              <span className="flex w-9 flex-none items-center justify-center">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-iris font-mono text-[10px] font-bold text-primary-foreground">
                  Y
                </span>
              </span>
              <span className={cn('flex-1 whitespace-nowrap font-semibold text-[12.5px] text-foreground transition-opacity', expanded ? 'opacity-100' : 'opacity-0')}>
                You
              </span>
              <Settings2 className={cn('mr-1 h-3 w-3 flex-none transition-opacity', expanded ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
            </button>
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
      </div>
    </nav>
  );
}
