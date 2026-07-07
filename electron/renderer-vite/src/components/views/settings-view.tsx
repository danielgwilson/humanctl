import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { Item, ItemGroup, ItemSeparator } from '@/components/ui/item';
import { Input } from '@/components/ui/input';
import { ViewHeader } from '@/components/shell/view-header';
import { useSummaryBudget } from '@/hooks/use-humanctl';
import { fmtUSD } from '@/lib/format';
import { cn } from '@/lib/utils';
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
  return <div className="px-6 pb-1 pt-5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink4">{children}</div>;
}

function SectionNote({ children }: { children: string }) {
  return <p className="px-6 pb-2 text-[11.5px] leading-relaxed text-ink3">{children}</p>;
}

// The bespoke segmented control (DESIGN.md's "no native/OS-default control"
// hardline): mono labels, an iris fill for the active option, native <button>
// semantics (keyboard + focus-visible come for free), never a stock
// shadcn/Radix component -- this exact control has no primitive counterpart
// in the component contract (chip.tsx/select.tsx/etc), so it is intentionally
// hand-built rather than bent out of one of those.
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-md border border-border bg-panel2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[5px] px-3 py-1 font-mono text-[10.5px] font-medium text-ink3 transition-colors hover:text-foreground',
              active && 'bg-iris text-primary-foreground hover:text-primary-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsView({ state, patch }: { state: AppState; patch: (next: Partial<AppState>) => void }) {
  const dailyBudgetUSD = state.summaryBudgetUSD ?? DEFAULT_BUDGET;
  const { budget } = useSummaryBudget(true, dailyBudgetUSD);
  const [budgetInput, setBudgetInput] = useState(String(dailyBudgetUSD));

  useEffect(() => { setBudgetInput(String(dailyBudgetUSD)); }, [dailyBudgetUSD]);

  function commitBudget() {
    const v = Math.max(0.1, Number(budgetInput) || DEFAULT_BUDGET);
    setBudgetInput(String(v));
    patch({ summaryBudgetUSD: v });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader icon={Settings2} title="Settings" subtitle="preferences, persisted locally" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <SectionLabel>Appearance</SectionLabel>
        <ItemGroup>
          <Item size="sm" className="justify-between px-6">
            <span className="text-[12.5px] text-ink3">Theme</span>
            <Segmented
              ariaLabel="Theme"
              value={state.theme}
              onChange={(t) => patch({ theme: t })}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </Item>
        </ItemGroup>

        <SectionLabel>AI summary engine</SectionLabel>
        <SectionNote>Which local CLI generates the on-demand summary. It runs on your machine, through your own CLI auth.</SectionNote>
        <ItemGroup>
          <Item size="sm" className="justify-between px-6">
            <span className="text-[12.5px] text-ink3">Engine</span>
            <Segmented
              ariaLabel="AI summary engine"
              value={state.summarizer || 'claude'}
              onChange={(v) => patch({ summarizer: v })}
              options={[
                { value: 'claude', label: 'Claude Code' },
                { value: 'codex', label: 'Codex' },
              ]}
            />
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
            <span className="text-[12.5px] text-ink3">Daily budget (est USD)</span>
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
              <div className="px-6 py-2 text-[11px] text-ink4">
                Today: {fmtUSD(budget.spentUSD)} of {fmtUSD(budget.dailyBudgetUSD)}
                {budget.paused ? ' · paused for the rest of today' : ''}.
              </div>
            </>
          )}
        </ItemGroup>
      </div>
    </div>
  );
}
