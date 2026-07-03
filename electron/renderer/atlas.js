'use strict';

// Atlas: the persistent right-rail panel (spec: docs/inbox-ui-v1-spec.md
// "Right sidebar = Atlas panel"). Shown in every mode, collapsible.
//   1. digest line + the needs-you queue (moved here from the old Focus-only
//      right rail; unchanged behavior, same rows, same click-to-select).
//   2. Atlas chat: an advisory-only headless probe (session.ask's plumbing,
//      pointed at the fleet instead of one transcript). Every exchange is
//      logged via the atlas.ask registry command and persisted to
//      ~/.humanctl/atlas.jsonl, restored on boot so the thread survives a
//      restart.
// Depends on globals defined in renderer.js (el, esc, hue, STATE, TIERS,
// onDesk, nameHtml, stateTip, select, agoTxt, engineLabel, rollups, fmtUSD,
// fmtTok, fmtReset, svgRing). Loaded after renderer.js, before inbox.js.

(function () {
  const achat = [];          // [{q, a, engine, at}] oldest first, persisted
  let achatState = null;     // 'loading' | {error} | null
  const ACHAT_CAP = 40;
  let hydrated = false;

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
    try {
      const r = await window.humanctl.getAtlasLog();
      if (r && r.ok) hydrateFromLog(r.log);
    } catch { /* Atlas chat still works without history */ }
  }
  function hydrateFixture() {
    hydrated = true;
    hydrateFromLog([
      { q: 'what needs me right now?', a: 'Two sessions are asking for a decision: see the needs-you queue above. Everything else is moving or idle, nothing else is blocked.', engine: 'claude', ts: new Date(Date.now() - 6 * 6e4).toISOString() },
    ]);
  }

  // ---- digest + needs-you queue (moved verbatim from the old renderConductor) ----
  function renderQueue() {
    const need = onDesk().filter((a) => a.state === 'need' || a.state === 'block');
    const rows = need.map((a) => {
      const h = hue(STATE[a.state].hue);
      return `<div class="qrow ${a.id === selId ? 'sel' : ''} ${TIERS[a.tier].cls}" style="--c-sel:${h}" data-id="${esc(a.id)}" title="${esc(stateTip(a))}">
        <span class="face">${a.face}</span>
        <span class="who"><span class="nm">${nameHtml(a)}</span><span class="rz">${esc(a.stateReason || STATE[a.state].label)} &middot; ${esc(a.repo || 'no repo')}</span></span>
        <span class="chip ${STATE[a.state].cls}"><span class="dt"></span>${esc((a.tier === 'drifting' ? 'drifting · ' : '') + (a.when || ''))}</span>
      </div>`;
    }).join('') || `<div class="queue-empty">nothing needs you right now.</div>`;
    return `<div>
      <div class="sec-l">Needs you now <span class="ct">${need.length}</span></div>
      <div class="queue">${rows}</div>
    </div>`;
  }

  // ---- Atlas chat ----
  function chatExchangeHtml(x) {
    return `<div class="achat-x">
      <div class="q">${esc(x.q)}</div>
      <div class="a">${esc(x.a)}</div>
      <div class="meta">via ${esc(engineLabel(x.engine))}${x.at ? ' &middot; ' + esc(agoTxt(x.at)) : ''}</div>
    </div>`;
  }
  function chatHtml() {
    let thread = achat.map(chatExchangeHtml).join('');
    const busy = achatState === 'loading';
    if (busy) {
      thread += `<div class="achat-x"><div class="q">${esc(achatState && achatState.q ? achatState.q : '')}</div><div class="a load">thinking...</div></div>`;
    } else if (achatState && achatState.error) {
      thread += `<div class="achat-x"><div class="q">${esc(achatState.q || '')}</div><div class="a err">${esc(achatState.error)}</div></div>`;
    }
    const empty = !thread ? `<div class="achat-empty">Ask Atlas things like "what needs me right now?" Answers are advisory only, grounded in pulse, notes, and session states, and cite what they refer to.</div>` : '';
    return `<div class="atlas-chat">
      <div class="achat-thread" id="achatThread">${thread}${empty}</div>
      <div class="achat-in">
        <input id="achatInput" type="text" maxlength="500" placeholder="Ask Atlas..." ${busy ? 'disabled' : ''} />
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
    if (!q || achatState === 'loading') return;
    achatState = { phase: 'loading', q };
    renderPanel();
    const settle = (entry, err) => {
      if (entry) { achatState = null; achat.push(entry); while (achat.length > ACHAT_CAP) achat.shift(); }
      else achatState = { q, error: err || 'could not reach Atlas.' };
      renderPanel();
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

  // ---- fleet stats (moved here so the right rail owns totals context in
  // every mode; the header keeps the compact one-line summary) ----
  function statsHtml() {
    const r = rollups();
    const rows = [
      ['claude spend (est)', r.claudeUSD != null ? fmtUSD(r.claudeUSD) : 'n/a'],
      ['codex api-equiv (est)', r.codexUSD != null ? fmtUSD(r.codexUSD) : 'n/a'],
      ['tokens', r.tokens ? fmtTok(r.tokens) : 'n/a'],
    ];
    if (r.quota && r.quota.primary && r.quota.primary.used_percent != null) {
      rows.push(['codex quota (5h)', r.quota.primary.used_percent + '%' + (r.quota.primary.resets_at ? ' &middot; resets ' + fmtReset(r.quota.primary.resets_at) : '')]);
    }
    return `<div class="gstats">${rows.map((x) => `<div class="gstat"><span class="k">${x[0]}</span><span class="v">${x[1]}</span></div>`).join('')}</div>`;
  }

  function renderPanel() {
    const body = el('atlasBody');
    if (!body) return;
    body.innerHTML = `
      <div>
        <div class="sec-l">Digest</div>
        <div class="atlas-digest" id="atlasDigestLine"></div>
      </div>
      ${renderQueue()}
      <div>
        <div class="sec-l">Fleet</div>
        ${statsHtml()}
      </div>
      <div>
        <div class="sec-l">Ask Atlas</div>
        ${chatHtml()}
      </div>`;
    const dl = el('atlasDigestLine');
    const dg = el('digest');
    if (dl && dg) dl.innerHTML = dg.innerHTML;
    body.querySelectorAll('.qrow').forEach((r) => r.addEventListener('click', () => select(r.dataset.id)));
    wireChat();
  }

  window.Atlas = { renderPanel, hydrate, hydrateFixture };
})();
