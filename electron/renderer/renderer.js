'use strict';

// humanctl renderer :: conductor home.
// Read-only cross-harness control room. Three modes (Focus / Triage / Wall) over a
// persistent conductor header, wired to REAL local data via window.humanctl.
// No bridge (plain browser) -> synthetic fixture fleet + a "demo" badge.
// Only real signals. Where a datum is null, degrade gracefully; never fabricate.

// ---------- tiny utils ----------
const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cssv(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
// hue() runs per row/tile/sparkline; getComputedStyle forces a style recalc each
// call, so memoize resolved values. Cleared whenever theme/temperature changes.
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
// boilerplate ("# Files mentioned by the user:", markdown-comment/heading lines,
// or <...> wrappers) that leaks into row/tile/watch titles. Strip leading
// boilerplate lines and fall through to the first meaningful line. Never mutates
// stored data; if nothing meaningful remains, keep the original string.
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
  // collect from the first meaningful line to the end of that line's paragraph
  const rest = lines.slice(i).join('\n').trim();
  return rest || orig;
}

// ---------- state model (mirrors the mock's STATE/STATE map) ----------
const STATE = {
  work: { cls: 'c-work', label: 'working', hue: 'var(--s-work)' },
  need: { cls: 'c-need', label: 'needs you', hue: 'var(--s-need)' },
  block: { cls: 'c-block', label: 'blocked', hue: 'var(--s-block)' },
  idle: { cls: 'c-idle', label: 'idle', hue: 'var(--s-idle)' },
  done: { cls: 'c-done', label: 'done', hue: 'var(--s-done)' },
};
const GROUPS = [
  { k: 'need', label: 'Needs you' },
  { k: 'block', label: 'Blocked' },
  { k: 'work', label: 'Working' },
  { k: 'idle', label: 'Idle' },
  { k: 'done', label: 'Done' },
];
const ORDER = { need: 0, block: 1, work: 2, idle: 3, done: 4 };
// State and tier are computed by the reader (lib/sessions.js) from the tail
// CONTENT of each transcript: needs-you means the final assistant message is
// question- or decision-shaped, or the session was interrupted; the attention
// tier (hot / drifting / archived) ages by the last substantive message, not
// file mtime. The reader owns all time constants; the renderer consumes
// row.state / row.stateReason / row.tier and only overlays notes on top.
// Documented in docs/desktop.md ("State model").
const TIERS = {
  hot: { cls: '', label: '' },
  drifting: { cls: 'drift', label: 'drifting' },
  archived: { cls: 'archived', label: 'archived' },
};
// A done note usually lands moments before the agent's final transcript write,
// so allow that much clock skew when deciding whether the note postdates the
// session's last activity.
const DONE_NOTE_SLACK_MS = 10 * 60 * 1000;

// context-map kind constants (ported from old renderer)
const KIND_ORDER = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'];
const KIND_LABEL = { user: 'you', assistant: 'agent', thinking: 'thinking', 'tool-call': 'tool call', 'tool-result': 'tool result', meta: 'system' };

