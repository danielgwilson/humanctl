import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { Item, ItemGroup, ItemSeparator } from '@/components/ui/item';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ViewHeader } from '@/components/shell/view-header';
import { useSummaryBudget } from '@/hooks/use-humanctl';
import { fmtUSD } from '@/lib/format';
import type { AppState } from '@/lib/types';

// Settings is the SOLE home for persisted preferences (DESIGN.md: "Settings +
// theme | the user/settings picker at the foot of the sidebar | Settings
// remains a routable destination; the picker is its entry point, not a
// second, independent home"). Every control here writes through the existing
// AppState patch/setState round-trip -- no new persistence path.
//
// Resume-destination (per-harness "open in the desktop app vs Terminal") is
// deliberately NOT wired here: the renderer has no clean bridge signal for
// "is a desktop app registered for this harness on this machine" (the old
// static renderer's `appAvailable()` was a main-process-only check never
// exposed to window.humanctl). Shipping a segmented control that always
// guesses "Terminal" (or worse, silently enables an app choice that doesn't
// exist) would be a fabricated affordance, so this ships theme + engine +
// budget only, per the brief's own fallback instruction.

const DEFAULT_BUDGET = 1.0;

function SectionLabel({ children }: { children: string }) {
  return <div className="px-6 pb-1 pt-5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink-4">{children}</div>;
}

function SectionNote({ children }: { children: string }) {
  return <p className="px-6 pb-2 text-[11.5px] leading-relaxed text-ink-3">{children}</p>;
}

export function SettingsView({ state, patch }: { state: AppState; patch: (next: Partial<AppState>) => void }) {
  const dailyBudgetUSD = state.summaryBudgetUSD ?? DEFAULT_BUDGET;
  const { budget } = useSummaryBudget(true, dailyBudgetUSD);
  const [budgetInput, setBudgetInput] = useState(String(dailyBudgetUSD));

  useEffect(() => { setBudgetInput(String(dailyBudgetUSD)); }, [dailyBudgetUSD]);

  function commitBudget() {
    const v = Math.max(0.1, Number(budgetInput) || DEFAULT_BUDGET);
    setBudgetInput(String(v));
    if (v === dailyBudgetUSD) return;
    patch({ summaryBudgetUSD: v });
    toast(`daily budget: ${fmtUSD(v)}`);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader icon={Settings2} title="Settings" subtitle="preferences, persisted locally" />
      <ScrollArea className="min-h-0 flex-1" viewportClassName="pb-8">
        <SectionLabel>Appearance</SectionLabel>
        <ItemGroup>
          <Item size="sm" className="justify-between px-6">
            <span className="text-[12.5px] text-ink-3">Theme</span>
            <ToggleGroup
              type="single"
              aria-label="Theme"
              value={state.theme}
              onValueChange={(v) => {
                if (!v) return;
                const next = v as AppState['theme'];
                patch({ theme: next });
                toast(`theme: ${next}`);
              }}
            >
              <ToggleGroupItem value="light">Light</ToggleGroupItem>
              <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
              <ToggleGroupItem value="system">System</ToggleGroupItem>
            </ToggleGroup>
          </Item>
        </ItemGroup>

        <SectionLabel>AI summary engine</SectionLabel>
        <SectionNote>Which local CLI generates the on-demand summary. It runs on your machine, through your own CLI auth.</SectionNote>
        <ItemGroup>
          <Item size="sm" className="justify-between px-6">
            <span className="text-[12.5px] text-ink-3">Engine</span>
            <ToggleGroup
              type="single"
              aria-label="AI summary engine"
              value={state.summarizer || 'claude'}
              onValueChange={(v) => {
                if (!v) return;
                const next = v as NonNullable<AppState['summarizer']>;
                patch({ summarizer: next });
                toast(`summary engine: ${next === 'codex' ? 'Codex' : 'Claude Code'}`);
              }}
            >
              <ToggleGroupItem value="claude">Claude Code</ToggleGroupItem>
              <ToggleGroupItem value="codex">Codex</ToggleGroupItem>
            </ToggleGroup>
          </Item>
        </ItemGroup>
        <SectionNote>
          Only the &quot;AI summary&quot; and &quot;Ask the session&quot; actions send data off-device, through your own CLI auth.
          Claude asks leave no trace in the session; Codex asks write the marked question into the thread itself. Nothing else
          leaves your machine.
        </SectionNote>

        <SectionLabel>Always-on AI summary</SectionLabel>
        <SectionNote>
          Unread threads that need you get a background summary automatically (haiku, same engine as the manual button),
          refreshed after roughly 12 new events. It pauses honestly for the rest of the day once it hits this budget; nothing
          is ever silently over-spent.
        </SectionNote>
        <ItemGroup>
          <Item size="sm" className="justify-between px-6">
            <span className="text-[12.5px] text-ink-3">Daily budget (est USD)</span>
            <Input
              type="number"
              min="0.10"
              step="0.10"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onBlur={commitBudget}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitBudget(); } }}
              aria-label="Always-on summary daily budget in US dollars"
              className="h-8 w-28 font-mono text-[12px]"
            />
          </Item>
          {budget && (
            <>
              <ItemSeparator />
              <div className="px-6 py-2 text-[11px] text-ink-4">
                Today: {fmtUSD(budget.spentUSD)} of {fmtUSD(budget.dailyBudgetUSD)}
                {budget.paused ? ' · paused for the rest of today' : ''}.
              </div>
            </>
          )}
        </ItemGroup>
      </ScrollArea>
    </div>
  );
}
