'use strict';

// humanctl renderer :: shell v2 (the Great Subtraction).
// An attention router for one human running many coding-agent sessions. Every
// decision routes the human to the next bounded decision with the least noise.
// See DESIGN.md (repo root) for the one-owner signal rule this shell enforces.
//
// The shell is a hidden nav rail + one active view (Inbox default, plus
// Metrics/Fleet placeholders, Sessions, Settings) + a summonable Atlas drawer.
// Opening any session from any view shows the full-width session detail with a
// back breadcrumb; Esc returns. Read-only over real local data via
// window.humanctl; no bridge (plain browser) falls back to synthetic fixtures
// and a "demo" badge. Only real signals: where a datum is null, degrade
// gracefully, never fabricate.

// ---------- tiny utils ----------
const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
// hue() runs per row; getComputedStyle forces a style recalc each call, so
// memoize resolved values. Cleared whenever the theme changes.
let hueCache = Object.create(null);
function clearHueCache() { hueCache = Object.create(null); }
function hue(varRef) {
  const name = String(varRef).replace(/var\(|\)/g, '').trim();
  let v = hueCache[name];
  if (v === undefined) { v = cssv(name) || '#888'; hueCache[name] = v; }
  return v;
}

const fmtTok = (n) => { n = n || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)); };
const fmtUSD = (n) => { if (n == null) return null; return n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'k' : n >= 10 ? '$' + n.toFixed(0) : '$' + n.toFixed(2); };
const fmtReset = (ts) => { if (!ts) return ''; const ms = ts * 1000 - Date.now(); if (ms <= 0) return 'now'; const h = ms / 3.6e6; return h < 1 ? Math.round(h * 60) + 'm' : h < 48 ? h.toFixed(0) + 'h' : (h / 24).toFixed(0) + 'd'; };

