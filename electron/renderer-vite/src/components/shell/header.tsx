import { PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Matches electron/renderer/index.html's .hdr: slim header, wordmark +
// version + the sidebar-toggle icon only (DESIGN.md signal-ownership:
// digest/resources/theme controls do NOT live here). The Tooltip on the
// icon button is a Radix primitive replacing the old [data-tip] pure-CSS
// tooltip; same visual contract (delayed show, dismiss on Esc/blur) but
// keyboard focus and ARIA wiring (role="tooltip", aria-describedby) come
// from Radix for free.
export function Header({ demo, version, rightRailOpen, onToggleRightRail }: { demo: boolean; version?: string; rightRailOpen: boolean; onToggleRightRail: () => void }) {
  return (
    <header
      className="flex h-[52px] items-center gap-3 border-b border-border bg-bg2 pl-20 pr-6"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
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
