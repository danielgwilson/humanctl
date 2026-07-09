import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAtlasAsk } from '@/hooks/use-humanctl';

// Ported from atlas.js: the chief-of-staff drawer, a summonable right-side
// overlay, CHAT ONLY (shell v3 removed the digest/resources blocks that used
// to live here; DESIGN.md one-owner rule). This is a straight swap onto
// shadcn's Sheet (built on Radix Dialog): focus trap, Esc-to-close,
// return-focus-to-trigger, and an aria-modal dialog role all come from Radix
// for free, replacing atlas.js's hand-rolled onDrawerKeydown/focus-trap/
// returnFocusTo logic (about 25 lines of bespoke a11y code deleted).
export function CosDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { history, ask, loading } = useAtlasAsk();
  const [q, setQ] = useState('');

  function send() {
    if (!q.trim() || loading) return;
    ask(q);
    setQ('');
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* No `border-l`/`bg-*` overrides here any more: SheetContent's own
          base already supplies `overlay` elevation (a full ring on every
          edge) and `bg-surface-2` (stage 2, #68); a literal left border on
          top of that ring would double the left edge's weight for nothing. */}
      <SheetContent side="right" className="flex w-[var(--rail-list)] max-w-[90vw] flex-col gap-0 p-0 sm:max-w-[90vw]">
        <SheetHeader className="h-11 flex-none flex-row items-center gap-2 border-b border-b-hairline px-4 py-0 space-y-0">
          <span className="text-row" aria-hidden="true">🤝</span>
          <SheetTitle className="font-mono text-label uppercase text-iris-contrast">Chief of staff</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-3">
              {history.length === 0 && !loading && (
                // Empty-state copy inside the chat drawer, one of docs/design-
                // system.md 2.1's enumerated sans call sites twice over
                // ("chat", "empty-state copy").
                <p className="font-sans text-prose text-ink-4">
                  Ask your chief of staff things like &quot;what needs me right now?&quot; Answers are advisory only, grounded in pulse, notes,
                  and session states, and cite what they refer to.
                </p>
              )}
              {history.map((x, i) => (
                // Chat: one of 2.1's enumerated sans call sites verbatim.
                <div key={i} className="grid gap-1.5">
                  <div className="font-sans text-prose text-ink-2">{x.q}</div>
                  <div className="whitespace-pre-wrap border-l-2 border-l-iris-contrast pl-2 font-sans text-prose text-ink">{x.a}</div>
                </div>
              ))}
              {loading && (
                <div className="grid gap-1.5">
                  <div className="font-sans text-prose text-ink-2">{q}</div>
                  <div className="font-mono text-micro text-ink-3">thinking...</div>
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="mt-3 flex flex-none gap-1.5">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
              placeholder="Ask your chief of staff..."
              aria-label="Ask your chief of staff"
              disabled={loading}
              maxLength={500}
            />
            <Button variant="accent-outline" onClick={send} disabled={loading} className="flex-none">
              Ask
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