// DISPLAY-ONLY narrative cleaner. Codex user messages often begin with wrapper
// boilerplate ("# Files mentioned by the user:", markdown-comment/heading
// lines, or <...> wrappers) that leaks into titles. Strip leading boilerplate
// and fall through to the first meaningful line. Never mutates stored data.
function cleanNarrative(text) {
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
// First sentence of a message-to-the-human, one line, for row line 2.
function firstSentence(text) {
  const clean = cleanNarrative(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const m = clean.match(/^.*?[.?!](?=\s|$)/);
  return (m ? m[0] : clean).trim();
}

// ---------- state model (reader-derived; renderer only overlays notes) ----------
const STATE = {
  work: { cls: 'c-work', label: 'running', hue: 'var(--s-work)' },
  need: { cls: 'c-need', label: 'needs input', hue: 'var(--s-need)' },
  block: { cls: 'c-block', label: 'blocked', hue: 'var(--s-block)' },
  idle: { cls: 'c-idle', label: 'stalled', hue: 'var(--s-idle)' },
  done: { cls: 'c-done', label: 'finished', hue: 'var(--s-done)' },
};
const GROUPS = [
  { k: 'need', label: 'Needs input' },
  { k: 'block', label: 'Blocked' },
  { k: 'work', label: 'Running' },
  { k: 'idle', label: 'Stalled' },
  { k: 'done', label: 'Finished' },
];
// State and tier are computed by the reader (lib/sessions.js) from the tail
// CONTENT of each transcript: needs-you means the final assistant message is
// question- or decision-shaped, or the session was interrupted; the attention
// tier (hot / drifting / archived) ages by the last substantive message. The
// reader owns all time constants; the renderer consumes row.state /
// row.stateReason / row.tier and only overlays notes on top. See
// docs/desktop.md ("State model").
const TIERS = {
  hot: { cls: '', label: '' },
  drifting: { cls: 'drift', label: 'drifting' },
  archived: { cls: 'archived', label: 'archived' },
};
// A done note usually lands moments before the agent's final transcript write,
// so allow that much clock skew when deciding whether the note postdates the
// session's last activity.
const DONE_NOTE_SLACK_MS = 10 * 60 * 1000;

// context-map kind constants
const KIND_ORDER = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'];
const KIND_LABEL = { user: 'you', assistant: 'agent', thinking: 'thinking', 'tool-call': 'tool call', 'tool-result': 'tool result', meta: 'system' };

// ============================================================
// SVG metric helpers
// ============================================================
function svgRing(pct, color, size) {
  size = size || 46; pct = clamp(pct || 0, 0, 100);
  const r = size / 2 - 3, c = 2 * Math.PI * r, off = c * (1 - pct / 100), ct = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
    + `<circle cx="${ct}" cy="${ct}" r="${r}" fill="none" stroke="var(--rule2)" stroke-width="4.5"/>`
    + `<circle cx="${ct}" cy="${ct}" r="${r}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"`
    + ` stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${ct} ${ct})"/></svg>`;
}
function svgBar(pct, color, w, h) {
  w = w || 60; h = h || 5; pct = clamp(pct || 0, 0, 100);
  const fw = Math.max(2, w * pct / 100);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">`
    + `<rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="var(--rule2)"/>`
    + `<rect x="0" y="0" width="${fw.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${color}"/></svg>`;
}

// ============================================================
// Identity: deterministic display name from the session id hash + a NEUTRAL
// built-in harness glyph. Harness identity is conveyed by GLYPH SHAPE, never
// vendor art and never color (DESIGN.md: "Harness identity is conveyed by
// icon, never by color"). Two glyphs only in PR-1: claude and codex. Runtime
// icon extraction is PR-2 scope and deliberately absent here.
const NAMES = [
  'Goodall', 'Leibniz', 'Curie', 'Turing', 'Hopper', 'Lovelace', 'Feynman', 'Darwin',
  'Bohr', 'Noether', 'Franklin', 'Hodgkin', 'Ramanujan', 'Euler', 'Gauss', 'Hypatia',
  'Kepler', 'Faraday', 'Maxwell', 'Pauling', 'Dirac', 'Fermi', 'Planck', 'Hawking',
  'Mendel', 'Pasteur', 'Lamarr', 'Tesla', 'Babbage', 'Shannon', 'Knuth', 'Dijkstra',
  'Ritchie', 'Thompson', 'Torvalds', 'Hamilton', 'Johnson', 'Meitner', 'Rubin', 'Tharp',
  'Carson', 'Wu', 'Yalow', 'Elion', 'McClintock', 'Ochoa', 'Cori', 'Boole',
  'Cauchy', 'Riemann', 'Poincare', 'Galois', 'Fibonacci', 'Nightingale', 'Somerville', 'Germain',
  'Cajal', 'Fleming', 'Pauli', 'Heisenberg', 'Schrodinger', 'Wigner', 'Chandrasekhar', 'Sagan',
];
// Two neutral built-in glyphs. Solid disc for claude, hollow ring for codex.
// Distinguished by shape, so they read the same in light and dark and carry no
// vendor branding. Rendered as an inline mark, colored by the harness hue only
// for a faint accent, not to encode identity.
function harnessGlyph(harness) {
  const codex = harness === 'codex';
  return `<span class="hglyph ${codex ? 'g-codex' : 'g-claude'}" aria-hidden="true">${codex ? '◯' : '◉'}</span>`;
}
function hashU(str) {
  let h = 2166136261 >>> 0;
  str = String(str || '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function modNN(x, len) { return (((x % len) + len) % len); }
function identity(id) {
  const h = hashU(id);
  const name = NAMES[modNN(h >>> 0, NAMES.length)] || 'Agent';
  const tag = ('0000000' + h.toString(16)).slice(-2);
  return { name, tag };
}

// ============================================================
// Row -> agent model
// ============================================================
function normModel(m) {
  const s = String(m || '').toLowerCase();
  if (!s) return null;
  if (/claude-opus|opus/.test(s)) return 'opus';
  if (/sonnet/.test(s)) return 'sonnet';
  if (/haiku/.test(s)) return 'haiku';
  if (/gpt-5|gpt5/.test(s)) return 'gpt-5';
  return String(m).trim();
}
function deriveState(row, notes) {
  const tier = TIERS[row.tier] ? row.tier : 'hot';
  const n = notes.filter((x) => x.session && x.session === row.id);
  const latestTs = (lvl) => n.reduce((m, x) => (x.level === lvl ? Math.max(m, Date.parse(x.ts) || 0) : m), 0);
  const doneTs = latestTs('done');
  if (doneTs && doneTs >= row.ageMs - DONE_NOTE_SLACK_MS
    && doneTs >= latestTs('blocked') && doneTs >= latestTs('review')) return { state: 'done', reason: 'note: done', tier };
  if (n.some((x) => x.level === 'blocked')) return { state: 'block', reason: 'note: blocked', tier };
  if (n.some((x) => x.level === 'review')) return { state: 'need', reason: 'note: review', tier };
  if (n.some((x) => x.level === 'done')) return { state: 'done', reason: 'note: done', tier };
  return { state: STATE[row.state] ? row.state : 'idle', reason: row.stateReason || '', tier };
}
function mapAgent(row, notes) {
  const idn = identity(row.id);
  const { state, reason, tier } = deriveState(row, notes);
  const sum = summaries.get(row.id) || null;
  const promptNarr = cleanNarrative(row.lastUser || row.title || row.prevAgent || '(no recent prompt)');
  const cost = row.costUSD != null ? row.costUSD : (row.apiEquivUSD != null ? row.apiEquivUSD : null);
  const renamed = (row.customTitle || '').trim();
  return {
    id: row.id,
    harness: row.harness,
    harnessLabel: row.harness === 'codex' ? 'codex' : 'claude',
    harnessCls: row.harness === 'codex' ? 'c-codex' : 'c-claude',
    name: renamed || idn.name, tag: idn.tag, titled: !!renamed,
    state, stateReason: reason, tier,
    promptNarr,
    summary: sum,
    aiNarr: !!sum,
    repo: row.repo || '',
    model: normModel(row.model),
    effort: row.reasoningEffort || null,
    ultracode: !!row.ultracode,
    ctxPct: (row.contextPct != null ? row.contextPct : null),
    cost,
    when: row.age || '',
    ageMs: row.ageMs,
    createdMs: row.createdMs != null ? row.createdMs : (row.lastActiveMs || row.ageMs),
    path: row.path,
    cwd: row.cwd || '',
    lastUser: row.lastUser || '',
    prevAgent: row.prevAgent || '',
    row,
  };
}

// disambiguate display names within the CURRENT visible fleet: when >=2 agents
// resolve to the same base name, assign a positional suffix after sorting the
// colliding group by id (deterministic + unique).
function computeDisplayNames(list) {
  const groups = {};
  for (const a of list) { a.dupe = false; (groups[a.name] || (groups[a.name] = [])).push(a); }
  for (const name in groups) {
    const g = groups[name];
    if (g.length < 2) { g[0].dupe = false; continue; }
    g.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    g.forEach((a, i) => { a.dupe = true; a.tag = String(i + 1); });
  }
}
function displayName(a) { return a.name + (a.dupe ? ' ' + a.tag : ''); }
function stateTip(a) {
  const parts = [STATE[a.state].label];
  if (a.stateReason) parts.push(a.stateReason);
  if (a.tier !== 'hot') parts.push(TIERS[a.tier].label + (a.tier === 'drifting' ? ' (idle 24h to 7d)' : ' (idle over 7d)'));
  return parts.join(' · ');
}
function nameHtml(a) {
  return esc(a.name) + (a.dupe ? `<span class="idtag">${esc(a.tag)}</span>` : '');
}

// The three-line row anatomy shared by Inbox threads and Sessions rows
// (DESIGN.md "Row anatomy"). No PR chips in PR-1 (PR-2). No avatars, no context
// bars. Line 2 is the message-to-the-human, first sentence only.
//   line 1: harness glyph + title + unread dot + time ladder
//   line 2: state chip + message to the human (ask excerpt > note > completion)
//   line 3: dir basename only
function timeLadder(a) { return esc(a.when || ''); }
function cwdBase(cwd) {
  if (!cwd) return '';
  const parts = String(cwd).replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || cwd;
}

// ============================================================
// live state
// ============================================================
let agents = [];
let byId = new Map();
let allRows = [], status = null, allNotes = [], demo = false;
// View replaces the old three modes. inbox is the default; metrics/fleet are
// quiet placeholder views (0.16 / 0.17); sessions replaces the old Wall;
// settings is a real view now (the old header gear popover is gone).
let view = 'inbox';           // inbox | metrics | fleet | sessions | settings
let navPinned = false;        // Cmd+\ pins the nav rail as a fixed column
let detailId = null;          // when set, the full-width session detail is showing (over the calling view)
let detailFrom = 'inbox';     // which view Esc/back returns to
let selId = null;             // the selected session (drives detail + Atlas queue highlight)
let theme = 'dark';           // dark | light
let pins = new Set();
let summarizer = 'claude';    // claude | codex: which local CLI powers AI summary
let lastReadTs = {};          // threadId -> ms, from state.json
// per-harness resume destination: 'terminal' (default) or 'app' (deep link).
let openPref = { 'claude-code': 'terminal', codex: 'terminal' };

// The app destination is only offered when the OS reports a real handler for
// the harness's deep-link scheme (status.apps, probed in the main process).
function appAvailable(harness) {
  if (demo) return true;
  const key = harness === 'codex' ? 'codex' : 'claude';
  return !!(status && status.apps && status.apps[key]);
}
function resumeActs(a) {
  const term = { act: 'resume-term', label: 'Resume in terminal' };
  if (!appAvailable(a.harness)) return { primary: term, secondary: null };
  const app = { act: 'resume-app', label: a.harness === 'codex' ? 'Open in Codex app' : 'Resume in Claude app' };
  return openPref[a.harness] === 'app' ? { primary: app, secondary: term } : { primary: term, secondary: app };
}
// The Resume split-button label (harness-aware) for the detail header.
function resumeLabel(a) {
  const ra = resumeActs(a);
  return a.harness === 'codex' ? 'Resume in Codex' : 'Resume in Claude';
}

// per-agent readSession detail cache (real signals only)
const detailCache = new Map();  // id -> {data, usage, detail} | 'loading' | 'error'

// Live timeline for the watched session: a bounded page of substantive events
// plus cursor-fed appends pushed by the main process for the ONE hot session.
// Every truncation is an explicit element; a spliced timeline is never rendered
// as complete. Events are stored in file order (oldest first).
const tlState = new Map();
const TL_STATE_CAP = 12;
const TL_EVENTS_CAP = 600;
function tlRemember(id, v) {
  tlState.delete(id); tlState.set(id, v);
  while (tlState.size > TL_STATE_CAP) tlState.delete(tlState.keys().next().value);
}
function lastEventTs(evs) {
  for (let i = (evs || []).length - 1; i >= 0; i--) if (evs[i].ts != null) return evs[i].ts;
  return null;
}
async function ensureTimeline(a) {
  const have = tlState.get(a.id);
  if (have && (have.events || have.loading)) {
    if (have.events && !have.capped && Number.isFinite(have.end) && window.humanctl) {
      window.humanctl.setHotSession({ path: a.path, harness: a.harness, from: have.end });
      have.live = true;
    }
    return;
  }
  const mark = { loading: true };
  tlRemember(a.id, mark);
  const fin = (page, err) => {
    if (tlState.get(a.id) !== mark) return;
    if (!page) { tlRemember(a.id, { error: err || 'could not read this session.' }); return; }
    tlRemember(a.id, {
      events: page.events || [], start: page.start, end: page.end, atStart: !!page.atStart,
      estEarlier: page.estEarlier, size: page.size,
      lastAt: lastEventTs(page.events) || page.mtimeMs || Date.now(),
      live: false, capped: false,
    });
  };
  if (!window.humanctl) {
    setTimeout(() => {
      fin(fixtureTimeline(a.row));
      const tl = tlState.get(a.id);
      if (tl && tl.events) { tl.live = true; tl.lastAt = Date.now() - 4000; }
      repaintTimeline(a.id);
    }, 0);
    return;
  }
  try {
    const r = await window.humanctl.readTimeline({ path: a.path, harness: a.harness });
    fin(r && r.ok ? r.page : null, r && r.error);
    if (r && r.ok && r.page) {
      await window.humanctl.setHotSession({ path: a.path, harness: a.harness, from: r.page.end });
      const tl = tlState.get(a.id);
      if (tl && tl.events) tl.live = true;
    }
  } catch (e) { fin(null, String((e && e.message) || e)); }
  repaintTimeline(a.id);
}
async function loadOlderTimeline(a) {
  const tl = tlState.get(a.id);
  if (!tl || !tl.events || tl.loadingOlder || tl.atStart) return;
  if (tl.capped || !Number.isFinite(tl.start)) { tlState.delete(a.id); ensureTimeline(a); return; }
  tl.loadingOlder = true;
  repaintTimeline(a.id);
  const done = (page, err) => {
    tl.loadingOlder = false;
    if (page) {
      const older = page.events || [];
      if (older.length && tl.events.length && older[older.length - 1].k === 'tools' && tl.events[0].k === 'tools') {
        tl.events[0].n += older[older.length - 1].n;
        older.pop();
      }
      tl.events = older.concat(tl.events);
      tl.start = page.start; tl.atStart = !!page.atStart; tl.estEarlier = page.estEarlier;
    } else if (err) toast('could not load earlier events: ' + err);
    repaintTimeline(a.id);
  };
  if (!window.humanctl) { setTimeout(() => done(fixtureOlderTimeline(a.row)), 350); return; }
  try {
    const r = await window.humanctl.readTimeline({ path: a.path, harness: a.harness, before: tl.start });
    done(r && r.ok ? r.page : null, r && !r.ok ? r.error : null);
  } catch (e) { done(null, String((e && e.message) || e)); }
}
function onSessionAppend(p) {
  const a = byId.get(selId);
  if (!a || !p || p.path !== a.path) return;
  if (p.reset) { tlState.delete(a.id); ensureTimeline(a); return; }
  const tl = tlState.get(a.id);
  if (!tl || !tl.events) return;
  for (const e of (p.events || [])) {
    const last = tl.events[tl.events.length - 1];
    if (e.k === 'tools' && last && last.k === 'tools') { last.n += e.n; if (e.ts != null) last.ts = e.ts; }
    else tl.events.push(e);
  }
  if (tl.events.length > TL_EVENTS_CAP) {
    tl.events.splice(0, tl.events.length - TL_EVENTS_CAP);
    tl.capped = true; tl.atStart = false; tl.estEarlier = null;
  }
  if (typeof p.end === 'number') tl.end = p.end;
  if (typeof p.size === 'number') tl.size = p.size;
  tl.lastAt = p.at || Date.now();
  tl.live = true;
  if (p.meta && p.meta.customTitle) a.row.customTitle = p.meta.customTitle;
  if (p.need && STATE[p.need.state]) {
    a.row.state = p.need.state; a.row.stateReason = p.need.reason; a.row.tier = p.need.tier;
    const d = deriveState(a.row, allNotes);
    a.state = d.state; a.stateReason = d.reason; a.tier = d.tier;
  }
  repaintTimeline(a.id);
}
// Repaint only the timeline body: a streaming session must never clobber the
// ask input or the rest of the detail mid-typing.
function repaintTimeline(id) {
  if (detailId !== id) return;
  const a = byId.get(id);
  const d = detailCache.get(id);
  if (a && d && d !== 'loading' && d !== 'error') {
    const body = el('tlBody');
    if (body) { body.innerHTML = timelineHtml(a, d); bindTimeline(body, a, d); }
  }
}
function agoShort(at) {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return s + 's ago';
  return agoTxt(at);
}
function liveIndicatorText(a) {
  const tl = tlState.get(a.id);
  if (!tl || !tl.events || !tl.lastAt) return '';
  return (tl.live ? 'live · ' : '') + 'updated ' + agoShort(tl.lastAt);
}
// The single live-indicator ticker (declared cadence: 1s, cosmetic label only,
// no data fetch, no self-triggered refresh). Updates the detail header + the
// timeline live chip in place; does nothing when no detail is open.
setInterval(() => {
  const a = detailId ? byId.get(detailId) : null;
  if (!a) return;
  const live = liveIndicatorText(a);
  const tlv = el('tlLive');
  if (tlv) tlv.textContent = live;
  const dl = el('detailLive');
  if (dl) dl.textContent = live;
}, 1000);

// Opt-in AI summaries. Each entry is {text, engine, at}; persisted via setState.
const summaries = new Map();
const sumState = new Map();
const SUM_CAP = 60;
function rememberSummary(id, entry) {
  summaries.delete(id); summaries.set(id, entry);
  if (summaries.size > SUM_CAP) summaries.delete(summaries.keys().next().value);
  if (window.humanctl) window.humanctl.setState({ summaries: Object.fromEntries(summaries) });
}
function hydrateSummaries(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [id, v] of Object.entries(obj)) {
    if (v && typeof v.text === 'string' && v.text) {
      summaries.set(id, { text: v.text, engine: v.engine === 'codex' ? 'codex' : 'claude', at: +v.at || 0 });
    }
  }
}
function agoTxt(at) {
  if (!at) return '';
  const m = (Date.now() - at) / 6e4;
  if (m < 1) return 'just now';
  if (m < 60) return Math.round(m) + 'm ago';
  if (m < 48 * 60) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}

// Ask the session (persisted like summaries, capped). Codex asks are
// append-mode (the question is written into the real thread), so the first use
// shows a one-line disclosure whose acknowledgement persists as askCodexAck.
const asks = new Map();
const askState = new Map();
const askDraft = new Map();
const askPending = new Map();
const askRuns = new Map();
let askAck = false;
const ASK_XCAP = 20;
const ASK_SCAP = 40;
const ASK_QUICK = ['Status?', 'What do you need from me?', 'Summarize this thread'];
function rememberAsk(id, entry) {
  const list = asks.get(id) || [];
  list.push({ q: String(entry.q).slice(0, 500), a: String(entry.a).slice(0, 2000), engine: entry.engine, at: entry.at });
  while (list.length > ASK_XCAP) list.shift();
  asks.delete(id); asks.set(id, list);
  while (asks.size > ASK_SCAP) asks.delete(asks.keys().next().value);
  if (window.humanctl) window.humanctl.setState({ asks: Object.fromEntries(asks) });
}
function hydrateAsks(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [id, list] of Object.entries(obj)) {
    if (!Array.isArray(list)) continue;
    const clean = list
      .filter((x) => x && typeof x.q === 'string' && x.q && typeof x.a === 'string' && x.a)
      .map((x) => ({ q: x.q, a: x.a, engine: x.engine === 'codex' ? 'codex' : 'claude', at: +x.at || 0 }))
      .slice(-ASK_XCAP);
    if (clean.length) asks.set(id, clean);
  }
}

// ============================================================
// SYNTHETIC FIXTURE (OSS-safe; only when window.humanctl is absent). Clean,
// non-real ids + generic repos. Never real data. Covers every content shape the
// v3 state model can emit plus note overlays. Rows arrive pre-sorted the way
// the reader sorts: tier, needs-you first, depth, recency.
// ============================================================
const FIXTURE_ROWS = [
  { harness: 'claude-code', id: 'fixture-a1a1a1a1', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Wire the multi-source update spine', customTitle: 'Multi-source spine, renderer wiring pass', lastRole: 'assistant', state: 'need', stateReason: 'asks you a question', tier: 'hot', age: '2m', ageMs: Date.now() - 2 * 6e4, createdMs: Date.now() - 90 * 6e4, contextPct: 63, costUSD: 2.14, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: true, lastUser: 'wire the update spine into the renderer', prevAgent: 'Spine is wired. Should the watcher debounce at 2s or 5s?' },
  { harness: 'codex', id: 'rollout-fixture-b2b2', repo: '~/demo/core', cwd: '~/demo/core', title: 'Choose the rename-persistence path', lastRole: 'assistant', state: 'need', stateReason: 'awaiting your go-ahead', tier: 'hot', age: '6m', ageMs: Date.now() - 6 * 6e4, createdMs: Date.now() - 120 * 6e4, contextPct: 22, apiEquivUSD: 0.88, model: 'gpt-5.5', reasoningEffort: 'xhigh', ultracode: false, lastUser: 'which rename-persistence path should we trust?', prevAgent: 'Both paths verified; say the word and I take path B.' },
  { harness: 'claude-code', id: 'fixture-h8h8h8h8', repo: '~/demo/exports', cwd: '~/demo/exports', title: 'Backfill the export manifest', lastRole: 'user', state: 'need', stateReason: 'you interrupted; only you can resume', tier: 'hot', age: '18m', ageMs: Date.now() - 18 * 6e4, createdMs: Date.now() - 60 * 6e4, contextPct: 31, costUSD: 0.66, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'wait, hold off on the manifest rewrite', prevAgent: 'Starting the manifest rewrite now.' },
  { harness: 'codex', id: 'rollout-fixture-c9c9', repo: '~/demo/ledger', cwd: '~/demo/ledger', title: 'Reconcile the ledger deltas', lastRole: 'user', state: 'need', stateReason: 'your reply was never picked up', tier: 'hot', age: '3h', ageMs: Date.now() - 3 * 3.6e6, createdMs: Date.now() - 5 * 3.6e6, contextPct: 44, apiEquivUSD: 1.12, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'yes please, run the reconcile pass', prevAgent: 'Deltas mapped; ready to reconcile on your word.' },
  { harness: 'claude-code', id: 'fixture-c3c3c3c3', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Pull the activity feed', customTitle: 'Activity feed adapter', lastRole: 'assistant', state: 'work', stateReason: 'progress report, still fresh', tier: 'hot', age: '11m', ageMs: Date.now() - 11 * 6e4, createdMs: Date.now() - 40 * 6e4, contextPct: 38, costUSD: 1.02, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: 'retry the activity pull', prevAgent: 'The activity adapter is built; PR is up.' },
  { harness: 'codex', id: 'rollout-fixture-d4d4', repo: '~/demo/tokens', cwd: '~/demo/tokens', title: 'Rotate the activity token', lastRole: 'user', state: 'work', stateReason: 'your turn was picked up', tier: 'hot', age: '9m', ageMs: Date.now() - 9 * 6e4, createdMs: Date.now() - 30 * 6e4, contextPct: 55, apiEquivUSD: 0.63, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'rotate it and rerun the smoke test', prevAgent: 'Token rotation staged.' },
  { harness: 'codex', id: 'rollout-fixture-e5e5', repo: '~/demo/ledger', cwd: '~/demo/ledger', title: 'Backfill the ledger', lastRole: 'user', state: 'work', stateReason: 'tools in flight', tier: 'hot', age: '1m', ageMs: Date.now() - 1 * 6e4, createdMs: Date.now() - 20 * 6e4, contextPct: 58, apiEquivUSD: 0.41, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'keep backfilling the ledger', prevAgent: 'At 147 of 188 rows.' },
  { harness: 'claude-code', id: 'fixture-e5e5e5e5', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Extract the sparkline component', lastRole: 'user', state: 'work', stateReason: 'your turn was picked up', tier: 'hot', age: '3m', ageMs: Date.now() - 3 * 6e4, createdMs: Date.now() - 25 * 6e4, contextPct: 48, costUSD: 0.74, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'extract Spark into a shared component', prevAgent: 'Created the component shell.' },
  { harness: 'claude-code', id: 'fixture-f6f6f6f6', repo: '~/demo/hygiene', cwd: '~/demo/hygiene', title: 'OSS hygiene sweep', lastRole: 'assistant', state: 'done', stateReason: 'reports completion, no ask', tier: 'hot', age: '24m', ageMs: Date.now() - 24 * 6e4, createdMs: Date.now() - 80 * 6e4, contextPct: 12, costUSD: 3.40, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: '', prevAgent: 'Swept history; merged and shipped, checks are green.' },
  { harness: 'codex', id: 'rollout-fixture-g7g7', repo: '~/demo/icons', cwd: '~/demo/icons', title: 'Draft the squircle icons', lastRole: 'assistant', state: 'idle', stateReason: 'ended without an ask', tier: 'hot', age: '5h', ageMs: Date.now() - 5 * 3.6e6, createdMs: Date.now() - 8 * 3.6e6, contextPct: 8, apiEquivUSD: 0.20, model: 'gpt-5.5', reasoningEffort: 'low', ultracode: false, lastUser: '', prevAgent: 'Drafted the squircle variants.' },
  { harness: 'claude-code', id: 'fixture-i9i9i9i9', repo: '~/demo/profiler', cwd: '~/demo/profiler', title: 'Spike the profiler wiring', lastRole: 'assistant', state: 'need', stateReason: 'asks you a question', tier: 'drifting', age: '2d', ageMs: Date.now() - 49 * 3.6e6, createdMs: Date.now() - 52 * 3.6e6, contextPct: 41, costUSD: 1.90, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'spike the profiler wiring', prevAgent: 'Spike is parked. Keep the sampling hook or drop it?' },
  { harness: 'claude-code', id: 'fixture-j0j0j0j0', repo: '~/demo/attic', cwd: '~/demo/attic', title: 'Migrate the icon pipeline', lastRole: 'assistant', state: 'need', stateReason: 'ready for your review', tier: 'archived', age: '9d', ageMs: Date.now() - 9 * 24 * 3.6e6, createdMs: Date.now() - 10 * 24 * 3.6e6, contextPct: 17, costUSD: 0.95, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'migrate the icon pipeline', prevAgent: 'Pipeline PR is ready for your review.' },
];
function fixtureStatus() {
  const now = Math.floor(Date.now() / 1000);
  return {
    per: {
      codex: { sessions: 5, generated: 240000, totalTokens: 5e6, apiEquivUSD: 1.71 },
      'claude-code': { sessions: 7, generated: 180000, totalTokens: 3.2e6, costUSD: 7.30 },
    },
    codexQuota: { plan_type: 'pro', primary: { used_percent: 46, resets_at: now + 36 * 60 }, secondary: { used_percent: 71, resets_at: now + 5 * 86400 } },
    needsYou: 5, working: 4, nearCompaction: 1, sessions: 12, pricingAsOf: '2026-06',
    generatedAt: new Date().toISOString(),
  };
}
const FIXTURE_NOTES = [
  { id: 'fn1', ts: new Date(Date.now() - 4 * 6e4).toISOString(), level: 'review', message: 'PR is up for the activity feed; needs a review + merge.', repo: 'renderer', session: 'fixture-c3c3c3c3' },
  { id: 'fn2', ts: new Date(Date.now() - 7 * 6e4).toISOString(), level: 'blocked', message: 'Blocked: the activity token is missing from the environment.', repo: 'tokens', session: 'rollout-fixture-d4d4' },
  { id: 'fn3', ts: new Date(Date.now() - 22 * 6e4).toISOString(), level: 'fyi', message: 'Ledger backfill is on track; no action needed.', repo: 'ledger', session: 'rollout-fixture-e5e5' },
  { id: 'fn4', ts: new Date(Date.now() - 26 * 6e4).toISOString(), level: 'done', message: 'Hygiene sweep landed; checks are green.', repo: 'hygiene', session: 'fixture-f6f6f6f6' },
];
function fixtureRead(row) {
  const pat = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'tool-call', 'tool-result', 'assistant'];
  const seed = (row.id || '').length + (row.repo || '').length;
  const blocks = []; const n = 90 + (seed % 40);
  for (let i = 0; i < n; i++) {
    const kind = i === 0 ? 'meta' : pat[i % pat.length];
    const base = { user: 60, assistant: 120, thinking: 200, 'tool-call': 40, 'tool-result': 320, meta: 700 }[kind];
    blocks.push({ kind, tokens: base + ((i * 37 + seed) % 90), preview: KIND_LABEL[kind] + ' content sample ' + i });
  }
  const usage = row.harness === 'codex'
    ? { model: row.model, apiEquivUSD: row.apiEquivUSD, contextPct: row.contextPct, tokens: { output: 41000, reasoning: 22000, total: 4.16e6 } }
    : { model: row.model, costUSD: row.costUSD, contextPct: row.contextPct, tokens: { output: 38000, total: 2.7e6 } };
  const detail = {
    lastExchange: { lastUser: row.lastUser, prevAgent: row.prevAgent },
    linearRefs: row.harness === 'codex' ? [{ url: 'https://linear.app/demo/issue/DEMO-412', label: 'DEMO-412' }] : [],
    htmlFiles: row.repo.includes('ledger') ? ['/demo/ledger/rollup.html'] : [],
    skillsUsed: row.harness === 'claude-code' ? { 'shared-kit': 2, 'render-spine': 1 } : {},
    skillCount: row.harness === 'claude-code' ? 3 : 0,
    reasoningEffort: row.reasoningEffort, model: row.model, ultracode: row.ultracode,
  };
  return { ok: true, data: { blocks, truncated: false }, usage, detail };
}
function fixtureTimeline(row) {
  const seed = hashU(row.id);
  const n = 12 + (seed % 5);
  const events = [];
  let ts = Date.now() - n * 4 * 6e4;
  for (let i = 0; i < n; i++) {
    const pick = (seed + i) % 4;
    if (pick === 0) events.push({ k: 'user', t: `demo instruction ${i + 1} for ${row.repo || 'the demo repo'}`, ts });
    else if (pick === 3) events.push({ k: 'assistant', t: `demo progress report ${i + 1}: the step landed cleanly, moving on.`, ts });
    else events.push({ k: 'tools', n: 2 + ((seed + i) % 6), ts });
    ts += 4 * 6e4;
  }
  return { events, start: 4096, end: 262144, size: 262144, atStart: false, estEarlier: 18 + (seed % 20), mtimeMs: Date.now() - 90000 };
}
function fixtureOlderTimeline(row) {
  const seed = hashU(row.id);
  const events = [];
  let ts = Date.now() - 4 * 3.6e6;
  for (let i = 0; i < 7; i++) {
    const pick = (seed + i) % 3;
    if (pick === 0) events.push({ k: 'user', t: `earlier demo instruction ${i + 1}`, ts });
    else if (pick === 1) events.push({ k: 'assistant', t: `earlier demo report ${i + 1}`, ts });
    else events.push({ k: 'tools', n: 1 + ((seed + i) % 4), ts });
    ts += 6e4;
  }
  return { events, start: 0, end: 4096, size: 262144, atStart: true, estEarlier: 0 };
}

// ============================================================
// derived rollups (from real status + agents)
// ============================================================
const onDesk = () => agents.filter((a) => a.tier !== 'archived');
function rollups() {
  const per = (status && status.per) || {};
  const cl = per['claude-code'] || {};
  const cx = per.codex || {};
  const desk = onDesk();
  const needsYou = (status && status.needsYou != null) ? status.needsYou : desk.filter((a) => a.state === 'need' || a.state === 'block').length;
  const working = (status && status.working != null) ? status.working : desk.filter((a) => a.state === 'work').length;
  const idle = desk.filter((a) => a.state === 'idle').length;
  const totalTokens = (cl.totalTokens || 0) + (cx.totalTokens || 0);
  return {
    needsYou, working, idle,
    claudeUSD: cl.costUSD != null ? cl.costUSD : null,
    codexUSD: cx.apiEquivUSD != null ? cx.apiEquivUSD : null,
    tokens: totalTokens,
    quota: (status && status.codexQuota) || null,
  };
}

// ============================================================
// FLEET DIGEST (one owner: the header). DESIGN.md signal-ownership table:
// "Fleet digest (counts) | header | Atlas drawer reuses the same component."
// This is the single digest renderer; the Atlas drawer calls digestHtml() too.
// ============================================================
function digestData() {
  const desk = onDesk();
  const b = { need: 0, block: 0, work: 0, idle: 0, done: 0 };
  for (const a of desk) b[a.state]++;
  return { b, needYou: b.need + b.block, desk };
}
function digestHtml() {
  const { b, needYou, desk } = digestData();
  const need = desk.filter((a) => a.state === 'need' || a.state === 'block');
  let tail = '';
  if (need.length) {
    const top = need.slice(0, 2);
    if (top.length >= 2 && top[0].name === top[1].name) {
      tail = ` ${need.length} sessions are waiting on you.`;
    } else {
      const names = top.map((a) => displayName(a)).join(' and ');
      tail = ` ${names}${need.length > 2 ? ' and others are' : (need.length === 1 ? ' is' : ' are')} waiting on you.`;
    }
  } else if (b.work) {
    tail = ' All moving, none blocked on you.';
  }
  let digest = `<b>${needYou} need you</b>, ${b.work} moving, ${b.idle} idle`;
  if (b.done) digest += `, ${b.done} done`;
  return `${digest}.${esc(tail)}`;
}

// ============================================================
// HEADER (shared, never swaps). Owns: brand, fleet digest, the needs-you hero,
// and the quota chip (rendered ONLY above 80% per DESIGN.md), plus the Atlas
// summon button and theme toggle. Fleet totals no longer live in the header;
// their one home is the Metrics view / Atlas drawer (DESIGN.md), so the header
// stays a routing surface, not a second metrics home.
// ============================================================
function renderHeader() {
  const r = rollups();
  const { needYou, desk } = digestData();
  el('digest').innerHTML = digestHtml();
  el('heroNum').textContent = needYou;
  const denom = desk.length || 1;
  el('heroShape').innerHTML = svgRing(100 * needYou / denom, hue('var(--s-need)'), 30);
  // Quota chip: DESIGN.md gives the header the quota signal ONLY when quota
  // exceeds 80 percent. Otherwise it is silent (Metrics / Atlas own it).
  const qp = r.quota && r.quota.primary;
  const qpct = qp && qp.used_percent != null ? qp.used_percent : null;
  const chip = el('quotaChip');
  if (qpct != null && qpct > 80) {
    chip.style.display = '';
    chip.innerHTML = `<span class="dt"></span>codex quota ${qpct}%${qp.resets_at ? ' · resets ' + fmtReset(qp.resets_at) : ''}`;
    chip.className = 'chip ' + (qpct > 95 ? 'c-block' : 'c-need');
  } else {
    chip.style.display = 'none';
  }
  el('verTag').textContent = status && status.version ? 'v' + status.version : 'demo';
  el('demoBadge').style.display = demo ? '' : 'none';
}

// ============================================================
// NAV RAIL (hidden by default; hover left hot-edge reveals as overlay; Cmd+\
// pins it as a fixed column). Contents top to bottom: Inbox (unread badge),
// Metrics (0.16 placeholder), Fleet (0.17 placeholder), Sessions, divider,
// Settings. Keys 1/2/3/4 switch the first four (Inbox/Metrics/Fleet/Sessions).
// ============================================================
const NAV = [
  { view: 'inbox', label: 'Inbox', key: '1', glyph: '✉' },
  { view: 'metrics', label: 'Metrics', key: '2', glyph: '◰' },
  { view: 'fleet', label: 'Fleet', key: '3', glyph: '⌘' },
  { view: 'sessions', label: 'Sessions', key: '4', glyph: '☷' },
  { divider: true },
  { view: 'settings', label: 'Settings', glyph: '⚙' },
];
function unreadCount() {
  return inboxThreads.filter((t) => {
    const last = lastReadTs[t.sessionId] || 0;
    return t.items.some((it) => (Date.parse(it.ts) || 0) > last);
  }).length;
}
function renderNav() {
  const rail = el('navRail');
  if (!rail) return;
  const un = unreadCount();
  rail.innerHTML = NAV.map((n) => {
    if (n.divider) return `<div class="nav-div"></div>`;
    const active = (view === n.view && !detailId) ? 'on' : '';
    const badge = (n.view === 'inbox' && un) ? `<span class="nav-badge">${un}</span>` : '';
    const kk = n.key ? `<span class="nav-key">${n.key}</span>` : '';
    return `<button class="nav-item ${active}" data-view="${n.view}" title="${esc(n.label)}${n.key ? ' (' + n.key + ')' : ''}">
      <span class="nav-glyph">${n.glyph}</span>
      <span class="nav-label">${esc(n.label)}</span>
      ${badge}${kk}
    </button>`;
  }).join('');
  rail.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
}

// ============================================================
// VIEW SWITCHING (registry-backed via app.set-view). Leaving detail if open.
// ============================================================
function setView(v) {
  if (!['inbox', 'metrics', 'fleet', 'sessions', 'settings'].includes(v)) v = 'inbox';
  detailId = null;
  view = v;
  if (window.humanctl) window.humanctl.setView(v);
  renderView();
}
function renderView() {
  // Toggle detail overlay off; show the active view section.
  el('detailWrap').classList.toggle('on', !!detailId);
  document.querySelectorAll('.view').forEach((s) => s.classList.remove('on'));
  if (!detailId) {
    const sec = el('view-' + view);
    if (sec) sec.classList.add('on');
    if (view === 'inbox' && window.Inbox) { window.Inbox.setData(inboxThreads, lastReadTs); window.Inbox.render(); }
    else if (view === 'sessions') renderSessions();
    else if (view === 'metrics') renderMetrics();
    else if (view === 'fleet') renderFleetPlaceholder();
    else if (view === 'settings') renderSettings();
  }
  renderNav();
}

// ============================================================
// SESSION SELECTION + DETAIL. Opening any session from any view shows the
// full-width detail (one component, reused by Inbox reply and Sessions).
// Back breadcrumb / Esc returns to the calling view.
// ============================================================
function selectSession(id) {
  if (!byId.has(id)) return;
  selId = id;
  if (window.humanctl) window.humanctl.setState({ selectedId: id });
}
function openDetail(id, fromView) {
  if (!byId.has(id)) return;
  detailFrom = fromView || view;
  selectSession(id);
  detailId = id;
  renderView();
  renderDetail();
  if (window.Atlas) window.Atlas.renderQueue();
}
function closeDetail() {
  detailId = null;
  view = detailFrom || 'inbox';
  if (window.humanctl) window.humanctl.setView(view);
  renderView();
}

// ============================================================
// INBOX v2 lives in inbox.js (thread list + detail-launch). Sessions view and
// session detail live here (they share the detail render function with Inbox).
// ============================================================

// Session detail: the one component family for both Inbox and Sessions
// (DESIGN.md: session state+reason owns the header chip; context fill owns the
// detail meta; single-session chat owns the composer here). Reused, not forked.
function renderDetail() {
  const a = byId.get(detailId);
  const wrap = el('detailBody');
  if (!wrap || !a) return;
  const s = STATE[a.state], h = hue(s.hue);
  wrap.style.setProperty('--c-sel', h);
  const fromLabel = { inbox: 'Inbox', sessions: 'Sessions' }[detailFrom] || 'back';
  const t = inboxThreads.find((x) => x.sessionId === a.id);
  const stream = t ? t.items.slice().reverse().map(streamItemHtml).join('') : '';

  wrap.innerHTML = `
    <div class="detail-crumb">
      <button class="crumb-back" id="crumbBack">&#8592; ${esc(fromLabel)}</button>
      <span class="crumb-live" id="detailLive">${esc(liveIndicatorText(a))}</span>
      <button class="crumb-pin ${pins.has(a.id) ? 'on' : ''}" id="crumbPin" title="${pins.has(a.id) ? 'unpin session' : 'pin session'}" aria-label="${pins.has(a.id) ? 'unpin session' : 'pin session'}">&#128204; ${pins.has(a.id) ? 'Pinned' : 'Pin'}</button>
    </div>
    <div class="detail-hd">
      <div class="dh-id">
        ${harnessGlyph(a.harness)}
        <div class="dh-meta">
          <div class="dh-row1">
            <h1>${nameHtml(a)}</h1>
            <span class="chip ${s.cls}" title="${esc(stateTip(a))}"><span class="dt"></span>${s.label}</span>
            ${a.tier !== 'hot' ? `<span class="chip c-idle" title="${esc(stateTip(a))}"><span class="dt"></span>${esc(TIERS[a.tier].label)}</span>` : ''}
          </div>
          <div class="dh-sub">${a.stateReason ? esc(a.stateReason) + ' · ' : ''}${esc(a.when || '')}</div>
        </div>
      </div>
      ${resumeSplitHtml(a)}
    </div>
    ${stream ? `<div class="tstream" id="dtStream">${stream}</div>` : ''}
    ${summaryBlockHtml(a)}
    <div class="tl-wrap">
      <div class="tl-head"><span class="lbl">Conversation</span><span class="tl-live" id="tlLive">${esc(liveIndicatorText(a))}</span></div>
      <div id="tlBody"><div class="tl-empty">reading transcript...</div></div>
    </div>
    ${askBlockHtml(a)}
    <div id="touchedChips"></div>
    <div class="detail-disc">
      <button class="disc-tog" id="discTog">Session details</button>
      <div class="disc-body" id="discBody" hidden></div>
    </div>`;

  el('crumbBack').addEventListener('click', closeDetail);
  el('crumbPin').addEventListener('click', () => togglePin(a.id));
  wireResumeSplit(a);
  wireAsk(a);
  const dtStream = el('dtStream');
  if (dtStream) dtStream.querySelectorAll('[data-retry-q]').forEach((b) => b.addEventListener('click', () => runAsk(a, b.dataset.retryQ)));
  el('discTog').addEventListener('click', () => {
    const body = el('discBody');
    body.hidden = !body.hidden;
    if (!body.hidden) fillSessionDetails(a);
  });
  // Load the transcript + touched chips async, post-paint (perf: SLOs). The
  // detail paints immediately from data already in hand; the heavier reads
  // fill in without blocking the click-to-paint.
  ensureDetailBody(a);
  fillTouchedChipsAsync(a);
}
function ensureDetailBody(a) {
  const body = el('tlBody');
  if (!body) return;
  const cached = detailCache.get(a.id);
  if (cached && cached !== 'loading' && cached !== 'error') { body.innerHTML = timelineHtml(a, cached); bindTimeline(body, a, cached); return; }
  if (cached === 'error') { body.innerHTML = `<div class="tl-empty">could not read this session.</div>`; return; }
  body.innerHTML = `<div class="tl-empty">reading transcript...</div>`;
  loadDetail(a).then(() => { if (detailId === a.id) { const d = detailCache.get(a.id); if (d && d !== 'error') { body.innerHTML = timelineHtml(a, d); bindTimeline(body, a, d); } else body.innerHTML = `<div class="tl-empty">could not read this session.</div>`; } });
}

// The Resume split button (DESIGN.md: single-session actions in the detail
// header). Primary is the per-harness preferred destination; the caret opens
// the other destination, Reveal transcript, and Copy session id.
function resumeSplitHtml(a) {
  const ra = resumeActs(a);
  const primaryLabel = a.state === 'done' ? 'Reveal transcript' : resumeLabel(a);
  const primaryAct = a.state === 'done' ? 'reveal' : ra.primary.act;
  return `<div class="resume-split">
    <button class="btn primary" data-dact="${primaryAct}">${esc(primaryLabel)}</button>
    <button class="btn primary caret" id="resumeCaret" aria-label="more resume options">&#9662;</button>
    <div class="resume-menu" id="resumeMenu" hidden>
      ${ra.secondary ? `<button data-dact="${ra.secondary.act}">${esc(ra.secondary.label)}</button>` : ''}
      <button data-dact="reveal">Reveal transcript</button>
      <button data-dact="copy-id">Copy session id</button>
    </div>
  </div>`;
}
function wireResumeSplit(a) {
  const wrap = el('detailBody');
  wrap.querySelectorAll('[data-dact]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const m = el('resumeMenu'); if (m) m.hidden = true; runAction(b.dataset.dact, a); }));
  const caret = el('resumeCaret');
  const menu = el('resumeMenu');
  if (caret && menu) {
    caret.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('mousedown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== caret) menu.hidden = true; }, { once: false });
  }
}

// Touched chips: repos + issue keys, sourced ONLY from the session reader's OWN
// extracted refs (readDetail's linearRefs and its repo/cwd). NEVER from
// lib/pulse.js (hard rule from the critic pass: touched chips must not spawn a
// pulse read). Filled async post-paint so the first paint stays fast.
function touchedRefs(a, d) {
  const detail = (d && d.detail) || {};
  const repos = new Set();
  if (a.repo) repos.add(cwdBase(a.repo));
  if (a.cwd) repos.add(cwdBase(a.cwd));
  const issueKeys = new Set();
  for (const l of (detail.linearRefs || [])) {
    if (l.label) issueKeys.add(l.label);
    else { const im = String(l.url || '').match(/\/issue\/([A-Za-z]{2,}-\d+)/i); if (im) issueKeys.add(im[1].toUpperCase()); }
  }
  return { repos: [...repos].filter(Boolean), issueKeys: [...issueKeys] };
}
function renderTouchedChips(a, d) {
  const box = el('touchedChips');
  if (!box) return;
  const { repos, issueKeys } = touchedRefs(a, d);
  if (!repos.length && !issueKeys.length) { box.innerHTML = ''; return; }
  const rc = repos.map((r) => `<span class="touch-chip repo">${esc(r)}</span>`).join('');
  const ic = issueKeys.map((k) => `<span class="touch-chip issue">${esc(k)}</span>`).join('');
  box.innerHTML = `<div class="touched"><span class="touch-l">Touched</span>${rc}${ic}</div>`;
}
function fillTouchedChipsAsync(a) {
  const cached = detailCache.get(a.id);
  if (cached && cached !== 'loading' && cached !== 'error') { renderTouchedChips(a, cached); return; }
  loadDetail(a).then(() => { if (detailId === a.id) { const d = detailCache.get(a.id); if (d && d !== 'error') renderTouchedChips(a, d); } });
}

function fillSessionDetails(a) {
  const body = el('discBody');
  if (!body) return;
  const d = detailCache.get(a.id);
  const usage = (d && d !== 'loading' && d !== 'error' && d.usage) || {};
  const rows = [
    ['cwd', a.cwd || 'n/a'],
    ['session id', a.id],
    ['context', a.ctxPct != null ? a.ctxPct + '%' : 'n/a'],
    ['tokens', usage.tokens && usage.tokens.total != null ? fmtTok(usage.tokens.total) : 'n/a'],
    ['engine', a.harnessLabel + (a.model ? ' · ' + a.model : '') + (a.effort ? ' · ' + a.effort : (a.ultracode ? ' · ultra' : ''))],
    ['cost (est)', a.cost != null ? fmtUSD(a.cost) : 'n/a'],
  ];
  body.innerHTML = `<div class="disc-grid">${rows.map((r) => `<div class="disc-row"><span class="dk">${esc(r[0])}</span><span class="dv">${esc(String(r[1]))}</span></div>`).join('')}</div>`;
}

// The humanctl-updates stream item (notes / detected asks / btw Q&A). Renders
// note level chips. Attachments are NOT rendered in PR-1 (PR-2 scope): even if
// a note carries an `attachments` field on the data, it is ignored here.
const LEVEL_LABEL = { blocked: 'blocked', review: 'review', done: 'done', fyi: 'fyi' };
const LEVEL_HUE = { blocked: 'var(--s-block)', review: 'var(--s-need)', done: 'var(--s-done)', fyi: 'var(--iris)' };
function streamItemHtml(it) {
  const ts = (i) => esc(agoTxt(Date.parse(i.ts) || 0));
  if (it.kind === 'note') {
    return `<div class="tsitem" style="--il:${LEVEL_HUE[it.level] || 'var(--iris)'}">
      <div class="th2"><span class="lvl">${esc(LEVEL_LABEL[it.level] || it.level)} &middot; note</span><span class="when2">${ts(it)}</span></div>
      <div class="body2">${esc(it.message)}</div>
    </div>`;
  }
  if (it.kind === 'ask') {
    return `<div class="tsitem" style="--il:${LEVEL_HUE[it.level] || 'var(--s-need)'}">
      <div class="th2"><span class="lvl">detected ask</span><span class="when2">${ts(it)}</span></div>
      <div class="body2">${esc(it.reason || 'the session is waiting on you')}</div>
    </div>`;
  }
  if (it.kind === 'qa') {
    return `<div class="tsitem" style="--il:var(--s-done)">
      <div class="th2"><span class="lvl">btw</span><span class="when2">${ts(it)}</span></div>
      <div class="qtag">you asked</div><div class="body2">${esc(it.question)}</div>
      <div class="qtag" style="margin-top:8px">session answered &middot; via ${esc(engineLabel(it.engine))}</div><div class="body2">${esc(it.answer)}</div>
    </div>`;
  }
  if (it.kind === 'ask-interrupted') {
    return `<div class="tsitem" style="--il:var(--s-block)">
      <div class="th2"><span class="lvl">interrupted</span><span class="when2">${ts(it)}</span></div>
      <div class="qtag">you asked</div><div class="body2">${esc(it.question)}</div>
      <div class="body2" style="color:var(--ink3);font-size:12px">The app closed before this probe finished. Nothing was lost silently; retry it.</div>
      <button class="retry" data-retry-q="${esc(it.question)}">Retry this question</button>
    </div>`;
  }
  return '';
}

// The AI summary block: the summary's one home in the detail (manual trigger,
// same mechanics as today; the trigger button is under the summary block).
function summaryBlockHtml(a) {
  const st = sumState.get(a.id);
  const trigger = (label, dis) => `<button class="sum-trigger" id="sumTrigger" ${dis ? 'disabled' : ''} title="sends recent messages to your local ${esc(engineLabel(summarizer))} CLI">${label}</button>`;
  if (st === 'loading') {
    return `<div class="sumblock load" id="sumBlock">
      <div class="lh"><span class="lbl">AI summary</span><span class="meta">via ${esc(engineLabel(summarizer))} CLI</span></div>
      <div class="txt">summarizing recent activity...</div>
    </div>`;
  }
  if (st && st.error) {
    return `<div class="sumblock err" id="sumBlock">
      <div class="lh"><span class="lbl">AI summary failed</span></div>
      <div class="txt">${esc(st.error)}</div>${trigger('Retry AI summary', false)}
    </div>`;
  }
  const s = a.summary;
  if (!s) {
    return `<div class="sumblock empty" id="sumBlock">
      <div class="lh"><span class="lbl">AI summary</span></div>
      ${trigger('Generate AI summary', false)}
    </div>`;
  }
  return `<div class="sumblock" id="sumBlock">
    <div class="lh"><span class="lbl">AI summary</span><span class="meta">via ${esc(engineLabel(s.engine))}${s.at ? ' · ' + esc(agoTxt(s.at)) : ''}</span></div>
    <div class="txt">${esc(s.text)}</div>${trigger('Refresh AI summary', false)}
  </div>`;
}

// Ask the session: the persisted ask-thread composer (reused verbatim, same
// component family, not forked). Quick prompts + freeform input; the header
// carries the honest per-harness footprint.
function askExchangeHtml(x) {
  return `<div class="ask-x">
    <div class="q"><span class="tag">you</span><span class="txt">${esc(x.q)}</span></div>
    <div class="a"><span class="tag">session</span><span class="txt">${esc(x.a)}</span>
      <div class="meta">via ${esc(engineLabel(x.engine))}${x.at ? ' · ' + esc(agoTxt(x.at)) : ''}</div></div>
  </div>`;
}
function askBlockHtml(a) {
  const codex = a.harness === 'codex';
  const list = asks.get(a.id) || [];
  const st = askState.get(a.id);
  const busy = !!(st && st.phase === 'loading');
  let thread = list.map(askExchangeHtml).join('');
  if (busy) {
    thread += `<div class="ask-x">
      <div class="q"><span class="tag">you</span><span class="txt">${esc(st.q)}</span></div>
      <div class="a load"><span class="tag">session</span><span class="txt">asking the session...</span></div>
    </div>`;
  } else if (st && st.error) {
    thread += `<div class="ask-x">
      <div class="q"><span class="tag">you</span><span class="txt">${esc(st.q)}</span></div>
      <div class="a err"><span class="tag">failed</span><span class="txt">${esc(st.error)}</span></div>
    </div>`;
  }
  const note = codex ? 'writes a marked question into the thread' : 'leaves no trace in the session';
  let controls;
  if (askPending.has(a.id)) {
    controls = `<div class="ask-ack">
      <span class="txt">Codex questions are written into the thread itself; Claude questions leave no trace.</span>
      <button class="ok" data-ask-ack="yes">Ask anyway</button>
      <button data-ask-ack="no">Cancel</button>
    </div>`;
  } else if (codex && a.state === 'work') {
    controls = `<div class="ask-off">session is working; a Codex ask would append into the live thread. Try again once it settles.</div>`;
  } else {
    const qps = ASK_QUICK.map((q) => `<button class="ask-qp" data-ask-q="${esc(q)}" ${busy ? 'disabled' : ''}>${esc(q)}</button>`).join('');
    controls = `<div class="ask-ctl">${qps}</div>
    <div class="ask-in">
      <input id="askInput" type="text" maxlength="500" placeholder="Ask this session anything..." value="${esc(askDraft.get(a.id) || '')}" ${busy ? 'disabled' : ''} />
      <button id="askSend" ${busy ? 'disabled' : ''}>Ask</button>
    </div>`;
  }
  return `<div class="askblock" id="askBlock">
    <div class="lh"><span class="lbl">Ask the session</span><span class="meta">${esc(note)}</span></div>
    ${thread ? `<div class="ask-thread">${thread}</div>` : ''}
    ${controls}
  </div>`;
}
function wireAsk(a) {
  const blk = el('askBlock');
  if (blk) {
    blk.querySelectorAll('[data-ask-q]').forEach((b) => b.addEventListener('click', () => runAsk(a, b.dataset.askQ)));
    const input = el('askInput');
    if (input) {
      input.addEventListener('input', () => askDraft.set(a.id, input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runAsk(a, input.value); } });
    }
    const send = el('askSend');
    if (send) send.addEventListener('click', () => runAsk(a, input ? input.value : ''));
    blk.querySelectorAll('[data-ask-ack]').forEach((b) => b.addEventListener('click', () => {
      const q = askPending.get(a.id);
      askPending.delete(a.id);
      if (b.dataset.askAck === 'yes' && q) {
        askAck = true;
        if (window.humanctl) window.humanctl.setState({ askCodexAck: true });
        sendAsk(a, q);
      } else repaintAsk(a.id);
    }));
  }
  const st = el('sumTrigger');
  if (st) st.addEventListener('click', () => summarizeAgent(a));
}
function runAsk(a, q) {
  q = String(q || '').trim();
  if (!q) return;
  const st = askState.get(a.id);
  if (st && st.phase === 'loading') return;
  if (a.harness === 'codex' && !askAck) { askPending.set(a.id, q); repaintAsk(a.id); return; }
  sendAsk(a, q);
}
async function sendAsk(a, q) {
  const engine = a.harness === 'codex' ? 'codex' : 'claude';
  askState.set(a.id, { q, phase: 'loading' });
  askDraft.delete(a.id);
  repaintAsk(a.id);
  const run = (askRuns.get(a.id) || 0) + 1;
  askRuns.set(a.id, run);
  const settle = (entry, err) => {
    if (askRuns.get(a.id) !== run) return;
    if (entry) { askState.delete(a.id); rememberAsk(a.id, entry); }
    else askState.set(a.id, { q, error: err || 'could not ask this session.' });
    repaintAsk(a.id);
  };
  if (!window.humanctl) { setTimeout(() => settle({ q, a: fixtureAnswer(a, q), engine, at: Date.now() }), 1100); return; }
  try {
    const r = await window.humanctl.askSession({ id: a.id, harness: a.harness, path: a.path, cwd: a.cwd, question: q });
    if (r && r.ok && r.answer) settle({ q, a: r.answer, engine: r.engine || engine, at: r.at || Date.now() });
    else if (r && r.needsAck) { askState.delete(a.id); askAck = false; askPending.set(a.id, q); repaintAsk(a.id); }
    else settle(null, r && r.error);
  } catch (e) { settle(null, String((e && e.message) || e)); }
}
function fixtureAnswer(a, q) {
  if (/^status/i.test(q)) return 'Mid-flight on the ' + (a.repo || 'demo') + ' work: the last verified step landed cleanly and the next one is queued.';
  if (/need from me/i.test(q)) return 'One decision is open (see the stream above); everything else is proceeding without you.';
  if (/^summarize/i.test(q)) return 'This thread set up the task, verified the approach against fixtures, and is now closing out the remaining edge cases.';
  return 'Synthetic demo answer: in the real app this comes from the session itself, through your local ' + engineLabel(a.harness === 'codex' ? 'codex' : 'claude') + ' CLI.';
}
// Only the ask block + summary block repaint, so the detail composer never
// clobbers the timeline or loses input focus mid-stream.
function repaintAsk(id) {
  if (detailId !== id) return;
  const a = byId.get(id);
  if (!a) return;
  const blk = el('askBlock');
  if (blk) { blk.outerHTML = askBlockHtml(a); wireAsk(a); }
}

// ---- timeline (real substantive events; reused by detail) ----
const TL_KLBL = { user: 'you', assistant: 'agent', interrupt: 'interrupted', tools: 'tools' };
const TL_KHUE = { user: 'var(--iris)', assistant: 'var(--s-done)', interrupt: 'var(--s-block)', tools: 'var(--ink3)' };
function liveEventsHtml(a, tl) {
  let html = '';
  for (let i = tl.events.length - 1; i >= 0; i--) {
    const e = tl.events[i];
    const msg = e.k === 'tools' ? `${e.n} tool event${e.n === 1 ? '' : 's'}` : esc(e.t || '');
    const ts = e.ts != null ? `<span class="ts">${esc(agoTxt(e.ts))}</span>` : '';
    html += `<div class="tevt" style="--src:${TL_KHUE[e.k] || 'var(--ink3)'}">
      <div class="top"><span class="src">${esc(TL_KLBL[e.k] || e.k)}</span>${ts}</div>
      <div class="msg">${msg || '(no text)'}</div>
    </div>`;
  }
  if (!tl.events.length) html += `<div class="tl-empty">no substantive events in this slice.</div>`;
  if (tl.atStart) {
    html += `<div class="tl-start">start of session</div>`;
  } else {
    const label = tl.loadingOlder ? 'loading earlier events...'
      : tl.capped ? 'earlier events trimmed from view · reload timeline'
        : `${tl.estEarlier != null ? '~' + tl.estEarlier + ' earlier events' : 'earlier events'} not shown · load older`;
    html += `<div class="tl-more"><button id="tlOlder" ${tl.loadingOlder ? 'disabled' : ''}>${esc(label)}</button></div>`;
  }
  return html;
}
function timelineHtml(a, d) {
  let html = `<div class="tl">`;
  const tl = tlState.get(a.id);
  if (!tl || tl.loading) { ensureTimeline(a); html += `<div class="tl-empty">reading timeline...</div>`; }
  else if (tl.error) html += `<div class="tl-empty">${esc(tl.error)}</div>`;
  else html += liveEventsHtml(a, tl);
  html += `</div>`;
  return html;
}
// Upward infinite scroll: when the timeline body scrolls near the top, load the
// next backward page (no new timer; a scroll listener bound at render time).
function bindTimeline(root, a, d) {
  const older = root.querySelector('#tlOlder');
  if (older) older.addEventListener('click', () => loadOlderTimeline(a));
  const scroller = root.closest('#tlBody');
  if (scroller && !scroller.__tlScrollBound) {
    scroller.__tlScrollBound = true;
    scroller.addEventListener('scroll', () => {
      if (scroller.scrollTop < 60) {
        const tl = tlState.get(detailId);
        if (tl && tl.events && !tl.atStart && !tl.loadingOlder) { const cur = byId.get(detailId); if (cur) loadOlderTimeline(cur); }
      }
    });
  }
}

// ============================================================
// SESSIONS VIEW (replaces Wall). Complete-fleet list, denser rows than Inbox,
// same three-line anatomy tighter, sort recent|state|created|title, same
// filters, pinned float on top. DESIGN.md: complete fleet owns the Sessions
// view. No kanban, no peek in 0.15.x.
// ============================================================
// Sessions search/filter/sort state is RENDERER EPHEMERA (transient UI state,
// like scroll position / selection). Per the AGENTS.md CommandRegistry
// invariant's exemption clause, it is deliberately NOT a registered command:
// it never touches disk, a process, or another session. Do not "fix" this into
// app.set-* commands. (The Inbox toolbar state in inbox.js is exempt for the
// same reason.)
const sessFilter = { q: '', state: '', harness: '', sort: 'recent' };
const STATE_ORDER = { need: 0, block: 1, work: 2, idle: 3, done: 4 };
function sessionsSorted() {
  let list = agents.slice();
  const q = sessFilter.q.trim().toLowerCase();
  if (q) list = list.filter((a) => (displayName(a) + ' ' + a.repo + ' ' + a.cwd + ' ' + a.promptNarr).toLowerCase().includes(q));
  if (sessFilter.state) list = list.filter((a) => a.state === sessFilter.state);
  if (sessFilter.harness) list = list.filter((a) => a.harness === sessFilter.harness);
  const cmp = {
    recent: (a, b) => (b.row.lastActiveMs || 0) - (a.row.lastActiveMs || 0) || b.ageMs - a.ageMs,
    state: (a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || (a.ageMs - b.ageMs),
    created: (a, b) => (b.createdMs || 0) - (a.createdMs || 0),
    title: (a, b) => displayName(a).localeCompare(displayName(b)),
  }[sessFilter.sort] || ((a, b) => a.ageMs - b.ageMs);
  // Pinned float to the top, then the chosen sort within each group.
  const pinned = list.filter((a) => pins.has(a.id)).sort(cmp);
  const rest = list.filter((a) => !pins.has(a.id)).sort(cmp);
  return { pinned, rest };
}
// The shared three-line row (Inbox and Sessions both use it; Sessions adds a
// dense class). Line 2 message-to-the-human priority: newest ask reason > note >
// completion line.
function messageToHuman(a) {
  if (a.state === 'need' || a.state === 'block') return a.stateReason || 'needs your input';
  const t = inboxThreads.find((x) => x.sessionId === a.id);
  if (t) {
    const notes = t.items.filter((it) => it.kind === 'note');
    if (notes.length) return firstSentence(notes[notes.length - 1].message);
  }
  if (a.state === 'done') return firstSentence(a.prevAgent) || 'reported complete';
  return firstSentence(a.summary ? a.summary.text : a.promptNarr);
}
function anatomyRow(a, dense) {
  const s = STATE[a.state], h = hue(s.hue);
  const unread = isUnread(a.id);
  const isPin = pins.has(a.id);
  return `<div class="srow ${dense ? 'dense' : ''} ${a.id === selId ? 'sel' : ''} ${TIERS[a.tier].cls}" style="--c-sel:${h}" data-id="${esc(a.id)}" title="${esc(stateTip(a))}">
    <span class="unread ${unread ? 'on' : ''}"></span>
    <span class="sbody">
      <span class="l1">${harnessGlyph(a.harness)}<span class="nm">${nameHtml(a)}</span><span class="when">${timeLadder(a)}</span></span>
      <span class="l2"><span class="chip ${s.cls}"><span class="dt"></span>${s.label}</span><span class="msg">${esc(messageToHuman(a))}</span></span>
      <span class="l3">${esc(cwdBase(a.cwd) || a.repo)}</span>
    </span>
    <button class="pinbtn ${isPin ? 'on' : ''}" data-pin="${esc(a.id)}" title="${isPin ? 'unpin' : 'pin'}" aria-label="${isPin ? 'unpin' : 'pin'}">&#128204;</button>
  </div>`;
}
function isUnread(id) {
  const t = inboxThreads.find((x) => x.sessionId === id);
  if (!t) return false;
  const last = lastReadTs[id] || 0;
  return t.items.some((it) => (Date.parse(it.ts) || 0) > last);
}
function toolbarHtml(scope) {
  const f = scope === 'sessions' ? sessFilter : null;
  if (!f) return '';
  const sorts = scope === 'sessions'
    ? [['recent', 'recent'], ['state', 'state'], ['created', 'created'], ['title', 'title']]
    : [];
  return `<div class="toolbar">
    <input class="tb-search" id="sessSearch" type="text" placeholder="Search sessions..." value="${esc(f.q)}" />
    <select class="tb-sel" id="sessState">
      <option value="">all states</option>
      <option value="need">needs input</option><option value="block">blocked</option>
      <option value="work">running</option><option value="idle">stalled</option><option value="done">finished</option>
    </select>
    <select class="tb-sel" id="sessHarness"><option value="">all harnesses</option><option value="claude-code">claude</option><option value="codex">codex</option></select>
    <select class="tb-sel" id="sessSort">${sorts.map((s) => `<option value="${s[0]}">${s[1]}</option>`).join('')}</select>
  </div>`;
}
function renderSessions() {
  const box = el('view-sessions');
  const { pinned, rest } = sessionsSorted();
  const total = agents.length;
  let rows = '';
  if (pinned.length) { rows += `<div class="grp-hd"><span class="gdot" style="background:var(--iris)"></span>Pinned<span class="gct">${pinned.length}</span></div>`; rows += pinned.map((a) => anatomyRow(a, true)).join(''); }
  rows += rest.map((a) => anatomyRow(a, true)).join('');
  box.innerHTML = `
    <div class="view-hd"><span class="glyph">&#9783;</span><span class="ttl">Sessions</span><span class="sub">${total} ${total === 1 ? 'session' : 'sessions'}</span></div>
    ${toolbarHtml('sessions')}
    <div class="srows" id="sessRows">${rows || `<div class="view-empty">no sessions in the last 72h.</div>`}</div>`;
  wireSessionsToolbar();
  const rowsBox = el('sessRows');
  rowsBox.querySelectorAll('.srow').forEach((r) => {
    r.addEventListener('click', (e) => { if (e.target.closest('[data-pin]')) return; openDetail(r.dataset.id, 'sessions'); });
    if (window.ContextMenu) r.addEventListener('contextmenu', (e) => { e.preventDefault(); window.ContextMenu.open(e, { type: 'session', agent: byId.get(r.dataset.id) }); });
  });
  rowsBox.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); togglePin(b.dataset.pin); }));
}
function wireSessionsToolbar() {
  const s = el('sessSearch'), st = el('sessState'), hh = el('sessHarness'), so = el('sessSort');
  if (st) st.value = sessFilter.state;
  if (hh) hh.value = sessFilter.harness;
  if (so) so.value = sessFilter.sort;
  if (s) s.addEventListener('input', () => { sessFilter.q = s.value; renderSessionRows(); });
  if (st) st.addEventListener('change', () => { sessFilter.state = st.value; renderSessionRows(); });
  if (hh) hh.addEventListener('change', () => { sessFilter.harness = hh.value; renderSessionRows(); });
  if (so) so.addEventListener('change', () => { sessFilter.sort = so.value; renderSessionRows(); });
}
// Repaint only the rows on filter/sort change (search input keeps focus).
function renderSessionRows() {
  const rowsBox = el('sessRows');
  if (!rowsBox) return;
  const { pinned, rest } = sessionsSorted();
  let rows = '';
  if (pinned.length) { rows += `<div class="grp-hd"><span class="gdot" style="background:var(--iris)"></span>Pinned<span class="gct">${pinned.length}</span></div>`; rows += pinned.map((a) => anatomyRow(a, true)).join(''); }
  rows += rest.map((a) => anatomyRow(a, true)).join('');
  rowsBox.innerHTML = rows || `<div class="view-empty">no sessions match.</div>`;
  rowsBox.querySelectorAll('.srow').forEach((r) => {
    r.addEventListener('click', (e) => { if (e.target.closest('[data-pin]')) return; openDetail(r.dataset.id, 'sessions'); });
    if (window.ContextMenu) r.addEventListener('contextmenu', (e) => { e.preventDefault(); window.ContextMenu.open(e, { type: 'session', agent: byId.get(r.dataset.id) }); });
  });
  rowsBox.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); togglePin(b.dataset.pin); }));
}
function togglePin(id) {
  if (pins.has(id)) pins.delete(id); else pins.add(id);
  if (window.humanctl) window.humanctl.setState({ pins: [...pins] });
  if (view === 'sessions' && !detailId) renderSessionRows();
  if (detailId === id) renderDetail();
}

