'use strict';

// humanctl renderer. Read-only view over recent cross-harness sessions, plus a
// per-session context map. Talks to the main process through the `humanctl`
// bridge (see preload.js). When that bridge is absent (e.g. opened in a plain
// browser for a screenshot), it falls back to synthetic fixture data so no real
// session content is ever shown.

const HARNESS_LABEL = { codex: 'codex', 'claude-code': 'claude' };
const KIND_ORDER = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'];
const KIND_LABEL = { user: 'you', assistant: 'agent', thinking: 'thinking', 'tool-call': 'tool call', 'tool-result': 'tool result', meta: 'system' };

// Synthetic, obviously-fake rows. Used only when the Electron bridge is missing.
// Never derived from real transcripts. Safe for demos and screenshots.
const FIXTURE = [
  { harness: 'codex', id: 'rollout-2026-fixture-a', repo: '~/local_git/acme-api', title: 'Wire the billing webhook retry queue and backfill failed events', lastRole: 'user', age: '3m' },
  { harness: 'claude-code', id: 'fixture-b0b0b0b0', repo: '~/local_git/acme-web', title: 'Refactor the dashboard data layer onto the new query client', lastRole: 'assistant', age: '12m' },
  { harness: 'codex', id: 'rollout-2026-fixture-c', repo: '~/local_git/acme-infra', title: 'Scout Terraform drift across the staging environment', lastRole: 'assistant', age: '41m' },
  { harness: 'claude-code', id: 'fixture-d1d1d1d1', repo: '~/codex/notes', title: 'Draft the launch post and pull three supporting charts', lastRole: 'user', age: '2h' },
  { harness: 'codex', id: 'rollout-2026-fixture-e', repo: '~/local_git/acme-api', title: '(no prompt found)', lastRole: 'assistant', age: '5h' },
];

// Deterministic synthetic block map for the fixture detail view (tool-heavy).
function fixtureBlocks(seed) {
  const pat = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'tool-call', 'tool-result', 'assistant'];
  const blocks = [];
  const n = 90 + (seed % 40);
  for (let i = 0; i < n; i++) {
    const kind = i === 0 ? 'meta' : pat[i % pat.length];
    const base = { user: 60, assistant: 120, thinking: 200, 'tool-call': 40, 'tool-result': 320, meta: 700 }[kind];
    blocks.push({ kind, tokens: base + ((i * 37 + seed) % 90), preview: KIND_LABEL[kind] + ' block ' + i });
  }
  return { blocks, truncated: false };
}

const el = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));

let currentRows = [];

// last speaker -> who the turn is waiting on. user spoke last => agent owes work;
// assistant spoke last => the human owes a reply (the thing humanctl cares about).
function turnState(lastRole) {
  if (lastRole === 'assistant') return { label: 'needs you', cls: 'user' };
  if (lastRole === 'user') return { label: 'working', cls: '' };
  return { label: lastRole || 'unknown', cls: '' };
}

function renderSummary(rows, demo) {
  const by = rows.reduce((m, r) => ((m[r.harness] = (m[r.harness] || 0) + 1), m), {});
  const needsYou = rows.filter((r) => r.lastRole === 'assistant').length;
  const parts = [];
  parts.push(`<span><b>${rows.length}</b> sessions</span>`);
  if (by.codex) parts.push(`<span class="codex"><b>${by.codex}</b> codex</span>`);
  if (by['claude-code']) parts.push(`<span class="claude"><b>${by['claude-code']}</b> claude</span>`);
  parts.push(`<span><b>${needsYou}</b> waiting on you</span>`);
  if (demo) parts.push('<span class="spacer" style="flex:1"></span><span class="demo">demo data (fixture)</span>');
  el('summary').innerHTML = parts.join('');
}

function rowHtml(r, idx) {
  const hk = r.harness === 'codex' ? 'codex' : 'claude';
  const ts = turnState(r.lastRole);
  const id = (r.id || '').slice(0, 12);
  return `<div class="row" data-idx="${idx}">
    <span class="h ${hk}"><span class="dot"></span>${esc(HARNESS_LABEL[r.harness] || r.harness)}</span>
    <span class="mid">
      <div class="title">${esc(r.title || '(no prompt found)')}</div>
      <div class="meta"><span class="repo">${esc(r.repo || '?')}</span><span>${esc(id)}</span><span class="reveal">reveal</span></div>
    </span>
    <span class="right">
      <span class="role ${ts.cls}">${esc(ts.label)}</span>
      <span class="age">${esc(r.age || '')}</span>
    </span>
  </div>`;
}

