'use strict';

// humanctl renderer. Read-only cross-harness control room: lean, exception-first,
// AI-summary-forward, tabbed. No bridge (plain browser) -> synthetic fixtures.

const HARNESS_LABEL = { codex: 'codex', 'claude-code': 'claude' };
const KIND_ORDER = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'];
const KIND_LABEL = { user: 'you', assistant: 'agent', thinking: 'thinking', 'tool-call': 'tool call', 'tool-result': 'tool result', meta: 'system' };
const FRESH_MS = 3 * 3600 * 1000;
const ICON = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5M16 13H8M16 17H8"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M9.5 3 11 7.5 15.5 9 11 10.5 9.5 15 8 10.5 3.5 9 8 7.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  monitor: '<svg viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};

const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTok = (n) => { n = n || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); };
const fmtUSD = (n) => { if (n == null) return null; return n >= 1000 ? '~$' + (n / 1000).toFixed(1) + 'k' : n >= 10 ? '~$' + n.toFixed(0) : '~$' + n.toFixed(2); };
const fmtReset = (ts) => { if (!ts) return ''; const ms = ts * 1000 - Date.now(); if (ms <= 0) return 'now'; const h = ms / 3.6e6; return h < 1 ? Math.round(h * 60) + 'm' : h < 48 ? h.toFixed(0) + 'h' : (h / 24).toFixed(0) + 'd'; };
const qcls = (p) => (p >= 90 ? 'hot' : p >= 70 ? 'warn' : '');

// ---- state ----
let allRows = [], status = null, skillsAgg = null, demo = false;
let activeFilter = 'all', search = '', pins = new Set(), theme = 'system', aiOn = false;
const summaries = new Map();
let tabs = [{ id: 'home', type: 'home' }];
let activeId = 'home';
let navHist = ['home'], navIdx = 0;
let sumRun = 0; // generation token so stale summary loops stop

