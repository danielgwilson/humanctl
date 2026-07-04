'use strict';

// Atlas (shell v2): a SUMMONABLE right-side overlay DRAWER, not a persistent
// column. This is a behavioral rewrite of the old persistent rail: it renders
// as an overlay over the active view, summoned with the key `a` or the header
// button, and closed with Esc or a click on the scrim.
//
// Contents (DESIGN.md signal ownership):
//   - Digest: reuses the EXACT same digest component the header uses
//     (renderer.js's digestHtml). The digest has ONE owner; the drawer is the
//     documented exception that reuses that owner's component, never a second
//     digest renderer.
//   - Chat: the existing atlas.ask flow (advisory only, grounded in pulse +
//     notes + session states, logged + persisted). Mechanics unchanged.
//   - Resources: spend estimate, tokens, codex quota + reset time. This is the
//     Atlas drawer summarizing spend/tokens/quota (the Metrics view is their
//     primary owner; the header shows quota only above 80 percent).
//   - Needs-you queue: the ranked "what needs the human" list, click to open.
//
// Depends on globals from renderer.js (el, esc, hue, STATE, TIERS, onDesk,
// nameHtml, stateTip, openDetail, agoTxt, engineLabel, rollups, fmtUSD, fmtTok,
// fmtReset, digestHtml, selId, summarizer). Loaded after renderer.js, before
// inbox.js.

(function () {
  const achat = [];
  let achatState = null;
  const ACHAT_CAP = 40;
  let hydrated = false;
  let open = false;

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
      { q: 'what needs me right now?', a: 'Two sessions are asking for a decision: see the needs-you queue. Everything else is moving or idle, nothing else is blocked.', engine: 'claude', ts: new Date(Date.now() - 6 * 6e4).toISOString() },
    ]);
  }

  // ---- needs-you queue (the ranked list; click opens the full detail) ----
  function queueHtml() {
    const need = onDesk().filter((a) => a.state === 'need' || a.state === 'block');
    const rows = need.map((a) => {
      const h = hue(STATE[a.state].hue);
      return `<div class="qrow ${a.id === selId ? 'sel' : ''} ${TIERS[a.tier].cls}" style="--c-sel:${h}" data-id="${esc(a.id)}" title="${esc(stateTip(a))}">
        <span class="who"><span class="nm">${nameHtml(a)}</span><span class="rz">${esc(a.stateReason || STATE[a.state].label)} &middot; ${esc(a.repo || 'no repo')}</span></span>
        <span class="chip ${STATE[a.state].cls}"><span class="dt"></span>${esc((a.tier === 'drifting' ? 'drifting · ' : '') + (a.when || ''))}</span>
      </div>`;
    }).join('') || `<div class="queue-empty">nothing needs you right now.</div>`;
    return `<div class="atlas-sect">
      <div class="sec-l">Needs you now <span class="ct">${need.length}</span></div>
      <div class="queue">${rows}</div>
    </div>`;
  }

  // ---- resources: spend / tokens / quota + reset ----
  function resourcesHtml() {
    const r = rollups();
    const rows = [
      ['claude spend (est)', r.claudeUSD != null ? fmtUSD(r.claudeUSD) : 'n/a'],
      ['codex api-equiv (est)', r.codexUSD != null ? fmtUSD(r.codexUSD) : 'n/a'],
      ['tokens', r.tokens ? fmtTok(r.tokens) : 'n/a'],
    ];
    if (r.quota && r.quota.primary && r.quota.primary.used_percent != null) {
      rows.push(['codex quota (5h)', r.quota.primary.used_percent + '%' + (r.quota.primary.resets_at ? ' &middot; resets ' + fmtReset(r.quota.primary.resets_at) : '')]);
    }
    return `<div class="atlas-sect">
      <div class="sec-l">Resources</div>
      <div class="gstats">${rows.map((x) => `<div class="gstat"><span class="k">${x[0]}</span><span class="v">${x[1]}</span></div>`).join('')}</div>
    </div>`;
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
    const empty = !thread ? `<div class="achat-empty">Ask Atlas things like "what needs me right now?" Answers are advisory only, grounded in pulse, notes, and session states, and cite what they refer to.</div>` : '';
    return `<div class="atlas-sect">
      <div class="sec-l">Ask Atlas</div>
      <div class="atlas-chat">
        <div class="achat-thread" id="achatThread">${thread}${empty}</div>
        <div class="achat-in">
          <input id="achatInput" type="text" maxlength="500" placeholder="Ask Atlas..." ${busy ? 'disabled' : ''} />
          <button id="achatSend" ${busy ? 'disabled' : ''}>Ask</button>
        </div>
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
      else achatState = { q, error: err || 'could not reach Atlas.' };
      render();
    };
    if (!window.humanctl) {
      setTimeout(() => settle({ q, a: 'Demo answer: in the real app Atlas grounds this in pulse --json, recent notes, and the top session states, and cites which sessions or lanes it means.', engine: summarizer, at: Date.now() }), 900);
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
    body.innerHTML = `
      <div class="atlas-sect">
        <div class="sec-l">Fleet digest</div>
        <div class="atlas-digest">${digestHtml()}</div>
      </div>
      ${queueHtml()}
      ${resourcesHtml()}
      ${chatHtml()}`;
    body.querySelectorAll('.qrow').forEach((r) => r.addEventListener('click', () => { openDetail(r.dataset.id, 'inbox'); close(); }));
    wireChat();
  }
  function refresh() { if (open) render(); }        // live data changed while the drawer is open
  function renderQueue() { if (open) render(); }     // selection changed

  function openDrawer() {
    if (open) return;
    open = true;
    el('atlasDrawer').classList.add('on');
    el('atlasScrim').classList.add('on');
    render();
  }
  function close() {
    if (!open) return;
    open = false;
    el('atlasDrawer').classList.remove('on');
    el('atlasScrim').classList.remove('on');
  }
  function isOpen() { return open; }

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

  window.Atlas = { open: openDrawer, close, isOpen, render, refresh, renderQueue, hydrate, hydrateFixture };
})();