// ============================================================
// METRICS + FLEET placeholder views (quiet, honest, no fake data). Metrics is
// where spend/tokens/quota WILL live (0.16); until then it says so.
// ============================================================
function renderMetrics() {
  el('view-metrics').innerHTML = `
    <div class="view-hd"><span class="glyph">&#9712;</span><span class="ttl">Metrics</span></div>
    <div class="placeholder">
      <div class="ph-num">0.16</div>
      <div class="ph-msg">Metrics arrive in 0.16.</div>
      <div class="ph-sub">Spend, tokens, and quota over time will live here, with one owner for each. Until then the Atlas drawer summarizes the current numbers; nothing is faked in the meantime.</div>
    </div>`;
}
function renderFleetPlaceholder() {
  el('view-fleet').innerHTML = `
    <div class="view-hd"><span class="glyph">&#8984;</span><span class="ttl">Fleet</span></div>
    <div class="placeholder">
      <div class="ph-num">0.17</div>
      <div class="ph-msg">The fleet graph arrives in 0.17.</div>
      <div class="ph-sub">A live map of every session and how they relate. The complete list already lives in Sessions; this view will add the shape of the fleet, not a second list.</div>
    </div>`;
}

// ============================================================
// SETTINGS VIEW (real view now; the old header gear popover is gone). AI-summary
// engine + per-harness resume destination, persisted via the registry.
// ============================================================
function renderSettings() {
  const box = el('view-settings');
  const seg = (id, opts, cur) => `<div class="seg2" id="${id}">${opts.map((o) => `<button data-val="${o[0]}" class="${o[0] === cur ? 'on' : ''}">${esc(o[1])}</button>`).join('')}</div>`;
  const destSeg = (h) => {
    const avail = appAvailable(h);
    const cur = avail ? openPref[h] : 'terminal';
    return `<div class="seg2" data-openseg="${h}">
      <button data-dest="app" class="${cur === 'app' ? 'on' : ''}" ${avail ? '' : 'disabled'} title="${avail ? '' : 'no desktop app registered for this harness on this machine'}">Desktop app</button>
      <button data-dest="terminal" class="${cur === 'terminal' ? 'on' : ''}">Terminal</button>
    </div>`;
  };
  box.innerHTML = `
    <div class="view-hd"><span class="glyph">&#9881;</span><span class="ttl">Settings</span></div>
    <div class="settings">
      <div class="set-sect">
        <h4>Appearance</h4>
        <div class="set-row"><span class="sk">Theme</span>${seg('setTheme', [['dark', 'Dark'], ['light', 'Light']], theme)}</div>
      </div>
      <div class="set-sect">
        <h4>AI summary engine</h4>
        <p class="sub">Which local CLI generates the on-demand summary. It runs on your machine, through your own CLI auth.</p>
        ${seg('setEngine', [['claude', 'Claude Code'], ['codex', 'Codex']], summarizer)}
        <p class="note">Only the "AI summary" and "Ask the session" actions send data off-device, through your own CLI auth. Claude asks leave no trace in the session; Codex asks write the marked question into the thread itself. Nothing else leaves your machine.</p>
      </div>
      <div class="set-sect">
        <h4>Resume sessions in</h4>
        <p class="sub">Where the resume action takes you, per harness. The other choice stays one click away in the detail header.</p>
        <div class="set-row"><span class="sk">Claude Code</span>${destSeg('claude-code')}</div>
        <div class="set-row"><span class="sk">Codex</span>${destSeg('codex')}</div>
      </div>
    </div>`;
  el('setTheme').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { theme = b.dataset.val; applyTheme(); if (window.humanctl) window.humanctl.setState({ theme }); renderSettings(); redrawChrome(); }));
  el('setEngine').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { summarizer = b.dataset.val === 'codex' ? 'codex' : 'claude'; if (window.humanctl) window.humanctl.setState({ summarizer }); renderSettings(); toast('AI summary engine: ' + engineLabel(summarizer)); }));
  box.querySelectorAll('[data-openseg] button').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    const h = b.closest('[data-openseg]').dataset.openseg;
    openPref = Object.assign({}, openPref, { [h]: b.dataset.dest === 'app' ? 'app' : 'terminal' });
    if (window.humanctl) window.humanctl.setState({ openPref });
    renderSettings();
    toast((h === 'codex' ? 'Codex' : 'Claude Code') + ' sessions now open in ' + (openPref[h] === 'app' ? 'the desktop app' : 'Terminal') + '.');
  }));
}