// ---- fixtures ----
const FIXTURE = [
  { harness: 'codex', id: 'rollout-2026-fixture-a', repo: '~/local_git/acme-api', title: 'Wire the billing webhook retry queue', lastRole: 'assistant', age: '3m', ageMs: Date.now() - 3 * 6e4, contextPct: 47, apiEquivUSD: 0.62, model: 'gpt-5.5', reasoningEffort: 'xhigh', ultracode: true, lastUser: 'add idempotency keys to the retry path', prevAgent: 'Mapped the webhook handlers, found 3 retry sites.' },
  { harness: 'claude-code', id: 'fixture-b0b0b0b0', repo: '~/local_git/acme-web', title: 'Refactor the dashboard data layer', lastRole: 'assistant', age: '12m', ageMs: Date.now() - 12 * 6e4, contextPct: 88, costUSD: 3.42, model: 'claude-opus-4-8', ultracode: false, lastUser: 'now migrate the settings page too', prevAgent: 'Dashboard is migrated and tests pass.' },
  { harness: 'codex', id: 'rollout-2026-fixture-c', repo: '~/local_git/acme-infra', title: 'Scout Terraform drift in staging', lastRole: 'user', age: '41m', ageMs: Date.now() - 41 * 6e4, contextPct: 53, apiEquivUSD: 0.18, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'check the prod workspace too', prevAgent: '' },
  { harness: 'claude-code', id: 'fixture-d1d1d1d1', repo: '~/codex/notes', title: 'Draft the launch post', lastRole: 'assistant', age: '6h', ageMs: Date.now() - 6 * 36e5, contextPct: 31, costUSD: 1.2, model: 'claude-opus-4-8', ultracode: false, lastUser: 'make the tone punchier', prevAgent: 'Draft v2 ready with 3 charts.' },
  { harness: 'codex', id: 'rollout-2026-fixture-e', repo: '~/local_git/acme-api', title: 'Audit payments reconciliation', lastRole: 'assistant', age: '2d', ageMs: Date.now() - 2 * 864e5, contextPct: 12, apiEquivUSD: 0.05, model: 'gpt-5.5', reasoningEffort: 'medium', ultracode: false, lastUser: '', prevAgent: 'Reconciliation looks correct; no action needed.' },
];
function fixtureStatus() {
  const now = Math.floor(Date.now() / 1000);
  return { per: { codex: { sessions: 3, generated: 240000, totalTokens: 5e6, apiEquivUSD: 0.85 }, 'claude-code': { sessions: 2, generated: 180000, totalTokens: 3.2e6, costUSD: 4.62 } }, codexQuota: { plan_type: 'pro', primary: { used_percent: 46, resets_at: now + 36 * 60 }, secondary: { used_percent: 71, resets_at: now + 5 * 86400 } }, needsYou: 4, working: 1, nearCompaction: 1, sessions: 5, pricingAsOf: '2026-06' };
}
function fixtureRead(row) {
  const pat = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'tool-call', 'tool-result', 'assistant'];
  const seed = (row.id || '').length + (row.repo || '').length;
  const blocks = [];
  const n = 90 + (seed % 40);
  for (let i = 0; i < n; i++) { const kind = i === 0 ? 'meta' : pat[i % pat.length]; const base = { user: 60, assistant: 120, thinking: 200, 'tool-call': 40, 'tool-result': 320, meta: 700 }[kind]; blocks.push({ kind, tokens: base + ((i * 37 + seed) % 90), preview: KIND_LABEL[kind] + ' block ' + i }); }
  const usage = row.harness === 'codex'
    ? { harness: 'codex', model: row.model, apiEquivUSD: row.apiEquivUSD, contextPct: row.contextPct, tokens: { output: 41000, reasoning: 22000, total: 4.16e6 } }
    : { harness: 'claude-code', model: row.model, costUSD: row.costUSD, contextPct: row.contextPct, tokens: { output: 38000, total: 2.7e6 } };
  const detail = { lastExchange: { lastUser: row.lastUser, prevAgent: row.prevAgent }, linearRefs: row.harness === 'codex' ? [{ url: 'https://linear.app/acme/project/billing-abc123', label: 'billing hardening' }, { url: 'https://linear.app/acme/issue/ACME-412', label: 'ACME-412' }] : [], htmlFiles: row.repo.includes('notes') ? ['/Users/demo/notes/launch-rollup.html'] : [], skillsUsed: row.harness === 'claude-code' ? { 'daniel-html-artifact': 2, 'daniel-frontend-design': 1 } : {}, skillCount: row.harness === 'claude-code' ? 3 : 0, reasoningEffort: row.reasoningEffort, model: row.model, ultracode: row.ultracode };
  return { ok: true, data: { blocks, truncated: false }, usage, detail };
}
const FIXTURE_SUM = { 'fixture-a': 'Adding idempotency keys to the webhook retry path; next it will wire the dedupe store.', 'fixture-b0b0b0b0': 'Finished the dashboard migration; now porting the settings page to the new query client.', 'fixture-c': 'Scanned staging for Terraform drift; about to diff the prod workspace.' };
const fixSum = (id) => FIXTURE_SUM[id] || FIXTURE_SUM[(id || '').replace('rollout-2026-', '')];

// ---- turn state ----
function turnState(lastRole) { if (lastRole === 'assistant') return { label: 'needs you', cls: 'needs' }; if (lastRole === 'user') return { label: 'working', cls: '' }; return { label: lastRole || 'unknown', cls: '' }; }