// ============================================================
// SVG metric helpers (ported verbatim from the shared kit)
// ============================================================
function sparkPath(vals, w, h, pad) {
  pad = pad || 3;
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  return vals.map((v, i) => {
    const x = pad + i * (w - 2 * pad) / (vals.length - 1);
    const y = h - pad - (v - mn) / rng * (h - 2 * pad);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
}
function svgSpark(vals, color, w, h, fill) {
  w = w || 96; h = h || 34;
  if (!vals || vals.length < 2) vals = [0, 0];
  const d = sparkPath(vals, w, h);
  const mn = Math.min(...vals), mx = Math.max(...vals), rng = (mx - mn) || 1;
  const lx = w - 3, ly = h - 3 - (vals[vals.length - 1] - mn) / rng * (h - 6);
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" style="overflow:visible">`
    + (fill ? `<path d="${d} L ${w - 3} ${h} L 3 ${h} Z" fill="${color}" opacity=".12"/>` : '')
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.2" fill="${color}"/></svg>`;
}
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
// Identity: deterministic nickname + emoji from the session id hash.
// Unsigned hashing + non-negative modulo so indices never go out of range.
// ============================================================
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
// tasteful faces: science / tools / animals / objects. No people, flags, food.
const FACES = [
  '\u{1F9ED}', '\u{1F52C}', '\u{1F52D}', '\u{1F9EC}', '⚛️', '\u{1F9EE}', '⚙️', '\u{1F52E}',
  '\u{1F6F0}️', '⚗️', '\u{1F98A}', '\u{1F989}', '\u{1F997}', '\u{1F98D}', '\u{1F9F5}', '\u{1F9E9}',
  '\u{1F3BC}', '✏️', '\u{1F4D0}', '\u{1F9F2}', '\u{1F4E1}', '\u{1F52C}', '\u{1F5DC}️', '\u{1F3AF}',
  '\u{1F4A0}', '\u{1F311}', '☄️', '✨', '\u{1F300}', '\u{1F310}', '\u{1F9F1}', '\u{1F4CA}',
  '\u{1F41D}', '\u{1F98B}', '\u{1F41E}', '\u{1F577}️', '\u{1F421}', '\u{1F419}', '\u{1F433}', '\u{1F994}',
];
function hashU(str) {
  // FNV-1a style, kept unsigned via >>> 0.
  let h = 2166136261 >>> 0;
  str = String(str || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function modNN(x, len) { return (((x % len) + len) % len); } // non-negative modulo
function identity(id) {
  const h = hashU(id);
  // two independent derivations so name and face vary independently.
  const nameIdx = modNN(h >>> 0, NAMES.length);
  const faceIdx = modNN((h >>> 11) ^ (h >>> 3), FACES.length);
  const name = NAMES[nameIdx] || 'Agent';
  const face = FACES[faceIdx] || '\u{1F9ED}';
  const tag = ('0000000' + h.toString(16)).slice(-2); // stable 2-hex id tag for disambiguation
  return { name, face, tag };
}

// ============================================================
// Row -> agent model (mapAgent / deriveState / normModel)
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
function deriveState(row, notes, now) {
  const tier = TIERS[row.tier] ? row.tier : 'hot';
  const n = notes.filter((x) => x.session && x.session === row.id);
  const latestTs = (lvl) => n.reduce((m, x) => (x.level === lvl ? Math.max(m, Date.parse(x.ts) || 0) : m), 0);
  // Notes overlay the content-shaped state: a done note is the agent
  // explicitly closing the loop. It clears needs-you immediately, as long as
  // it is the newest note for the session and the session has not moved again
  // since (activity after a done note reopens it).
  const doneTs = latestTs('done');
  if (doneTs && doneTs >= row.ageMs - DONE_NOTE_SLACK_MS
    && doneTs >= latestTs('blocked') && doneTs >= latestTs('review')) return { state: 'done', reason: 'note: done', tier };
  if (n.some((x) => x.level === 'blocked')) return { state: 'block', reason: 'note: blocked', tier };
  if (n.some((x) => x.level === 'review')) return { state: 'need', reason: 'note: review', tier };
  if (n.some((x) => x.level === 'done')) return { state: 'done', reason: 'note: done', tier };
  // The reader classified the tail content; trust it and carry its reason.
  return { state: STATE[row.state] ? row.state : 'idle', reason: row.stateReason || '', tier };
}
function mapAgent(row, notes, now) {
  const idn = identity(row.id);
  const { state, reason, tier } = deriveState(row, notes, now);
  const sum = summaries.get(row.id) || null; // {text, engine, at} once a summary was made
  // display-only: strip Codex wrapper boilerplate from the chosen narrative.
  // Stored row fields (lastUser/title/prevAgent) are never mutated.
  const promptNarr = cleanNarrative(row.lastUser || row.title || row.prevAgent || '(no recent prompt)');
  const narrative = sum ? sum.text : promptNarr;
  const cost = row.costUSD != null ? row.costUSD : (row.apiEquivUSD != null ? row.apiEquivUSD : null);
  const renamed = (row.customTitle || '').trim();  // the name set in the Claude Code sidebar, if any
  return {
    id: row.id,
    harness: row.harness,                       // 'codex' | 'claude-code'
    harnessLabel: row.harness === 'codex' ? 'codex' : 'claude',
    harnessCls: row.harness === 'codex' ? 'c-codex' : 'c-claude',
    name: renamed || idn.name, face: idn.face, tag: idn.tag, titled: !!renamed,
    state,
    stateReason: reason,
    tier,
    narrative,
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
    path: row.path,
    cwd: row.cwd || '',
    lastUser: row.lastUser || '',
    prevAgent: row.prevAgent || '',
    row,
  };
}

// disambiguate display names within the CURRENT visible fleet: when >=2 agents
// resolve to the same base name, assign a POSITIONAL suffix (1,2,3...) after
// sorting the colliding group by id. This is guaranteed unique + deterministic
// (same id -> same tag as long as the colliding set is stable), so no two
// visible agents can ever share a display name.
function computeDisplayNames(list) {
  const groups = {};
  for (const a of list) {
    a.dupe = false;
    (groups[a.name] || (groups[a.name] = [])).push(a);
  }
  for (const name in groups) {
    const g = groups[name];
    if (g.length < 2) { g[0].dupe = false; continue; }
    g.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    g.forEach((a, i) => { a.dupe = true; a.tag = String(i + 1); });
  }
}
function displayName(a) {
  return a.name + (a.dupe ? ' ' + a.tag : '');
}
// Honest tooltip: the state, WHY (the reader's reason or the note), and the
// attention tier when the session is drifting or archived.
function stateTip(a) {
  const parts = [STATE[a.state].label];
  if (a.stateReason) parts.push(a.stateReason);
  if (a.tier !== 'hot') parts.push(TIERS[a.tier].label + (a.tier === 'drifting' ? ' (idle 24h to 7d)' : ' (idle over 7d)'));
  return parts.join(' · ');
}
function nameHtml(a) {
  return esc(a.name) + (a.dupe ? `<span class="idtag">${esc(a.tag)}</span>` : '');
}

// ============================================================
// live state
// ============================================================
let agents = [];             // mapped agents (from allRows)
let byId = new Map();
let allRows = [], status = null, allNotes = [], demo = false;
let mode = 'focus';
let selId = null;
let expId = null;            // triage inline-expand
let theme = 'dark';         // 'dark' | 'light'
let temp = 'considered';    // 'considered' | 'loud'
let pins = new Set();
let summarizer = 'claude';  // 'claude' | 'codex': which local CLI powers AI summary
let facet = 'timeline';      // watched-agent detail facet: 'timeline' | 'map'
// per-harness resume destination: 'terminal' (default, existing behavior) or
// 'app' (the harness's own desktop app via its deep link). Persisted in state.json.
let openPref = { 'claude-code': 'terminal', codex: 'terminal' };

// The app destination is only offered when the OS reports a real handler for the
// harness's deep link scheme (status.apps, probed in the main process). Honest
// signals: no button for an app that is not installed. Demo mode shows both.
function appAvailable(harness) {
  if (demo) return true;
  const key = harness === 'codex' ? 'codex' : 'claude';
  return !!(status && status.apps && status.apps[key]);
}
// Linear-style pair: the preferred destination is primary, the other secondary.
// Secondary is null when the desktop app is not installed.
function resumeActs(a) {
  const term = { act: 'resume-term', label: 'Resume in terminal' };
  if (!appAvailable(a.harness)) return { primary: term, secondary: null };
  const app = { act: 'resume-app', label: a.harness === 'codex' ? 'Open in Codex app' : 'Resume in Claude app' };
  return openPref[a.harness] === 'app' ? { primary: app, secondary: term } : { primary: term, secondary: app };
}

// per-agent readSession detail cache (real signals only)
const detailCache = new Map();  // id -> {data, usage, detail} | 'loading' | 'error'

// Live timeline for the watched session: a bounded page of substantive events
// (reader-budgeted, tail-anchored) plus cursor-fed appends pushed by the main
// process for the ONE hot session. Every truncation is an explicit element
// ("~N earlier events not shown · load older"); a spliced timeline is never
// rendered as if complete. Events are stored in file order (oldest first).
const tlState = new Map(); // id -> {events, start, end, atStart, estEarlier, size, lastAt, live, loading, loadingOlder, capped, error}
const TL_STATE_CAP = 12;   // sessions kept
const TL_EVENTS_CAP = 600; // events kept per session before the view is capped
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
    // Reselection: re-arm the hot pump from the cached end offset. The main
    // process primes its cursor there and pumps once immediately, so anything
    // appended while this session was deselected streams in as a catch-up
    // batch; nothing is lost and nothing is re-read twice.
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
    // demo: synthetic page with the truncation affordance visible, marked
    // live. Deferred: ensureTimeline is reached from inside timelineHtml, and
    // a synchronous repaint here would be overwritten by the caller's render.
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
      // arm the hot pump from this page's line-aligned end: appends from here
      // on stream in without waiting for the debounced list refresh.
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
      // merge a tool run cut at the page boundary
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
// Appends pushed by the main process for the hot session. Only the watched
// agent is on this path; everything else keeps the debounced list refresh.
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
    // keep the newest; the cut stays explicit (the affordance becomes a reload)
    tl.events.splice(0, tl.events.length - TL_EVENTS_CAP);
    tl.capped = true; tl.atStart = false; tl.estEarlier = null;
  }
  if (typeof p.end === 'number') tl.end = p.end;
  if (typeof p.size === 'number') tl.size = p.size;
  tl.lastAt = p.at || Date.now();
  tl.live = true;
  if (p.meta && p.meta.customTitle) a.row.customTitle = p.meta.customTitle;
  // live state via the reader's own v3 classifier; note overlays still win
  if (p.need && STATE[p.need.state]) {
    a.row.state = p.need.state; a.row.stateReason = p.need.reason; a.row.tier = p.need.tier;
    const d = deriveState(a.row, allNotes, Date.now());
    a.state = d.state; a.stateReason = d.reason; a.tier = d.tier;
  }
  repaintTimeline(a.id);
}
// Repaint only the facet body: a streaming session must never clobber the ask
// input or the rest of the dossier mid-typing.
function repaintTimeline(id) {
  if (mode !== 'focus' || selId !== id || facet !== 'timeline') return;
  const a = byId.get(id);
  const d = detailCache.get(id);
  if (a && d && d !== 'loading' && d !== 'error') paintFacet(a, d);
}
// "live · updated Ns ago" for the detail header. Real times only: the reader's
// last event timestamp, advanced by real appends.
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
setInterval(() => {
  const a = byId.get(selId);
  if (!a || mode !== 'focus') return;
  const live = liveIndicatorText(a);
  const sub = el('watch-sub');
  if (sub) sub.textContent = a.harnessLabel + (live ? ' · ' + live : (a.when ? ' · ' + a.when : ''));
  const tlv = el('tlLive');
  if (tlv) tlv.textContent = live;
}, 1000);
// Opt-in AI summaries. Each entry is {text, engine, at} so the dossier can say
// which CLI wrote it and how old it is. Persisted via setState so reopening the
// app still shows the last summary with its age; capped to stay tiny.
const summaries = new Map();     // id -> {text, engine, at}
const sumState = new Map();      // id -> 'loading' | {error} (transient, not persisted)
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

// Ask the session: one-turn questions injected into the session through its
// own harness CLI (main process `session:ask`). Exchanges persist via setState
// like summaries, capped per session and across sessions. Codex asks are
// append-mode (the question is written into the real thread), so the first use
// shows a one-line disclosure whose acknowledgement persists as askCodexAck.
const asks = new Map();      // id -> [{q, a, engine, at}] oldest first
const askState = new Map();  // id -> {q, phase:'loading'} | {q, error} (transient)
const askDraft = new Map();  // id -> freeform input text, survives repaints
const askPending = new Map();// id -> question parked behind the codex disclosure
const askRuns = new Map();   // id -> run token, so a stale response never lands
let askAck = false;          // codex append disclosure acknowledged (persisted)
const ASK_XCAP = 20;         // exchanges kept per session
const ASK_SCAP = 40;         // sessions kept
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
// SYNTHETIC FIXTURE (OSS-safe; used only when window.humanctl is absent).
// Clean, non-real ids + generic repos. Never real data. Every content shape
// the v3 state model can emit is covered: question-tail, awaiting-decision,
// interrupted, orphaned reply, in-flight, completed, drifting tier, archived
// tier, plus note overlays (review / blocked / done). Headless one-shot noise
// (summarizer probes, `claude -p`) has no fixture on purpose: the reader
// filters those sessions out before the renderer ever sees them.
// Rows arrive pre-sorted the way the reader sorts: tier, needs-you first,
// depth, recency.
// ============================================================
const FIXTURE_ROWS = [
  // question-tail: final assistant message ends on a question for you
  { harness: 'claude-code', id: 'fixture-a1a1a1a1', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Wire the multi-source update spine', customTitle: 'Multi-source spine, renderer wiring pass', lastRole: 'assistant', state: 'need', stateReason: 'asks you a question', tier: 'hot', age: '2m', ageMs: Date.now() - 2 * 6e4, contextPct: 63, costUSD: 2.14, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: true, lastUser: 'wire the update spine into the renderer', prevAgent: 'Spine is wired. Should the watcher debounce at 2s or 5s?' },
  // awaiting-decision: say-the-word tail, the go is yours
  { harness: 'codex', id: 'rollout-fixture-b2b2', repo: '~/demo/core', cwd: '~/demo/core', title: 'Choose the rename-persistence path', lastRole: 'assistant', state: 'need', stateReason: 'awaiting your go-ahead', tier: 'hot', age: '6m', ageMs: Date.now() - 6 * 6e4, contextPct: 22, apiEquivUSD: 0.88, model: 'gpt-5.5', reasoningEffort: 'xhigh', ultracode: false, lastUser: 'which rename-persistence path should we trust?', prevAgent: 'Both paths verified; say the word and I take path B.' },
  // interrupted: you stopped the turn; only you can resume it
  { harness: 'claude-code', id: 'fixture-h8h8h8h8', repo: '~/demo/exports', cwd: '~/demo/exports', title: 'Backfill the export manifest', lastRole: 'user', state: 'need', stateReason: 'you interrupted; only you can resume', tier: 'hot', age: '18m', ageMs: Date.now() - 18 * 6e4, contextPct: 31, costUSD: 0.66, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'wait, hold off on the manifest rewrite', prevAgent: 'Starting the manifest rewrite now.' },
  // orphaned reply: your directive was never picked up by the agent
  { harness: 'codex', id: 'rollout-fixture-c9c9', repo: '~/demo/ledger', cwd: '~/demo/ledger', title: 'Reconcile the ledger deltas', lastRole: 'user', state: 'need', stateReason: 'your reply was never picked up', tier: 'hot', age: '3h', ageMs: Date.now() - 3 * 3.6e6, contextPct: 44, apiEquivUSD: 1.12, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'yes please, run the reconcile pass', prevAgent: 'Deltas mapped; ready to reconcile on your word.' },
  // review note overlay: content says working, the agent posted a review note
  { harness: 'claude-code', id: 'fixture-c3c3c3c3', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Pull the activity feed', customTitle: 'Activity feed adapter', lastRole: 'assistant', state: 'work', stateReason: 'progress report, still fresh', tier: 'hot', age: '11m', ageMs: Date.now() - 11 * 6e4, contextPct: 38, costUSD: 1.02, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: 'retry the activity pull', prevAgent: 'The activity adapter is built; PR is up.' },
  // blocked note overlay
  { harness: 'codex', id: 'rollout-fixture-d4d4', repo: '~/demo/tokens', cwd: '~/demo/tokens', title: 'Rotate the activity token', lastRole: 'user', state: 'work', stateReason: 'your turn was picked up', tier: 'hot', age: '9m', ageMs: Date.now() - 9 * 6e4, contextPct: 55, apiEquivUSD: 0.63, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'rotate it and rerun the smoke test', prevAgent: 'Token rotation staged.' },
  // in-flight: tool activity still streaming
  { harness: 'codex', id: 'rollout-fixture-e5e5', repo: '~/demo/ledger', cwd: '~/demo/ledger', title: 'Backfill the ledger', lastRole: 'user', state: 'work', stateReason: 'tools in flight', tier: 'hot', age: '1m', ageMs: Date.now() - 1 * 6e4, contextPct: 58, apiEquivUSD: 0.41, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'keep backfilling the ledger', prevAgent: 'At 147 of 188 rows.' },
  // fresh user turn: you just replied, the agent is on it
  { harness: 'claude-code', id: 'fixture-e5e5e5e5', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Extract the sparkline component', lastRole: 'user', state: 'work', stateReason: 'your turn was picked up', tier: 'hot', age: '3m', ageMs: Date.now() - 3 * 6e4, contextPct: 48, costUSD: 0.74, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'extract Spark into a shared component', prevAgent: 'Created the component shell.' },
  // completed: closure-shaped tail, no trailing ask (plus a done note)
  { harness: 'claude-code', id: 'fixture-f6f6f6f6', repo: '~/demo/hygiene', cwd: '~/demo/hygiene', title: 'OSS hygiene sweep', lastRole: 'assistant', state: 'done', stateReason: 'reports completion, no ask', tier: 'hot', age: '24m', ageMs: Date.now() - 24 * 6e4, contextPct: 12, costUSD: 3.40, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: '', prevAgent: 'Swept history; merged and shipped, checks are green.' },
  // idle: progress-shaped tail that went stale without asking anything
  { harness: 'codex', id: 'rollout-fixture-g7g7', repo: '~/demo/icons', cwd: '~/demo/icons', title: 'Draft the squircle icons', lastRole: 'assistant', state: 'idle', stateReason: 'ended without an ask', tier: 'hot', age: '5h', ageMs: Date.now() - 5 * 3.6e6, contextPct: 8, apiEquivUSD: 0.20, model: 'gpt-5.5', reasoningEffort: 'low', ultracode: false, lastUser: '', prevAgent: 'Drafted the squircle variants.' },
  // drifting tier: a real unanswered ask, 2 days old. Listed, dimmed,
  // needs-you shape retained but visually secondary.
  { harness: 'claude-code', id: 'fixture-i9i9i9i9', repo: '~/demo/profiler', cwd: '~/demo/profiler', title: 'Spike the profiler wiring', lastRole: 'assistant', state: 'need', stateReason: 'asks you a question', tier: 'drifting', age: '2d', ageMs: Date.now() - 49 * 3.6e6, contextPct: 41, costUSD: 1.90, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'spike the profiler wiring', prevAgent: 'Spike is parked. Keep the sampling hook or drop it?' },
  // archived tier: over 7 days idle. Dropped from Focus and Triage; the Wall
  // still shows it, dimmed.
  { harness: 'claude-code', id: 'fixture-j0j0j0j0', repo: '~/demo/attic', cwd: '~/demo/attic', title: 'Migrate the icon pipeline', lastRole: 'assistant', state: 'need', stateReason: 'ready for your review', tier: 'archived', age: '9d', ageMs: Date.now() - 9 * 24 * 3.6e6, contextPct: 17, costUSD: 0.95, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'migrate the icon pipeline', prevAgent: 'Pipeline PR is ready for your review.' },
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
  // synthetic transcript blocks (only used in demo mode). Real mode reads live blocks.
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
// Synthetic live-timeline pages (demo mode only): cover the shapes the real
// reader emits, including the explicit truncation affordance (atStart=false)
// and a load-older page that terminates at the start of the session.
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
// Archived sessions (no substantive activity for over 7 days) drop out of the
// default views and counts; the Wall keeps them, dimmed, as the full inventory.
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
// HEADER (shared, never swaps)
// ============================================================
function renderHeader() {
  const r = rollups();
  // Digest numbers come from ONE bucket set (deriveState over the on-desk,
  // non-archived fleet) so they partition it exactly and match the
  // roster/queue group counts. No triple-counting.
  const desk = onDesk();
  const b = { need: 0, block: 0, work: 0, idle: 0, done: 0 };
  for (const a of desk) b[a.state]++;
  const needYou = b.need + b.block;
  const need = desk.filter((a) => a.state === 'need' || a.state === 'block');
  let tail = '';
  if (need.length) {
    const top = need.slice(0, 2);
    // Use disambiguated display names so two colliding agents never render the
    // same bare name. If the top two share a base name, collapse to a count.
    if (top.length >= 2 && top[0].name === top[1].name) {
      tail = ` ${need.length} agents are waiting on you.`;
    } else {
      const names = top.map((a) => displayName(a)).join(' and ');
      tail = ` ${names}${need.length > 2 ? ' and others are' : (need.length === 1 ? ' is' : ' are')} waiting on you.`;
    }
  } else if (b.work) {
    tail = ' All moving, none blocked on you.';
  }
  let digest = `<b>${needYou} need you</b>, ${b.work} moving, ${b.idle} idle`;
  if (b.done) digest += `, ${b.done} done`;
  el('digest').innerHTML = `${digest}.${esc(tail)}`;
  el('heroNum').textContent = needYou;
  const denom = desk.length || 1;
  el('heroShape').innerHTML = svgRing(100 * needYou / denom, hue('var(--s-need)'), 30);
  // Fleet totals live here, once, for every mode. The Focus rail and Triage
  // gutter stay queues and notes; they do not repeat these numbers.
  const claude = r.claudeUSD != null ? fmtUSD(r.claudeUSD) : 'n/a';
  const codex = r.codexUSD != null ? fmtUSD(r.codexUSD) : 'n/a';
  const tokens = r.tokens ? fmtTok(r.tokens) : 'n/a';
  const qp = r.quota && r.quota.primary;
  const quota = qp && qp.used_percent != null ? `quota ${qp.used_percent}%` : '';
  el('totA').textContent = `claude ${claude} · codex ${codex}`;
  el('totB').textContent = `${tokens} tok${quota ? ' · ' + quota : ''}`;
  el('totA').parentElement.title = 'fleet totals (est): claude spend, codex API-equivalent, total tokens, codex 5h quota'
    + (qp && qp.resets_at ? ' (resets ' + fmtReset(qp.resets_at) + ')' : '');
  // Real app injects the package version via IPC; demo/fixture has none, so show
  // "demo" rather than asserting a version number that could drift out of sync.
  el('verTag').textContent = status && status.version ? 'v' + status.version : 'demo';
  el('demoBadge').style.display = demo ? '' : 'none';
}

// ============================================================
// selection (shared across all modes)
// ============================================================
function pickDefaultSelection() {
  if (selId && byId.has(selId)) return;
  const desk = onDesk();
  const need = desk.find((a) => a.state === 'need' || a.state === 'block');
  selId = need ? need.id : (desk[0] ? desk[0].id : (agents[0] ? agents[0].id : null));
}
function select(id, opts) {
  if (!byId.has(id)) return;
  selId = id;
  facet = 'timeline';
  if (window.humanctl) window.humanctl.setState({ selectedId: id });
  if (mode === 'focus') { renderRoster(); renderWatch(); renderConductor(); ensureWatchDetail(); }
  else if (mode === 'triage') { if (opts && opts.expand) expId = (expId === id ? null : id); applyTriageSelection(); }
  else if (mode === 'wall') renderWall();
}

// ============================================================
// FOCUS MODE
// ============================================================
function rosterRow(a) {
  const h2 = hue(STATE[a.state].hue);
  // per-row metric = REAL contextPct (tiny bar). null -> a faint "n/a" placeholder bar.
  const meter = a.ctxPct != null ? svgBar(a.ctxPct, h2, 46, 5) : `<span style="font-family:var(--mono);font-size:8px;color:var(--ink4)">n/a</span>`;
  const isPin = pins.has(a.id);
  return `<div class="arow ${a.id === selId ? 'sel' : ''} ${TIERS[a.tier].cls}" style="--c-sel:${h2}" data-id="${esc(a.id)}" title="${esc(stateTip(a))}">
    <span class="face">${a.face}</span>
    <span class="who"><span class="nm">${nameHtml(a)}</span><span class="rp">${esc(a.repo)}</span></span>
    <span class="spk">${meter}</span>
    <button class="pinbtn ${isPin ? 'on' : ''}" data-pin="${esc(a.id)}" title="${isPin ? 'unpin' : 'pin'}" aria-label="${isPin ? 'unpin' : 'pin'}">&#128204;</button>
    <span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${h2}"></span>
  </div>`;
}
function renderRoster() {
  const box = el('roster');
  const desk = onDesk();
  el('fleet-ct').textContent = desk.length + ' agents';
  let html = '';
  // Pinned group first (humanctl-native pins; neither harness exposes pins locally).
  const pinned = desk.filter((a) => pins.has(a.id));
  if (pinned.length) {
    html += `<div class="grp-hd"><span class="gdot" style="background:var(--iris)"></span>Pinned<span class="gct">${pinned.length}</span></div>`;
    for (const a of pinned) html += rosterRow(a);
  }
  for (const g of GROUPS) {
    const items = desk.filter((a) => a.state === g.k && !pins.has(a.id));
    if (!items.length) continue;
    const h = hue(STATE[g.k].hue);
    // The queue in the right rail owns needs-you and blocked. The roster keeps
    // the inventory honest with a slim count line that jumps to the queue,
    // instead of repeating the same sessions as full rows on both sides.
    if (g.k === 'need' || g.k === 'block') {
      html += `<div class="grp-hd jump" data-jump="${g.k}" title="handled in the queue on the right"><span class="gdot" style="background:${h}"></span>${g.label}<span class="gct">${items.length}</span><span class="gjump">in queue &rarr;</span></div>`;
      continue;
    }
    html += `<div class="grp-hd"><span class="gdot" style="background:${h}"></span>${g.label}<span class="gct">${items.length}</span></div>`;
    for (const a of items) html += rosterRow(a);
  }
  box.innerHTML = html || `<div class="watch-empty">no sessions in the last 72h.</div>`;
  box.querySelectorAll('.arow').forEach((r) => r.addEventListener('click', () => select(r.dataset.id)));
  box.querySelectorAll('.pinbtn').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); togglePin(b.dataset.pin); }));
  box.querySelectorAll('.grp-hd.jump').forEach((hd) => hd.addEventListener('click', () => flashQueue(hd.dataset.jump)));
}
// Pull the eye to the right-rail queue (the owner of needs-you) and select the
// first session of the requested state so the jump lands somewhere concrete.
function flashQueue(state) {
  const desk = onDesk();
  const first = desk.find((a) => a.state === state) || desk.find((a) => a.state === 'need' || a.state === 'block');
  if (first && first.id !== selId) select(first.id);
  const pane = document.querySelector('#mode-focus .pane.right');
  if (!pane) return;
  pane.classList.remove('flash');
  void pane.offsetWidth; // restart the animation on repeat clicks
  pane.classList.add('flash');
  setTimeout(() => pane.classList.remove('flash'), 1000);
}
function togglePin(id) {
  if (pins.has(id)) pins.delete(id); else pins.add(id);
  if (window.humanctl) window.humanctl.setState({ pins: [...pins] });
  renderRoster();
}

function propCell(k, valHtml, na) { return `<div class="cell"><div class="k">${k}</div><div class="v ${na ? 'na' : ''}">${valHtml}</div></div>`; }

function renderWatch() {
  const a = byId.get(selId);
  const w = el('watch');
  if (!a) { el('watch-sub').textContent = ''; w.innerHTML = `<div class="watch-empty">select an agent from the fleet.</div>`; return; }
  const s = STATE[a.state], h = hue(s.hue);
  el('watch-sub').textContent = a.harnessLabel + (a.when ? ' · ' + a.when : '');
  w.style.setProperty('--c-sel', h);

  const ctxCell = a.ctxPct != null
    ? propCell('context', `${svgRing(a.ctxPct, h, 26)}<span class="mono">${a.ctxPct}%</span>`)
    : propCell('context', `<span class="mono">n/a</span>`, true);
  const costCell = a.cost != null
    ? propCell('cost', `<span class="mono">${fmtUSD(a.cost)}</span>`)
    : propCell('cost', `<span class="mono">n/a</span>`, true);
  const modelCell = propCell('model', `<span class="mono">${esc(a.model || 'n/a')}</span>`, !a.model);
  const effortCell = propCell('effort', `<span class="mono">${esc(a.effort || (a.ultracode ? 'ultra' : 'n/a'))}</span>`, !a.effort && !a.ultracode);

  w.innerHTML = `
    <div class="watch-id">
      <div class="face">${a.face}</div>
      <div class="idmeta">
        <div class="row1">
          <h1>${nameHtml(a)}</h1>
          <span class="chip ${s.cls}" title="${esc(stateTip(a))}"><span class="dt"></span>${s.label}</span>
          ${a.tier !== 'hot' ? `<span class="chip c-idle" title="${esc(stateTip(a))}"><span class="dt"></span>${esc(TIERS[a.tier].label)}</span>` : ''}
          <span class="chip ${a.harnessCls}">${a.harnessLabel}</span>
          ${a.ultracode ? '<span class="chip c-claude">ultra</span>' : ''}
        </div>
        <div class="subline">
          <span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${h}"></span>
          <span>${esc(a.repo || 'no repo')}</span>${a.when ? '<span class="sep">·</span><span>updated ' + esc(a.when) + '</span>' : ''}${a.stateReason ? '<span class="sep">·</span><span>' + esc(a.stateReason) + '</span>' : ''}
        </div>
      </div>
    </div>
    <div class="props">${modelCell}${effortCell}${ctxCell}${costCell}</div>
    <div class="latest">
      <div class="lh"><span class="lbl">Latest prompt</span>${a.when ? `<span class="when">${esc(a.when)}</span>` : ''}</div>
      <div class="narr">${esc(a.promptNarr)}</div>
    </div>
    ${summaryBlockHtml(a)}
    ${askBlockHtml(a)}
    <div class="facets" id="facets">
      <button class="facet-tab ${facet === 'timeline' ? 'on' : ''}" data-facet="timeline">Timeline</button>
      <button class="facet-tab ${facet === 'map' ? 'on' : ''}" data-facet="map">Map</button>
    </div>
    <div id="facetBody"></div>`;

  el('facets').querySelectorAll('.facet-tab').forEach((b) => b.addEventListener('click', () => {
    facet = b.dataset.facet; renderWatch(); ensureWatchDetail();
  }));
  wireAsk(a);
  renderDock(a, h);
}

// The AI summary's home: a labeled block in the dossier, directly under the
// latest prompt. The dock button points up at it. Renders loading / error /
// result (with engine + age); absent until a summary is asked for.
function summaryBlockHtml(a) {
  const st = sumState.get(a.id);
  if (st === 'loading') {
    return `<div class="sumblock load" id="sumBlock">
      <div class="lh"><span class="lbl">AI summary</span><span class="meta">via ${esc(engineLabel(summarizer))} CLI</span></div>
      <div class="txt">summarizing recent activity...</div>
    </div>`;
  }
  if (st && st.error) {
    return `<div class="sumblock err" id="sumBlock">
      <div class="lh"><span class="lbl">AI summary failed</span></div>
      <div class="txt">${esc(st.error)} Use the dock button to retry.</div>
    </div>`;
  }
  const s = a.summary;
  if (!s) return '';
  return `<div class="sumblock" id="sumBlock">
    <div class="lh"><span class="lbl">AI summary</span><span class="meta">via ${esc(engineLabel(s.engine))}${s.at ? ' · ' + esc(agoTxt(s.at)) : ''}</span></div>
    <div class="txt">${esc(s.text)}</div>
  </div>`;
}

// Ask the session: the dossier's question box, directly under the AI summary.
// Three quick prompts plus a freeform input; answers land in a compact thread
// of question/answer pairs with engine + age, persisted like summaries. The
// header carries the honest per-harness footprint: a Claude ask leaves no
// trace in the session (--no-session-persistence, verified byte-identical);
// a Codex ask writes a marked question into the thread itself, so its first
// use shows a one-line disclosure and the acknowledgement persists.
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
    // The main process refuses this too; say so up front instead of offering
    // a button that cannot work while the thread is live.
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
  if (!blk) return;
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
function runAsk(a, q) {
  q = String(q || '').trim();
  if (!q) return;
  const st = askState.get(a.id);
  if (st && st.phase === 'loading') return;
  // Codex append disclosure: park the question until the one-time confirm.
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
  if (!window.humanctl) {
    // demo: land a fixture answer after a beat so the loading state is visible
    setTimeout(() => settle({ q, a: fixtureAnswer(a, q), engine, at: Date.now() }), 1100);
    return;
  }
  try {
    const r = await window.humanctl.askSession({ id: a.id, harness: a.harness, path: a.path, cwd: a.cwd, question: q });
    if (r && r.ok && r.answer) settle({ q, a: r.answer, engine: r.engine || engine, at: r.at || Date.now() });
    else if (r && r.needsAck) { askState.delete(a.id); askAck = false; askPending.set(a.id, q); repaintAsk(a.id); }
    else settle(null, r && r.error);
  } catch (e) { settle(null, String((e && e.message) || e)); }
}
// demo-mode answers, clearly synthetic (fixture fleet only; never real data)
function fixtureAnswer(a, q) {
  if (/^status/i.test(q)) return 'Mid-flight on the ' + (a.repo || 'demo') + ' work: the last verified step landed cleanly and the next one is queued.';
  if (/need from me/i.test(q)) return 'One decision is open (see the latest prompt above); everything else is proceeding without you.';
  if (/^summarize/i.test(q)) return 'This thread set up the task, verified the approach against fixtures, and is now closing out the remaining edge cases.';
  return 'Synthetic demo answer: in the real app this comes from the session itself, through your local ' + engineLabel(a.harness === 'codex' ? 'codex' : 'claude') + ' CLI.';
}
function repaintAsk(id) {
  if (mode === 'focus' && selId === id) { renderWatch(); ensureWatchDetail(); }
}

function renderDock(a, h) {
  const dock = el('dock');
  dock.style.setProperty('--c-sel', h);
  const det = detailCache.get(a.id);
  const hasLinear = det && det !== 'loading' && det !== 'error' && det.detail && det.detail.linearRefs && det.detail.linearRefs.length;
  // read-only + resume only. every state resumes except done (which reveals).
  // resume splits per harness into terminal / desktop-app destinations; the
  // preferred one (settings) is primary, the other stays one click away.
  const ra = resumeActs(a);
  const primaryLabel = a.state === 'done' ? 'Reveal transcript' : ra.primary.label;
  const primaryAct = a.state === 'done' ? 'reveal' : ra.primary.act;
  const sumLoading = sumState.get(a.id) === 'loading';
  const sumLabel = sumLoading ? 'Summarizing...' : (summaries.has(a.id) ? 'Refresh AI summary &uarr;' : 'AI summary &uarr;');
  dock.innerHTML = `
    <button class="btn primary" data-act="${primaryAct}">${primaryLabel}</button>
    ${a.state === 'done' ? `<button class="btn" data-act="${ra.primary.act}">${ra.primary.label}</button>` : ''}
    ${ra.secondary ? `<button class="btn" data-act="${ra.secondary.act}">${ra.secondary.label}</button>` : ''}
    ${a.state === 'done' ? '' : `<button class="btn" data-act="reveal">Reveal transcript</button>`}
    <button class="btn ghost" data-act="linear" ${hasLinear ? '' : 'disabled'}>Open in Linear</button>
    <button class="btn ghost" data-act="summary" ${sumLoading ? 'disabled' : ''} title="writes a summary into the dossier above; sends recent messages to your local ${esc(engineLabel(summarizer))} CLI">${sumLabel}</button>
    <span class="spacer"></span>
    <span class="hint">${esc(a.harnessLabel)}${a.model ? ' · ' + esc(a.model) : ''}${a.effort ? ' · ' + esc(a.effort) : ''}</span>`;
  dock.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act, a)));
}