// ============================================================
// ACTIONS (honest: read-only + resume). No fictional actions.
// ============================================================
async function runAction(act, a) {
  if (!a) return;
  if (act === 'resume') act = resumeActs(a).primary.act;
  if (act === 'resume-term') return resumeAgent(a);
  if (act === 'resume-app') return openAppAgent(a);
  if (act === 'reveal') return revealAgent(a);
  if (act === 'copy-id') return copySessionId(a);
  if (act === 'summary') return summarizeAgent(a);
}
async function resumeAgent(a) {
  if (!window.humanctl) { toast('demo: would resume ' + a.name + ' in Terminal (' + (a.harness === 'codex' ? 'codex resume' : 'claude --resume') + ').'); return; }
  toast('opening Terminal for ' + a.name + '...');
  const r = await window.humanctl.resumeSession({ id: a.id, harness: a.harness, cwd: a.cwd });
  toast(r && r.ok ? 'resumed ' + a.name + ' in Terminal.' : 'could not resume ' + a.name + '.');
}
async function openAppAgent(a) {
  const appName = a.harness === 'codex' ? 'Codex' : 'Claude';
  if (!window.humanctl) { toast('demo: would open ' + a.name + ' in the ' + appName + ' desktop app.'); return; }
  toast('opening ' + a.name + ' in the ' + appName + ' app...');
  const r = await window.humanctl.openInApp({ id: a.id, harness: a.harness });
  toast(r && r.ok ? 'opened ' + a.name + ' in the ' + appName + ' app.' : (r && r.error ? r.error : 'could not open the ' + appName + ' app.'));
}
async function revealAgent(a) {
  if (!window.humanctl) { toast('demo: would reveal the transcript for ' + a.name + '.'); return; }
  const r = await window.humanctl.revealSession(a.path);
  toast(r && r.ok ? 'revealed transcript for ' + a.name + '.' : 'could not reveal transcript.');
}
function copySessionId(a) {
  try { navigator.clipboard.writeText(a.id); toast('copied session id.'); }
  catch { toast(a.id); }
}
const sumRuns = new Map();
const engineLabel = (e) => (e === 'codex' ? 'Codex' : 'Claude Code');
async function summarizeAgent(a) {
  if (sumState.get(a.id) === 'loading') return;
  sumState.set(a.id, 'loading');
  repaintSummary(a.id);
  const run = (sumRuns.get(a.id) || 0) + 1;
  sumRuns.set(a.id, run);
  const settle = (entry, err) => {
    if (sumRuns.get(a.id) !== run) return;
    if (entry) { sumState.delete(a.id); rememberSummary(a.id, entry); }
    else { sumState.set(a.id, { error: err || 'could not summarize.' }); toast('summary failed: ' + (err || 'unknown error')); }
    repaintSummary(a.id, !!entry);
  };
  if (!window.humanctl) { setTimeout(() => settle({ text: 'Working through the latest instruction; see the conversation for the real signals.', engine: summarizer, at: Date.now() }), 900); return; }
  try {
    const r = await window.humanctl.summarize({ path: a.path, harness: a.harness, engine: summarizer });
    if (r && r.ok && r.summary) settle({ text: r.summary, engine: r.engine || summarizer, at: Date.now() });
    else settle(null, r && r.error);
  } catch (e) { settle(null, String((e && e.message) || e)); }
}
function repaintSummary(id, landed) {
  const a = byId.get(id);
  if (a) a.summary = summaries.get(id) || a.summary;
  if (detailId === id) {
    const blk = el('sumBlock');
    if (blk && a) { blk.outerHTML = summaryBlockHtml(a); wireAsk(a); if (landed) { const nb = el('sumBlock'); if (nb) { nb.classList.add('flash'); setTimeout(() => nb.classList.remove('flash'), 1200); } } }
  }
}