// ---- theme ----
function applyTheme() { document.documentElement.setAttribute('data-theme', theme); el('theme').innerHTML = theme === 'light' ? ICON.sun : theme === 'dark' ? ICON.moon : ICON.monitor; el('theme').title = `theme: ${theme}`; }
function cycleTheme() { theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'; applyTheme(); if (window.humanctl) window.humanctl.setState({ theme }); }

// ---- tabs + nav ----
function activate(id, fromNav) {
  if (!tabs.find((t) => t.id === id)) id = 'home';
  activeId = id;
  if (!fromNav) { navHist = navHist.slice(0, navIdx + 1); if (navHist[navIdx] !== id) { navHist.push(id); navIdx = navHist.length - 1; } }
  renderTabs(); renderMain(); updateNav();
}
function openSession(row) { if (!row) return; if (!tabs.find((t) => t.id === row.id)) tabs.push({ id: row.id, type: 'session', row }); activate(row.id); }
function closeTab(id) {
  const i = tabs.findIndex((t) => t.id === id); if (i <= 0) return;
  tabs.splice(i, 1);
  navHist = navHist.filter((x) => x !== id); if (navIdx >= navHist.length) navIdx = navHist.length - 1;
  if (activeId === id) activate(navHist[navIdx] || 'home', true);
  else { renderTabs(); }
}
function back() { if (navIdx > 0) { navIdx--; activate(navHist[navIdx], true); } }
function fwd() { if (navIdx < navHist.length - 1) { navIdx++; activate(navHist[navIdx], true); } }
function updateNav() { el('back').disabled = navIdx <= 0; el('fwd').disabled = navIdx >= navHist.length - 1; }
function renderTabs() {
  let html = `<div class="tab home ${activeId === 'home' ? 'on' : ''}" data-tab="home">control room</div>`;
  for (const t of tabs) {
    if (t.type !== 'session') continue;
    const r = allRows.find((x) => x.id === t.id) || t.row;
    const hk = r && r.harness === 'codex' ? 'codex' : 'claude';
    const label = (r && (r.title || r.repo)) || t.id;
    html += `<div class="tab ${hk} ${activeId === t.id ? 'on' : ''}" data-tab="${esc(t.id)}"><span class="dot"></span><span class="tlabel">${esc(label)}</span><span class="x" data-close="${esc(t.id)}">${ICON.x}</span></div>`;
  }
  el('tabs').innerHTML = html;
  el('tabs').querySelectorAll('.tab').forEach((n) => n.addEventListener('click', (e) => {
    const cx = e.target.closest('[data-close]'); if (cx) { e.stopPropagation(); closeTab(cx.getAttribute('data-close')); return; }
    activate(n.getAttribute('data-tab'));
  }));
  el('tabs').classList.toggle('hidden', tabs.length <= 1);
}
function renderMain() {
  const t = tabs.find((x) => x.id === activeId) || tabs[0];
  if (t.type === 'home') { el('detail').classList.add('hidden'); el('list').classList.remove('hidden'); el('controls').classList.remove('hidden'); renderList(); }
  else { el('list').classList.add('hidden'); el('controls').classList.add('hidden'); el('detail').classList.remove('hidden'); showDetail(allRows.find((r) => r.id === t.id) || t.row); }
}

// ---- top status bar ----
function qbar(label, pct, resetTs) { if (pct == null) return ''; return `<span class="qbar" title="${esc(label)}: ${pct}% used${resetTs ? ' resets ' + esc(fmtReset(resetTs)) : ''}"><span class="est">${esc(label)}</span><span class="track"><span class="fill ${qcls(pct)}" style="width:${Math.min(100, pct)}%"></span></span><b class="${pct >= 90 ? 'hot' : ''}">${pct}%</b></span>`; }
function renderStatusbar() {
  if (!status) { el('statusbar').innerHTML = ''; return; }
  const c = status.per.codex || {}, cl = status.per['claude-code'] || {}, q = status.codexQuota;
  const p = [];
  const needs = status.needsYou || 0;
  p.push(`<span class="lead ${needs ? '' : 'zero'}"><b>${needs}</b> need you</span><span class="grp"><span>${status.working || 0} working</span><span>${status.sessions} sessions</span></span>`);
  if (status.nearCompaction > 0) p.push(`<span class="hot">${status.nearCompaction} near compaction</span>`);
  if (q) { p.push('<span class="sep"></span>'); p.push(`<span class="grp codex"><span><b>codex</b> ${esc(q.plan_type || '')}</span>${qbar('5h', q.primary && q.primary.used_percent, q.primary && q.primary.resets_at)}${qbar('wk', q.secondary && q.secondary.used_percent, q.secondary && q.secondary.resets_at)}</span>`); }
  p.push('<span class="sep"></span>');
  p.push(`<span class="grp"><span class="claude"><b>${fmtUSD(cl.costUSD) || '~$0'}</b> claude</span><span class="codex"><b>${fmtUSD(c.apiEquivUSD) || '~$0'}</b> codex</span><span class="est">est @ API &middot; quota: codex only</span></span>`);
  if (skillsAgg && skillsAgg.totalInvocations) p.push(`<span class="sep"></span><span class="grp"><span><b>${skillsAgg.totalInvocations}</b> skill calls</span></span>`);
  p.push('<span class="spacer"></span>');
  if (demo) p.push('<span class="est" style="color:var(--warn)">demo (fixture)</span>');
  el('statusbar').innerHTML = p.join('');
}

// ---- list (lean, exception-first) ----
function oneLiner(r) {
  if (aiOn && summaries.has(r.id)) return { ai: true, text: summaries.get(r.id) };
  if (r.lastUser) return { ai: false, text: r.lastUser };
  return { ai: false, text: r.title || '(no prompt found)' };
}
function rowHtml(r) {
  const hk = r.harness === 'codex' ? 'codex' : 'claude';
  const pinned = pins.has(r.id);
  const ol = oneLiner(r);
  const sub = [r.repo || '?']; if (ol.text !== r.title && r.title) sub.push(r.title);
  const ctx = (r.contextPct != null && r.contextPct >= 60) ? `<span class="ctx ${qcls(r.contextPct)}">${r.contextPct}%</span>` : '';
  return `<div class="row ${hk} ${pinned ? 'pinned' : ''}" data-id="${esc(r.id)}">
    <span class="dot"></span>
    <span class="rmid"><div class="line1">${ol.ai ? '<span class="ai">ai</span>' : ''}${esc(ol.text)}</div><div class="line2"><span class="repo">${esc(sub[0])}</span>${sub[1] ? ' &middot; ' + esc(sub[1]) : ''}</div></span>
    <span class="rright">${ctx}<span class="age">${esc(r.age || '')}</span><button class="pin ${pinned ? 'on' : ''}" data-act="pin" title="pin">${ICON.pin}</button></span>
  </div>`;
}
function passes(r) {
  if (search && !((r.title + ' ' + r.repo + ' ' + r.id + ' ' + (r.lastUser || '') + ' ' + (summaries.get(r.id) || '')).toLowerCase().includes(search))) return false;
  if (activeFilter === 'needs') return r.lastRole === 'assistant';
  if (activeFilter === 'working') return r.lastRole === 'user';
  if (activeFilter === 'codex') return r.harness === 'codex';
  if (activeFilter === 'claude-code') return r.harness === 'claude-code';
  if (activeFilter === 'pinned') return pins.has(r.id);
  return true;
}
function bucketOf(r) { if (pins.has(r.id)) return 'Pinned'; if (r.lastRole === 'user') return 'Working'; if (r.lastRole === 'assistant') return (Date.now() - r.ageMs) < FRESH_MS ? 'Needs you' : 'Tabled'; return 'Other'; }
const GROUP_ORDER = ['Pinned', 'Needs you', 'Working', 'Tabled', 'Other'];
function renderList() {
  const shown = allRows.filter(passes);
  el('count').textContent = `${shown.length} / ${allRows.length}`;
  if (!allRows.length) { el('list').innerHTML = '<div class="empty">no sessions in the last 72h.</div>'; return; }
  if (!shown.length) { el('list').innerHTML = '<div class="empty">nothing matches this filter.</div>'; return; }
  const groups = {};
  for (const r of shown) { const g = bucketOf(r); (groups[g] = groups[g] || []).push(r); }
  let html = '';
  for (const g of GROUP_ORDER) { if (!groups[g]) continue; html += `<div class="group">${g} &middot; <b>${groups[g].length}</b></div>` + groups[g].map(rowHtml).join(''); }
  el('list').innerHTML = html;
  el('list').querySelectorAll('.row').forEach((node) => {
    const id = node.getAttribute('data-id');
    node.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act) { e.stopPropagation(); if (act.getAttribute('data-act') === 'pin') togglePin(id); return; }
      openSession(allRows.find((x) => x.id === id));
    });
  });
  if (aiOn) queueSummaries(shown);
}