// build + render the watched-agent detail facet (timeline | map) from REAL data.
function ensureWatchDetail() {
  const body = el('facetBody');
  if (!body) return;
  const a = byId.get(selId);
  if (!a) { body.innerHTML = ''; return; }
  const cached = detailCache.get(a.id);
  if (cached === 'loading') { body.innerHTML = `<div class="tl-empty">reading transcript...</div>`; return; }
  if (cached && cached !== 'error') { paintFacet(a, cached); return; }
  if (cached === 'error') { body.innerHTML = `<div class="tl-empty">could not read this session.</div>`; return; }
  // fetch
  body.innerHTML = `<div class="tl-empty">reading transcript...</div>`;
  loadDetail(a).then(() => { if (selId === a.id && mode === 'focus') paintFacet(a, detailCache.get(a.id)); });
}

function paintFacet(a, d) {
  const body = el('facetBody');
  if (!body || !d || d === 'loading' || d === 'error') return;
  if (facet === 'map') { body.innerHTML = mapFacetHtml(d); bindMap(); return; }
  body.innerHTML = timelineHtml(a, d) + sparkHtml(a, d);
  bindTimeline(body, a, d);
}

// ---- REAL multi-source timeline (watched agent only) ----
// `full` mode (triage drawer) keeps the compact one-glance shape: notes, last
// exchange, refs, and a few recent blocks. The Focus dossier passes
// full=false and renders the live event timeline below the overlay instead
// (the real messages supersede the lastExchange summary there).
function buildTimeline(a, d, full = true) {
  const evs = [];
  const detail = (d && d.detail) || {};
  const blocks = (d && d.data && d.data.blocks) || [];
  const myNotes = allNotes.filter((n) => n.session && n.session === a.id);
  const NLHUE = { blocked: 'var(--s-block)', review: 'var(--s-need)', done: 'var(--s-done)', fyi: 'var(--iris)' };

  // notes for this session (level-colored)
  for (const n of myNotes) {
    evs.push({ src: 'note · ' + n.level, cvar: NLHUE[n.level] || 'var(--iris)', msg: esc(n.message) });
  }
  // last exchange (you asked / agent)
  if (full) {
    const ex = detail.lastExchange || {};
    if (ex.lastUser) evs.push({ src: 'you asked', cvar: 'var(--iris)', msg: esc(ex.lastUser) });
    if (ex.prevAgent) evs.push({ src: 'agent', cvar: 'var(--s-done)', msg: esc(ex.prevAgent) });
  }
  // linear refs
  for (const l of (detail.linearRefs || [])) {
    evs.push({ src: 'linear', cvar: 'var(--h-claude)', msg: 'linear · ' + esc(l.label || l.url), url: l.url });
  }
  // generated html files
  for (const f of (detail.htmlFiles || [])) {
    const base = String(f).replace(/^.*\/(?=[^/]+$)/, '');
    evs.push({ src: 'generated', cvar: 'var(--s-work)', msg: 'generated <code>' + esc(base) + '</code>', path: f });
  }
  // skills used
  const skills = detail.skillsUsed || {};
  const sk = Object.keys(skills).sort((x, y) => skills[y] - skills[x]);
  if (sk.length) {
    evs.push({ src: 'skills', cvar: 'var(--iris)', msg: sk.map((s) => `<code>${esc(s)}</code> x${skills[s]}`).join(' · ') });
  }
  if (full) {
    // recent activity: last few real blocks (kind + preview)
    const tail = blocks.slice(-4).reverse();
    for (const b of tail) {
      evs.push({ src: KIND_LABEL[b.kind] || b.kind, cvar: 'var(--ink3)', msg: esc((b.preview || '').slice(0, 160)) || '(no preview)' });
    }
  }
  return evs;
}
const TL_KLBL = { user: 'you', assistant: 'agent', interrupt: 'interrupted', tools: 'tools' };
const TL_KHUE = { user: 'var(--iris)', assistant: 'var(--s-done)', interrupt: 'var(--s-block)', tools: 'var(--ink3)' };
// The live activity stream: real substantive events, newest first, with real
// per-event timestamps, an explicit truncation element at the old end, and a
// terminator when the timeline verifiably reaches the start of the session.
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
  const overlay = buildTimeline(a, d, false);
  let html = `<div class="tl-head"><span class="lbl">Activity</span><span class="tl-live" id="tlLive">${esc(liveIndicatorText(a))}</span></div>`;
  html += `<div class="tl">`;
  overlay.forEach((e) => {
    const clickable = e.url || e.path;
    html += `<div class="tevt ${clickable ? 'click' : ''}" style="--src:${e.cvar}" ${e.url ? `data-url="${esc(e.url)}"` : ''} ${e.path ? `data-path="${esc(e.path)}"` : ''}>
      <div class="top"><span class="src">${esc(e.src)}</span></div>
      <div class="msg">${e.msg}</div>
    </div>`;
  });
  const tl = tlState.get(a.id);
  if (!tl || tl.loading) { ensureTimeline(a); html += `<div class="tl-empty">reading timeline...</div>`; }
  else if (tl.error) html += `<div class="tl-empty">${esc(tl.error)}</div>`;
  else html += liveEventsHtml(a, tl);
  html += `</div>`;
  return html;
}
function bindTimeline(root, a, d) {
  root.querySelectorAll('.tevt[data-url]').forEach((n) => n.addEventListener('click', () => { const u = n.getAttribute('data-url'); if (u && window.humanctl) window.humanctl.openExternal(u); else if (u) toast('would open ' + u); }));
  root.querySelectorAll('.tevt[data-path]').forEach((n) => n.addEventListener('click', () => { const p = n.getAttribute('data-path'); if (p && window.humanctl) window.humanctl.openPath(p); else if (p) toast('would open ' + p); }));
  const older = root.querySelector('#tlOlder');
  if (older) older.addEventListener('click', () => loadOlderTimeline(a));
}