function showList() {
  el('detail').classList.add('hidden');
  el('list').classList.remove('hidden');
  el('summary').classList.remove('hidden');
  el('back').classList.add('hidden');
  el('subtitle').textContent = 'recent sessions across Codex and Claude Code';
}

function renderRows(rows, demo) {
  currentRows = rows;
  showList();
  if (!rows.length) {
    el('list').innerHTML = '<div class="empty">no sessions in the last 72h.</div>';
    el('summary').innerHTML = '';
    return;
  }
  renderSummary(rows, demo);
  el('list').innerHTML = rows.map(rowHtml).join('');
  el('list').querySelectorAll('.row').forEach((node) => {
    const idx = Number(node.getAttribute('data-idx'));
    node.addEventListener('click', () => openDetail(currentRows[idx]));
    const rev = node.querySelector('.reveal');
    if (rev) rev.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = currentRows[idx];
      if (r && r.path && window.humanctl) window.humanctl.revealSession(r.path);
    });
  });
}

function renderDetail(row, data) {
  const blocks = data.blocks || [];
  const totals = {};
  let total = 0;
  for (const b of blocks) { totals[b.kind] = (totals[b.kind] || 0) + b.tokens; total += b.tokens; }

  const hk = row.harness === 'codex' ? 'codex' : 'claude';
  const meter = KIND_ORDER.filter((k) => totals[k]).map((k) =>
    `<span class="k-${k}" style="width:${((totals[k] / total) * 100).toFixed(2)}%" title="${esc(KIND_LABEL[k])} ${((totals[k] / total) * 100).toFixed(0)}%"></span>`
  ).join('');

  const counts = {};
  for (const b of blocks) counts[b.kind] = (counts[b.kind] || 0) + 1;
  const legend = KIND_ORDER.filter((k) => counts[k]).map((k) =>
    `<span class="li"><span class="sw k-${k}"></span>${esc(KIND_LABEL[k])} <b>${counts[k]}</b> <span class="pct">${fmt(totals[k] || 0)}t</span></span>`
  ).join('');

  const squares = blocks.map((b) =>
    `<div class="sq k-${b.kind}" title="${esc(KIND_LABEL[b.kind])} · ${b.tokens}t · ${esc(b.preview)}"></div>`
  ).join('');

  el('detail').innerHTML = `
    <div class="dhead">
      <span class="h ${hk}"><span class="dot"></span>${esc(HARNESS_LABEL[row.harness] || row.harness)}</span>
      <span class="dtitle">${esc(row.title || '(no prompt found)')}</span>
    </div>
    <div class="dmeta">
      <span class="repo">${esc(row.repo || '?')}</span>
      <span>${esc((row.id || '').slice(0, 24))}</span>
      <span>${esc(row.age || '')}</span>
      <span><b>${blocks.length}</b> blocks</span>
      <span><b>~${fmt(total)}</b> tokens total</span>
    </div>
    <div class="meter">${meter}</div>
    <div class="legend">${legend}</div>
    <div class="maplabel">context map · one square per block, in order</div>
    <div class="map">${squares}</div>
    ${data.truncated ? '<div class="trunc">large session: showing the first portion of the transcript.</div>' : ''}
  `;
}

async function openDetail(row) {
  if (!row) return;
  el('list').classList.add('hidden');
  el('summary').classList.add('hidden');
  el('detail').classList.remove('hidden');
  el('back').classList.remove('hidden');
  el('subtitle').textContent = 'context map';
  el('detail').innerHTML = '<div class="empty">reading transcript...</div>';

  if (!window.humanctl) {
    renderDetail(row, fixtureBlocks((row.id || '').length + (row.repo || '').length));
    return;
  }
  const res = await window.humanctl.readSession({ path: row.path, harness: row.harness });
  if (!res || !res.ok) {
    el('detail').innerHTML = `<div class="err">could not read session: ${esc((res && res.error) || 'unknown error')}</div>`;
    return;
  }
  renderDetail(row, res.data);
}

async function load() {
  el('list').innerHTML = '<div class="empty">loading...</div>';
  if (!window.humanctl) {
    renderRows(FIXTURE, true); // plain browser: synthetic data only
    return;
  }
  const res = await window.humanctl.listSessions({ maxAgeH: 72, limit: 40 });
  if (!res || !res.ok) {
    el('list').innerHTML = `<div class="err">could not read sessions: ${esc((res && res.error) || 'unknown error')}</div>`;
    return;
  }
  renderRows(res.rows, false);
}

el('refresh').addEventListener('click', load);
el('back').addEventListener('click', showList);
load();
