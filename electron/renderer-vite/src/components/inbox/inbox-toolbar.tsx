import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { InboxFilter } from '@/lib/inbox-logic';

// Search input + three filter/sort dropdowns. The dropdowns are shadcn's
// Select (Radix Select underneath), which replaced a bespoke ~170-line
// popover component (manual popover positioning, ArrowUp/Down + Home/End
// keyboard handling, aria-activedescendant wiring, click-outside detection,
// viewport-flip logic): all of that behavior comes from Radix for free,
// including typeahead-select and portal-based positioning that survives
// scroll containers.
export function InboxToolbar({ filter, onChange }: { filter: InboxFilter; onChange: (next: InboxFilter) => void }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-b-hairline px-6 py-2">
      <Input
        value={filter.q}
        onChange={(e) => onChange({ ...filter, q: e.target.value })}
        placeholder="Search inbox..."
        aria-label="Search inbox"
        // eslint-disable-next-line design-system/no-arbitrary-length -- stage 6 (#72) item 2: "One Toolbar" extracts this exact search-input width, duplicated verbatim in sessions-view.tsx's SessionsToolbar, into one shared component. Zero-visual-delta this stage.
        className="min-w-[120px] flex-1 basis-[200px]"
      />
      <Select value={filter.state || 'all'} onValueChange={(v) => onChange({ ...filter, state: v === 'all' ? '' : v })}>
        {/* Stage 5 (#71) item 4: SelectTrigger is one height (28px/r8) now, no per-instance override needed. */}
        <SelectTrigger aria-label="Filter by state" className="w-auto font-mono text-micro">
          <SelectValue placeholder="all states" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">all states</SelectItem>
          <SelectItem value="need">needs input</SelectItem>
          <SelectItem value="block">blocked</SelectItem>
          <SelectItem value="work">running</SelectItem>
          <SelectItem value="idle">stalled</SelectItem>
          <SelectItem value="done">finished</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filter.harness || 'all'} onValueChange={(v) => onChange({ ...filter, harness: v === 'all' ? '' : v })}>
        <SelectTrigger aria-label="Filter by harness" className="w-auto font-mono text-micro">
          <SelectValue placeholder="all harnesses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">all harnesses</SelectItem>
          <SelectItem value="claude-code">claude</SelectItem>
          <SelectItem value="codex">codex</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filter.sort} onValueChange={(v) => onChange({ ...filter, sort: v as InboxFilter['sort'] })}>
        <SelectTrigger aria-label="Sort inbox threads" className="w-auto font-mono text-micro">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">recent</SelectItem>
          <SelectItem value="needs-first">needs first</SelectItem>
          <SelectItem value="alpha">alpha</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