// ---- REAL sparkline: cumulative running sum of block.tokens, downsampled to ~24 ----
function cumulativeSeries(blocks, points) {
  points = points || 24;
  if (!blocks || !blocks.length) return null;
  let acc = 0; const cum = blocks.map((b) => (acc += (b.tokens || 0)));
  if (cum.length <= points) return cum;
  const out = []; const step = (cum.length - 1) / (points - 1);
  for (let i = 0; i < points; i++) out.push(cum[Math.round(i * step)]);
  return out;
}
function sparkHtml(a, d) {
  const blocks = (d && d.data && d.data.blocks) || [];
  const series = cumulativeSeries(blocks, 24);
  if (!series || series.length < 2) return '';
  const h = hue(STATE[a.state].hue);
  const total = series[series.length - 1];
  return `<div class="spark-wrap">
    <div class="sh"><span class="lbl">Context growth</span><span class="note">cumulative tokens · ${fmtTok(total)} total · ${blocks.length} blocks</span></div>
    <div class="sbody">${svgSpark(series, h, 320, 56, true)}</div>
  </div>`;
}

// ---- context MAP facet (ported from old renderer block-square viz) ----
function mapFacetHtml(d) {
  const blocks = (d && d.data && d.data.blocks) || [];
  if (!blocks.length) return `<div class="tl-empty">no transcript blocks to map.</div>`;
  const levelFor = (t) => (t > 5000 ? 5 : t > 1500 ? 4 : t > 500 ? 3 : t > 100 ? 2 : 1);
  // tokens may be null on real blocks; coerce to 0 everywhere so no NaN renders.
  const totals = {}; for (const b of blocks) totals[b.kind] = (totals[b.kind] || 0) + (b.tokens || 0);
  let pacc = 0; const protSet = new Set();
  for (let i = blocks.length - 1; i >= 0 && pacc < 20000; i--) { pacc += (blocks[i].tokens || 0); protSet.add(i); }
  const squares = blocks.map((b, i) => { const tok = b.tokens || 0; return `<div class="sq k-${b.kind} l${levelFor(tok)}${protSet.has(i) ? ' prot' : ''}" data-k="${esc(KIND_LABEL[b.kind] || b.kind)}" data-t="${tok}" data-p="${esc(b.preview || '')}"></div>`; }).join('');
  const legend = KIND_ORDER.filter((k) => totals[k]).map((k) => `<span class="li"><span class="sw k-${k}"></span>${esc(KIND_LABEL[k])} <b>${fmtTok(totals[k])}t</b></span>`).join('');
  // Honest truncation: the reader is tail-anchored, so a capped map shows the
  // NEWEST portion and says how much earlier material is not shown.
  let trunc = '';
  if (d.data && d.data.truncated) {
    const mb = d.data.skippedHeadBytes ? (d.data.skippedHeadBytes / 1048576).toFixed(1) : null;
    trunc = `<div class="trunc">large session: latest portion shown${mb ? ` (~${mb}MB earlier not shown)` : ''}.</div>`;
  }
  return `<div class="map-hint">one square per block · shade = token weight · outlined = live tail</div>
    <div class="cmap">${squares}</div>
    <div class="legend">${legend}</div>
    ${trunc}`;
}
function bindMap() {
  const tip = el('ctip');
  const map = el('facetBody') && el('facetBody').querySelector('.cmap');
  if (!map || !tip) return;
  map.addEventListener('mousemove', (e) => {
    const s = e.target.closest('.sq');
    if (!s) { tip.classList.remove('on'); return; }
    tip.innerHTML = `<div class="ck">${esc(s.dataset.k)} · ${(+s.dataset.t || 0).toLocaleString()} tok</div><div class="cp">${esc(s.dataset.p)}</div>`;
    tip.classList.add('on');
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 350) + 'px';
    tip.style.top = (e.clientY + 16) + 'px';
  });
  map.addEventListener('mouseleave', () => tip.classList.remove('on'));
}

