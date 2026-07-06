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
    <div
      role="button"
      tabIndex={0}
      aria-label={rowLabel}
      title={thread.repo || ''}
      onClick={() => onSelect(thread.sessionId)}
      onDoubleClick={() => onOpenDetail(thread.sessionId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(thread.sessionId); }
      }}
      className={cn(
        'grid cursor-pointer grid-cols-[14px_1fr] items-start gap-2 border-b border-border border-l-2 border-l-transparent px-6 py-3 hover:bg-panel',
        selected && 'border-l-iris bg-panel2',
      )}
    >
      <span className={cn('mt-[5px] h-[7px] w-[7px] rounded-full', unread ? 'bg-iris' : 'bg-transparent')} aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="flex min-w-0 items-center gap-2">
          <HarnessGlyph harness={harnessOf(thread, byId)} />
          <span className="flex-1 truncate text-[13px] font-semibold text-foreground">{title}</span>
          <span className="flex-none font-mono text-[9.5px] text-ink4">{when}</span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <StateChip state={state} />
          <span className="flex-1 truncate text-[11.5px] text-ink3">{msg}</span>
        </span>
        <span className="truncate font-mono text-[9px] text-ink4">{repoBase(thread, byId)}</span>
      </span>
    </div>
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