// ---- AI summaries (opt-in; sends data out) ----
async function queueSummaries(rows) {
  if (!aiOn) return;
  const run = ++sumRun;
  const todo = rows.filter((r) => (bucketOf(r) === 'Needs you' || bucketOf(r) === 'Working') && !summaries.has(r.id)).slice(0, 14);
  if (!window.humanctl) { for (const r of todo) { const s = fixSum(r.id); if (s) { summaries.set(r.id, s); patchRowLine(r.id); } } return; }
  for (const r of todo) {
    if (run !== sumRun || !aiOn) return;
    const res = await window.humanctl.summarize({ path: r.path, harness: r.harness });
    if (run !== sumRun) return;
    if (res && res.ok && res.summary) { summaries.set(r.id, res.summary); patchRowLine(r.id); }
  }
}
function patchRowLine(id) {
  const node = el('list') && el('list').querySelector(`.row[data-id="${CSS.escape(id)}"] .line1`);
  if (node && summaries.has(id)) node.innerHTML = `<span class="ai">ai</span>${esc(summaries.get(id))}`;
}

// ---- detail ----
function showDetail(row) {
  if (!row) { activate('home'); return; }
  el('detail').innerHTML = '<div class="empty">reading transcript...</div>';
  const render = (res) => { if (!res || !res.ok) { el('detail').innerHTML = `<div class="err">could not read session: ${esc((res && res.error) || 'unknown')}</div>`; return; } renderDetail(row, res.data || {}, res.usage, res.detail); };
  if (!window.humanctl) { render(fixtureRead(row)); return; }
  window.humanctl.readSession({ path: row.path, harness: row.harness }).then(render);
}
function metaLine(row, usage, det) {
  const p = [];
  const cost = row.harness === 'claude-code' ? fmtUSD(usage && usage.costUSD) : fmtUSD(usage && usage.apiEquivUSD);
  if (cost) p.push(`<b>${cost}</b> ${row.harness === 'codex' ? 'API-equiv' : 'est'}`);
  if (det && det.model) p.push(esc(det.model));
  if (det && det.reasoningEffort) p.push(`<span class="badge effort">${esc(det.reasoningEffort)}</span>`);
  if (det && det.ultracode) p.push('<span class="badge ultra">ultra</span>');
  if (usage && usage.contextPct != null) p.push(`<span class="${usage.contextPct >= 80 ? 'hot' : ''}">ctx ${usage.contextPct}%${usage.contextPct >= 80 ? ' near compaction' : ''}</span>`);
  return p.join(' &middot; ');
}
function renderDetail(row, data, usage, det) {
  const blocks = data.blocks || [];
  const totals = {}; let total = 0;
  for (const b of blocks) { totals[b.kind] = (totals[b.kind] || 0) + b.tokens; total += b.tokens; }
  const hk = row.harness === 'codex' ? 'codex' : 'claude';
  const meter = total ? KIND_ORDER.filter((k) => totals[k]).map((k) => `<span class="k-${k}" style="width:${((totals[k] / total) * 100).toFixed(2)}%"></span>`).join('') : '';
  const counts = {}; for (const b of blocks) counts[b.kind] = (counts[b.kind] || 0) + 1;
  const legend = KIND_ORDER.filter((k) => counts[k]).map((k) => `<span class="li"><span class="sw k-${k}"></span>${esc(KIND_LABEL[k])} <b>${counts[k]}</b> <span class="pct">${fmtTok(totals[k] || 0)}t</span></span>`).join('');
  const squares = blocks.map((b) => `<div class="sq k-${b.kind}" title="${esc(KIND_LABEL[b.kind])} &middot; ${b.tokens}t &middot; ${esc(b.preview)}"></div>`).join('');
  const ex = (det && det.lastExchange) || {};
  const cached = summaries.get(row.id);
  const skills = (det && det.skillsUsed) || {}; const sk = Object.keys(skills).sort((a, b) => skills[b] - skills[a]);
  const lr = (det && det.linearRefs) || []; const hf = (det && det.htmlFiles) || [];
  el('detail').innerHTML = `
    <div class="dsec">
      <div class="dtitle">${esc(row.title || '(no prompt found)')}</div>
      <div class="dmeta"><span class="h ${hk}"><span class="dot"></span>${esc(HARNESS_LABEL[row.harness] || row.harness)}</span><span class="repo">${esc(row.repo || '?')}</span><span>${esc(row.age || '')}</span>${metaLine(row, usage, det) ? '<span>' + metaLine(row, usage, det) + '</span>' : ''}</div>
    </div>
    <div class="dsec">
      <div class="dlabel">what it is working on <button class="sumbtn" id="dosum">${ICON.spark} ai summary</button></div>
      <div class="sumout" id="sumout">${cached ? sumHtml(cached) : ''}</div>
      ${(ex.prevAgent || ex.lastUser) ? `<div class="exchange" style="margin-top:${cached ? '12px' : '0'}">${ex.prevAgent ? `<div><div class="who">agent, before</div><div class="body">${esc(ex.prevAgent)}</div></div>` : ''}${ex.lastUser ? `<div><div class="who you">you, latest</div><div class="body">${esc(ex.lastUser)}</div></div>` : ''}</div>` : ''}
    </div>
    ${blocks.length ? `<div class="dsec"><div class="dlabel">context map &middot; one square per block</div><div class="meter">${meter}</div><div class="legend">${legend}</div><div class="map">${squares}</div>${data.truncated ? '<div class="trunc">large session: first portion shown.</div>' : ''}</div>` : ''}
    ${sk.length ? `<div class="dsec"><div class="dlabel">skills used</div><div class="skillgrid">${sk.map((s) => `<span class="skill">${esc(s)} <b>${skills[s]}</b></span>`).join('')}</div></div>` : ''}
    ${lr.length ? `<div class="dsec"><div class="dlabel">linear touched</div><div class="chips">${lr.map((l) => `<span class="lchip" data-url="${esc(l.url)}"><span class="ic">${ICON.link}</span>${esc(l.label)}</span>`).join('')}</div></div>` : ''}
    ${hf.length ? `<div class="dsec"><div class="dlabel">html generated</div><div class="filelist">${hf.map((f) => `<span class="filerow" data-path="${esc(f)}"><span class="ic">${ICON.file}</span>${esc(f.replace(/^.*\/(?=[^/]+$)/, ''))}</span>`).join('')}</div></div>` : ''}
  `;
  const sb = el('dosum'); if (sb) sb.addEventListener('click', () => runSummary(row));
  el('detail').querySelectorAll('.lchip').forEach((n) => n.addEventListener('click', () => { const u = n.getAttribute('data-url'); if (u && window.humanctl) window.humanctl.openExternal(u); }));
  el('detail').querySelectorAll('.filerow').forEach((n) => n.addEventListener('click', () => { const p = n.getAttribute('data-path'); if (p && window.humanctl) window.humanctl.openPath(p); }));
  if (aiOn && !cached) runSummary(row);
}
function sumHtml(text) { return `<div class="sumtext">${esc(text)}</div><div class="sumnote">summary by claude-haiku via your local CLI &middot; sends recent messages to the model</div>`; }
async function runSummary(row) {
  const out = el('sumout'); if (!out) return;
  if (summaries.has(row.id)) { out.innerHTML = sumHtml(summaries.get(row.id)); return; }
  out.innerHTML = '<div class="sumnote">summarizing via local CLI...</div>';
  if (!window.humanctl) { const s = FIXTURE_SUM[row.id] || FIXTURE_SUM[(row.id || '').replace('rollout-2026-', '')] || 'Working through the latest instruction; see the exchange below.'; summaries.set(row.id, s); out.innerHTML = sumHtml(s); return; }
  const r = await window.humanctl.summarize({ path: row.path, harness: row.harness });
  if (el('sumout') !== out) return; // navigated away
  if (r && r.ok) { summaries.set(row.id, r.summary); out.innerHTML = sumHtml(r.summary); }
  else out.innerHTML = `<div class="sumnote warn">could not summarize: ${esc((r && r.error) || 'unknown')} (needs your local claude CLI auth)</div>`;
}