// ---- right rail: the needs-you queue. This surface OWNS needs-you; the left
// roster only points here. Fleet totals live in the header, not in this rail.
function renderConductor() {
  const cond = el('cond');
  // Hot first; drifting keeps its needs-you shape but renders dimmed at the
  // bottom of the queue (the reader already sorts tiers; keep that order).
  const need = onDesk().filter((a) => a.state === 'need' || a.state === 'block');
  const queue = need.map((a) => {
    const h = hue(STATE[a.state].hue);
    return `<div class="qrow ${a.id === selId ? 'sel' : ''} ${TIERS[a.tier].cls}" style="--c-sel:${h}" data-id="${esc(a.id)}" title="${esc(stateTip(a))}">
      <span class="face">${a.face}</span>
      <span class="who"><span class="nm">${nameHtml(a)}</span><span class="rz">${esc(a.stateReason || STATE[a.state].label)} · ${esc(a.repo || 'no repo')}</span></span>
      <span class="chip ${STATE[a.state].cls}"><span class="dt"></span>${esc((a.tier === 'drifting' ? 'drifting · ' : '') + (a.when || ''))}</span>
    </div>`;
  }).join('') || `<div class="queue-empty">nothing needs you right now.</div>`;

  cond.innerHTML = `
    <div>
      <div class="sec-l">Needs you now <span class="ct">${need.length}</span></div>
      <div class="queue">${queue}</div>
    </div>`;
  cond.querySelectorAll('.qrow').forEach((r2) => r2.addEventListener('click', () => select(r2.dataset.id)));
}

