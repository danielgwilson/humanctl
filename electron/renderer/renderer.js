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
function hue(varRef) { const name = String(varRef).replace(/var\(|\)/g, '').trim(); return cssv(name) || '#888'; }

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
const FRESH_MS = 30 * 60 * 1000; // "working" freshness window (spec)

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
  const n = notes.filter((x) => x.session && x.session === row.id);
  if (n.some((x) => x.level === 'blocked')) return 'block';
  if (row.lastRole === 'assistant' || n.some((x) => x.level === 'review')) return 'need';
  if (n.some((x) => x.level === 'done')) return 'done';
  if (row.lastRole === 'user' && (now - row.ageMs) < FRESH_MS) return 'work';
  return 'idle';
}
function mapAgent(row, notes, now) {
  const idn = identity(row.id);
  const state = deriveState(row, notes, now);
  const cachedSummary = (aiOn && summaries.has(row.id)) ? summaries.get(row.id) : null;
  // display-only: strip Codex wrapper boilerplate from the chosen narrative.
  // Stored row fields (lastUser/title/prevAgent) are never mutated.
  const rawNarr = cachedSummary || row.lastUser || row.title || row.prevAgent || '(no recent prompt)';
  const narrative = cleanNarrative(rawNarr);
  const cost = row.costUSD != null ? row.costUSD : (row.apiEquivUSD != null ? row.apiEquivUSD : null);
  return {
    id: row.id,
    harness: row.harness,                       // 'codex' | 'claude-code'
    harnessLabel: row.harness === 'codex' ? 'codex' : 'claude',
    harnessCls: row.harness === 'codex' ? 'c-codex' : 'c-claude',
    name: idn.name, face: idn.face, tag: idn.tag,
    state,
    narrative,
    aiNarr: !!cachedSummary,
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
let aiOn = false;
let pins = new Set();
let facet = 'timeline';      // watched-agent detail facet: 'timeline' | 'map'

// per-agent readSession detail cache (real signals only)
const detailCache = new Map();  // id -> {data, usage, detail} | 'loading' | 'error'
const summaries = new Map();     // id -> text (opt-in AI)
const SUM_CAP = 400;
function rememberSummary(id, text) { summaries.delete(id); summaries.set(id, text); if (summaries.size > SUM_CAP) summaries.delete(summaries.keys().next().value); }

// ============================================================
// SYNTHETIC FIXTURE (OSS-safe; used only when window.humanctl is absent).
// Clean, non-real ids + generic repos. Never real data.
// ============================================================
const FIXTURE_ROWS = [
  { harness: 'claude-code', id: 'fixture-a1a1a1a1', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Wire the multi-source update spine', lastRole: 'assistant', age: '2m', ageMs: Date.now() - 2 * 6e4, contextPct: 63, costUSD: 2.14, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: true, lastUser: 'wire the update spine into the renderer', prevAgent: 'Mapped the render path and the watcher.' },
  { harness: 'codex', id: 'rollout-fixture-b2b2', repo: '~/demo/core', cwd: '~/demo/core', title: 'Choose the rename-persistence path', lastRole: 'assistant', age: '6m', ageMs: Date.now() - 6 * 6e4, contextPct: 22, apiEquivUSD: 0.88, model: 'gpt-5.5', reasoningEffort: 'xhigh', ultracode: false, lastUser: 'which rename-persistence path should we trust?', prevAgent: 'Ran the migration dry-run; two paths viable.' },
  { harness: 'claude-code', id: 'fixture-c3c3c3c3', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Pull the activity feed', lastRole: 'user', age: '11m', ageMs: Date.now() - 11 * 6e4, contextPct: 38, costUSD: 1.02, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: 'retry the activity pull', prevAgent: 'The activity adapter is built.' },
  { harness: 'codex', id: 'rollout-fixture-d4d4', repo: '~/demo/ledger', cwd: '~/demo/ledger', title: 'Backfill the ledger', lastRole: 'user', age: '1m', ageMs: Date.now() - 1 * 6e4, contextPct: 55, apiEquivUSD: 0.63, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'keep backfilling the ledger', prevAgent: 'At 147 of 188 rows.' },
  { harness: 'claude-code', id: 'fixture-e5e5e5e5', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Extract the sparkline component', lastRole: 'user', age: '3m', ageMs: Date.now() - 3 * 6e4, contextPct: 48, costUSD: 0.74, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'extract Spark into a shared component', prevAgent: 'Created the component shell.' },
  { harness: 'claude-code', id: 'fixture-f6f6f6f6', repo: '~/demo/hygiene', cwd: '~/demo/hygiene', title: 'OSS hygiene sweep', lastRole: 'assistant', age: '24m', ageMs: Date.now() - 24 * 6e4, contextPct: 12, costUSD: 3.40, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: '', prevAgent: 'Swept history; checks are green.' },
  { harness: 'codex', id: 'rollout-fixture-g7g7', repo: '~/demo/icons', cwd: '~/demo/icons', title: 'Draft the squircle icons', lastRole: 'assistant', age: '41m', ageMs: Date.now() - 41 * 6e4, contextPct: 8, apiEquivUSD: 0.20, model: 'gpt-5.5', reasoningEffort: 'low', ultracode: false, lastUser: '', prevAgent: 'Drafted the squircle variants.' },
];
function fixtureStatus() {
  const now = Math.floor(Date.now() / 1000);
  return {
    per: {
      codex: { sessions: 3, generated: 240000, totalTokens: 5e6, apiEquivUSD: 1.71 },
      'claude-code': { sessions: 4, generated: 180000, totalTokens: 3.2e6, costUSD: 7.30 },
    },
    codexQuota: { plan_type: 'pro', primary: { used_percent: 46, resets_at: now + 36 * 60 }, secondary: { used_percent: 71, resets_at: now + 5 * 86400 } },
    needsYou: 3, working: 2, nearCompaction: 1, sessions: 7, pricingAsOf: '2026-06', version: '0.5.4',
    generatedAt: new Date().toISOString(),
  };
}
const FIXTURE_NOTES = [
  { id: 'fn1', ts: new Date(Date.now() - 4 * 6e4).toISOString(), level: 'review', message: 'PR is up for the update spine; needs a review + merge.', repo: 'renderer', session: 'fixture-a1a1a1a1' },
  { id: 'fn2', ts: new Date(Date.now() - 11 * 6e4).toISOString(), level: 'blocked', message: 'Blocked: the activity token is missing from the environment.', repo: 'renderer', session: 'fixture-c3c3c3c3' },
  { id: 'fn3', ts: new Date(Date.now() - 22 * 6e4).toISOString(), level: 'fyi', message: 'Ledger backfill is on track; no action needed.', repo: 'ledger', session: 'rollout-fixture-d4d4' },
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

// ============================================================
// derived rollups (from real status + agents)
// ============================================================
function rollups() {
  const per = (status && status.per) || {};
  const cl = per['claude-code'] || {};
  const cx = per.codex || {};
  const needsYou = (status && status.needsYou != null) ? status.needsYou : agents.filter((a) => a.state === 'need' || a.state === 'block').length;
  const working = (status && status.working != null) ? status.working : agents.filter((a) => a.state === 'work').length;
  const idle = agents.filter((a) => a.state === 'idle').length;
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
  // Digest numbers come from ONE bucket set (deriveState) so they partition the
  // fleet exactly and match the roster/queue group counts. No triple-counting.
  const b = { need: 0, block: 0, work: 0, idle: 0, done: 0 };
  for (const a of agents) b[a.state]++;
  const needYou = b.need + b.block;
  const need = agents.filter((a) => a.state === 'need' || a.state === 'block');
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
  const denom = agents.length || 1;
  el('heroShape').innerHTML = svgRing(100 * needYou / denom, hue('var(--s-need)'), 30);
  const ver = status && status.version ? 'v' + status.version : 'home';
  el('verTag').textContent = ver;
  el('demoBadge').style.display = demo ? '' : 'none';
}

// ============================================================
// selection (shared across all modes)
// ============================================================
function pickDefaultSelection() {
  if (selId && byId.has(selId)) return;
  const need = agents.find((a) => a.state === 'need' || a.state === 'block');
  selId = need ? need.id : (agents[0] ? agents[0].id : null);
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
function renderRoster() {
  const box = el('roster');
  el('fleet-ct').textContent = agents.length + ' agents';
  let html = '';
  for (const g of GROUPS) {
    const items = agents.filter((a) => a.state === g.k);
    if (!items.length) continue;
    const h = hue(STATE[g.k].hue);
    html += `<div class="grp-hd"><span class="gdot" style="background:${h}"></span>${g.label}<span class="gct">${items.length}</span></div>`;
    for (const a of items) {
      const h2 = hue(STATE[a.state].hue);
      // per-row metric = REAL contextPct (tiny bar). null -> a faint "n/a" placeholder bar.
      const meter = a.ctxPct != null ? svgBar(a.ctxPct, h2, 46, 5) : `<span style="font-family:var(--mono);font-size:8px;color:var(--ink4)">n/a</span>`;
      html += `<div class="arow ${a.id === selId ? 'sel' : ''}" style="--c-sel:${h2}" data-id="${esc(a.id)}">
        <span class="face">${a.face}</span>
        <span class="who"><span class="nm">${nameHtml(a)}</span><span class="rp">${esc(a.repo)}</span></span>
        <span class="spk">${meter}</span>
        <span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${h2}"></span>
      </div>`;
    }
  }
  box.innerHTML = html || `<div class="watch-empty">no sessions in the last 72h.</div>`;
  box.querySelectorAll('.arow').forEach((r) => r.addEventListener('click', () => select(r.dataset.id)));
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
          <span class="chip ${s.cls}"><span class="dt"></span>${s.label}</span>
          <span class="chip ${a.harnessCls}">${a.harnessLabel}</span>
          ${a.ultracode ? '<span class="chip c-claude">ultra</span>' : ''}
        </div>
        <div class="subline">
          <span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${h}"></span>
          <span>${esc(a.repo || 'no repo')}</span>${a.when ? '<span class="sep">·</span><span>updated ' + esc(a.when) + '</span>' : ''}
        </div>
      </div>
    </div>
    <div class="props">${modelCell}${effortCell}${ctxCell}${costCell}</div>
    <div class="latest">
      <div class="lh"><span class="lbl">Latest prompt</span>${a.when ? `<span class="when">${esc(a.when)}</span>` : ''}</div>
      <div class="narr">${a.aiNarr ? '<span class="ai">ai</span>' : ''}${esc(a.narrative)}</div>
    </div>
    <div class="facets" id="facets">
      <button class="facet-tab ${facet === 'timeline' ? 'on' : ''}" data-facet="timeline">Timeline</button>
      <button class="facet-tab ${facet === 'map' ? 'on' : ''}" data-facet="map">Map</button>
    </div>
    <div id="facetBody"></div>`;

  el('facets').querySelectorAll('.facet-tab').forEach((b) => b.addEventListener('click', () => {
    facet = b.dataset.facet; renderWatch(); ensureWatchDetail();
  }));
  renderDock(a, h);
}

function renderDock(a, h) {
  const dock = el('dock');
  dock.style.setProperty('--c-sel', h);
  const det = detailCache.get(a.id);
  const hasLinear = det && det !== 'loading' && det !== 'error' && det.detail && det.detail.linearRefs && det.detail.linearRefs.length;
  // read-only + resume only. every state resumes except done (which reveals).
  const primaryLabel = a.state === 'done' ? 'Reveal transcript' : 'Resume in terminal';
  const primaryAct = a.state === 'done' ? 'reveal' : 'resume';
  dock.innerHTML = `
    <button class="btn primary" data-act="${primaryAct}">${primaryLabel}</button>
    ${a.state === 'done' ? `<button class="btn" data-act="resume">Resume in terminal</button>` : `<button class="btn" data-act="reveal">Reveal transcript</button>`}
    <button class="btn ghost" data-act="linear" ${hasLinear ? '' : 'disabled'}>Open in Linear</button>
    <button class="btn ghost" data-act="summary" title="sends recent messages to your local claude CLI">AI summary</button>
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
function buildTimeline(a, d) {
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
  const ex = detail.lastExchange || {};
  if (ex.lastUser) evs.push({ src: 'you asked', cvar: 'var(--iris)', msg: esc(ex.lastUser) });
  if (ex.prevAgent) evs.push({ src: 'agent', cvar: 'var(--s-done)', msg: esc(ex.prevAgent) });
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
  // recent activity: last few real blocks (kind + preview)
  const tail = blocks.slice(-4).reverse();
  for (const b of tail) {
    evs.push({ src: KIND_LABEL[b.kind] || b.kind, cvar: 'var(--ink3)', msg: esc((b.preview || '').slice(0, 160)) || '(no preview)' });
  }
  return evs;
}
function timelineHtml(a, d) {
  const evs = buildTimeline(a, d);
  if (!evs.length) return `<div class="tl-title" style="font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);font-weight:600;margin:0 0 8px">Activity</div><div class="tl-empty">no recorded signals yet for this session.</div>`;
  let html = `<div class="tl">`;
  evs.forEach((e, i) => {
    const clickable = e.url || e.path;
    // only the latest (first) item may carry a relative time; do not fabricate per-event times.
    const ts = i === 0 && a.when ? `<span class="ts">${esc(a.when)}</span>` : '';
    html += `<div class="tevt ${clickable ? 'click' : ''}" style="--src:${e.cvar}" ${e.url ? `data-url="${esc(e.url)}"` : ''} ${e.path ? `data-path="${esc(e.path)}"` : ''}>
      <div class="top"><span class="src">${esc(e.src)}</span>${ts}</div>
      <div class="msg">${e.msg}</div>
    </div>`;
  });
  html += `</div>`;
  return html;
}
function bindTimeline(root, a, d) {
  root.querySelectorAll('.tevt[data-url]').forEach((n) => n.addEventListener('click', () => { const u = n.getAttribute('data-url'); if (u && window.humanctl) window.humanctl.openExternal(u); else if (u) toast('would open ' + u); }));
  root.querySelectorAll('.tevt[data-path]').forEach((n) => n.addEventListener('click', () => { const p = n.getAttribute('data-path'); if (p && window.humanctl) window.humanctl.openPath(p); else if (p) toast('would open ' + p); }));
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
  return `<div class="map-hint">one square per block · shade = token weight · outlined = live tail</div>
    <div class="cmap">${squares}</div>
    <div class="legend">${legend}</div>
    ${d.data && d.data.truncated ? '<div class="trunc">large session: first portion shown.</div>' : ''}`;
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

// ---- right rail: needs-you queue (scrollable) + fleet totals ----
function renderConductor() {
  const cond = el('cond');
  const need = agents.filter((a) => a.state === 'need' || a.state === 'block');
  const r = rollups();
  let queue = need.map((a) => {
    const h = hue(STATE[a.state].hue);
    return `<div class="qrow ${a.id === selId ? 'sel' : ''}" style="--c-sel:${h}" data-id="${esc(a.id)}">
      <span class="face">${a.face}</span>
      <span class="who"><span class="nm">${nameHtml(a)}</span><span class="rz">${STATE[a.state].label} · ${esc(a.repo || 'no repo')}</span></span>
      <span class="chip ${STATE[a.state].cls}"><span class="dt"></span>${esc(a.when || '')}</span>
    </div>`;
  }).join('') || `<div class="queue-empty">nothing needs you right now.</div>`;

  const claude = r.claudeUSD != null ? fmtUSD(r.claudeUSD) : 'n/a';
  const codex = r.codexUSD != null ? fmtUSD(r.codexUSD) : 'n/a';
  const tokens = r.tokens ? fmtTok(r.tokens) : 'n/a';
  let quotaRow = '';
  if (r.quota) {
    const q = r.quota;
    const prim = q.primary || {};
    const pct = prim.used_percent != null ? prim.used_percent : null;
    const qcolor = pct == null ? 'var(--q-ok)' : pct >= 90 ? 'var(--q-crit)' : pct >= 70 ? 'var(--q-warn)' : 'var(--q-ok)';
    const reset = prim.resets_at ? fmtReset(prim.resets_at) : '';
    quotaRow = `<div class="gstat">
      <span class="k">codex quota${reset ? ' · resets ' + esc(reset) : ''}</span>
      <span class="v">${pct != null ? svgBar(pct, hue(qcolor), 56, 5) + `<span class="mono">${pct}%</span>` : '<span class="mono">n/a</span>'}</span>
    </div>`;
  }

  cond.innerHTML = `
    <div>
      <div class="sec-l">Needs you now <span class="ct">${need.length}</span></div>
      <div class="queue">${queue}</div>
    </div>
    <div>
      <div class="sec-l">Fleet totals</div>
      <div class="gstats">
        <div class="gstat"><span class="k">claude spend</span><span class="v"><span class="mono">${claude}</span></span></div>
        <div class="gstat"><span class="k">codex API-equiv</span><span class="v"><span class="mono">${codex}</span></span></div>
        <div class="gstat"><span class="k">tokens</span><span class="v"><span class="mono">${tokens}</span></span></div>
        ${quotaRow}
      </div>
    </div>`;
  cond.querySelectorAll('.qrow').forEach((r2) => r2.addEventListener('click', () => select(r2.dataset.id)));
}

function renderFocus() { renderRoster(); renderWatch(); renderConductor(); ensureWatchDetail(); }

// ============================================================
// TRIAGE MODE
// ============================================================
const tGroupOpen = { need: true, block: true, work: true, idle: false, done: false };
function tGroupsBuild() {
  const sorted = [...agents].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
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
  return `<div class="item" data-id="${esc(a.id)}" style="--c-state:${h}">`
    + `<div class="row" tabindex="0">`
    + `<span class="rface"><span class="hb ${a.state === 'work' ? 'beat' : ''}" style="background:${h}"></span><span class="em">${a.face}</span></span>`
    + `<span class="who2"><span class="nm">${nameHtml(a)}</span><span class="hn">${esc(a.harnessLabel)}</span></span>`
    + `<span class="rnarr">${esc(a.narrative)}</span>`
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
  const primeLabel = a.state === 'done' ? 'Reveal' : 'Resume';
  const primeAct = a.state === 'done' ? 'reveal' : 'resume';
  const acts = `<div class="acts">`
    + `<button class="abtn prime" data-act="${primeAct}">${primeLabel} <kbd>${a.state === 'done' ? 'r' : '↵'}</kbd></button>`
    + (a.state === 'done' ? `<button class="abtn" data-act="resume">Resume</button>` : `<button class="abtn" data-act="reveal">Reveal</button>`)
    + `<button class="abtn" data-act="linear" ${hasLinear ? '' : 'disabled'}>Linear</button>`
    + `<button class="abtn" data-act="summary" title="sends recent messages to your local claude CLI">AI summary</button>`
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
  const g = el('gutter');
  const r = rollups();
  const claude = r.claudeUSD != null ? fmtUSD(r.claudeUSD) : 'n/a';
  const codex = r.codexUSD != null ? fmtUSD(r.codexUSD) : 'n/a';
  const tokens = r.tokens ? fmtTok(r.tokens) : 'n/a';
  let quota = '';
  if (r.quota && r.quota.primary && r.quota.primary.used_percent != null) {
    const pct = r.quota.primary.used_percent;
    const qcolor = pct >= 90 ? 'var(--q-crit)' : pct >= 70 ? 'var(--q-warn)' : 'var(--q-ok)';
    const reset = r.quota.primary.resets_at ? fmtReset(r.quota.primary.resets_at) : '';
    quota = `<div class="stat"><div class="sk">codex quota</div>`
      + `<div class="sr">${svgRing(pct, hue(qcolor), 34)}<div class="fill"></div><div class="sv" style="font-size:14px">${pct}%</div></div>`
      + (reset ? `<div class="rst">resets ${esc(reset)}</div>` : '') + `</div>`;
  }
  const recent = allNotes.slice(0, 4).map((n) => {
    const NLHUE = { blocked: 'var(--s-block)', review: 'var(--s-need)', done: 'var(--s-done)', fyi: 'var(--iris)' };
    return `<div class="tnote" style="--nl:${NLHUE[n.level] || 'var(--iris)'}"><div class="nl">${esc(n.level)}</div><div class="nm">${esc(n.message)}</div><div class="nmeta">${esc(n.repo || '')}</div></div>`;
  }).join('');
  g.innerHTML =
    `<div class="kbar"><div class="kh">keys</div>`
    + `<span class="kk"><kbd>j</kbd><kbd>k</kbd> move</span>`
    + `<span class="kk"><kbd>↵</kbd> open</span>`
    + `<span class="kk"><kbd>esc</kbd> close</span></div>`
    + `<div class="gh">fleet totals</div>`
    + `<div class="stat"><div class="sk">claude</div><div class="sv">${claude}</div></div>`
    + `<div class="stat"><div class="sk">codex API-equiv</div><div class="sv">${codex}</div></div>`
    + `<div class="stat"><div class="sk">tokens</div><div class="sv">${tokens}</div></div>`
    + quota
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
      <article class="tile ${isSel ? 'active' : ''}" data-id="${esc(a.id)}" style="--st:${st.hue}">
        <div class="t-head">
          <span class="t-face">${a.face}</span>
          <span class="t-name">${nameHtml(a)}</span>
          <span class="hb t-hb ${a.state === 'work' ? 'beat' : ''}" style="background:${st.hue}"></span>
          <span class="spacer"></span>
          <span class="chip ${a.harnessCls}"><span class="dt"></span>${esc(a.harnessLabel)}</span>
        </div>
        ${viz}
        <div class="t-body">
          <p class="t-narr">${esc(a.narrative)}</p>
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
    ['repo', a.repo || 'n/a'], ['harness', a.harnessLabel], ['model', a.model || 'n/a'],
    ['effort', a.effort || (a.ultracode ? 'ultra' : 'n/a')], ['ctx', a.ctxPct != null ? a.ctxPct + '%' : 'n/a'],
    ['cost', a.cost != null ? fmtUSD(a.cost) : 'n/a'], ['last', a.when || 'n/a'],
  ];
  const primeLabel = a.state === 'done' ? 'reveal transcript' : 'resume in terminal';
  const primeAct = a.state === 'done' ? 'reveal' : 'resume';
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
  if (act === 'resume') return resumeAgent(a);
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
let sumRun = 0;
async function summarizeAgent(a) {
  toast('AI summary: sending recent messages to your local claude CLI...');
  const run = ++sumRun;
  if (summaries.has(a.id)) { applySummary(a.id); toast('summary ready (cached).'); return; }
  if (!window.humanctl) {
    const s = 'Working through the latest instruction; see the timeline for the real signals.';
    rememberSummary(a.id, s); applySummary(a.id); toast('demo summary set.'); return;
  }
  const r = await window.humanctl.summarize({ path: a.path, harness: a.harness });
  if (run !== sumRun) return;
  if (r && r.ok && r.summary) { rememberSummary(a.id, r.summary); applySummary(a.id); toast('summary ready (via local claude CLI).'); }
  else toast('could not summarize (needs your local claude CLI auth).');
}
function applySummary(id) {
  // recompute the agent's narrative and repaint the active mode's view of it.
  remapAgents();
  if (mode === 'focus') { renderRoster(); renderWatch(); ensureWatchDetail(); }
  else if (mode === 'triage') applyTriageSelection();
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
}
function applyTemp() {
  document.body.classList.toggle('loud', temp === 'loud');
  el('tTemp').textContent = temp;
  el('tTemp').classList.toggle('on', temp === 'loud');
}
el('tTheme').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; applyTheme(); if (window.humanctl) window.humanctl.setState({ theme }); redrawActive(); });
el('tTemp').addEventListener('click', () => { temp = temp === 'loud' ? 'considered' : 'loud'; applyTemp(); if (window.humanctl) window.humanctl.setState({ temp }); redrawActive(); });
document.querySelectorAll('#seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
el('scrim').addEventListener('click', closePeek);

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
    aiOn = !!st.state.aiOn;
    pins = new Set(st.state.pins || []);
    if (st.state.selectedId) selId = st.state.selectedId;
  }
  applyTheme(); applyTemp();
  await fetchData();
  remapAgents(); renderHeader(); setMode(mode);
}
let lastSig = '';
const rowSubSig = new Map(); // id -> ageMs+':'+contextPct sub-signature from last render
async function refresh() {
  if (!window.humanctl) return;
  await fetchData();
  const sig = allRows.map((r) => r.id + r.ageMs + r.lastRole + r.contextPct).join('|')
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
if (window.humanctl && window.humanctl.onSessionsChanged) window.humanctl.onSessionsChanged(refresh);
setInterval(() => { if (window.humanctl) refresh(); }, 20000);
load();
