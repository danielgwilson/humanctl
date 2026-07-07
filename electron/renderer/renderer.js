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
// Shared keyboard-activation helper for row-shaped elements with role="button"
// (session rows, inbox threads): Enter or Space triggers the same action a
// click would, and Space is prevented from also scrolling the list. Used by
// renderer.js's Sessions rows and inbox.js's thread rows so both keyboard
// activation paths stay identical rather than re-implemented per view.
function wireRowActivation(nodeList) {
  nodeList.forEach((r) => {
    if (r.__kbBound) return;
    r.__kbBound = true;
    r.addEventListener('keydown', (e) => {
      if (e.target !== r) return; // let inner focusable controls (pin button) handle their own keys
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); r.click(); }
    });
  });
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
// Absolute local reset clock ("resets 9:41pm" / "resets Sun 12:00am"), never a
// relative "resets now": the bottom bar's quota rule requires a real datetime,
// not a countdown. `ts` is codex's real rate_limits resets_at, unix SECONDS.
function fmtResetClock(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  if (sameDay) return time;
  const dayMs = d - new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = dayMs > 0 && dayMs < 7 * 86400000 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  return `${weekday} ${time}`;
}
// Cadence label from codex's real window_minutes ("5h window" / "weekly").
function fmtCadence(mins) {
  if (!mins) return '';
  if (mins % 10080 === 0) return mins === 10080 ? 'weekly' : (mins / 10080) + 'w';
  if (mins % 1440 === 0) return (mins / 1440) + 'd';
  if (mins % 60 === 0) return (mins / 60) + 'h';
  return mins + 'm';
}
// Quota color per DESIGN.md thresholds: neutral <50, amber >50, red >80.
function quotaCls(pct) { return pct == null ? 'q-na' : pct > 80 ? 'q-red' : pct > 50 ? 'q-amber' : ''; }

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
// Identity: deterministic display name from the session id hash + a NEUTRAL
// built-in harness glyph. Harness identity is conveyed by GLYPH SHAPE, never
// vendor art and never color (DESIGN.md: "Harness identity is conveyed by
// icon, never by color"). Two glyphs are the permanent fallback; PR-2 adds
// runtime icon extraction from the LOCALLY INSTALLED app (never committed,
// never fixture mode -- see loadHarnessIcons below and lib/harness-icons.js).
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
// for a faint accent, not to encode identity. This is the PERMANENT fallback:
// fixture mode (no window.humanctl) always uses it, and the real app falls
// back to it silently whenever runtime icon extraction cannot produce an
// icon for a harness (app not installed, unreadable plist, decode failure --
// see loadHarnessIcons below and lib/harness-icons.js's resolveHarnessIconPath).
function builtinGlyph(harness) {
  const codex = harness === 'codex';
  return `<span class="hglyph ${codex ? 'g-codex' : 'g-claude'}" aria-hidden="true">${codex ? '◯' : '◉'}</span>`;
}
// Runtime-extracted icons (PR-2 item 1), keyed by harness id ('claude-code' |
// 'codex') -> data URL, populated once by loadHarnessIcons(). Fixture mode
// never populates this map, so demo/screenshots always render the glyph.
const harnessIconUrls = new Map();
async function loadHarnessIcons() {
  if (!window.humanctl || !window.humanctl.getHarnessIcons) return; // fixture mode: glyphs only, by design
  try {
    const r = await window.humanctl.getHarnessIcons();
    if (r && r.ok && r.icons) {
      for (const [harness, dataUrl] of Object.entries(r.icons)) {
        if (dataUrl) harnessIconUrls.set(harness, dataUrl);
      }
    }
  } catch { /* any failure: the glyph map below just stays empty */ }
}
function harnessGlyph(harness) {
  const key = harness === 'codex' ? 'codex' : 'claude-code';
  const url = harnessIconUrls.get(key);
  if (url) return `<span class="hglyph hicon" aria-hidden="true"><img src="${esc(url)}" alt="" width="16" height="16" /></span>`;
  return builtinGlyph(harness);
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
// PR chips (PR-2 item 2, DESIGN.md row anatomy line 3): CACHE-ONLY contract.
// pulse.pr-chip reads ONLY ~/.humanctl/pulse-cache.json (lib/commands.js
// prChip): zero network, zero git/gh spawns, ever, from this rendering path.
// A miss (no cache, repo not configured in pulse, cache expired past pulse's
// own TTL) renders no chip at all -- never a fake "0/0" -- and refreshing the
// underlying cache only ever happens when `humanctl pulse` itself runs
// (manual, or a future scheduled run), never triggered from here.
// prChipCache is populated once per _refresh()/runInboxFast() tick (batched
// over the distinct repo basenames on screen, not once per row) so the
// per-row render stays a synchronous cache lookup, same shape as isUnread().
// ============================================================
const prChipCache = new Map(); // repoBase -> chip object | null
async function refreshPrChips(repoBases) {
  if (!window.humanctl || !window.humanctl.getPrChip) return;
  const uniq = [...new Set(repoBases.filter(Boolean))];
  await Promise.all(uniq.map(async (repo) => {
    try {
      const r = await window.humanctl.getPrChip(repo);
      prChipCache.set(repo, r && r.ok ? r.chip : null);
    } catch { prChipCache.set(repo, null); }
  }));
}
function prChipHtml(repoBase) {
  const chip = repoBase ? prChipCache.get(repoBase) : null;
  if (!chip) return '';
  const label = `${chip.merged}/${chip.total}`;
  const ageTxt = chip.stale ? ` &middot; as of ${agoTxt(Date.now() - chip.ageMs)}` : '';
  const cls = chip.open > 0 ? 'c-need' : 'c-done';
  return `<span class="prchip ${cls}" title="pulse cache: ${chip.open} open, ${chip.merged} merged${ageTxt ? ageTxt.replace(' &middot; ', ', ') : ''}">${label} PRs${ageTxt}</span>`;
}

// ============================================================
// live state
// ============================================================
let agents = [];
let byId = new Map();
let allRows = [], status = null, allNotes = [], demo = false;
let inboxThreads = [];        // declared here (not near load) so functions above load() that read it are never in its TDZ during boot
// View replaces the old three modes. inbox is the default; metrics/fleet are
// quiet placeholder views (0.16 / 0.17); sessions replaces the old Wall;
// settings is a real view now (the old header gear popover is gone).
let view = 'inbox';           // inbox | metrics | fleet | sessions | settings
let navPinned = false;        // Cmd+\ pins the nav rail as a fixed column
let rightRailOpen = false;    // chief-of-staff drawer open state (persisted, default closed)
// The session detail renders in ONE of two hosts through the same render
// function (same component family, never forked): 'detailBody' is the
// full-width overlay (entered from Sessions, or from Inbox via Enter / the
// context menu; back breadcrumb + Esc return), 'inbPreview' is the Inbox
// thread-detail pane (the second pane of the two-pane Inbox).
let detailId = null;          // the session whose detail is showing (either host)
let detailHostId = null;      // 'detailBody' | 'inbPreview' | null
let detailFrom = 'inbox';     // which view Esc/back returns to from the overlay
const overlayOpen = () => detailHostId === 'detailBody' && !!detailId;
let selId = null;             // the selected session (drives which detail renders)
let theme = 'dark';           // effective: dark | light (what's actually applied)
let themePref = 'dark';       // stored preference: dark | light | system
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
    codexQuota: { plan_type: 'pro', primary: { used_percent: 46, window_minutes: 300, resets_at: now + 36 * 60 }, secondary: { used_percent: 71, window_minutes: 10080, resets_at: now + 5 * 86400 } },
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
// FLEET DIGEST (one owner: the bottom context bar). DESIGN.md signal-ownership
// table: "Fleet digest (counts) | bottom bar | none." Shell v3 moves the
// digest out of the header AND out of the chief-of-staff drawer (both were
// second homes for the same signal); this is now the ONLY digest renderer.
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
// HEADER (slim: wordmark + version + the right-drawer sidebar-toggle icon.
// Owns nothing else -- digest, resources, theme, and settings all moved out
// per the DESIGN.md signal-ownership table update in this release.
// ============================================================
function renderHeader() {
  el('verTag').textContent = status && status.version ? 'v' + status.version : 'demo';
  el('demoBadge').style.display = demo ? '' : 'none';
  const rb = el('btnRightRail');
  if (rb) rb.classList.toggle('on', rightRailOpen);
}

// ============================================================
// BOTTOM CONTEXT BAR (sole home: fleet digest, Codex quota, Claude quota, and
// the selected session's context-fill % when a session is open). Calm,
// single line, mono. Quota color: neutral <50, amber >50, red >80.
// ============================================================
function quotaItemHtml(label, pct, resetsAt, windowMinutes, extra) {
  if (pct == null) {
    return `<span class="cb-item q-na" title="${esc(extra || label + ' quota: no data source')}"><span class="dt"></span>${esc(label)} n/a</span>`;
  }
  const cadence = fmtCadence(windowMinutes);
  const tip = `${cadence ? cadence + ' window' : ''}${resetsAt ? (cadence ? '; ' : '') + 'resets ' + fmtResetClock(resetsAt) : ''}${extra ? ' · ' + extra : ''}`;
  const resetTxt = resetsAt ? ` · resets ${fmtResetClock(resetsAt)}` : '';
  return `<span class="cb-item ${quotaCls(pct)}" title="${esc(tip)}"><span class="dt"></span>${esc(label)} ${pct}%${resetTxt}</span>`;
}
function renderCtxBar() {
  const bar = el('ctxBar');
  if (!bar) return;
  const r = rollups();
  const qp = r.quota && r.quota.primary;
  const qs = r.quota && r.quota.secondary;
  const codexItem = qp && qp.used_percent != null
    ? quotaItemHtml('codex', Math.round(qp.used_percent), qp.resets_at, qp.window_minutes, qs && qs.used_percent != null ? `weekly ${Math.round(qs.used_percent)}%${qs.resets_at ? ', resets ' + fmtResetClock(qs.resets_at) : ''}` : '')
    : quotaItemHtml('codex', null);
  // Claude exposes no rate-limit/window field in its transcripts (only token
  // counts for cost estimation) -- confirmed absent, per rev-2 amendment 2.
  // Ship "n/a" honestly rather than fabricate a percentage.
  const claudeItem = quotaItemHtml('claude', null, null, null, 'confirmed: Claude Code transcripts expose no rate-limit/window data, only token counts');
  // overlayOpen() gates this on the full-width detail specifically (not just
  // any selection): the spec's "selected-session context%" means the session
  // actually open in view, not merely the last-clicked row in a list.
  const sel = overlayOpen() && detailId ? byId.get(detailId) : null;
  const ctxItem = sel && sel.ctxPct != null
    ? `<span class="cb-item" title="context window fill for the open session">${esc(sel.ctxPct)}% context</span>`
    : '';
  bar.innerHTML = `
    <span class="cb-digest">${digestHtml()}</span>
    <span class="cb-sep"></span>
    ${codexItem}
    <span class="cb-sep"></span>
    ${claudeItem}
    ${ctxItem ? `<span class="cb-sep"></span>${ctxItem}` : ''}
  `;
}

// ============================================================
// NAV STRIP (a VISIBLE icon strip by default; hover the strip itself for
// >=150ms to expand and show labels as an overlay; Cmd+\ pins the widened
// rail as a fixed column). Contents top to bottom: Inbox (unread badge),
// Metrics, Fleet, Sessions, then a spacer, then the user/settings picker
// anchored at the foot (Codex/Claude-Code sidebar-footer style). Keys
// 1/2/3/4 switch the four views; Settings is reached via the picker's
// "All settings" (still the registered app.set-view('settings') route).
// ============================================================
const NAV = [
  { view: 'inbox', label: 'Inbox', key: '1', glyph: '✉' },
  { view: 'metrics', label: 'Metrics', key: '2', glyph: '◰' },
  { view: 'fleet', label: 'Fleet', key: '3', glyph: '⌘' },
  { view: 'sessions', label: 'Sessions', key: '4', glyph: '☷' },
];
function unreadCount() {
  return inboxThreads.filter((t) => {
    const last = lastReadTs[t.sessionId] || 0;
    return t.items.some((it) => (Date.parse(it.ts) || 0) > last);
  }).length;
}
// humanctl is single-user and local-only (no account system, no Node `os`
// module in the renderer per preload.js's locked-down bridge), so the picker
// avatar is a fixed, honest "You" label rather than a fabricated username.
function userInitial() { return 'Y'; }
function renderNav() {
  const rail = el('navRail');
  if (!rail) return;
  const un = unreadCount();
  const items = NAV.map((n) => {
    const active = (view === n.view && !overlayOpen()) ? 'on' : '';
    const badge = (n.view === 'inbox' && un) ? `<span class="nav-badge">${un}</span>` : '';
    const kk = n.key ? `<span class="nav-key">${n.key}</span>` : '';
    return `<button class="nav-item ${active}" data-view="${n.view}" title="${esc(n.label)}${n.key ? ' (' + n.key + ')' : ''}" aria-label="${esc(n.label)}${un && n.view === 'inbox' ? ', ' + un + ' unread' : ''}" ${active ? 'aria-current="page"' : ''}>
      <span class="nav-glyph" aria-hidden="true">${n.glyph}</span>
      <span class="nav-label">${esc(n.label)}</span>
      ${badge}${kk}
    </button>`;
  }).join('');
  rail.innerHTML = `${items}<div class="nav-fill"></div>
    <div class="nav-user">
      <button class="nav-user-btn" id="navUserBtn" title="theme, settings" aria-haspopup="menu">
        <span class="av"><span class="dot">${esc(userInitial())}</span></span>
        <span class="nm">You</span>
        <span class="gear">&#9881;</span>
      </button>
    </div>`;
  rail.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  const ub = el('navUserBtn');
  if (ub) ub.addEventListener('click', (e) => { e.stopPropagation(); toggleUserPicker(); });
}

// ============================================================
// USER / SETTINGS PICKER (bespoke popover anchored at the foot of the nav
// strip; Codex/Claude-Code sidebar-footer style). Houses quick theme
// (light/dark/system), the always-on summary budget (the one real "how often
// does it run" control this app has -- no fabricated frequency knob), and
// "All settings", which routes to the existing registered app.set-view
// ('settings') destination rather than orphaning it.
// ============================================================
let userPickerOpen = false;
function setThemePref(v) {
  themePref = v === 'light' || v === 'system' ? v : 'dark';
  applyTheme();
  if (window.humanctl) window.humanctl.setState({ theme: themePref });
  redrawActive();
  renderUserPicker();
}
function renderUserPicker() {
  const box = el('userPicker');
  if (!box || !userPickerOpen) return;
  const seg = (id, opts, cur, label) => `<div class="seg2" id="${id}" role="group" ${label ? `aria-label="${esc(label)}"` : ''}>${opts.map((o) => `<button data-val="${o[0]}" class="${o[0] === cur ? 'on' : ''}" aria-pressed="${o[0] === cur}">${esc(o[1])}</button>`).join('')}</div>`;
  box.innerHTML = `
    <div class="pk-sect">
      <div class="pk-l">Theme</div>
      ${seg('pkTheme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], themePref, 'Theme')}
    </div>
    <hr />
    <div class="pk-sect">
      <div class="pk-l">Always-on summary budget</div>
      <div class="pk-row"><span class="sk">Daily (est USD)</span>
        <input class="hc-input set-num" id="pkSumBudget" type="number" min="0.10" step="0.10" aria-label="Always-on summary daily budget in US dollars" value="${esc(String(summaryBudgetUSD))}" style="width:76px" />
      </div>
      ${summaryBudgetChip ? `<p class="note" style="margin:6px 0 0;font-size:10.5px;color:var(--ink4)">today: ${esc(fmtUSD(summaryBudgetChip.spentUSD))} of ${esc(fmtUSD(summaryBudgetChip.dailyBudgetUSD))}${summaryBudgetChip.paused ? ' -- paused' : ''}</p>` : ''}
    </div>
    <hr />
    <button class="pk-item" id="pkAllSettings">All settings&hellip;</button>
  `;
  el('pkTheme').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setThemePref(b.dataset.val)));
  const sb = el('pkSumBudget');
  if (sb) sb.addEventListener('change', () => {
    const v = Math.max(0.1, Number(sb.value) || 1.0);
    summaryBudgetUSD = v;
    if (window.humanctl) window.humanctl.setState({ summaryBudgetUSD: v });
    refreshSummaryBudgetChip().then(() => renderUserPicker());
    toast('summary budget set to ' + fmtUSD(v) + '/day');
  });
  el('pkAllSettings').addEventListener('click', () => { closeUserPicker(); setView('settings'); });
}
function openUserPicker() {
  const box = el('userPicker');
  const btn = el('navUserBtn');
  if (!box || !btn) return;
  const r = btn.getBoundingClientRect();
  box.style.left = (r.right + 8) + 'px';
  box.style.bottom = (window.innerHeight - r.bottom) + 'px';
  box.hidden = false;
  userPickerOpen = true;
  renderUserPicker();
  document.addEventListener('click', onPickerOutsideClick);
  // a11y: move focus into the popover (first focusable control) so keyboard
  // users land inside it immediately, same contract as the CoS drawer and the
  // context menu.
  const first = box.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
}
function closeUserPicker() {
  const box = el('userPicker');
  const hadFocus = box && box.contains(document.activeElement);
  if (box) box.hidden = true;
  userPickerOpen = false;
  document.removeEventListener('click', onPickerOutsideClick);
  // a11y: return focus to the trigger only if focus was actually inside the
  // popover (an outside click that closes it should not steal focus back).
  if (hadFocus) { const btn = el('navUserBtn'); if (btn) btn.focus(); }
}
function onPickerOutsideClick(e) {
  const box = el('userPicker');
  // Use composedPath(), not box.contains(e.target): a click on a picker
  // control (e.g. the theme segmented buttons) can trigger a synchronous
  // re-render that replaces box.innerHTML BEFORE this document-level
  // listener runs (it fires after the click's own handler on bubble), which
  // would make e.target a now-detached node and box.contains(e.target)
  // incorrectly return false, closing the picker out from under the click
  // that was supposed to update it. composedPath() reflects the DOM as it
  // was at dispatch time, so it is immune to that race.
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  const btn = el('navUserBtn');
  if (box && !path.includes(box) && !(btn && path.includes(btn))) closeUserPicker();
}
function toggleUserPicker() { if (userPickerOpen) closeUserPicker(); else openUserPicker(); }