let toastTimer = null;
function toast(msg) {
  const t = el('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ============================================================
// detail loading (real readSession, cached per id)
// ============================================================
async function loadDetail(a) {
  if (!a) return null;
  const have = detailCache.get(a.id);
  if (have && have !== 'error') return have;
  detailCache.set(a.id, 'loading');
  const finish = (res) => {
    if (res && res.ok) { const v = { data: res.data || {}, usage: res.usage || null, detail: res.detail || {} }; detailCache.set(a.id, v); return v; }
    detailCache.set(a.id, 'error'); return 'error';
  };
  if (!window.humanctl) return finish(fixtureRead(a.row));
  try { return finish(await window.humanctl.readSession({ path: a.path, harness: a.harness })); }
  catch (e) { detailCache.set(a.id, 'error'); return 'error'; }
}

// ============================================================
// data mapping + refresh
// ============================================================
function remapAgents() {
  agents = allRows.map((r) => mapAgent(r, allNotes));
  computeDisplayNames(agents);
  byId = new Map(agents.map((a) => [a.id, a]));
}
// Chrome that must stay in sync no matter which view is active.
function redrawChrome() {
  renderHeader();
  renderNav();
  if (window.Atlas) window.Atlas.refresh();
}
function redrawActive() {
  redrawChrome();
  if (detailId && byId.has(detailId)) renderDetail();
  else if (view === 'inbox' && window.Inbox) { window.Inbox.setData(inboxThreads, lastReadTs); window.Inbox.render(); }
  else if (view === 'sessions') renderSessions();
  else if (view === 'metrics') renderMetrics();
  else if (view === 'fleet') renderFleetPlaceholder();
  else if (view === 'settings') renderSettings();
}

// ============================================================
// theme
// ============================================================
function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  el('tTheme').textContent = theme;
  clearHueCache();
}
el('tTheme').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; applyTheme(); if (window.humanctl) window.humanctl.setState({ theme }); redrawActive(); });

