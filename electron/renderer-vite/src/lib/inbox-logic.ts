// Pure inbox derivation logic, matching electron/renderer/inbox.js exactly
// so this renderer's Inbox row anatomy, filtering, and sort behavior are
// identical to the static renderer's (DESIGN.md "Row anatomy" section).
import type { InboxThread, SessionRow, ThreadItem } from './types';
import { firstSentence } from './format';

export const STATE_ORDER: Record<string, number> = { need: 0, block: 1, work: 2, idle: 3, done: 4 };

export function threadItemTs(it: ThreadItem): number {
  return Date.parse(it.ts) || 0;
}

export function threadUnread(t: InboxThread, lastReadTs: Record<string, number>): boolean {
  const last = lastReadTs[t.sessionId] || 0;
  return t.items.some((it) => threadItemTs(it) > last);
}

export function agentFor(t: InboxThread, byId: Map<string, SessionRow>): SessionRow | null {
  return byId.get(t.sessionId) || null;
}

export function displayTitle(t: InboxThread, byId: Map<string, SessionRow>): string {
  const a = agentFor(t, byId);
  if (a) return a.customTitle || a.title || t.sessionId.slice(0, 10);
  return t.title || t.repo || t.sessionId.slice(0, 10);
}

export function harnessOf(t: InboxThread, byId: Map<string, SessionRow>): string {
  const a = agentFor(t, byId);
  return a ? a.harness : t.harness;
}

export function repoBase(t: InboxThread, byId: Map<string, SessionRow>): string {
  const a = agentFor(t, byId);
  const raw = (a && (a.cwd || a.repo)) || t.cwd || t.repo || '';
  const parts = String(raw).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || raw;
}

export function messageToHuman(t: InboxThread): string {
  const items = t.items;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'ask') return firstSentence(it.reason || 'the session is waiting on you');
    if (it.kind === 'ask-interrupted') return firstSentence('a question was interrupted when the app closed');
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'note') return firstSentence(it.message);
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'qa') return firstSentence(it.answer);
  }
  return '';
}

export function threadState(t: InboxThread, byId: Map<string, SessionRow>): string {
  const a = agentFor(t, byId);
  if (a) return a.state;
  const newest = t.items[t.items.length - 1];
  if (!newest) return 'idle';
  if (newest.kind === 'note') return newest.level === 'blocked' ? 'block' : newest.level === 'review' ? 'need' : newest.level === 'done' ? 'done' : 'idle';
  if (newest.kind === 'ask') return newest.level === 'blocked' ? 'block' : 'need';
  if (newest.kind === 'ask-interrupted') return 'block';
  return 'idle';
}

export interface InboxFilter {
  q: string;
  state: string;
  harness: string;
  sort: 'recent' | 'needs-first' | 'alpha';
}

export function visibleThreads(threads: InboxThread[], byId: Map<string, SessionRow>, filter: InboxFilter): InboxThread[] {
  let list = threads.slice();
  const q = filter.q.trim().toLowerCase();
  if (q) list = list.filter((t) => (displayTitle(t, byId) + ' ' + (t.repo || '') + ' ' + messageToHuman(t)).toLowerCase().includes(q));
  if (filter.state) list = list.filter((t) => threadState(t, byId) === filter.state);
  if (filter.harness) list = list.filter((t) => harnessOf(t, byId) === filter.harness);
  const cmp: Record<string, (x: InboxThread, y: InboxThread) => number> = {
    recent: (x, y) => (Date.parse(y.lastTs) || 0) - (Date.parse(x.lastTs) || 0),
    'needs-first': (x, y) => (STATE_ORDER[threadState(x, byId)] - STATE_ORDER[threadState(y, byId)]) || ((Date.parse(y.lastTs) || 0) - (Date.parse(x.lastTs) || 0)),
    alpha: (x, y) => displayTitle(x, byId).localeCompare(displayTitle(y, byId)),
  };
  return list.sort(cmp[filter.sort] || cmp.recent);
}