// ============================================================
// VIEW SWITCHING (registry-backed via app.set-view). Leaving detail if open.
// ============================================================
// setViewLocal applies a view change to THIS window's DOM/state only, with no
// write-back to window.humanctl.setView. Used whenever the new view value
// already came FROM persisted/broadcast state (load()'s boot-time restore,
// applyExternalState's live CLI/socket-driven update) so it never re-persists
// a value that is already on disk, which would re-broadcast state:changed and
// risk a self-triggered setView echo. setView (below) is the write-through
// version for genuine user-initiated changes (click, keyboard shortcut,
// context menu), which DOES need to persist.
function setViewLocal(v) {
  if (!['inbox', 'metrics', 'fleet', 'sessions', 'settings'].includes(v)) v = 'inbox';
  detailId = null;
  detailHostId = null;
  view = v;
  renderView();
}
function setView(v) {
  setViewLocal(v);
  if (window.humanctl) window.humanctl.setView(view);
}
function renderView() {
  // Toggle the full-width overlay; show the active view section otherwise.
  // (The Inbox thread-detail pane is inside the inbox view itself, so it is
  // NOT the overlay; Inbox.render() re-renders it below.)
  el('detailWrap').classList.toggle('on', overlayOpen());
  document.querySelectorAll('.view').forEach((s) => s.classList.remove('on'));
  if (!overlayOpen()) {
    const sec = el('view-' + view);
    if (sec) sec.classList.add('on');
    if (view === 'inbox' && window.Inbox) { window.Inbox.setData(inboxThreads, lastReadTs); window.Inbox.render(); }
    else if (view === 'sessions') renderSessions();
    else if (view === 'metrics') renderMetrics();
    else if (view === 'fleet') renderFleetPlaceholder();
    else if (view === 'settings') renderSettings();
  }
  renderNav();
  // The bottom context bar shows the open session's context-fill % (its one
  // owner per DESIGN.md); every view/detail transition passes through here,
  // so this is the one place that needs to repaint it.
  renderCtxBar();
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
  detailHostId = 'detailBody';
  renderView();
  renderDetail();
}
function closeDetail() {
  detailId = null;
  detailHostId = null;
  view = detailFrom || 'inbox';
  if (window.humanctl) window.humanctl.setView(view);
  renderView();
}
// The Inbox thread-detail pane: the SAME detail component rendered into the
// Inbox's second pane (host 'inbPreview') instead of the full-width overlay.
// Called by inbox.js whenever a thread is selected; never a fork.
function renderThreadDetail(id) {
  if (!byId.has(id)) return;
  selectSession(id);
  detailId = id;
  detailHostId = 'inbPreview';
  renderDetail();
}