function renderFocus() { renderRoster(); renderWatch(); renderConductor(); ensureWatchDetail(); }

// ============================================================
// TRIAGE MODE
// ============================================================
const tGroupOpen = { need: true, block: true, work: true, idle: false, done: false };
function tGroupsBuild() {
  const sorted = [...onDesk()].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  return [
    { state: 'need', label: 'needs you', items: sorted.filter((a) => a.state === 'need'), clickable: false },
    { state: 'block', label: 'blocked', items: sorted.filter((a) => a.state === 'block'), clickable: false },
    { state: 'work', label: 'working', items: sorted.filter((a) => a.state === 'work'), clickable: true },
    { state: 'idle', label: 'idle', items: sorted.filter((a) => a.state === 'idle'), clickable: true },
    { state: 'done', label: 'done', items: sorted.filter((a) => a.state === 'done'), clickable: true },
  ];
}
function tItemHTML(a) {
  const st = STATE[a.state], h = hue(st.hue);
  const meta = a.ctxPct != null ? `ctx ${a.ctxPct}%` : (a.cost != null ? fmtUSD(a.cost) : (a.model || ''));
  return `<div class="item ${TIERS[a.tier].cls}" data-id="${esc(a.id)}" style="--c-state:${h}">`
    + `<div class="row" tabindex="0" title="${esc(stateTip(a))}">`
    + `<span class="rface"><span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${h}"></span><span class="em">${a.face}</span></span>`
    + `<span class="who2"><span class="nm">${nameHtml(a)}</span><span class="hn">${esc(a.harnessLabel)}</span></span>`
    + `<span class="rnarr">${a.aiNarr ? '<span class="ai">ai</span>' : ''}${esc(a.narrative)}</span>`
    + `<span class="chip ${st.cls}"><span class="dt"></span>${st.label}</span>`
    + `<span class="rmeta"><span class="rdelta">${esc(meta)}</span></span>`
    + `<span class="rwhen">${esc(a.when || '')}</span>`
    + `</div>`
    + `<div class="drawer"><div class="drawer-in" data-drawer="${esc(a.id)}"></div></div>`
    + `</div>`;
}
function tDrawerHTML(a, d) {
  const h = hue(STATE[a.state].hue);
  const propItems = [
    ['why', esc(a.stateReason || STATE[a.state].label) + (a.tier !== 'hot' ? ' · ' + esc(TIERS[a.tier].label) : '')],
    ['repo', esc(a.repo || 'n/a')],
    ['harness', `<span class="chip ${a.harnessCls}"><span class="dt"></span>${esc(a.harnessLabel)}</span>`],
    ['model', esc((a.model || 'n/a') + (a.effort ? ' · ' + a.effort : ''))],
    ['context', a.ctxPct != null ? `${svgBar(a.ctxPct, h, 44, 5)} ${a.ctxPct}%` : 'n/a'],
    ['cost', a.cost != null ? esc(fmtUSD(a.cost)) : 'n/a'],
  ];
  const props = `<div class="dprops">${propItems.map((p) => `<div class="dprop"><span class="k">${p[0]}</span><span class="v">${p[1]}</span></div>`).join('')}</div>`;

  let tl;
  if (d === 'loading' || !d) tl = `<div class="dtl"><div class="th">timeline · multi-source</div><div class="ev"><span class="tick"></span><span class="src">...</span><span class="txt">reading transcript...</span></div></div>`;
  else if (d === 'error') tl = `<div class="dtl"><div class="th">timeline · multi-source</div><div class="ev"><span class="txt">could not read this session.</span></div></div>`;
  else {
    const evs = buildTimeline(a, d).slice(0, 6);
    const rows = evs.length ? evs.map((e, i) => {
      const clickable = e.url || e.path;
      const strip = String(e.msg).replace(/<[^>]+>/g, '');
      return `<div class="ev ${i === 0 ? 'hot' : ''} ${clickable ? 'click' : ''}" ${e.url ? `data-url="${esc(e.url)}"` : ''} ${e.path ? `data-path="${esc(e.path)}"` : ''}>`
        + `<span class="tick"></span><span class="src">${esc(e.src)}</span>`
        + `<span class="txt">${esc(strip)}</span><span class="tw">${i === 0 && a.when ? esc(a.when) : ''}</span></div>`;
    }).join('') : `<div class="ev"><span class="txt">no recorded signals yet.</span></div>`;
    tl = `<div class="dtl"><div class="th">timeline · multi-source</div>${rows}</div>`;
  }

  const det = (d && d !== 'loading' && d !== 'error') ? d.detail : null;
  const hasLinear = det && det.linearRefs && det.linearRefs.length;
  const ra = resumeActs(a);
  const primeLabel = a.state === 'done' ? 'Reveal' : ra.primary.label;
  const primeAct = a.state === 'done' ? 'reveal' : ra.primary.act;
  const sumLoading = sumState.get(a.id) === 'loading';
  const sumLabel = sumLoading ? 'Summarizing...' : (summaries.has(a.id) ? 'Refresh AI summary' : 'AI summary');
  const acts = `<div class="acts">`
    + `<button class="abtn prime" data-act="${primeAct}">${primeLabel} <kbd>${a.state === 'done' ? 'r' : '↵'}</kbd></button>`
    + (a.state === 'done' ? `<button class="abtn" data-act="${ra.primary.act}">${ra.primary.label}</button>` : '')
    + (ra.secondary ? `<button class="abtn" data-act="${ra.secondary.act}">${ra.secondary.label}</button>` : '')
    + (a.state === 'done' ? '' : `<button class="abtn" data-act="reveal">Reveal</button>`)
    + `<button class="abtn" data-act="linear" ${hasLinear ? '' : 'disabled'}>Linear</button>`
    + `<button class="abtn" data-act="summary" ${sumLoading ? 'disabled' : ''} title="replaces this row's line with an AI summary; sends recent messages to your local ${esc(engineLabel(summarizer))} CLI">${sumLabel}</button>`
    + `<span class="fill"></span>`
    + `</div>`;
  return props + tl + acts;
}
function renderTriage() {
  const col = el('col');
  col.innerHTML = tGroupsBuild().map((g) => {
    const st = STATE[g.state]; const open = g.clickable ? tGroupOpen[g.state] : true;
    const sec = `<div class="tsec ${g.clickable ? 'click' : ''} ${open ? 'open' : ''}" data-grp="${g.state}">`
      + (g.clickable ? `<span class="caret">▸</span>` : '')
      + `<span class="lab"><span class="hb" style="width:6px;height:6px;background:${hue(st.hue)}"></span>${g.label} <span class="n">(${g.items.length})</span></span>`
      + `<span class="line"></span>`
      + (g.clickable ? `<span class="hint">${open ? 'hide' : 'show ' + g.items.length}</span>` : '')
      + `</div>`;
    let body = '';
    if (open) body = `<div class="rows">${g.items.map(tItemHTML).join('')}</div>`;
    return sec + body;
  }).join('') || `<div class="tl-empty">no sessions in the last 72h.</div>`;
  renderGutter();
  wireTriage();
  applyTriageSelection();
}
function renderGutter() {
  // keys + recent notes only: fleet totals live in the header for every mode.
  const g = el('gutter');
  const recent = allNotes.slice(0, 4).map((n) => {
    const NLHUE = { blocked: 'var(--s-block)', review: 'var(--s-need)', done: 'var(--s-done)', fyi: 'var(--iris)' };
    return `<div class="tnote" style="--nl:${NLHUE[n.level] || 'var(--iris)'}"><div class="nl">${esc(n.level)}</div><div class="nm">${esc(n.message)}</div><div class="nmeta">${esc(n.repo || '')}</div></div>`;
  }).join('');
  g.innerHTML =
    `<div class="kbar"><div class="kh">keys</div>`
    + `<span class="kk"><kbd>j</kbd><kbd>k</kbd> move</span>`
    + `<span class="kk"><kbd>↵</kbd> open</span>`
    + `<span class="kk"><kbd>esc</kbd> close</span></div>`
    + (recent ? `<div class="gh" style="margin-top:8px">recent notes</div>${recent}` : '');
}
function applyTriageSelection() {
  document.querySelectorAll('#col .item').forEach((it) => {
    const id = it.dataset.id;
    const row = it.querySelector('.row');
    row.classList.toggle('sel', id === selId && id !== expId);
    const open = id === expId;
    it.classList.toggle('exp', open);
    const dr = it.querySelector('.drawer');
    const inner = it.querySelector('.drawer-in');
    dr.style.transition = RM ? 'none' : 'height .18s ease';
    if (open) {
      const a = byId.get(id);
      // fill drawer with real detail (lazy)
      const d = detailCache.get(id);
      inner.innerHTML = tDrawerHTML(a, d || 'loading');
      wireDrawer(inner, a);
      if (d == null) loadDetail(a).then(() => { if (expId === id) { inner.innerHTML = tDrawerHTML(a, detailCache.get(id)); wireDrawer(inner, a); dr.style.height = inner.offsetHeight + 'px'; } });
      dr.style.height = 'auto'; dr.style.height = inner.offsetHeight + 'px';
    } else { dr.style.height = '0px'; }
  });
}
function wireDrawer(inner, a) {
  inner.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); runAction(b.dataset.act, a); }));
  inner.querySelectorAll('.ev[data-url]').forEach((n) => n.addEventListener('click', () => { const u = n.getAttribute('data-url'); if (u && window.humanctl) window.humanctl.openExternal(u); }));
  inner.querySelectorAll('.ev[data-path]').forEach((n) => n.addEventListener('click', () => { const p = n.getAttribute('data-path'); if (p && window.humanctl) window.humanctl.openPath(p); }));
}
function tVisible() { return [...document.querySelectorAll('#col .item')].map((it) => it.dataset.id); }
function tSelect(id, expand) {
  selId = id;
  if (window.humanctl) window.humanctl.setState({ selectedId: id });
  if (expand) expId = (expId === id ? null : id);
  applyTriageSelection();
  const it = document.querySelector(`#col .item[data-id="${CSS.escape(id)}"]`);
  if (it) it.scrollIntoView({ block: 'nearest' });
}
function tMove(dir) {
  const list = tVisible(); if (!list.length) return;
  let i = list.indexOf(selId); i = i < 0 ? 0 : clamp(i + dir, 0, list.length - 1);
  tSelect(list[i], false);
}
function wireTriage() {
  document.querySelectorAll('#col .item .row').forEach((row) => {
    const id = row.closest('.item').dataset.id;
    row.addEventListener('click', () => tSelect(id, true));
  });
  document.querySelectorAll('#col .tsec.click').forEach((sec) => {
    sec.addEventListener('click', () => { const s = sec.dataset.grp; tGroupOpen[s] = !tGroupOpen[s]; renderTriage(); });
  });
}