// ---- pins, spot-check, ai toggle ----
function togglePin(id) { if (pins.has(id)) pins.delete(id); else pins.add(id); if (window.humanctl) window.humanctl.setState({ pins: [...pins] }); if (activeId === 'home') renderList(); }
function spotCheck() { if (!allRows.length) return; const pool = allRows.filter((r) => r.lastRole === 'assistant'); const arr = pool.length ? pool : allRows; openSession(arr[Math.floor((Date.now() / 1000) % arr.length)]); }
function toggleAI() { aiOn = !aiOn; el('aitoggle').classList.toggle('on', aiOn); if (window.humanctl) window.humanctl.setState({ aiOn }); if (activeId === 'home') renderList(); }

// ---- load + realtime ----
async function fetchData() {
  const [s, l] = await Promise.all([window.humanctl.getStatus({ maxAgeH: 72, limit: 40 }), window.humanctl.listSessions({ maxAgeH: 72, limit: 40, withUsage: true })]);
  if (s && s.ok) status = s.status;
  if (l && l.ok) allRows = l.rows;
}
async function load() {
  if (!window.humanctl) { demo = true; allRows = FIXTURE; status = fixtureStatus(); applyTheme(); el('aitoggle').classList.toggle('on', aiOn); renderStatusbar(); renderTabs(); renderMain(); updateNav(); return; }
  const st = await window.humanctl.getState(); if (st && st.ok && st.state) { pins = new Set(st.state.pins || []); theme = st.state.theme || 'system'; aiOn = !!st.state.aiOn; }
  applyTheme(); el('aitoggle').classList.toggle('on', aiOn);
  await fetchData();
  renderStatusbar(); renderTabs(); renderMain(); updateNav();
  window.humanctl.aggregateSkills({ maxAgeH: 72, limit: 40 }).then((r) => { if (r && r.ok) { skillsAgg = r.agg; renderStatusbar(); } });
}
async function refresh() {
  if (!window.humanctl) return;
  await fetchData();
  renderStatusbar();
  if (activeId === 'home') renderList();
  renderTabs();
}

// ---- wiring ----
el('back').addEventListener('click', back);
el('fwd').addEventListener('click', fwd);
el('theme').addEventListener('click', cycleTheme);
el('aitoggle').addEventListener('click', toggleAI);
el('spotcheck').addEventListener('click', spotCheck);
el('search').addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); if (activeId === 'home') renderList(); });
el('controls').querySelectorAll('.chip[data-filter]').forEach((chip) => chip.addEventListener('click', () => { el('controls').querySelectorAll('.chip[data-filter]').forEach((c) => c.classList.remove('on')); chip.classList.add('on'); activeFilter = chip.getAttribute('data-filter'); if (activeId === 'home') renderList(); }));
document.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'Escape' && activeId !== 'home') activate('home');
  else if (e.key === '/') { e.preventDefault(); el('search').focus(); }
  else if (e.key === '[') back();
  else if (e.key === ']') fwd();
});
if (window.humanctl && window.humanctl.onSessionsChanged) window.humanctl.onSessionsChanged(refresh);
setInterval(() => { if (window.humanctl) refresh(); }, 20000);
load();
