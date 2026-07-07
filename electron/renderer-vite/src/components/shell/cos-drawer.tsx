import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
      <SheetContent side="right" className="flex w-[340px] max-w-[90vw] flex-col gap-0 border-l border-border bg-bg2 p-0 sm:max-w-[90vw]">
        <SheetHeader className="h-11 flex-none flex-row items-center gap-2 border-b border-border px-4 py-0 space-y-0">
          <span className="text-[15px]" aria-hidden="true">🤝</span>
          <SheetTitle className="font-mono text-[10px] font-semibold uppercase tracking-widest text-iris">Chief of staff</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
            {history.length === 0 && !loading && (
              <p className="font-mono text-[10.5px] leading-relaxed text-ink4">
                Ask your chief of staff things like &quot;what needs me right now?&quot; Answers are advisory only, grounded in pulse, notes,
                and session states, and cite what they refer to.
              </p>
            )}
            {history.map((x, i) => (
              <div key={i} className="grid gap-1.5">
                <div className="text-[12px] text-ink2">{x.q}</div>
                <div className="whitespace-pre-wrap border-l-2 border-iris-dim pl-2 text-[12.5px] leading-relaxed text-foreground">{x.a}</div>
              </div>
            ))}
            {loading && (
              <div className="grid gap-1.5">
                <div className="text-[12px] text-ink2">{q}</div>
                <div className="font-mono text-[11px] text-ink3">thinking...</div>
              </div>
            )}
          </div>
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
            <Button onClick={send} disabled={loading} className="flex-none bg-transparent border border-iris-dim text-iris hover:bg-iris/10">
              Ask
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