// ============================================================
// WALL MODE (scrollable tile grid of ALL agents)
// ============================================================
function renderWall() {
  const grid = el('grid');
  grid.innerHTML = agents.map((a) => {
    const st = STATE[a.state], stHue = hue(st.hue);
    const isSel = a.id === selId;
    const d = isSel ? detailCache.get(a.id) : null;
    const series = (d && d !== 'loading' && d !== 'error') ? cumulativeSeries((d.data && d.data.blocks) || [], 24) : null;
    // selected tile: real sparkline if we have it; else ctx ring. others: ctx ring.
    let viz;
    if (isSel && series && series.length > 1) viz = `<div class="t-spark">${svgSpark(series, stHue, 240, 60, true)}</div>`;
    else if (a.ctxPct != null) viz = `<div class="t-ring">${svgRing(a.ctxPct, stHue, 54)}</div>`;
    else viz = `<div class="t-ring"><span class="na" style="font-family:var(--mono);font-size:9px;color:var(--ink4)">ctx n/a</span></div>`;
    const meter = a.ctxPct != null
      ? `<div class="t-meter" title="context window used"><span class="lab">ctx</span>${svgBar(a.ctxPct, stHue, 100, 5)}<span class="pct">${a.ctxPct}%</span></div>`
      : `<div class="t-meter"><span class="lab">ctx</span><span class="na">n/a</span></div>`;
    const act = a.state === 'done' ? 'reveal' : 'resume';
    return `
      <article class="tile ${isSel ? 'active' : ''} ${TIERS[a.tier].cls}" data-id="${esc(a.id)}" style="--st:${st.hue}" title="${esc(stateTip(a))}">
        <div class="t-head">
          <span class="t-face">${a.face}</span>
          <span class="t-name">${nameHtml(a)}</span>
          <span class="hb t-hb ${a.state === 'work' ? 'beat' : ''}" style="background:${st.hue}"></span>
          <span class="spacer"></span>
          ${a.tier !== 'hot' ? `<span class="chip c-idle"><span class="dt"></span>${esc(TIERS[a.tier].label)}</span>` : ''}
          <span class="chip ${a.harnessCls}"><span class="dt"></span>${esc(a.harnessLabel)}</span>
        </div>
        ${viz}
        <div class="t-body">
          <p class="t-narr">${a.aiNarr ? '<span class="ai">ai</span>' : ''}${esc(a.narrative)}</p>
          ${meter}
        </div>
        <div class="t-foot">
          <span class="m mdl">${esc(a.model || '')}</span>
          <span class="m">${a.cost != null ? esc(fmtUSD(a.cost)) : ''}</span>
          <span class="spacer"></span>
          <span class="m when">${esc(a.when || '')}</span>
          <button class="t-act" data-act="${act}">${act}</button>
        </div>
      </article>`;
  }).join('') + fleetCell();

  grid.querySelectorAll('.tile[data-id]').forEach((elt) => {
    elt.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      const id = elt.dataset.id;
      if (act) { e.stopPropagation(); runAction(act.dataset.act, byId.get(id)); return; }
      selId = id;
      if (window.humanctl) window.humanctl.setState({ selectedId: id });
      loadDetail(byId.get(id)).then(() => { if (mode === 'wall') renderWall(); });
      openPeek(id); renderWall();
    });
  });
}
function fleetCell() {
  const order = ['need', 'block', 'work', 'idle', 'done'];
  const counts = order.map((k) => ({ k, n: agents.filter((a) => a.state === k).length, st: STATE[k] })).filter((x) => x.n > 0);
  const denom = agents.length || 1;
  const bars = counts.map((c) => {
    const w = svgBar(100 * c.n / denom, hue(c.st.hue), 100, 5);
    return `<div class="fc-row"><span class="chip ${c.st.cls}"><span class="dt"></span>${c.st.label}</span><span class="fc-bar">${w}</span><span class="fc-n">${c.n}</span></div>`;
  }).join('');
  const r = rollups();
  const spend = (r.claudeUSD != null || r.codexUSD != null) ? fmtUSD((r.claudeUSD || 0) + (r.codexUSD || 0)) : 'n/a';
  let resetTxt = '';
  if (r.quota && r.quota.primary && r.quota.primary.resets_at) resetTxt = 'resets ' + fmtReset(r.quota.primary.resets_at);
  return `
    <aside class="tile fleet" aria-label="fleet summary">
      <div class="t-head">
        <span class="t-face">\u{1F6F0}️</span>
        <span class="t-name">Fleet</span>
        <span class="spacer"></span>
        <span class="chip c-idle"><span class="dt"></span>${agents.length} agents</span>
      </div>
      <div class="fc-rows">${bars || '<div class="tl-empty">no agents</div>'}</div>
      <div class="t-foot">
        <span class="m">${spend} today</span>
        <span class="spacer"></span>
        <span class="m when">${esc(resetTxt)}</span>
      </div>
    </aside>`;
}

// ---- floating peek (Wall transient surface) ----
function openPeek(id) {
  const a = byId.get(id); if (!a) return;
  const st = STATE[a.state], h = hue(st.hue);
  const d = detailCache.get(id);
  const hasLinear = d && d !== 'loading' && d !== 'error' && d.detail && d.detail.linearRefs && d.detail.linearRefs.length;
  const props = [
    ['why', a.stateReason || STATE[a.state].label], ['tier', a.tier],
    ['repo', a.repo || 'n/a'], ['harness', a.harnessLabel], ['model', a.model || 'n/a'],
    ['effort', a.effort || (a.ultracode ? 'ultra' : 'n/a')], ['ctx', a.ctxPct != null ? a.ctxPct + '%' : 'n/a'],
    ['cost', a.cost != null ? fmtUSD(a.cost) : 'n/a'], ['last', a.when || 'n/a'],
  ];
  const ra = resumeActs(a);
  const primeLabel = a.state === 'done' ? 'reveal transcript' : ra.primary.label.toLowerCase();
  const primeAct = a.state === 'done' ? 'reveal' : ra.primary.act;
  el('peekIn').innerHTML = `
    <div class="pk-id">
      <span class="pk-face">${a.face}</span>
      <div>
        <div class="pk-nm">${nameHtml(a)}
          <span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${st.hue}"></span>
          <span class="chip ${st.cls}"><span class="dt"></span>${st.label}</span>
        </div>
        <div class="pk-sub">${esc(a.repo || 'no repo')} · ${esc(a.harnessLabel)}${a.model ? '/' + esc(a.model) : ''}</div>
      </div>
    </div>
    <div class="pk-mid">
      <div class="pk-narr">${a.aiNarr ? '<span class="ai" style="color:var(--iris);font-family:var(--mono);font-size:9px;margin-right:6px">ai</span>' : ''}${esc(a.narrative)}</div>
      <div class="pk-props">${props.map((p) => `<div class="p"><span class="k">${p[0]}</span><span class="v">${esc(String(p[1]))}</span></div>`).join('')}</div>
    </div>
    <div class="pk-act">
      <button class="primary" data-act="${primeAct}">${primeLabel}</button>
      ${a.state === 'done' ? `<button data-act="${ra.primary.act}">${ra.primary.label.toLowerCase()}</button>` : ''}
      ${ra.secondary ? `<button data-act="${ra.secondary.act}">${ra.secondary.label.toLowerCase()}</button>` : ''}
      <button data-act="reveal" ${a.state === 'done' ? 'style="display:none"' : ''}>reveal</button>
      <button data-act="linear" ${hasLinear ? '' : 'disabled'}>linear</button>
      <button class="pk-open" data-do="focus">Open in Focus</button>
      <button class="pk-close" aria-label="close">×</button>
    </div>`;
  const peek = el('peek');
  peek.style.setProperty('--dst', h);
  peek.classList.add('open');
  el('scrim').classList.add('open');
  el('peekIn').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => runAction(b.dataset.act, a)));
  el('peekIn').querySelector('.pk-close').addEventListener('click', closePeek);
  el('peekIn').querySelector('[data-do="focus"]').addEventListener('click', () => { closePeek(); setMode('focus'); });
}
function closePeek() { el('peek').classList.remove('open'); el('scrim').classList.remove('open'); }

