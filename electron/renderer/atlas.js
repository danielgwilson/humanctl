'use strict';

// Chief-of-staff drawer (shell v3 chrome pass): a SUMMONABLE right-side
// overlay DRAWER, CHAT ONLY. Shell v2 made it a summonable overlay (not a
// persistent column); shell v3's chrome pass removes the digest block and the
// resources block that used to live here too -- both were second homes for
// signals the bottom context bar (digest) and the Metrics view (resources)
// now own exclusively (DESIGN.md one-owner rule). This module now renders
// nothing but the atlas.ask chat.
//
// Toggled by the header's sidebar-toggle icon button (or key `a`), default
// closed, state persisted via app.set-cos-drawer (renderer.js owns the
// persistence call; this module just exposes open/close/isOpen and notifies
// via the optional onClose hook so ANY close path -- scrim click, Esc, the
// close button, or the header toggle -- keeps renderer.js's rightRailOpen
// flag in sync).
//
// Depends on globals from renderer.js (el, esc, engineLabel, summarizer).
// Loaded after renderer.js, before inbox.js.

(function () {
  const achat = [];
  let achatState = null;
  const ACHAT_CAP = 40;
  let hydrated = false;
  let open = false;
  let onCloseCb = null;

  function hydrateFromLog(log) {
    achat.length = 0;
    for (const e of log || []) {
      if (e && typeof e.q === 'string' && typeof e.a === 'string') {
        achat.push({ q: e.q, a: e.a, engine: e.engine, at: Date.parse(e.ts) || Date.now() });
      }
    }
    while (achat.length > ACHAT_CAP) achat.shift();
  }
  async function hydrate() {
    if (hydrated || !window.humanctl || !window.humanctl.getAtlasLog) return;
    hydrated = true;
    try { const r = await window.humanctl.getAtlasLog(); if (r && r.ok) hydrateFromLog(r.log); } catch { /* chat works without history */ }
  }
  function hydrateFixture() {
    hydrated = true;
    hydrateFromLog([
      { q: 'what needs me right now?', a: 'Two sessions are asking for a decision: see Inbox. Everything else is moving or idle, nothing else is blocked.', engine: 'claude', ts: new Date(Date.now() - 6 * 6e4).toISOString() },
    ]);
  }

  // ---- chat (atlas.ask, unchanged mechanics) ----
  function chatExchangeHtml(x) {
    return `<div class="achat-x"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.a)}</div>
      <div class="meta">via ${esc(engineLabel(x.engine))}${x.at ? ' &middot; ' + esc(agoTxt(x.at)) : ''}</div></div>`;
  }
  function chatHtml() {
    let thread = achat.map(chatExchangeHtml).join('');
    const busy = achatState === 'loading' || (achatState && achatState.phase === 'loading');
    if (busy) thread += `<div class="achat-x"><div class="q">${esc(achatState && achatState.q ? achatState.q : '')}</div><div class="a load">thinking...</div></div>`;
    else if (achatState && achatState.error) thread += `<div class="achat-x"><div class="q">${esc(achatState.q || '')}</div><div class="a err">${esc(achatState.error)}</div></div>`;
    const empty = !thread ? `<div class="achat-empty">Ask your chief of staff things like "what needs me right now?" Answers are advisory only, grounded in pulse, notes, and session states, and cite what they refer to.</div>` : '';
    return `<div class="atlas-chat">
      <div class="achat-thread" id="achatThread">${thread}${empty}</div>
      <div class="achat-in">
        <input id="achatInput" type="text" maxlength="500" placeholder="Ask your chief of staff..." ${busy ? 'disabled' : ''} />
        <button id="achatSend" ${busy ? 'disabled' : ''}>Ask</button>
      </div>
    </div>`;
  }
  function wireChat() {
    const input = el('achatInput');
    const send = el('achatSend');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runAsk(input.value); } });
    if (send) send.addEventListener('click', () => runAsk(input ? input.value : ''));
    const thread = el('achatThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }
  async function runAsk(q) {
    q = String(q || '').trim();
    if (!q || achatState === 'loading' || (achatState && achatState.phase === 'loading')) return;
    achatState = { phase: 'loading', q };
    render();
    const settle = (entry, err) => {
      if (entry) { achatState = null; achat.push(entry); while (achat.length > ACHAT_CAP) achat.shift(); }
      else achatState = { q, error: err || 'could not reach the chief of staff.' };
      render();
    };
    if (!window.humanctl) {
      setTimeout(() => settle({ q, a: 'Demo answer: in the real app this grounds in pulse --json, recent notes, and the top session states, and cites which sessions or lanes it means.', engine: summarizer, at: Date.now() }), 900);
      return;
    }
    try {
      const r = await window.humanctl.askAtlas({ question: q, engine: summarizer });
      if (r && r.ok && r.answer) settle({ q, a: r.answer, engine: r.engine || summarizer, at: r.at || Date.now() });
      else settle(null, r && r.error);
    } catch (e) { settle(null, String((e && e.message) || e)); }
  }

  // ---- drawer shell ----
  function render() {
    if (!open) return;
    const body = el('atlasBody');
    if (!body) return;
    body.innerHTML = chatHtml();
    wireChat();
  }
  function refresh() { /* no ambient data in a chat-only drawer; nothing to refresh passively */ }

  function openDrawer() {
    if (open) return;
    open = true;
    el('atlasDrawer').classList.add('on');
    el('atlasScrim').classList.add('on');
    render();
    const input = el('achatInput');
    if (input) input.focus();
  }
  function close() {
    if (!open) return;
    open = false;
    el('atlasDrawer').classList.remove('on');
    el('atlasScrim').classList.remove('on');
    if (onCloseCb) { try { onCloseCb(); } catch {} }
  }
  function isOpen() { return open; }
  function setOnClose(cb) { onCloseCb = cb; }

  document.addEventListener('DOMContentLoaded', () => {
    const scrim = el('atlasScrim');
    if (scrim) scrim.addEventListener('click', close);
    const x = el('atlasClose');
    if (x) x.addEventListener('click', close);
  });
  // The scrim/close wiring above needs the DOM; index.html has these elements
  // present at parse time, so also wire immediately in case DOMContentLoaded
  // already fired by the time this script runs (defer-free plain script).
  {
    const scrim = el('atlasScrim');
    if (scrim) scrim.addEventListener('click', close);
    const x = el('atlasClose');
    if (x) x.addEventListener('click', close);
  }

  window.Atlas = { open: openDrawer, close, isOpen, render, refresh, hydrate, hydrateFixture, setOnClose };
})();
