// Small formatting helpers, matching electron/renderer/renderer.js's output
// exactly so numbers/labels are identical between the two renderers.
export function agoTxt(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 0) return 'now';
  const m = Math.floor(ms / 6e4);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function fmtResetClock(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  if (sameDay) return time;
  const dayMs = d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekday = dayMs > 0 && dayMs < 7 * 86400000
    ? d.toLocaleDateString(undefined, { weekday: 'short' })
    : d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  return `${weekday} ${time}`;
}

export function quotaCls(pct: number | null | undefined): string {
  return pct == null ? 'q-na' : pct > 80 ? 'q-red' : pct > 50 ? 'q-amber' : '';
}

export function cleanNarrative(text?: string): string {
  const orig = text == null ? '' : String(text);
  if (!orig) return orig;
  const lines = orig.split('\n');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === '') { i++; continue; }
    if (t === '# Files mentioned by the user:') { i++; continue; }
    if (t[0] === '#') { i++; continue; }
    if (t[0] === '<' && t[t.length - 1] === '>') { i++; continue; }
    break;
  }
  const rest = lines.slice(i).join('\n').trim();
  return rest || orig;
}

export function firstSentence(text?: string): string {
  const clean = cleanNarrative(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const m = clean.match(/^.*?[.?!](?=\s|$)/);
  return (m ? m[0] : clean).trim();
}

export function cwdBase(p?: string): string {
  if (!p) return '';
  const parts = String(p).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

// `variant` names the Chip cva variant (components/ui/chip.tsx) that renders
// this state's hue -- one strict map, DESIGN.md: "Colors are semantic and
// fixed per axis".
export type ChipVariant = 'work' | 'need' | 'block' | 'idle' | 'done' | 'fyi' | 'review' | 'label' | 'label-iris' | 'label-need' | 'label-block' | 'label-done';
export const STATE_META: Record<string, { variant: ChipVariant; label: string }> = {
  work: { variant: 'work', label: 'running' },
  need: { variant: 'need', label: 'needs input' },
  block: { variant: 'block', label: 'blocked' },
  idle: { variant: 'idle', label: 'stalled' },
  done: { variant: 'done', label: 'finished' },
};