// ============================================================
// ACTIONS (honest: read-only + resume). No fictional actions.
// ============================================================
async function runAction(act, a) {
  if (!a) return;
  if (act === 'resume') act = resumeActs(a).primary.act;  // generic entry (wall button, key r) -> preferred destination
  if (act === 'resume-term') return resumeAgent(a);
  if (act === 'resume-app') return openAppAgent(a);
  if (act === 'reveal') return revealAgent(a);
  if (act === 'linear') return openLinear(a);
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
  const link = a.harness === 'codex' ? 'codex://threads/...' : 'claude://resume?session=...';
  if (!window.humanctl) { toast('demo: would open ' + a.name + ' in the ' + appName + ' desktop app (' + link + ').'); return; }
  toast('opening ' + a.name + ' in the ' + appName + ' app...');
  const r = await window.humanctl.openInApp({ id: a.id, harness: a.harness });
  toast(r && r.ok ? 'opened ' + a.name + ' in the ' + appName + ' app.' : (r && r.error ? r.error : 'could not open the ' + appName + ' app.'));
}
async function revealAgent(a) {
  if (!window.humanctl) { toast('demo: would reveal the transcript for ' + a.name + '.'); return; }
  const r = await window.humanctl.revealSession(a.path);
  toast(r && r.ok ? 'revealed transcript for ' + a.name + '.' : 'could not reveal transcript.');
}
async function openLinear(a) {
  const d = detailCache.get(a.id);
  const refs = (d && d !== 'loading' && d !== 'error' && d.detail && d.detail.linearRefs) || [];
  if (!refs.length) { toast('no linear refs for ' + a.name + '.'); return; }
  if (!window.humanctl) { toast('demo: would open ' + refs[0].url); return; }
  await window.humanctl.openExternal(refs[0].url);
}
const sumRuns = new Map(); // id -> run token, so a stale response never lands
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
  if (!window.humanctl) {
    // demo: land a fixture summary after a beat so the loading state is visible
    setTimeout(() => settle({ text: 'Working through the latest instruction; see the timeline for the real signals.', engine: summarizer, at: Date.now() }), 900);
    return;
  }
  try {
    const r = await window.humanctl.summarize({ path: a.path, harness: a.harness, engine: summarizer });
    if (r && r.ok && r.summary) settle({ text: r.summary, engine: r.engine || summarizer, at: Date.now() });
    else settle(null, r && r.error);
  } catch (e) { settle(null, String((e && e.message) || e)); }
}
// Repaint every surface that shows summary state. When a summary just landed
// for the watched agent, pull the eye to the block so its home is unmistakable.
function repaintSummary(id, landed) {
  remapAgents();
  if (mode === 'focus') {
    renderRoster(); renderWatch(); ensureWatchDetail();
    if (landed && selId === id) {
      const blk = el('sumBlock');
      if (blk) {
        blk.scrollIntoView({ block: 'nearest', behavior: RM ? 'auto' : 'smooth' });
        blk.classList.add('flash');
        setTimeout(() => blk.classList.remove('flash'), 1200);
      }
    }
  } else if (mode === 'triage') applyTriageSelection();
  else if (mode === 'wall') renderWall();
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
// mode switching
// ============================================================
function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode').forEach((s) => s.classList.remove('on'));
  el('mode-' + m).classList.add('on');
  document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  if (window.humanctl) window.humanctl.setState({ mode: m });
  if (m === 'focus') renderFocus();
  else if (m === 'triage') { expId = selId; renderTriage(); }
  else if (m === 'wall') { renderWall(); if (selId) loadDetail(byId.get(selId)).then(() => { if (mode === 'wall') renderWall(); }); }
}

// ============================================================
// data mapping + refresh
// ============================================================
function remapAgents() {
  const now = Date.now();
  agents = allRows.map((r) => mapAgent(r, allNotes, now));
  computeDisplayNames(agents);
  byId = new Map(agents.map((a) => [a.id, a]));
  pickDefaultSelection();
}
function redrawActive() {
  renderHeader();
  if (mode === 'focus') renderFocus();
  else if (mode === 'triage') renderTriage();
  else if (mode === 'wall') renderWall();
}

// ============================================================
// toggles: theme + temperature (persist via setState)
// ============================================================
function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  el('tTheme').textContent = theme;
  el('tTheme').classList.toggle('on', theme === 'light');
  clearHueCache();
}
function applyTemp() {
  document.body.classList.toggle('loud', temp === 'loud');
  el('tTemp').textContent = temp;
  el('tTemp').classList.toggle('on', temp === 'loud');
  clearHueCache();
}
el('tTheme').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; applyTheme(); if (window.humanctl) window.humanctl.setState({ theme }); redrawActive(); });
el('tTemp').addEventListener('click', () => { temp = temp === 'loud' ? 'considered' : 'loud'; applyTemp(); if (window.humanctl) window.humanctl.setState({ temp }); redrawActive(); });
document.querySelectorAll('#seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
el('scrim').addEventListener('click', closePeek);

// settings popover: pick the AI-summary engine (Claude Code or Codex), persisted
function applySummarizerUI() { document.querySelectorAll('#engSeg button').forEach((b) => b.classList.toggle('on', b.dataset.eng === summarizer)); }
// resume destination per harness. The "Desktop app" side is disabled (with the
// reason in the title) when the OS has no handler for that harness's deep link.
function applyOpenPrefUI() {
  document.querySelectorAll('[data-openseg]').forEach((seg) => {
    const h = seg.dataset.openseg;
    const avail = appAvailable(h);
    seg.querySelectorAll('button').forEach((b) => {
      const isApp = b.dataset.dest === 'app';
      b.disabled = isApp && !avail;
      b.title = (isApp && !avail) ? 'no desktop app registered for this harness on this machine' : '';
      b.classList.toggle('on', b.dataset.dest === ((avail ? openPref[h] : 'terminal') || 'terminal'));
    });
  });
}
function toggleSettings(force) { const pop = el('settingsPop'); const show = force !== undefined ? force : pop.hidden; pop.hidden = !show; if (show) { applySummarizerUI(); applyOpenPrefUI(); } }
el('btnSettings').addEventListener('click', (e) => { e.stopPropagation(); toggleSettings(); });
document.querySelectorAll('#engSeg button').forEach((b) => b.addEventListener('click', () => {
  summarizer = b.dataset.eng === 'codex' ? 'codex' : 'claude';
  applySummarizerUI();
  if (window.humanctl) window.humanctl.setState({ summarizer });
  toast('AI summary engine: ' + engineLabel(summarizer));
}));
document.querySelectorAll('[data-openseg] button').forEach((b) => b.addEventListener('click', () => {
  if (b.disabled) return;
  const h = b.closest('[data-openseg]').dataset.openseg;
  openPref = Object.assign({}, openPref, { [h]: b.dataset.dest === 'app' ? 'app' : 'terminal' });
  applyOpenPrefUI();
  if (window.humanctl) window.humanctl.setState({ openPref });
  toast((h === 'codex' ? 'Codex' : 'Claude Code') + ' sessions now open in ' + (openPref[h] === 'app' ? 'the desktop app' : 'Terminal') + '.');
  redrawActive();  // resume buttons across all modes pick up the new primary
}));
document.addEventListener('mousedown', (e) => {
  const pop = el('settingsPop');
  if (!pop.hidden && !pop.contains(e.target) && e.target.id !== 'btnSettings') toggleSettings(false);
});

// keyboard
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) {
    if (e.key === 'Escape' && e.target.blur) e.target.blur();
    return;
  }
  if (e.key === '1') setMode('focus');
  else if (e.key === '2') setMode('triage');
  else if (e.key === '3') setMode('wall');
  else if (mode === 'triage') {
    if (e.key === 'j') { e.preventDefault(); tMove(1); }
    else if (e.key === 'k') { e.preventDefault(); tMove(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (selId) tSelect(selId, true); }
    else if (e.key === 'r') { const a = byId.get(selId); if (a) runAction(a.state === 'done' ? 'reveal' : 'resume', a); }
    else if (e.key === 'Escape') { e.preventDefault(); expId = null; applyTriageSelection(); }
  } else if (mode === 'wall' && e.key === 'Escape') closePeek();
});

// ============================================================
// load + realtime
// ============================================================
async function fetchData() {
  const [s, l, nt] = await Promise.all([
    window.humanctl.getStatus({ maxAgeH: 72, limit: 40 }),
    window.humanctl.listSessions({ maxAgeH: 72, limit: 40, withUsage: true }),
    window.humanctl.getNotes({ limit: 100 }),
  ]);
  if (s && s.ok) status = s.status;
  if (l && l.ok) allRows = l.rows || [];
  if (nt && nt.ok) allNotes = nt.notes || [];
}
async function load() {
  if (!window.humanctl) {
    demo = true;
    allRows = FIXTURE_ROWS; status = fixtureStatus(); allNotes = FIXTURE_NOTES;
    applyTheme(); applyTemp(); remapAgents(); renderHeader(); setMode('focus');
    return;
  }
  const st = await window.humanctl.getState();
  if (st && st.ok && st.state) {
    theme = st.state.theme === 'light' ? 'light' : 'dark';
    temp = st.state.temp === 'loud' ? 'loud' : 'considered';
    mode = ['focus', 'triage', 'wall'].includes(st.state.mode) ? st.state.mode : 'focus';
    pins = new Set(st.state.pins || []);
    summarizer = st.state.summarizer === 'codex' ? 'codex' : 'claude';
    const op = st.state.openPref || {};
    openPref = { 'claude-code': op['claude-code'] === 'app' ? 'app' : 'terminal', codex: op.codex === 'app' ? 'app' : 'terminal' };
    hydrateSummaries(st.state.summaries);
    hydrateAsks(st.state.asks);
    askAck = st.state.askCodexAck === true;
    if (st.state.selectedId) selId = st.state.selectedId;
  }
  applyTheme(); applyTemp();
  await fetchData();
  remapAgents(); renderHeader(); setMode(mode);
}
let lastSig = '';
const rowSubSig = new Map(); // id -> ageMs+':'+contextPct sub-signature from last render
async function _refresh() {
  if (!window.humanctl) return;
  await fetchData();
  // state + tier come from the reader and change when a session crosses a
  // tier boundary, so the 20s poll repaints demotions (hot -> drifting ->
  // archived) even though no file changed.
  const sig = allRows.map((r) => r.id + r.ageMs + r.state + ':' + r.tier + ':' + r.contextPct).join('|')
    + '#' + allNotes.map((n) => n.id + ':' + n.level).join('|')
    + '#' + (status ? status.needsYou + ':' + status.working + ':' + status.sessions : '');
  if (sig === lastSig) return; // nothing changed
  lastSig = sig;
  // Invalidate cached transcript detail for any row whose ageMs or contextPct
  // moved since the last render. Without this, a watched agent's timeline /
  // sparkline / map would freeze on the first read for the window's lifetime.
  for (const r of allRows) {
    const sub = r.ageMs + ':' + r.contextPct;
    if (rowSubSig.get(r.id) !== sub) {
      detailCache.delete(r.id);
      rowSubSig.set(r.id, sub);
    }
  }
  remapAgents();
  redrawActive();
}
// Throttle refresh: coalesce bursts and never overlap two scans. A fs.watch
// storm or the 20s poll both funnel through scheduleRefresh, so the main thread
// pays the (now cached) scan at most once every REFRESH_MIN_MS.
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
  if (refreshTimer) return; // one already pending
  const wait = Math.max(0, REFRESH_MIN_MS - (Date.now() - lastRefreshAt));
  refreshTimer = setTimeout(runRefresh, wait);
}
if (window.humanctl && window.humanctl.onSessionsChanged) window.humanctl.onSessionsChanged(scheduleRefresh);
// Hot-session appends: near-immediate, for the watched session only.
if (window.humanctl && window.humanctl.onSessionAppend) window.humanctl.onSessionAppend(onSessionAppend);
setInterval(() => { if (window.humanctl) scheduleRefresh(); }, 20000);
load();