// ============================================================
// NAV RAIL hover intent + pin. The hot edge is 8px wide and its vertical range
// STARTS BELOW THE HEADER (the header is -webkit-app-region: drag for the
// frameless window; an overlapping hot edge would fight window dragging). The
// hot edge element is positioned from the header's bottom to the viewport
// bottom in CSS (top: var(--hdr-h)); a >=150ms hover intent reveals the overlay
// rail; mouse-out hides it unless pinned. This is the ONE hover-intent timer;
// no other timers are introduced (perf: SLOs).
const HOVER_INTENT_MS = 150;
let hoverTimer = null;
function showNav() { document.body.classList.add('nav-open'); }
function hideNav() { if (!navPinned) document.body.classList.remove('nav-open'); }
function applyNavPinned() {
  document.body.classList.toggle('nav-pinned', navPinned);
  if (navPinned) document.body.classList.add('nav-open'); else document.body.classList.remove('nav-open');
}
function setupNavHover() {
  const edge = el('navHotEdge');
  const rail = el('navRail');
  if (edge) {
    edge.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(showNav, HOVER_INTENT_MS); });
    edge.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); });
  }
  if (rail) {
    rail.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); showNav(); });
    rail.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(hideNav, HOVER_INTENT_MS); });
  }
}
function toggleNavPinned() {
  navPinned = !navPinned;
  applyNavPinned();
  if (window.humanctl) window.humanctl.setNav(navPinned);
}

