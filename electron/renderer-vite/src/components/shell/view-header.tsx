import type { LucideIcon } from 'lucide-react';
import { Icon } from '@/components/ui/icon';

// The one quiet mono header shared by Sessions/Metrics/Fleet/Settings
// (ported from renderer.js's .view-hd: glyph + title + a count-with-noun
// subtitle). The glyph is the SAME lucide icon as that view's nav-sidebar
// entry (nav-sidebar.tsx's NAV_ITEMS), reinforcing wayfinding between the
// rail and the open view rather than inventing a second decorative glyph
// language.
export function ViewHeader({ icon: HeaderIcon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-b-hairline px-6 py-3.5">
      <Icon icon={HeaderIcon} className="flex-none text-ink-3" aria-hidden="true" />
      {/* This IS "the view name. Once per screen" (docs/design-system.md
          2.3's `title` role, verbatim) -- the one call site that owns it. */}
      <span className="font-sans text-title text-ink">{title}</span>
      <span className="font-mono text-label uppercase text-ink-4">{subtitle}</span>
    </div>
  );
}
