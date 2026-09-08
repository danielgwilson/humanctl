// The hub page: one self-contained HTML document, no build step, no external
// requests. Served by lib/hub-server.ts with a per-response nonce; the CSP
// allows only that nonce for style and script. Information hierarchy and
// interaction rules: docs/hub.md ("Information hierarchy").
//
// Timers, declared: one 15-second state poll while the page is visible (paused
// when hidden, refired on focus), and a 4-second undo window per answer.

export function renderHubPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>humanctl</title>
<style nonce="${nonce}">
:root {
  color-scheme: dark;
  --surface-0: oklch(0.145 0.003 260); --surface-1: oklch(0.18 0.004 260); --surface-2: oklch(0.225 0.005 260);
  --ink: oklch(0.972 0.004 250); --ink-2: oklch(0.86 0.014 255); --ink-3: oklch(0.645 0.014 256); --ink-4: oklch(0.6 0.012 258);
  --hairline: oklch(1 0 0 / 0.11); --separator: oklch(1 0 0 / 0.055);
  --overlay-hover: oklch(1 0 0 / 0.06); --overlay-selected: oklch(0.72 0.13 250 / 0.16);
  --accent-solid: oklch(0.52 0.15 255); --accent-contrast: oklch(0.78 0.11 250); --on-solid: oklch(0.99 0 0);
  --need: oklch(0.845 0.115 70); --block: oklch(0.735 0.155 26); --work: oklch(0.86 0.14 152); --done: oklch(0.8 0.1 215); --idle: oklch(0.72 0.01 260);
  --need-soft: oklch(0.255 0.046 70); --block-soft: oklch(0.25 0.052 26);
  --sans: "Geist Variable", Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --control: 40px; --radius: 8px;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --surface-0: oklch(0.972 0.003 260); --surface-1: oklch(1 0 0); --surface-2: oklch(1 0 0);
    --ink: oklch(0.245 0.014 258); --ink-2: oklch(0.42 0.014 258); --ink-3: oklch(0.52 0.016 256); --ink-4: oklch(0.5 0.015 255);
    --hairline: oklch(0.245 0.014 258 / 0.14); --separator: oklch(0.245 0.014 258 / 0.08);
    --overlay-hover: oklch(0.245 0.014 258 / 0.055); --overlay-selected: oklch(0.52 0.15 255 / 0.18);
    --accent-contrast: oklch(0.46 0.14 255);
    --need: oklch(0.47 0.1 70); --block: oklch(0.5 0.165 26); --work: oklch(0.4 0.095 152); --done: oklch(0.445 0.078 215); --idle: oklch(0.47 0.008 260);
    --need-soft: oklch(0.94 0.034 70); --block-soft: oklch(0.935 0.03 26);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--surface-0); color: var(--ink); font: 15px/1.45 var(--sans); -webkit-text-size-adjust: 100%; }
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
a { color: var(--accent-contrast); }
.mono { font-family: var(--mono); font-size: 12px; }
.num { font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid var(--accent-contrast); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

.app { min-height: 100dvh; display: grid; grid-template-rows: auto 1fr; }
header.top { position: sticky; top: 0; z-index: 3; background: var(--surface-0); border-bottom: 1px solid var(--hairline); padding: 12px 16px 10px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
header.top .brand { font-family: var(--mono); font-size: 12px; color: var(--ink-3); letter-spacing: 0.02em; }
header.top .count { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
header.top .count.zero { color: var(--ink-3); font-weight: 500; }
header.top .sub { color: var(--ink-3); font-size: 13px; }
.stale { color: var(--need); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
.chip { font-family: var(--mono); font-size: 11.5px; padding: 4px 10px; border: 1px solid var(--hairline); border-radius: 999px; background: transparent; color: var(--ink-2); min-height: 32px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.chip[aria-pressed="true"] { background: var(--overlay-selected); border-color: var(--accent-contrast); color: var(--ink); }

main { padding: 0 0 80px; }
section.group h2 { margin: 0; padding: 14px 16px 6px; font: 600 12px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3); display: flex; gap: 8px; align-items: center; }
section.group h2 .n { color: var(--ink-4); font-weight: 500; }
section.group h2 .mark { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-4); }
section.group.blocked h2 .mark { background: var(--block); } section.group.decide h2 .mark { background: var(--need); }
section.group.needs-words h2 .mark { background: var(--accent-contrast); } section.group.review h2 .mark { background: var(--done); }
ul.rows { list-style: none; margin: 0; padding: 0; }
li.row { border-top: 1px solid var(--separator); }
li.row:last-child { border-bottom: 1px solid var(--separator); }
li.row > button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 10px 16px; cursor: pointer; }
li.row > button:focus-visible { outline: 2px solid var(--accent-contrast); outline-offset: -2px; }
li.row > button:hover { background: var(--overlay-hover); }
li.row[aria-current="true"] > button { background: var(--overlay-selected); box-shadow: inset 2px 0 0 var(--accent-contrast); }
.row .title { font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.row .detail { color: var(--ink-2); font-size: 13.5px; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.row .meta { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; }
.row .meta .waiting { color: var(--work); }
.origin { display: inline-flex; gap: 6px; align-items: center; }
.origin .host { color: var(--ink-2); }
.empty { padding: 28px 16px; color: var(--ink-3); }
.empty strong { color: var(--ink); font-weight: 500; }

/* Item sheet: full-screen on small screens, a right pane from 900px. */
.sheet { position: fixed; inset: 0; z-index: 5; background: var(--surface-0); display: none; grid-template-rows: auto 1fr auto; }
.sheet.open { display: grid; }
.sheet .head { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px 10px 8px; border-bottom: 1px solid var(--hairline); background: var(--surface-0); }
.sheet .head .back { width: var(--control); height: var(--control); border: 0; background: transparent; border-radius: var(--radius); color: var(--ink-2); font-size: 20px; flex: none; }
.sheet .head .back:hover { background: var(--overlay-hover); }
.sheet .head .ttl { font-weight: 600; font-size: 16px; line-height: 1.3; overflow-wrap: anywhere; }
.sheet .head > div { min-width: 0; }
.sheet .head .meta { color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px 10px; }
.sheet .body { overflow: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
.sheet .frame { display: block; width: 100%; border: 0; background: var(--surface-1); min-height: 240px; }
.sheet .frame-cap { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; border-top: 1px solid var(--separator); }
.sheet img.art { display: block; max-width: 100%; height: auto; margin: 0 auto; background: var(--surface-1); }
.sheet .text { padding: 14px 16px; max-width: 640px; }
.sheet .text p { margin: 0 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.sheet .text .opt { padding: 8px 0; border-top: 1px solid var(--separator); }
.sheet .text .opt b { font-weight: 600; }
.sheet .text .opt span { color: var(--ink-2); }
.sheet details { border-top: 1px solid var(--hairline); padding: 8px 16px 12px; color: var(--ink-2); }
.sheet details summary { cursor: pointer; color: var(--ink-3); font-family: var(--mono); font-size: 12px; padding: 4px 0; }
.sheet details dl { margin: 6px 0 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; max-width: 640px; }
.sheet details dt { color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; padding-top: 3px; }
.sheet details dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.strip { border-top: 1px solid var(--hairline); background: var(--surface-1); padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); display: grid; gap: 8px; }
.strip .options { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.strip button.opt { min-height: var(--control); padding: 6px 12px; border-radius: var(--radius); border: 1px solid var(--hairline); background: transparent; color: var(--ink); text-align: left; display: grid; gap: 1px; }
.strip button.opt small { color: var(--ink-3); font-size: 12px; font-weight: 400; }
.strip button.opt:hover { background: var(--overlay-hover); }
.strip button.opt.rec { background: var(--accent-solid); border-color: transparent; color: var(--on-solid); }
.strip button.opt.rec small { color: oklch(0.99 0 0 / 0.92); }
.strip button.opt.rec:hover { filter: brightness(1.08); }
.strip button.opt.chosen { outline: 2px solid var(--accent-contrast); }
.strip .line { display: flex; gap: 8px; align-items: center; }
.strip .link { border: 0; background: transparent; color: var(--accent-contrast); padding: 6px 4px; min-height: 32px; }
.strip textarea { width: 100%; min-height: 64px; resize: vertical; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--hairline); background: var(--surface-0); }
.strip .send { min-height: var(--control); padding: 0 16px; border-radius: var(--radius); border: 0; background: var(--accent-solid); color: var(--on-solid); font-weight: 600; }
.strip .send[disabled] { background: var(--surface-2); color: var(--ink-3); }
.strip .seen { min-height: var(--control); padding: 0 16px; border-radius: var(--radius); border: 1px solid var(--hairline); background: transparent; color: var(--ink); }
.strip .settled { color: var(--ink-3); font-family: var(--mono); font-size: 12px; padding: 6px 2px; }

.toast { position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 9; background: var(--surface-2); color: var(--ink); border: 1px solid var(--hairline); border-radius: 10px; padding: 10px 12px; display: none; gap: 12px; align-items: center; box-shadow: 0 8px 24px -8px oklch(0 0 0 / 0.45); max-width: min(92vw, 480px); }
.toast.show { display: flex; }
.toast button { border: 0; background: transparent; color: var(--accent-contrast); font-weight: 600; padding: 6px 8px; min-height: 32px; }
.toast .bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--accent-contrast); width: 100%; transform-origin: left; animation: shrink 4s linear forwards; }
@keyframes shrink { to { transform: scaleX(0); } }

section.fleet, section.recent { border-top: 1px solid var(--hairline); margin-top: 18px; }
section.fleet h2, section.recent h2 { margin: 0; padding: 14px 16px 6px; font: 600 12px/1 var(--mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-3); }
.host-block { padding: 6px 16px 10px; }
.host-block .hb-head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; font-family: var(--mono); font-size: 12px; color: var(--ink-3); }
.host-block .hb-head b { color: var(--ink); font-weight: 600; font-family: var(--sans); font-size: 14px; }
table.sessions { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 13px; }
table.sessions td { padding: 5px 8px 5px 0; border-top: 1px solid var(--separator); vertical-align: top; }
table.sessions td.st { white-space: nowrap; width: 1%; }
table.sessions td.t { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.sessions td.r { color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; text-align: right; }
.st .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; background: var(--idle); vertical-align: middle; }
.st.need .dot { background: var(--need); } .st.work .dot { background: var(--work); } .st.block .dot { background: var(--block); } .st.done .dot { background: var(--done); }
ul.recent { list-style: none; margin: 0; padding: 0 16px 16px; }
ul.recent li { padding: 7px 0; border-top: 1px solid var(--separator); display: grid; grid-template-columns: max-content 1fr; gap: 10px; font-size: 13.5px; }
ul.recent .outcome { font-family: var(--mono); font-size: 11.5px; color: var(--ink-3); padding-top: 2px; min-width: 64px; }
ul.recent .what { overflow: hidden; }
ul.recent .what .t { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
ul.recent .what .m { color: var(--ink-3); font-family: var(--mono); font-size: 11.5px; }
.hint { padding: 10px 16px 0; color: var(--ink-4); font-family: var(--mono); font-size: 11px; }

@media (min-width: 900px) {
  .app { grid-template-columns: minmax(360px, 440px) 1fr; grid-template-rows: auto 1fr; }
  header.top { grid-column: 1 / -1; }
  main { border-right: 1px solid var(--hairline); min-height: 0; }
  .sheet { position: sticky; top: var(--top-h, 58px); height: calc(100dvh - var(--top-h, 58px)); inset: auto; display: grid; }
  .sheet .head .back { display: none; }
  .sheet:not(.open) .head, .sheet:not(.open) .strip { display: none; }
  .sheet:not(.open) .body::before { content: "Select an item"; display: block; padding: 40px 16px; color: var(--ink-4); }
}
</style>
</head>
<body>
<div class="app">
  <header class="top">
    <span class="brand">humanctl</span>
    <span class="count zero" id="count">loading</span>
    <span class="sub" id="sub"></span>
    <div class="chips" id="chips" role="group" aria-label="Filter by origin"></div>
  </header>
  <main id="main"></main>
  <aside class="sheet" id="sheet">
    <div class="head"><button class="back" id="back" aria-label="Back to the queue">&larr;</button><div><div class="ttl" id="sh-title"></div><div class="meta" id="sh-meta"></div></div></div>
    <div class="body" id="sh-body"></div>
    <div class="strip" id="sh-strip"></div>
  </aside>
</div>
<div class="sr" id="live" aria-live="polite"></div>
<div class="toast" id="toast" role="status"></div>
<script nonce="${nonce}">
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GROUPS = [['blocked', 'Blocked'], ['decide', 'Decide'], ['needs-words', 'Needs words'], ['review', 'Review']];
  const POLL_MS = 15000, UNDO_MS = 4000, WAITING_MS = 120000;
  const state = { data: null, fetchedAt: 0, error: null, filter: new Set(), openKey: null, drafts: {}, pending: null, chosen: null, noteOpen: false, toastTimer: null };

  const age = (ts, now = Date.now()) => {
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return '?';
    const ms = Math.max(0, now - t);
    if (ms < 60e3) return 'now'; if (ms < 3600e3) return Math.floor(ms / 60e3) + 'm';
    if (ms < 86400e3) return Math.floor(ms / 3600e3) + 'h'; return Math.floor(ms / 86400e3) + 'd';
  };
  const draftFocused = () => { const t = $('draft'); return !!t && document.activeElement === t; };
  const announce = (msg) => { const l = $('live'); if (l) l.textContent = msg; };
  const money = (v) => v == null ? '' : '$' + (v < 10 ? v.toFixed(2) : Math.round(v));
  const originHtml = (o, host) => '<span class="origin"><span class="host">' + esc(host || o.host) + '</span>' + (o.harness && o.harness !== 'unknown' ? '<span>' + esc(o.harness) + '</span>' : '') + (o.repo ? '<span>' + esc(o.repo) + '</span>' : '') + '</span>';

  async function api(method, path, body) {
    const headers = { 'x-humanctl-client': 'page' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, ok: res.ok && (!json || json.ok !== false), json };
  }

  async function refresh() {
    try {
      const r = await api('GET', '/api/state');
      if (!r.ok) throw new Error((r.json && r.json.error) || ('hub responded ' + r.status));
      state.data = r.json; state.fetchedAt = Date.now(); state.error = null;
    } catch (e) { state.error = e.message || String(e); }
    // One bad field in one origin's data must not blank the whole surface.
    try { render(); } catch (e) { $('count').textContent = 'render failed'; $('sub').textContent = String(e && e.message || e); }
  }

  const visibleQueue = () => (state.data ? state.data.queue : []).filter((q) => !state.filter.size || state.filter.has(q.host));

  function render() {
    const d = state.data;
    const count = $('count'), sub = $('sub');
    if (!d) { count.textContent = state.error ? 'unreachable' : 'loading'; sub.textContent = state.error || ''; return; }
    const q = visibleQueue();
    count.textContent = q.length ? q.length + (q.length === 1 ? ' needs you' : ' need you') : 'Nothing needs you';
    count.classList.toggle('zero', !q.length);
    const parts = [];
    if (d.counts.blocked) parts.push(d.counts.blocked + ' blocked');
    if (d.fleet.length) parts.push(d.fleet.reduce((n, f) => n + f.working, 0) + ' working across ' + d.fleet.length + (d.fleet.length === 1 ? ' machine' : ' machines'));
    sub.innerHTML = esc(parts.join(' · ')) + (state.error ? ' <span class="stale">· stale, ' + esc(state.error) + '</span>' : '');
    // Re-rendering replaces the focused element; remember what it was and
    // hand focus back so a keyboard user is not dropped to <body> every poll.
    const active = document.activeElement;
    const focusKey = active && active.closest ? (active.closest('li.row') || {}).dataset?.key : null;
    const focusHost = active && active.classList && active.classList.contains('chip') ? active.dataset.host : null;
    $('chips').innerHTML = d.origins.length > 1 ? d.origins.map((h) => '<button class="chip" data-host="' + esc(h) + '" aria-pressed="' + state.filter.has(h) + '">' + esc(h) + '</button>').join('') : '';
    renderQueue(q);
    renderSheet();
    if (focusKey) { const b = document.querySelector('li.row[data-key="' + CSS.escape(focusKey) + '"] > button'); if (b) b.focus({ preventScroll: true }); }
    else if (focusHost) { const c = document.querySelector('.chip[data-host="' + CSS.escape(focusHost) + '"]'); if (c) c.focus({ preventScroll: true }); }
  }

  function renderQueue(q) {
    let html = '';
    for (const [g, label] of GROUPS) {
      const items = q.filter((x) => x.group === g);
      if (!items.length) continue;
      html += '<section class="group ' + g + '"><h2><span class="mark"></span>' + label + ' <span class="n num">' + items.length + '</span></h2><ul class="rows">';
      for (const it of items) {
        html += '<li class="row" data-key="' + esc(it.key) + '" aria-current="' + (it.key === state.openKey) + '"><button>' +
          '<div class="title">' + esc(it.title) + '</div>' +
          (it.detail ? '<div class="detail">' + esc(it.detail) + '</div>' : '') +
          '<div class="meta">' + originHtml(it.origin, it.host) + '<span class="num">' + age(it.ts) + '</span>' + (it.waiting ? '<span class="waiting">agent waiting</span>' : '') + (it.artifacts.length ? '<span>' + it.artifacts.length + (it.artifacts.length === 1 ? ' artifact' : ' artifacts') + '</span>' : '') + '</div>' +
          '</button></li>';
      }
      html += '</ul></section>';
    }
    if (!html) html = '<div class="empty"><strong>Nothing needs you.</strong><br>Open asks, blocked notes, and review requests from every machine land here.</div>';
    html += renderFleet() + renderRecent() + '<div class="hint">j/k move · enter open · 1-9 choose · s seen · esc back</div>';
    $('main').innerHTML = html;
  }

  function renderFleet() {
    const d = state.data;
    const fleet = d.fleet.filter((f) => !state.filter.size || state.filter.has(f.host));
    if (!fleet.length) return '';
    let html = '<section class="fleet"><h2>Fleet</h2>';
    for (const f of fleet) {
      const stale = Date.now() - Date.parse(f.ts) > 3 * 3600e3;
      html += '<div class="host-block"><div class="hb-head"><b>' + esc(f.host) + '</b><span' + (stale ? ' class="stale"' : '') + '>digest ' + age(f.ts) + (stale ? ' ago, stale' : '') + '</span><span class="num">' + f.needsYou + ' need · ' + f.working + ' working · ' + f.sessions.length + ' sessions</span></div>';
      const rows = f.sessions.slice().sort((a, b) => (a.state === 'need' ? -1 : 0) - (b.state === 'need' ? -1 : 0) || b.lastActiveMs - a.lastActiveMs).slice(0, 25);
      if (rows.length) {
        html += '<table class="sessions">';
        for (const s of rows) {
          const label = s.state === 'need' ? 'needs input' : s.state === 'work' ? 'running' : s.state === 'block' ? 'blocked' : s.state === 'done' ? 'complete' : 'idle';
          html += '<tr><td class="st ' + esc(s.state) + '"><span class="dot"></span>' + label + '</td><td class="t" title="' + esc(s.title || s.id) + '">' + esc(s.title || (f.titles ? s.id : s.harness + ' ' + s.id.slice(0, 8))) + '</td><td class="r">' + esc(s.repo) + ' · ' + age(s.lastActiveMs) + (s.contextPct != null ? ' · ' + Math.round(s.contextPct) + '%' : '') + (s.costUSD != null ? ' · ' + money(s.costUSD) : '') + '</td></tr>';
        }
        html += '</table>';
      }
      html += '</div>';
    }
    return html + '</section>';
  }

  function renderRecent() {
    const d = state.data;
    const items = d.recent.filter((r) => !state.filter.size || state.filter.has(r.host)).slice(0, 40);
    if (!items.length) return '';
    return '<section class="recent"><h2>Recent</h2><ul class="recent">' + items.map((r) => '<li><span class="outcome">' + esc(r.outcome) + '</span><span class="what"><span class="t">' + esc(r.title) + (r.detail ? ' <span class="m">· ' + esc(r.detail) + '</span>' : '') + '</span><span class="m">' + esc(r.host) + (r.origin.repo ? ' · ' + esc(r.origin.repo) : '') + ' · ' + age(r.ts) + '</span></span></li>').join('') + '</ul></section>';
  }

  const findItem = (key) => (state.data ? state.data.queue : []).find((q) => q.key === key);

  function renderSheet() {
    const sheet = $('sheet');
    const it = state.openKey ? findItem(state.openKey) : null;
    if (!it) {
      if (state.openKey && state.data && !state.pending) { // answered elsewhere or closed: leave the sheet
        state.openKey = null;
        $('sh-body').innerHTML = ''; $('sh-strip').innerHTML = '';
      }
      sheet.classList.toggle('open', false);
      return;
    }
    sheet.classList.add('open');
    $('sh-title').textContent = it.title;
    $('sh-meta').innerHTML = originHtml(it.origin, it.host) + '<span>' + age(it.ts) + ' ago</span>' + (it.waiting ? '<span class="waiting">agent waiting</span>' : '') + '<span class="mono">' + esc(it.id) + '</span>';
    if (sheet.dataset.key !== it.key) { sheet.dataset.key = it.key; renderSheetBody(it); state.chosen = null; state.noteOpen = false; }
    // A poll must not rebuild the field the human is typing in.
    if (draftFocused()) { const s = $('send'); if (s) s.disabled = !(state.chosen || (state.drafts[it.key] || '').trim()); return; }
    renderStrip(it);
  }

  function renderSheetBody(it) {
    let html = '';
    for (const a of it.artifacts) {
      if (a.render.type === 'image') html += '<img class="art" src="' + esc(a.url) + '" alt="' + esc(a.title) + '">';
      else html += '<iframe class="frame" sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer" loading="lazy" title="' + esc(a.title) + '" src="' + esc(a.url) + '" data-key="' + esc(a.key) + '"></iframe>';
      html += '<div class="frame-cap"><span>' + esc(a.title) + '</span><a href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">open</a></div>';
    }
    const ask = it.ask, note = it.note;
    if (!it.artifacts.length) {
      html += '<div class="text">';
      if (ask) {
        html += '<p>' + esc(ask.prompt || ask.summary || '') + '</p>';
        for (const o of ask.options) html += '<div class="opt"><b>' + esc(o.label) + '</b>' + (o.description && o.description !== o.label ? ' <span>' + esc(o.description) + '</span>' : '') + '</div>';
      } else if (note) {
        html += '<p>' + esc(note.message) + '</p>';
      }
      html += '</div>';
    }
    if (ask) {
      const rows = [];
      if (it.artifacts.length && ask.prompt) rows.push(['context', ask.prompt]);
      if (ask.unblocks) rows.push(['unblocks', ask.unblocks]);
      if (ask.whyNow) rows.push(['why now', ask.whyNow]);
      if (ask.ifIgnored) rows.push(['if ignored', ask.ifIgnored]);
      if (ask.origin.cwd) rows.push(['cwd', ask.origin.cwd]);
      if (rows.length) html += '<details' + (!it.artifacts.length ? ' open' : '') + '><summary>more</summary><dl>' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl></details>';
    }
    if (note && note.cwd) html += '<details><summary>more</summary><dl><dt>cwd</dt><dd>' + esc(note.cwd) + '</dd>' + (note.session ? '<dt>session</dt><dd>' + esc(note.session) + '</dd>' : '') + '</dl></details>';
    $('sh-body').innerHTML = html;
    $('sh-body').scrollTop = 0;
  }

  function renderStrip(it) {
    const strip = $('sh-strip');
    if (state.pending && state.pending.key === it.key) { strip.innerHTML = '<div class="settled">sending&hellip;</div>'; return; }
    if (it.note) { strip.innerHTML = '<div class="line"><button class="seen" data-act="seen">Seen</button><span class="settled">' + esc(it.note.level) + ' note</span></div>'; return; }
    const ask = it.ask;
    const rec = ask.recommendedExplicit ? ask.recommendedId : null;
    let html = '<div class="options">' + ask.options.map((o, i) => '<button class="opt' + (o.id === rec ? ' rec' : '') + (o.id === state.chosen ? ' chosen' : '') + '" data-act="choose" data-id="' + esc(o.id) + '" aria-keyshortcuts="' + (i + 1) + '"><span>' + esc(o.label) + (o.id === rec ? ' <small>default</small>' : '') + '</span>' + (o.description && o.description !== o.label ? '<small>' + esc(o.description) + '</small>' : '') + '</button>').join('') + '</div>';
    if (state.noteOpen) {
      html += '<textarea id="draft" placeholder="Add a note for the agent">' + esc(state.drafts[it.key] || '') + '</textarea><div class="line"><button class="send" id="send" data-act="send"' + (state.chosen || (state.drafts[it.key] || '').trim() ? '' : ' disabled') + '>Send</button><span class="settled">' + (state.chosen ? 'with ' + esc(ask.options.find((o) => o.id === state.chosen)?.label || state.chosen) : 'note only') + '</span></div>';
    } else {
      html += '<div class="line"><button class="link" data-act="note">Add a note</button>' + (rec ? '<span class="settled">tap the default to confirm</span>' : '<span class="settled">tap an option to answer</span>') + '</div>';
    }
    strip.innerHTML = html;
    if (state.noteOpen) { const t = $('draft'); if (t) { t.addEventListener('input', () => { state.drafts[it.key] = t.value; const s = $('send'); if (s) s.disabled = !(state.chosen || t.value.trim()); }); if (document.activeElement !== t) t.focus(); } }
  }

  function open(key) { state.openKey = key; render(); }
  function closeSheet() { state.openKey = null; render(); }

  // One tap answers. The answer is queued for UNDO_MS with a visible undo,
  // then posted; the queue advances only once the hub has recorded it.
  function showToast(html, ms) {
    const t = $('toast');
    clearTimeout(state.toastTimer);
    t.innerHTML = html;
    t.classList.add('show');
    if (ms) state.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function answer(it, choiceId, note) {
    if (state.pending) flushPending();
    const label = choiceId ? (it.ask.options.find((o) => o.id === choiceId)?.label || choiceId) : 'note';
    state.pending = { key: it.key, choiceId, note, item: it };
    showToast('<span>' + esc(it.type === 'note' ? 'Seen' : 'Answering ' + label) + '</span><button id="undo">Undo</button><div class="bar"></div>', 0);
    $('undo').addEventListener('click', () => { clearTimeout(state.pending.timer); state.pending = null; $('toast').classList.remove('show'); announce('Undone'); render(); });
    state.pending.timer = setTimeout(flushPending, UNDO_MS);
    announce((it.type === 'note' ? 'Seen' : 'Answering ' + label) + ', undo available');
    render();
  }

  async function flushPending() {
    const p = state.pending; if (!p) return;
    clearTimeout(p.timer); $('toast').classList.remove('show');
    const it = p.item;
    const path = it.type === 'note'
      ? '/api/notes/' + encodeURIComponent(it.host) + '/' + encodeURIComponent(it.workspace) + '/' + encodeURIComponent(it.id) + '/ack'
      : '/api/asks/' + encodeURIComponent(it.host) + '/' + encodeURIComponent(it.workspace) + '/' + encodeURIComponent(it.id) + '/answer';
    const r = await api('POST', path, it.type === 'note' ? {} : { choiceId: p.choiceId, note: p.note });
    state.pending = null;
    if (!r.ok) {
      const msg = r.status === 409 ? 'Already ' + ((r.json && r.json.answer) ? 'answered' : 'closed') + ' elsewhere' : 'Not recorded: ' + ((r.json && r.json.error) || r.status);
      showToast('<span>' + esc(msg) + '</span>', 3000);
      announce(msg);
    } else { delete state.drafts[it.key]; announce(it.type === 'note' ? 'Marked seen' : 'Answer recorded'); }
    // Advance to the next item that needs the human, in queue order.
    const q = visibleQueue(); const i = q.findIndex((x) => x.key === it.key);
    const next = q[i + 1] || q[i - 1];
    state.openKey = next ? next.key : null; state.chosen = null; state.noteOpen = false;
    await refresh();
  }

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) { const h = chip.dataset.host; if (state.filter.has(h)) state.filter.delete(h); else state.filter.add(h); render(); return; }
    const row = e.target.closest('li.row');
    if (row) { open(row.dataset.key); return; }
    if (e.target.closest('#back')) { closeSheet(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const it = findItem(state.openKey); if (!it) return;
    const a = act.dataset.act;
    if (a === 'seen') answer(it, null, null);
    else if (a === 'choose') {
      if (state.noteOpen) { state.chosen = act.dataset.id; renderStrip(it); }
      else answer(it, act.dataset.id, null);
    } else if (a === 'note') { state.noteOpen = true; renderStrip(it); }
    else if (a === 'send') { const note = (state.drafts[it.key] || '').trim(); if (state.chosen || note) answer(it, state.chosen, note || null); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser and OS chords are not ours
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) { if (e.key === 'Escape') { e.target.blur(); } return; }
    const q = visibleQueue(); if (!q.length) return;
    const i = q.findIndex((x) => x.key === state.openKey);
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); open(q[Math.min(q.length - 1, i + 1)].key); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); open(q[Math.max(0, i - 1)].key); }
    else if (e.key === 'Enter' && i < 0) { open(q[0].key); }
    else if (e.key === 'Escape') { closeSheet(); }
    else if (/^[1-9]$/.test(e.key) && i >= 0 && q[i].ask) {
      const o = q[i].ask.options[Number(e.key) - 1];
      if (!o) return;
      // With the note field open a digit selects, like a tap; Send posts both.
      if (state.noteOpen) { state.chosen = o.id; renderStrip(q[i]); } else answer(q[i], o.id, null);
    }
    else if (e.key === 's' && i >= 0 && q[i].note) { answer(q[i], null, null); }
  });

  // The desktop sheet sits under the header, whose height depends on how many
  // origin chips wrap; measure it rather than guess.
  const top = document.querySelector('header.top');
  const setTop = () => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px');
  new ResizeObserver(setTop).observe(top);
  setTop();

  // Artifacts on an opaque origin cannot be measured from here; they may post
  // their own height: parent.postMessage({type:'humanctl:height', height}, '*').
  window.addEventListener('message', (e) => {
    const m = e.data; if (!m || m.type !== 'humanctl:height') return;
    for (const f of document.querySelectorAll('iframe.frame')) {
      if (f.contentWindow === e.source) { const h = Math.max(120, Math.min(20000, Number(m.height) || 0)); if (h) f.style.height = h + 'px'; }
    }
  });
  const sizeFrames = () => { for (const f of document.querySelectorAll('iframe.frame')) if (!f.style.height) f.style.height = Math.max(240, Math.round(window.innerHeight * 0.62)) + 'px'; };
  new MutationObserver(sizeFrames).observe($('sh-body'), { childList: true });

  let timer = null;
  function schedule() { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && !state.pending && !draftFocused()) refresh(); }, POLL_MS); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !draftFocused()) refresh(); });
  window.addEventListener('focus', () => { if (!draftFocused()) refresh(); });
  window.addEventListener('beforeunload', () => { if (state.pending) { clearTimeout(state.pending.timer); const p = state.pending; const it = p.item; const path = it.type === 'note' ? '/api/notes/' + encodeURIComponent(it.host) + '/' + encodeURIComponent(it.workspace) + '/' + encodeURIComponent(it.id) + '/ack' : '/api/asks/' + encodeURIComponent(it.host) + '/' + encodeURIComponent(it.workspace) + '/' + encodeURIComponent(it.id) + '/answer'; fetch(path, { method: 'POST', headers: { 'x-humanctl-client': 'page', 'content-type': 'application/json' }, body: JSON.stringify(it.type === 'note' ? {} : { choiceId: p.choiceId, note: p.note }), keepalive: true }); } });
  refresh(); schedule();
})();
</script>
</body>
</html>
`;
}