// ============================================================
// INBOX v2 lives in inbox.js (thread list + selection). Sessions view and the
// session detail live here; Inbox renders the same detail into its own pane
// via renderThreadDetail above (one component family, two hosts, zero forks).
// ============================================================

// Session detail: the one component family for both hosts (DESIGN.md: session
// state+reason owns the header chip; context fill owns the detail meta;
// single-session chat owns the composer here). The overlay host adds the back
// breadcrumb; the Inbox pane host omits it (the thread list is beside it).
function renderDetail() {
  const a = byId.get(detailId);
  const hostId = detailHostId || 'detailBody';
  const wrap = el(hostId);
  if (!wrap || !a) return;
  // One detail at a time: blank the other host so stale duplicate ids never
  // linger in the DOM (el() targets by id).
  const other = el(hostId === 'detailBody' ? 'inbPreview' : 'detailBody');
  if (other) other.innerHTML = '';
  const crumbBack = hostId === 'detailBody';
  const s = STATE[a.state], h = hue(s.hue);
  wrap.style.setProperty('--c-sel', h);
  const fromLabel = { inbox: 'Inbox', sessions: 'Sessions' }[detailFrom] || 'back';
  const t = inboxThreads.find((x) => x.sessionId === a.id);
  const stream = t ? t.items.slice().reverse().map(streamItemHtml).join('') : '';

  // Layout (2026-07 composer-cutoff fix): the detail pane is a height-
  // constrained flex column, not a single scrolling blob. Everything through
  // the conversation timeline lives in a scrollable .detail-scroll region
  // (flex:1, its own overflow-y); the ask-the-session block -- the composer
  // and its suggested-reply row, the core reply loop DESIGN.md calls out as
  // this app's point -- is a sticky footer OUTSIDE that scroll region, so it
  // is always fully visible regardless of conversation length or window
  // height. Touched chips and the details disclosure are supplementary and
  // stay in the scroll area with everything else.
  const scrollInner = `
    <div class="detail-crumb">
      ${crumbBack ? `<button class="crumb-back" id="crumbBack">&#8592; ${esc(fromLabel)}</button>` : ''}
      <span class="crumb-live" id="detailLive">${esc(liveIndicatorText(a))}</span>
      <button class="crumb-pin ${pins.has(a.id) ? 'on' : ''}" id="crumbPin" title="${pins.has(a.id) ? 'unpin session' : 'pin session'}" aria-label="${pins.has(a.id) ? 'unpin session' : 'pin session'}">&#128204; ${pins.has(a.id) ? 'Pinned' : 'Pin'}</button>
    </div>
    <div class="detail-hd">
      <div class="dh-id">
        ${harnessGlyph(a.harness)}
        <div class="dh-meta">
          <div class="dh-row1">
            <h1>${nameHtml(a)}</h1>
            <span class="chip ${s.cls}" data-tip="${esc(stateTip(a))}" tabindex="0" role="status" aria-label="${esc(stateTip(a))}"><span class="dt" aria-hidden="true"></span>${s.label}</span>
            ${a.tier !== 'hot' ? `<span class="chip c-idle" data-tip="${esc(stateTip(a))}" tabindex="0" role="status" aria-label="${esc(stateTip(a))}"><span class="dt" aria-hidden="true"></span>${esc(TIERS[a.tier].label)}</span>` : ''}
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
    <div id="touchedChips"></div>
    <div class="detail-disc">
      <button class="disc-tog" id="discTog" aria-expanded="false" aria-controls="discBody">Session details</button>
      <div class="disc-body" id="discBody" hidden></div>
    </div>`;
  const inner = `<div class="detail-scroll">${scrollInner}</div>${askBlockHtml(a)}`;
  // The overlay host (#detailBody) already carries the .detail width wrapper;
  // the Inbox pane wraps the same markup in one so both read identically.
  wrap.innerHTML = crumbBack ? inner : `<div class="detail">${inner}</div>`;

  const back = el('crumbBack');
  if (back) back.addEventListener('click', closeDetail);
  el('crumbPin').addEventListener('click', () => togglePin(a.id));
  wireResumeSplit(a, wrap);
  wireAsk(a);
  const dtStream = el('dtStream');
  if (dtStream) {
    dtStream.querySelectorAll('[data-retry-q]').forEach((b) => b.addEventListener('click', () => runAsk(a, b.dataset.retryQ)));
    wireThumbClicks(dtStream);
    hydrateThumbs(dtStream);
  }
  el('discTog').addEventListener('click', (e) => {
    const body = el('discBody');
    body.hidden = !body.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!body.hidden));
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
    <button class="btn primary caret" id="resumeCaret" aria-label="more resume options" aria-haspopup="menu" aria-expanded="false">&#9662;</button>
    <div class="resume-menu" id="resumeMenu" role="menu" aria-label="more resume options" hidden>
      ${ra.secondary ? `<button data-dact="${ra.secondary.act}" role="menuitem">${esc(ra.secondary.label)}</button>` : ''}
      <button data-dact="reveal" role="menuitem">Reveal transcript</button>
      <button data-dact="copy-id" role="menuitem">Copy session id</button>
    </div>
  </div>`;
}
function closeResumeMenu(returnFocus) {
  const caret = el('resumeCaret');
  const menu = el('resumeMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  if (caret) caret.setAttribute('aria-expanded', 'false');
  if (returnFocus && caret) caret.focus();
}
function wireResumeSplit(a, wrap) {
  wrap.querySelectorAll('[data-dact]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); closeResumeMenu(false); runAction(b.dataset.dact, a); }));
  const caret = wrap.querySelector('#resumeCaret');
  const menu = wrap.querySelector('#resumeMenu');
  if (caret && menu) {
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      caret.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) { const first = menu.querySelector('[role="menuitem"]'); if (first) first.focus(); }
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeResumeMenu(true); }
    });
  }
}
// One document-level closer for the resume dropdown (registered once, not per
// render, so repaints never accumulate listeners). Esc when focus is inside
// the caret itself (menu not yet opened via click) also needs no special
// handling since the menu is already hidden in that case.
document.addEventListener('mousedown', (e) => {
  const menu = el('resumeMenu');
  if (menu && !menu.hidden && !menu.contains(e.target) && e.target.id !== 'resumeCaret') closeResumeMenu(false);
});

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
// Note images (PR-2 item 3): a note's `attachments` array holds filenames
// under ~/.humanctl/attachments/ (never a raw path -- see lib/commands.js
// storeNoteImages, which copies the caller's file in). Rendered as small
// inline thumbnails; clicking one opens the full image via app.open-path,
// same "open externally, never embed a viewer" pattern session.reveal uses
// for transcripts. Thumbnails are hydrated async (loadNoteThumb below) since
// each needs its own IPC read; the placeholder is a quiet loading square, not
// a broken-image flash.
function attachmentsHtml(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  return `<div class="tsimgs">${list.map((name) => `<span class="tsimg" data-thumb="${esc(name)}" title="click to open"></span>`).join('')}</div>`;
}
const noteThumbCache = new Map(); // filename -> data URL
async function hydrateThumbs(root) {
  if (!window.humanctl || !window.humanctl.getNoteImage || !root) return;
  const spans = root.querySelectorAll('.tsimg[data-thumb]');
  for (const span of spans) {
    const name = span.dataset.thumb;
    if (!name) continue;
    if (noteThumbCache.has(name)) { span.style.backgroundImage = `url(${noteThumbCache.get(name)})`; continue; }
    try {
      const r = await window.humanctl.getNoteImage(name);
      if (r && r.ok && r.dataUrl) {
        noteThumbCache.set(name, r.dataUrl);
        span.style.backgroundImage = `url(${r.dataUrl})`;
      }
    } catch { /* leave the quiet placeholder */ }
  }
}
function wireThumbClicks(root) {
  if (!root) return;
  root.querySelectorAll('.tsimg[data-thumb]').forEach((span) => {
    span.addEventListener('click', async () => {
      if (!window.humanctl || !window.humanctl.resolveAttachment) return;
      const r = await window.humanctl.resolveAttachment(span.dataset.thumb);
      if (r && r.ok && r.path) window.humanctl.openPath(r.path); // app.open-path: the one registered "open a local file" action
      else toast('could not open this image.');
    });
  });
}
function streamItemHtml(it) {
  const ts = (i) => esc(agoTxt(Date.parse(i.ts) || 0));
  if (it.kind === 'note') {
    return `<div class="tsitem" style="--il:${LEVEL_HUE[it.level] || 'var(--iris)'}">
      <div class="th2"><span class="lvl">${esc(LEVEL_LABEL[it.level] || it.level)} &middot; note</span><span class="when2">${ts(it)}</span></div>
      <div class="body2">${esc(it.message)}</div>
      ${attachmentsHtml(it.attachments)}
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
      <input class="hc-input" id="askInput" type="text" maxlength="500" placeholder="Ask this session anything..." aria-label="Ask this session anything" value="${esc(askDraft.get(a.id) || '')}" ${busy ? 'disabled' : ''} />
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
  const rowLabel = `${displayName(a)}, ${stateTip(a)}, ${messageToHuman(a)}${unread ? ', unread' : ''}`;
  return `<div class="srow ${dense ? 'dense' : ''} ${a.id === selId ? 'sel' : ''} ${TIERS[a.tier].cls}" style="--c-sel:${h}" data-id="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(rowLabel)}">
    ${unread ? `<span class="unread tip-left on" data-tip="unread &middot; new since you last opened this" aria-hidden="true"></span>` : `<span class="unread" aria-hidden="true"></span>`}
    <span class="sbody">
      <span class="l1">${harnessGlyph(a.harness)}<span class="nm">${nameHtml(a)}</span><span class="when">${timeLadder(a)}</span></span>
      <span class="l2"><span class="chip ${s.cls}" data-tip="${esc(stateTip(a))}"><span class="dt" aria-hidden="true"></span>${s.label}</span><span class="msg">${esc(messageToHuman(a))}</span></span>
      <span class="l3">${esc(cwdBase(a.cwd) || a.repo)}${prChipHtml(cwdBase(a.cwd) || a.repo)}</span>
    </span>
    <button class="pinbtn ${isPin ? 'on' : ''}" data-pin="${esc(a.id)}" title="${isPin ? 'unpin' : 'pin'}" aria-label="${isPin ? 'unpin' : 'pin'} ${esc(displayName(a))}">&#128204;</button>
  </div>`;
}
function isUnread(id) {
  const t = inboxThreads.find((x) => x.sessionId === id);
  if (!t) return false;
  const last = lastReadTs[id] || 0;
  return t.items.some((it) => (Date.parse(it.ts) || 0) > last);
}
// The three filter/sort controls are the bespoke HcSelect component (0.16.1
// controls + a11y pass), mounted onto these placeholder spans by
// wireSessionsToolbar below. Native <select> is never used per DESIGN.md.
function toolbarHtml(scope) {
  const f = scope === 'sessions' ? sessFilter : null;
  if (!f) return '';
  return `<div class="toolbar">
    <input class="hc-input tb-search" id="sessSearch" type="text" placeholder="Search sessions..." aria-label="Search sessions" value="${esc(f.q)}" />
    <span id="sessState"></span>
    <span id="sessHarness"></span>
    <span id="sessSort"></span>
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
  wireRowActivation(rowsBox.querySelectorAll('.srow'));
  rowsBox.querySelectorAll('.srow').forEach((r) => {
    r.addEventListener('click', (e) => { if (e.target.closest('[data-pin]')) return; openDetail(r.dataset.id, 'sessions'); });
    if (window.ContextMenu) r.addEventListener('contextmenu', (e) => { e.preventDefault(); window.ContextMenu.open(e, { type: 'session', agent: byId.get(r.dataset.id) }); });
  });
  rowsBox.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); togglePin(b.dataset.pin); }));
}
function wireSessionsToolbar() {
  const s = el('sessSearch');
  if (s) s.addEventListener('input', () => { sessFilter.q = s.value; renderSessionRows(); });
  if (window.HcSelect) {
    const stHost = el('sessState');
    if (stHost) HcSelect.create(stHost, {
      ariaLabel: 'Filter by state', value: sessFilter.state,
      options: [['', 'all states'], ['need', 'needs input'], ['block', 'blocked'], ['work', 'running'], ['idle', 'stalled'], ['done', 'finished']],
      onChange: (v) => { sessFilter.state = v; renderSessionRows(); },
    });
    const hhHost = el('sessHarness');
    if (hhHost) HcSelect.create(hhHost, {
      ariaLabel: 'Filter by harness', value: sessFilter.harness,
      options: [['', 'all harnesses'], ['claude-code', 'claude'], ['codex', 'codex']],
      onChange: (v) => { sessFilter.harness = v; renderSessionRows(); },
    });
    const soHost = el('sessSort');
    if (soHost) HcSelect.create(soHost, {
      ariaLabel: 'Sort sessions', value: sessFilter.sort,
      options: [['recent', 'recent'], ['state', 'state'], ['created', 'created'], ['title', 'title']],
      onChange: (v) => { sessFilter.sort = v; renderSessionRows(); },
    });
  }
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
  wireRowActivation(rowsBox.querySelectorAll('.srow'));
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
// Metrics (0.16): the one owner of spend / tokens / quota (DESIGN.md). This
// ships the basic version -- real numbers, no chart yet; the richer tiles
// (time-range picker, anomaly line, skills/productivity breakdown) are a
// fast-follow, called out honestly rather than faked here.
function renderMetrics() {
  const r = rollups();
  const rows = [
    ['claude spend (est)', r.claudeUSD != null ? fmtUSD(r.claudeUSD) : 'n/a'],
    ['codex api-equiv (est)', r.codexUSD != null ? fmtUSD(r.codexUSD) : 'n/a'],
    ['tokens (fleet)', r.tokens ? fmtTok(r.tokens) : 'n/a'],
  ];
  if (r.quota && r.quota.primary && r.quota.primary.used_percent != null) {
    const qp = r.quota.primary;
    rows.push(['codex quota (' + (fmtCadence(qp.window_minutes) || '5h') + ')', qp.used_percent + '%' + (qp.resets_at ? ' &middot; resets ' + fmtResetClock(qp.resets_at) : '')]);
  }
  if (r.quota && r.quota.secondary && r.quota.secondary.used_percent != null) {
    const qs = r.quota.secondary;
    rows.push(['codex quota (' + (fmtCadence(qs.window_minutes) || 'weekly') + ')', qs.used_percent + '%' + (qs.resets_at ? ' &middot; resets ' + fmtResetClock(qs.resets_at) : '')]);
  }
  rows.push(['claude quota', 'n/a &middot; Claude Code transcripts expose no rate-limit data']);
  el('view-metrics').innerHTML = `
    <div class="view-hd"><span class="glyph">&#9712;</span><span class="ttl">Metrics</span><span class="sub">basic; the fuller view (time range, anomaly line, skills/productivity) is a fast-follow</span></div>
    <div class="settings">
      <div class="set-sect">
        <h4>Resources</h4>
        <div class="gstats">${rows.map((x) => `<div class="gstat"><span class="k">${x[0]}</span><span class="v">${x[1]}</span></div>`).join('')}</div>
      </div>
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
  const seg = (id, opts, cur, label) => `<div class="seg2" id="${id}" role="group" ${label ? `aria-label="${esc(label)}"` : ''}>${opts.map((o) => `<button data-val="${o[0]}" class="${o[0] === cur ? 'on' : ''}" aria-pressed="${o[0] === cur}">${esc(o[1])}</button>`).join('')}</div>`;
  const destSeg = (h) => {
    const avail = appAvailable(h);
    const cur = avail ? openPref[h] : 'terminal';
    return `<div class="seg2" role="group" aria-label="Resume destination for ${esc(h)}" data-openseg="${h}">
      <button data-dest="app" class="${cur === 'app' ? 'on' : ''}" aria-pressed="${cur === 'app'}" ${avail ? '' : 'disabled'} title="${avail ? '' : 'no desktop app registered for this harness on this machine'}">Desktop app</button>
      <button data-dest="terminal" class="${cur === 'terminal' ? 'on' : ''}" aria-pressed="${cur === 'terminal'}">Terminal</button>
    </div>`;
  };
  box.innerHTML = `
    <div class="view-hd"><span class="glyph">&#9881;</span><span class="ttl">Settings</span></div>
    <div class="settings">
      <div class="set-sect">
        <h4>Appearance</h4>
        <div class="set-row"><span class="sk">Theme</span>${seg('setTheme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], themePref, 'Theme')}</div>
      </div>
      <div class="set-sect">
        <h4>AI summary engine</h4>
        <p class="sub">Which local CLI generates the on-demand summary. It runs on your machine, through your own CLI auth.</p>
        ${seg('setEngine', [['claude', 'Claude Code'], ['codex', 'Codex']], summarizer, 'AI summary engine')}
        <p class="note">Only the "AI summary" and "Ask the session" actions send data off-device, through your own CLI auth. Claude asks leave no trace in the session; Codex asks write the marked question into the thread itself. Nothing else leaves your machine.</p>
      </div>
      <div class="set-sect">
        <h4>Resume sessions in</h4>
        <p class="sub">Where the resume action takes you, per harness. The other choice stays one click away in the detail header.</p>
        <div class="set-row"><span class="sk">Claude Code</span>${destSeg('claude-code')}</div>
        <div class="set-row"><span class="sk">Codex</span>${destSeg('codex')}</div>
      </div>
      <div class="set-sect">
        <h4>Always-on AI summary</h4>
        <p class="sub">Unread threads that need you get a background summary automatically (haiku, same engine as the manual button), refreshed after roughly 12 new events. It pauses honestly for the rest of the day once it hits this budget; nothing is ever silently over-spent.</p>
        <div class="set-row"><span class="sk">Daily budget (est USD)</span>
          <input class="hc-input set-num" id="setSumBudget" type="number" min="0.10" step="0.10" aria-label="Always-on summary daily budget in US dollars" value="${esc(String(summaryBudgetUSD))}" />
        </div>
        ${summaryBudgetChip ? `<p class="note">Today: ${esc(fmtUSD(summaryBudgetChip.spentUSD))} of ${esc(fmtUSD(summaryBudgetChip.dailyBudgetUSD))}${summaryBudgetChip.paused ? ' -- paused for the rest of today' : ''}.</p>` : ''}
      </div>
    </div>`;
  el('setTheme').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setThemePref(b.dataset.val); renderSettings(); }));
  el('setEngine').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { summarizer = b.dataset.val === 'codex' ? 'codex' : 'claude'; if (window.humanctl) window.humanctl.setState({ summarizer }); renderSettings(); toast('AI summary engine: ' + engineLabel(summarizer)); }));
  box.querySelectorAll('[data-openseg] button').forEach((b) => b.addEventListener('click', () => {
    if (b.disabled) return;
    const h = b.closest('[data-openseg]').dataset.openseg;
    openPref = Object.assign({}, openPref, { [h]: b.dataset.dest === 'app' ? 'app' : 'terminal' });
    if (window.humanctl) window.humanctl.setState({ openPref });
    renderSettings();
    toast((h === 'codex' ? 'Codex' : 'Claude Code') + ' sessions now open in ' + (openPref[h] === 'app' ? 'the desktop app' : 'Terminal') + '.');
  }));
  const sb = el('setSumBudget');
  if (sb) sb.addEventListener('change', () => {
    const v = Math.max(0.1, Number(sb.value) || 1.0);
    summaryBudgetUSD = v;
    if (window.humanctl) window.humanctl.setState({ summaryBudgetUSD: v });
    refreshSummaryBudgetChip().then(() => { renderSettings(); redrawChrome(); });
    toast('summary budget set to ' + fmtUSD(v) + '/day');
  });
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
// Always-on summary engine (PR-2 item 4, DESIGN.md-adjacent: one ambient
// signal, no new timer). Scope: unread AND needs-* threads only. Piggybacks
// the EXISTING 20s renderer poll via _refresh() -> runAutoSummaries() above;
// there is no separate setInterval for this. A thread qualifies for
// (re)summary when it has no cached summary yet, or has landed >=12 new
// substantive items since the cached summary's timestamp. Budget: one
// authoritative unit (estimated dollars/day, lib/pricing.js-priced,
// lib/summary-budget.js-tracked); on persistent failure electron/main.js
// returns {skipped:true} and this engine leaves the stale summary exactly as
// it was (age label included), never blanking it and never toasting.
// ============================================================
let summaryBudgetUSD = 1.0;         // default; overridden by state.summaryBudgetUSD
let summaryBudgetChip = null;       // {paused, spentUSD, dailyBudgetUSD} | null, rendered by renderHeader
const autoSummaryRunning = new Set(); // sessionIds with an in-flight auto call (dedupe overlapping ticks)
const AUTO_SUMMARY_EVENT_THRESHOLD = 12;

function threadNeedsAutoSummary(t, a) {
  if (!a) return false; // no live session row (aged out of scan): nothing to summarize
  const isNeedsState = a.state === 'need' || a.state === 'block';
  if (!isNeedsState) return false;
  const last = lastReadTs[t.sessionId] || 0;
  const unread = t.items.some((it) => (Date.parse(it.ts) || 0) > last);
  if (!unread) return false;
  const cached = summaries.get(a.id);
  if (!cached) return true; // no summary yet: always qualifies
  const cachedAt = cached.at || 0;
  const newSince = t.items.filter((it) => (Date.parse(it.ts) || 0) > cachedAt).length;
  return newSince >= AUTO_SUMMARY_EVENT_THRESHOLD;
}

async function refreshSummaryBudgetChip() {
  if (!window.humanctl || !window.humanctl.getSummaryBudget) return;
  try {
    const r = await window.humanctl.getSummaryBudget({ dailyBudgetUSD: summaryBudgetUSD });
    if (r && r.ok) {
      const prevPaused = summaryBudgetChip && summaryBudgetChip.paused;
      summaryBudgetChip = r.budget;
      if (summaryBudgetChip.paused !== prevPaused) redrawChrome();
    }
  } catch { /* the chip is advisory; a failed read just skips this tick */ }
}

async function runAutoSummaries() {
  if (!window.humanctl) return;
  await refreshSummaryBudgetChip();
  if (summaryBudgetChip && summaryBudgetChip.paused) return; // honest pause: no auto calls fire past the cap
  const candidates = inboxThreads.filter((t) => {
    if (autoSummaryRunning.has(t.sessionId)) return false;
    const a = byId.get(t.sessionId);
    return threadNeedsAutoSummary(t, a);
  });
  if (!candidates.length) return;
  // One at a time per tick keeps this a background trickle, not a burst of
  // spawned CLI processes the moment several threads go stale together.
  const t = candidates[0];
  const a = byId.get(t.sessionId);
  autoSummaryRunning.add(t.sessionId);
  try {
    const r = await window.humanctl.summarize({ path: a.path, harness: a.harness, engine: 'claude', auto: true });
    if (r && r.ok && r.summary) {
      rememberSummary(a.id, { text: r.summary, engine: r.engine || 'claude', at: Date.now() });
      repaintSummary(a.id, true);
    } else if (r && r.paused) {
      summaryBudgetChip = { paused: true, spentUSD: r.spentUSD, dailyBudgetUSD: r.dailyBudgetUSD };
      redrawChrome();
    }
    // r.skipped (401-retry-exhausted / not-authenticated) and any other
    // failure: intentionally silent, no toast, stale summary (if any) is left
    // exactly as-is with its existing age label. This IS the honest-skip
    // behavior the spec calls for.
  } catch { /* background engine failures are always silent */ }
  finally { autoSummaryRunning.delete(t.sessionId); }
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
  // PR chips (cache-only, see prChipHtml above): refresh the small set of
  // distinct repo basenames currently on screen, then repaint once landed.
  // This is a local cache read (no network, no spawn), so the round trip is
  // fast; the repaint-after-land pattern avoids blocking remapAgents/render
  // on it, matching how summaries/asks already repaint their own block in
  // place rather than gating the main render loop.
  const repoBases = agents.map((a) => cwdBase(a.cwd) || a.repo);
  refreshPrChips(repoBases).then(() => redrawActive());
}
// Chrome that must stay in sync no matter which view is active.
function redrawChrome() {
  renderHeader();
  renderNav();
  renderCtxBar();
  if (userPickerOpen) renderUserPicker();
  if (window.Atlas) window.Atlas.refresh();
}
function redrawActive() {
  redrawChrome();
  // The full-width overlay repaints alone; the Inbox view repaints its list AND
  // its in-pane thread detail together via Inbox.render().
  if (overlayOpen() && byId.has(detailId)) renderDetail();
  else if (view === 'inbox' && window.Inbox) { window.Inbox.setData(inboxThreads, lastReadTs); window.Inbox.render(); }
  else if (view === 'sessions') renderSessions();
  else if (view === 'metrics') renderMetrics();
  else if (view === 'fleet') renderFleetPlaceholder();
  else if (view === 'settings') renderSettings();
}

// ============================================================
// theme (dark | light | system; the header toggle is gone -- the user picker
// at the foot of the nav strip is the one entry point per DESIGN.md)
// ============================================================
const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  theme = themePref === 'system' ? ((sysDark && sysDark.matches) ? 'dark' : 'light') : themePref;
  document.body.classList.toggle('light', theme === 'light');
  clearHueCache();
}
if (sysDark && sysDark.addEventListener) {
  sysDark.addEventListener('change', () => { if (themePref === 'system') { applyTheme(); redrawActive(); } });
}

// ============================================================
// NAV STRIP hover intent + pin. The strip is a VISIBLE icon-width column by
// default (not hidden); hovering it for >=150ms expands it to show labels as
// an overlay (does not push content); mouse-out collapses it back to icons
// unless pinned. Cmd+\ pins the widened rail as a fixed column that pushes
// content over. This is the ONE hover-intent timer; no other timers are
// introduced (perf: SLOs).
const HOVER_INTENT_MS = 150;
let hoverTimer = null;
function showNav() { document.body.classList.add('nav-open'); }
function hideNav() { if (!navPinned) document.body.classList.remove('nav-open'); }
function applyNavPinned() {
  document.body.classList.toggle('nav-pinned', navPinned);
  if (navPinned) document.body.classList.add('nav-open'); else document.body.classList.remove('nav-open');
}
function setupNavHover() {
  const rail = el('navRail');
  if (rail) {
    rail.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(showNav, HOVER_INTENT_MS); });
    rail.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(hideNav, HOVER_INTENT_MS); if (userPickerOpen) closeUserPicker(); });
  }
}
function toggleNavPinned() {
  navPinned = !navPinned;
  applyNavPinned();
  if (window.humanctl) window.humanctl.setNav(navPinned);
}

// ============================================================
// right (chief-of-staff) drawer toggle + persistence (app.set-cos-drawer;
// named distinctly from the retired shell-v2 app.set-right-rail command so
// this newer, unrelated concept does not resurrect a deleted name).
// Atlas.setOnClose fires for EVERY close path (scrim click, Esc, the drawer's
// own close button, or this toggle), so rightRailOpen and the header icon
// state never drift from what is actually on screen.
// ============================================================
function persistRightRail(nowOpen) {
  rightRailOpen = nowOpen;
  renderHeader();
  if (window.humanctl && window.humanctl.setCosDrawer) window.humanctl.setCosDrawer(nowOpen);
}
// window.Atlas is registered by atlas.js, loaded AFTER this file (script tag
// order in index.html), so this wiring happens in boot.js's load path instead
// of here at top level.
function toggleRightRail() {
  if (!window.Atlas) return;
  if (window.Atlas.isOpen()) window.Atlas.close();
  else { window.Atlas.open(); persistRightRail(true); }
}

// ============================================================
// keyboard
// ============================================================
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + \ toggles the pinned nav rail from anywhere.
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleNavPinned(); return; }
  // a11y fix: Escape while focus sits inside an open overlay (the CoS
  // drawer's chat input, the user picker) must close THAT overlay, not just
  // blur the focused field beneath it -- checked before the blanket
  // INPUT/TEXTAREA/SELECT/BUTTON blur guard below, which would otherwise
  // swallow the keypress (blur the input, never reach the drawer-close
  // branch) whenever an overlay's own composer/input has focus.
  if (e.key === 'Escape' && window.Atlas && window.Atlas.isOpen()) { toggleRightRail(); return; }
  if (e.key === 'Escape' && userPickerOpen) { closeUserPicker(); return; }
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON')) {
    // Controls that manage their own Escape contract (the bespoke HcSelect
    // trigger: close-and-return-focus-to-self) opt out of this blanket blur
    // via data-esc-self; blurring here would undo their own trigger.focus()
    // call a moment later in the same Escape keypress.
    if (e.key === 'Escape' && e.target.blur && !e.target.closest('[data-esc-self]')) e.target.blur();
    // a11y fix: only text-entry elements (INPUT/TEXTAREA/SELECT) need
    // protection from the single-letter/number view-switch shortcuts below
    // stealing a keystroke meant to be typed. A focused BUTTON never consumes
    // printable characters, so single-letter/number shortcuts must still
    // reach it (e.g. pressing "a" to open the CoS drawer while focus sits on
    // the drawer's own toggle button, right after Esc returned focus there,
    // must still work) -- EXCEPT Enter/Space, a button's own native
    // activation keys, which must not also fall through to the Inbox
    // j/k/Enter shortcuts below and double-fire.
    if (e.target.tagName !== 'BUTTON' || e.key === 'Enter' || e.key === ' ') return;
  }
  if (e.key === 'Escape' && overlayOpen()) { closeDetail(); return; }
  // preventDefault: toggleRightRail() synchronously moves focus into the
  // drawer's chat input (a11y: focus-moves-in-on-open), and without this the
  // same "a" keypress that opened it also lands as a typed character in that
  // now-focused field.
  if (e.key === 'a' || e.key === 'A') { e.preventDefault(); toggleRightRail(); return; }
  if (e.key === '1') setView('inbox');
  else if (e.key === '2') setView('metrics');
  else if (e.key === '3') setView('fleet');
  else if (e.key === '4') setView('sessions');
  else if (view === 'inbox' && !overlayOpen() && window.Inbox) {
    if (e.key === 'j') { e.preventDefault(); window.Inbox.move(1); }
    else if (e.key === 'k') { e.preventDefault(); window.Inbox.move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); window.Inbox.openSelected(); }
  }
});
el('btnRightRail').addEventListener('click', () => toggleRightRail());

// ============================================================
// load + realtime
// ============================================================
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
    if (view === 'inbox' && !overlayOpen() && window.Inbox) { window.Inbox.setData(inboxThreads, lastReadTs); window.Inbox.render(); }
    if (window.Atlas) window.Atlas.refresh();
  } finally {
    inboxFastRunning = false;
    if (inboxFastQueued) { inboxFastQueued = false; runInboxFast(); }
  }
}
async function load() {
  if (window.Atlas) window.Atlas.setOnClose(() => persistRightRail(false));
  if (!window.humanctl) {
    demo = true;
    allRows = FIXTURE_ROWS; status = fixtureStatus(); allNotes = FIXTURE_NOTES;
    inboxThreads = (window.Inbox && window.Inbox.fixtureThreads) ? window.Inbox.fixtureThreads() : [];
    applyTheme(); applyNavPinned(); setupNavHover(); remapAgents(); renderHeader(); renderNav(); renderCtxBar(); setView('inbox');
    if (window.Atlas) window.Atlas.hydrateFixture();
    return;
  }
  await loadHarnessIcons(); // best-effort; harnessGlyph() falls back to the built-in glyph either way
  const st = await window.humanctl.getState();
  if (st && st.ok && st.state) {
    themePref = ['light', 'dark', 'system'].includes(st.state.theme) ? st.state.theme : 'dark';
    view = ['inbox', 'metrics', 'fleet', 'sessions', 'settings'].includes(st.state.view) ? st.state.view : 'inbox';
    navPinned = st.state.navPinned === true;
    rightRailOpen = st.state.rightRailOpen === true;
    pins = new Set(st.state.pins || []);
    summarizer = st.state.summarizer === 'codex' ? 'codex' : 'claude';
    const op = st.state.openPref || {};
    openPref = { 'claude-code': op['claude-code'] === 'app' ? 'app' : 'terminal', codex: op.codex === 'app' ? 'app' : 'terminal' };
    hydrateSummaries(st.state.summaries);
    hydrateAsks(st.state.asks);
    askAck = st.state.askCodexAck === true;
    if (st.state.selectedId) selId = st.state.selectedId;
    lastReadTs = st.state.lastReadTs || {};
    if (Number.isFinite(st.state.summaryBudgetUSD) && st.state.summaryBudgetUSD > 0) summaryBudgetUSD = st.state.summaryBudgetUSD;
  }
  applyTheme(); applyNavPinned(); setupNavHover();
  if (rightRailOpen && window.Atlas) window.Atlas.open();
  // Perf (2026-07 click-lag investigation): fetchData()'s withUsage:true scan
  // is cheap once lib/sessions.js's caches are warm, but on a cold process
  // (app just launched, or the fleet is large/inactive enough that the
  // caches evicted) it is a real, measured ~1s of synchronous main-process
  // work, and Electron routes window input through that same main process --
  // so awaiting it here before the first paint/setView blocks the window
  // from accepting any click for that whole span ("does not open right
  // away"). Paint the shell with an empty fleet first (setView/renderHeader
  // below), then let fetchData land and repaint through the same signature
  // gate the 20s poll already uses, so the first screen the user can click on
  // never waits behind a full session scan.
  // setViewLocal, not setView: `view` here is exactly what getState() just
  // returned from disk (or the 'inbox' default), so writing it straight back
  // through window.humanctl.setView would be a pure echo -- a persist call
  // whose patch is identical to what applyStatePatch will read right back off
  // disk, for zero actual state change, on every single boot.
  remapAgents(); renderHeader(); renderNav(); renderCtxBar(); setViewLocal(view);
  await fetchData();
  if (window.Atlas) await window.Atlas.hydrate();
  await refreshSummaryBudgetChip();
  // Prime the signature gate with this first fetch's data (same computation
  // _refresh() uses below) BEFORE any repaint, so the next real _refresh()
  // tick correctly recognizes unchanged data as unchanged instead of forcing
  // one extra rebuild because lastSig was still its initial ''. Without this
  // priming, a poll landing right after boot would always rebuild once even
  // when the fleet is byte-identical to what load() already painted (perf:
  // signature-gate SLO, DOM rebuilds must be signature-gated).
  lastSig = currentSig();
  syncRowSubSig();
  remapAgents(); renderHeader(); renderNav(); redrawActive();
}
let lastSig = '';
const rowSubSig = new Map();
function currentSig() {
  return allRows.map((r) => r.id + r.ageMs + r.state + ':' + r.tier + ':' + r.contextPct).join('|')
    + '#' + allNotes.map((n) => n.id + ':' + n.level).join('|')
    + '#' + inboxThreads.map((t) => t.sessionId + ':' + t.lastTs + ':' + t.items.length).join('|')
    + '#' + (status ? status.needsYou + ':' + status.working + ':' + status.sessions : '');
}
function syncRowSubSig() {
  for (const r of allRows) {
    const sub = r.ageMs + ':' + r.contextPct;
    if (rowSubSig.get(r.id) !== sub) { detailCache.delete(r.id); rowSubSig.set(r.id, sub); }
  }
}
async function _refresh() {
  if (!window.humanctl) return;
  await fetchData();
  // Always-on summary engine (PR-2 item 4): evaluated on every poll tick,
  // independent of the DOM signature gate below, since a thread's summary can
  // go stale (>=12 new substantive events) without any of the fields that
  // gate participate changing shape. runAutoSummaries no-ops fast when
  // nothing qualifies, so this costs nothing extra at idle.
  runAutoSummaries();
  const sig = currentSig();
  if (sig === lastSig) return; // nothing changed; unchanged data must not rebuild (perf: signature gate)
  lastSig = sig;
  syncRowSubSig();
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
  themePref = ['light', 'dark', 'system'].includes(st.theme) ? st.theme : 'dark';
  pins = new Set(st.pins || []);
  summarizer = st.summarizer === 'codex' ? 'codex' : 'claude';
  const op = st.openPref || {};
  openPref = { 'claude-code': op['claude-code'] === 'app' ? 'app' : 'terminal', codex: op.codex === 'app' ? 'app' : 'terminal' };
  lastReadTs = st.lastReadTs || lastReadTs;
  navPinned = st.navPinned === true;
  rightRailOpen = st.rightRailOpen === true;
  if (Number.isFinite(st.summaryBudgetUSD) && st.summaryBudgetUSD > 0) summaryBudgetUSD = st.summaryBudgetUSD;
  applyTheme(); applyNavPinned();
  if (window.Atlas) { if (rightRailOpen && !window.Atlas.isOpen()) window.Atlas.open(); else if (!rightRailOpen && window.Atlas.isOpen()) window.Atlas.close(); }
  const v = ['inbox', 'metrics', 'fleet', 'sessions', 'settings'].includes(st.view) ? st.view : view;
  // setViewLocal, not setView: v came FROM the broadcast state (already
  // persisted by whoever made the change, e.g. `humanctl app app.set-view`
  // over the control socket), so writing it back through
  // window.humanctl.setView would immediately re-persist the same value and
  // re-broadcast state:changed to this same window -- a self-echo loop with
  // no natural end (see the boot-time version of this same hazard in load()).
  if (v !== view && !overlayOpen()) setViewLocal(v); else redrawActive();
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
