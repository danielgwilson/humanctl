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
    <div className="flex flex-none items-center gap-2.5 border-b border-border px-6 py-3.5">
      <Icon icon={HeaderIcon} className="flex-none text-ink3" aria-hidden="true" />
      <span className="text-[15px] font-bold tracking-tight text-foreground">{title}</span>
      <span className="font-mono text-[9.5px] uppercase tracking-wider text-ink4">{subtitle}</span>
    </div>
  );
}
