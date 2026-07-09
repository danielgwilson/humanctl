import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { HarnessGlyph, StateChip } from '@/components/state-chip';
import { cn } from '@/lib/utils';
import { agoTxt } from '@/lib/format';
import type { InboxThread, SessionRow } from '@/lib/types';
import { displayTitle, harnessOf, messageToHuman, repoBase, threadItemTs, threadState, threadUnread } from '@/lib/inbox-logic';

// Ported from inbox.js's threadRowHtml(): three-line row anatomy exactly per
// DESIGN.md ("Row anatomy" section) -- harness glyph + title + time; state
// chip + message-to-human; dir basename. The right-click menu is a Radix
// ContextMenu (radix-ui's ContextMenu primitive) replacing the app's
// hand-rolled contextmenu.js: positioning, Escape-to-close, arrow-key
// navigation between items, and type-ahead all come from Radix for free
// (contextmenu.js re-implements all of that by hand today, ~140 lines).
//
// The row is a real `<button>`, not a `div[role=button] tabIndex=0` with a
// hand-rolled Enter/Space onKeyDown. It has no nested interactive children, and
// ContextMenuTrigger's `asChild` accepts any element, so nothing forced the
// div. The native element brings Enter/Space activation, the button role, and
// focusability for free -- DESIGN.md's bespoke-controls rule explicitly prefers
// native `<button>` semantics and only permits `role`/`tabindex`/keydown on
// "anything else that is clickable". Sessions' row stays a div: it wraps a
// nested `<Button>` (the pin toggle), and a button may not nest inside a
// button. `w-full text-left` restores the two things a `<button>` changes vs a
// `<div>` (shrink-to-fit width, centered text); everything else is identical.
// `title=` stays: it is the truncated-repo-path overflow hint on a virtualized,
// high-frequency-render row, not explanatory chrome.
export function ThreadRow({
  thread,
  byId,
  selected,
  unreadTs,
  onSelect,
  onMarkRead,
  onPin,
  onOpenDetail,
  pinned,
}: {
  thread: InboxThread;
  byId: Map<string, SessionRow>;
  selected: boolean;
  unreadTs: Record<string, number>;
  onSelect: (id: string) => void;
  onMarkRead: (id: string) => void;
  onPin: (id: string) => void;
  onOpenDetail: (id: string) => void;
  pinned: boolean;
}) {
  const state = threadState(thread, byId);
  const unread = threadUnread(thread, unreadTs);
  const title = displayTitle(thread, byId);
  const when = agoTxt(threadItemTs(thread.items[thread.items.length - 1]));
  const msg = messageToHuman(thread);
  const rowLabel = `${title}, ${state}, ${msg}${unread ? ', unread' : ''}`;

  const row = (
    <button
      type="button"
      aria-label={rowLabel}
      title={thread.repo || ''}
      onClick={() => onSelect(thread.sessionId)}
      onDoubleClick={() => onOpenDetail(thread.sessionId)}
      // Stage 2 (#68), one of the five selection dialects unified onto
      // `--overlay-selected`: this used to be `border-l-iris bg-panel2`, a
      // left accent bar plus a hardcoded surface swap (section 7 forbids
      // both -- "a left accent bar on an active row" and "a hardcoded
      // surface swap for hover"). `selected && 'bg-selected'` sets
      // background-color; `hover:wash-hover` paints an inset box-shadow, a
      // DIFFERENT CSS property, on top of it. Because they never fight over
      // the same property, a selected row under hover shows both at once
      // (P4: they compose) instead of hover erasing the selection tint --
      // the #66 regression. A plain `hover:bg-hover` here would have
      // reproduced #66 exactly, just with new token names (verified against
      // this exact row while building the gate for this PR).
      className={cn(
        'grid w-full cursor-pointer grid-cols-[14px_1fr] items-start gap-2 border-b border-b-hairline px-6 py-3 text-left hover:wash-hover',
        selected && 'bg-selected',
      )}
    >
      {/* eslint-disable-next-line design-system/no-arbitrary-length -- stage 5 (#71) item 1 names a new "Dot" primitive with no call sites yet; this is exactly the ad-hoc unread dot it replaces. */}
      <span className={cn('mt-[5px] h-[7px] w-[7px] rounded-full', unread ? 'bg-iris-solid' : 'bg-transparent')} aria-hidden="true" />
      {/* eslint-disable-next-line design-system/no-arbitrary-length -- stage 6 (#72) item 5: "One ListRow" unifies this row anatomy with sessions-view.tsx's own copy of the same pattern ("thread-row.tsx and sessions-view.tsx start their glyph 22px apart"). Zero-visual-delta this stage. */}
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <HarnessGlyph harness={harnessOf(thread, byId)} />
          <span className="flex-1 truncate font-mono text-row text-ink">{title}</span>
          <span className="flex-none font-mono text-micro text-ink-4" data-numeric>{when}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <StateChip state={state} />
          {/* Row anatomy line 2, "the message to the human" -- docs/design-
              system.md 2.1's central sans call site (see sessions-view.tsx's
              SessionRowItem for the identical precedent). */}
          <span className="flex-1 truncate font-sans text-prose text-ink-3">{msg}</span>
        </span>
        <span className="truncate font-mono text-micro text-ink-4">{repoBase(thread, byId)}</span>
      </span>
    </button>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => onSelect(thread.sessionId)}>Open thread</ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpenDetail(thread.sessionId)}>Open full view</ContextMenuItem>
        <ContextMenuItem onSelect={() => onMarkRead(thread.sessionId)}>Mark read</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onPin(thread.sessionId)}>{pinned ? 'Unpin' : 'Pin'}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
