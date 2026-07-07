// Small formatting helpers for numbers/labels shown throughout the renderer.
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

// Ported verbatim from the deleted static renderer (renderer.js's fmtTok /
// fmtUSD): compact token counts (1.2M, 240k) and compact USD (rounds past
// $10, "k" past $1000) for the Metrics/Settings stat rows.
export function fmtTok(n: number | null | undefined): string {
  const v = n || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

export function fmtUSD(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 10) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

// Quota window length as a short cadence word ("5h", "weekly"), ported from
// renderer.js's fmtCadence.
export function fmtCadence(mins?: number): string {
  if (!mins) return '';
  if (mins % 10080 === 0) return mins === 10080 ? 'weekly' : `${mins / 10080}w`;
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
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