// ============================================================
// keyboard
// ============================================================
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + \ toggles the pinned nav rail from anywhere.
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleNavPinned(); return; }
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON')) {
    if (e.key === 'Escape' && e.target.blur) e.target.blur();
    return;
  }
  if (window.Atlas && window.Atlas.isOpen()) { if (e.key === 'Escape') window.Atlas.close(); return; }
  if (e.key === 'Escape' && detailId) { closeDetail(); return; }
  if (e.key === 'a' || e.key === 'A') { if (window.Atlas) window.Atlas.open(); return; }
  if (e.key === '1') setView('inbox');
  else if (e.key === '2') setView('metrics');
  else if (e.key === '3') setView('fleet');
  else if (e.key === '4') setView('sessions');
  else if (view === 'inbox' && !detailId && window.Inbox) {
    if (e.key === 'j') { e.preventDefault(); window.Inbox.move(1); }
    else if (e.key === 'k') { e.preventDefault(); window.Inbox.move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); window.Inbox.openSelected(); }
  }
});
el('btnAtlas').addEventListener('click', () => { if (window.Atlas) window.Atlas.open(); });

// ============================================================
// load + realtime
// ============================================================
let inboxThreads = [];
async function fetchData() {
  const [s, l, nt, it] = await Promise.all([
    window.humanctl.getStatus({ maxAgeH: 72, limit: 40 }),
    window.humanctl.listSessions({ maxAgeH: 72, limit: 40, withUsage: true }),
    window.humanctl.getNotes({ limit: 100 }),
    window.humanctl.getInboxThreads({ limit: 200 }),
  ]);
  if (s && s.ok) status = s.status;
  if (l && l.ok) allRows = l.rows || [];
  if (nt && nt.ok) allNotes = nt.notes || [];
  if (it && it.ok) inboxThreads = it.threads || [];
}
let inboxFastRunning = false, inboxFastQueued = false;
async function runInboxFast() {
  if (!window.humanctl) return;
  if (inboxFastRunning) { inboxFastQueued = true; return; }
  inboxFastRunning = true;
  try {
    const [nt, it] = await Promise.all([
      window.humanctl.getNotes({ limit: 100 }),
      window.humanctl.getInboxThreads({ limit: 200 }),
    ]);
    if (nt && nt.ok) allNotes = nt.notes || [];
    if (it && it.ok) inboxThreads = it.threads || [];
    renderNav();
    if (view === 'inbox' && !detailId && window.Inbox) { window.Inbox.setData(inboxThreads, lastReadTs); window.Inbox.render(); }
    if (window.Atlas) window.Atlas.refresh();
  } finally {
    inboxFastRunning = false;
    if (inboxFastQueued) { inboxFastQueued = false; runInboxFast(); }
  }
}
async function load() {
  if (!window.humanctl) {
    demo = true;
    allRows = FIXTURE_ROWS; status = fixtureStatus(); allNotes = FIXTURE_NOTES;
    inboxThreads = (window.Inbox && window.Inbox.fixtureThreads) ? window.Inbox.fixtureThreads() : [];
    applyTheme(); applyNavPinned(); setupNavHover(); remapAgents(); renderHeader(); renderNav(); setView('inbox');
    if (window.Atlas) window.Atlas.hydrateFixture();
    return;
  }
  const st = await window.humanctl.getState();
  if (st && st.ok && st.state) {
    theme = st.state.theme === 'light' ? 'light' : 'dark';
    view = ['inbox', 'metrics', 'fleet', 'sessions', 'settings'].includes(st.state.view) ? st.state.view : 'inbox';
    navPinned = st.state.navPinned === true;
    pins = new Set(st.state.pins || []);
    summarizer = st.state.summarizer === 'codex' ? 'codex' : 'claude';
    const op = st.state.openPref || {};
    openPref = { 'claude-code': op['claude-code'] === 'app' ? 'app' : 'terminal', codex: op.codex === 'app' ? 'app' : 'terminal' };
    hydrateSummaries(st.state.summaries);
    hydrateAsks(st.state.asks);
    askAck = st.state.askCodexAck === true;
    if (st.state.selectedId) selId = st.state.selectedId;
    lastReadTs = st.state.lastReadTs || {};
  }
  applyTheme(); applyNavPinned(); setupNavHover();
  await fetchData();
  if (window.Atlas) await window.Atlas.hydrate();
  remapAgents(); renderHeader(); renderNav(); setView(view);
}
let lastSig = '';
const rowSubSig = new Map();
async function _refresh() {
  if (!window.humanctl) return;
  await fetchData();
  const sig = allRows.map((r) => r.id + r.ageMs + r.state + ':' + r.tier + ':' + r.contextPct).join('|')
    + '#' + allNotes.map((n) => n.id + ':' + n.level).join('|')
    + '#' + inboxThreads.map((t) => t.sessionId + ':' + t.lastTs + ':' + t.items.length).join('|')
    + '#' + (status ? status.needsYou + ':' + status.working + ':' + status.sessions : '');
  if (sig === lastSig) return; // nothing changed; unchanged data must not rebuild (perf: signature gate)
  lastSig = sig;
  for (const r of allRows) {
    const sub = r.ageMs + ':' + r.contextPct;
    if (rowSubSig.get(r.id) !== sub) { detailCache.delete(r.id); rowSubSig.set(r.id, sub); }
  }
  remapAgents();
  redrawActive();
}
const REFRESH_MIN_MS = 2500;
let refreshing = false, refreshQueued = false, refreshTimer = null, lastRefreshAt = 0;
async function runRefresh() {
  refreshTimer = null;
  if (refreshing) { refreshQueued = true; return; }
  refreshing = true; lastRefreshAt = Date.now();
  try { await _refresh(); }
  finally { refreshing = false; if (refreshQueued) { refreshQueued = false; scheduleRefresh(); } }
}
function scheduleRefresh() {
  if (refreshTimer) return;
  const wait = Math.max(0, REFRESH_MIN_MS - (Date.now() - lastRefreshAt));
  refreshTimer = setTimeout(runRefresh, wait);
}
if (window.humanctl && window.humanctl.onSessionsChanged) window.humanctl.onSessionsChanged(scheduleRefresh);
if (window.humanctl && window.humanctl.onInboxFast) window.humanctl.onInboxFast(runInboxFast);
if (window.humanctl && window.humanctl.onSessionAppend) window.humanctl.onSessionAppend(onSessionAppend);
// State mutated from outside this window (a registered command over the control
// socket, e.g. `humanctl app app.set-view --view sessions`): apply it live so
// the CLI-driven app is visibly the same app.
function applyExternalState(st) {
  if (!st || typeof st !== 'object') return;
  theme = st.theme === 'light' ? 'light' : 'dark';
  pins = new Set(st.pins || []);
  summarizer = st.summarizer === 'codex' ? 'codex' : 'claude';
  const op = st.openPref || {};
  openPref = { 'claude-code': op['claude-code'] === 'app' ? 'app' : 'terminal', codex: op.codex === 'app' ? 'app' : 'terminal' };
  lastReadTs = st.lastReadTs || lastReadTs;
  navPinned = st.navPinned === true;
  applyTheme(); applyNavPinned();
  const v = ['inbox', 'metrics', 'fleet', 'sessions', 'settings'].includes(st.view) ? st.view : view;
  if (v !== view && !detailId) setView(v); else redrawActive();
}
if (window.humanctl && window.humanctl.onStateChanged) window.humanctl.onStateChanged(applyExternalState);
// The single idle poll: at rest this fires every 20s and returns early on an
// unchanged signature (zero self-triggered rebuild at idle, per DESIGN.md SLO).
setInterval(() => { if (window.humanctl) scheduleRefresh(); }, 20000);
// A tiny hook so inbox.js can refresh the nav unread badge after mark-read
// without reaching into renderer internals.
window.renderNavExternal = renderNav;
// load() is called from boot.js, AFTER inbox.js / atlas.js / contextmenu.js
// have registered their window.* globals (script tags execute top to bottom).
window.bootHumanctl = load;
