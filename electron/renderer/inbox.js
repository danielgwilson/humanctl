'use strict';

// Inbox v2 (shell v2): the default view. Two panes only, no other columns
// (the old persistent left roster and right rail are gone). A thread list plus
// the thread detail: selecting a thread renders the FULL session-detail
// component into the second pane (renderer.js's renderDetail through
// renderThreadDetail; same component family, never forked). Enter opens the
// same session as the full-width overlay detail (entered from Inbox).
//
// Row anatomy (DESIGN.md "Row anatomy", three lines):
//   line 1: harness glyph + title + time ladder, unread dot on the left edge
//   line 2: state chip + message-to-the-human (ask excerpt > note > completion)
//   line 3: dir basename only (NO PR chips: PR-2)
// A compact toolbar (fuzzy search + state/harness filter + sort) sits above
// the list. That toolbar state is RENDERER EPHEMERA (see renderer.js's note
// above sessFilter): transient, never a registered command.
//
// Depends on globals from renderer.js (el, esc, agoTxt, byId, view, setView,
// openDetail, harnessGlyph, STATE, TIERS, nameHtml, identity, cwdBase,
// firstSentence, streamItemHtml, selectSession). Loaded after renderer.js.

(function () {
  let threads = [];
  let lastReadTs = {};
  let selThreadId = null;

  // Inbox toolbar state: search/filter/sort. Renderer ephemera, exempt from the
  // command registry (see the invariant's exemption clause; renderer.js states
  // this explicitly above sessFilter). Never touches disk or another session.
  const filter = { q: '', state: '', harness: '', sort: 'recent' };
  const STATE_ORDER = { need: 0, block: 1, work: 2, idle: 3, done: 4 };

  const LEVEL_LABEL = { blocked: 'blocked', review: 'review', done: 'done', fyi: 'fyi' };

  function threadItemTs(it) { return Date.parse(it.ts) || 0; }
  function threadUnread(t) {
    const last = lastReadTs[t.sessionId] || 0;
    return t.items.some((it) => threadItemTs(it) > last);
  }
  function agentFor(t) { return byId.get(t.sessionId) || null; }
  function displayTitle(t) {
    const a = agentFor(t);
    if (a) return (a.titled ? a.name : nameHtml(a).replace(/<[^>]+>/g, ''));
    return t.title || t.repo || t.sessionId.slice(0, 10);
  }
  function harnessOf(t) { const a = agentFor(t); return a ? a.harness : t.harness; }
  function whenOf(t) { const a = agentFor(t); return a ? a.when : agoTxt(threadItemTs(t.items[t.items.length - 1])); }
  function repoBase(t) { const a = agentFor(t); return cwdBase((a && (a.cwd || a.repo)) || t.cwd || t.repo || ''); }

  // Line 2 message-to-the-human: newest unresolved detected ask excerpt >
  // newest note message > newest completion line. First sentence only.
  function messageToHuman(t) {
    const items = t.items;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'ask') return firstSentence(it.reason || 'the session is waiting on you');
      if (it.kind === 'ask-interrupted') return firstSentence('a question was interrupted when the app closed');
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === 'note') return firstSentence(items[i].message);
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === 'qa') return firstSentence(items[i].answer);
    }
    return '';
  }
  function threadState(t) {
    const a = agentFor(t);
    if (a) return a.state;
    // No live row: derive a chip from the newest item's shape.
    const newest = t.items[t.items.length - 1];
    if (!newest) return 'idle';
    if (newest.kind === 'note') return newest.level === 'blocked' ? 'block' : newest.level === 'review' ? 'need' : newest.level === 'done' ? 'done' : 'idle';
    if (newest.kind === 'ask') return newest.level === 'blocked' ? 'block' : 'need';
    if (newest.kind === 'ask-interrupted') return 'block';
    return 'idle';
  }

  function threadRowHtml(t) {
    const st = threadState(t);
    const s = STATE[st] || STATE.idle;
    const unread = threadUnread(t);
    const a = agentFor(t);
    const tierCls = a && TIERS[a.tier] ? TIERS[a.tier].cls : '';
    // Dot tooltip (2026-07 real-use feedback): prefer the live row's full
    // stateTip (state + honest reason, e.g. "needs input - asks you a
    // question") when this thread's session is still in the recent scan;
    // an aged-out thread has no live row to reason over, so its dot just
    // names the state derived from the newest item's shape.
    const dotTip = a ? stateTip(a) : s.label;
    const rowLabel = `${displayTitle(t)}, ${dotTip}, ${messageToHuman(t)}${unread ? ', unread' : ''}`;
    return `<div class="srow ${t.sessionId === selThreadId ? 'sel' : ''} ${tierCls}" style="--c-sel:${cssvHue(s.hue)}" data-id="${esc(t.sessionId)}" role="button" tabindex="0" aria-label="${esc(rowLabel)}" title="${esc(t.repo || '')}">
      ${unread ? `<span class="unread tip-left on" data-tip="unread &middot; new since you last opened this" aria-hidden="true"></span>` : `<span class="unread" aria-hidden="true"></span>`}
      <span class="sbody">
        <span class="l1">${harnessGlyph(harnessOf(t))}<span class="nm">${esc(displayTitle(t))}</span><span class="when">${esc(whenOf(t) || '')}</span></span>
        <span class="l2"><span class="chip ${s.cls}" data-tip="${esc(dotTip)}"><span class="dt" aria-hidden="true"></span>${esc(s.label)}</span><span class="msg">${esc(messageToHuman(t))}</span></span>
        <span class="l3">${esc(repoBase(t))}${prChipHtml(repoBase(t))}</span>
      </span>
    </div>`;
  }
  function cssvHue(v) { return getComputedStyle(document.documentElement).getPropertyValue(String(v).replace(/var\(|\)/g, '').trim()).trim() || '#888'; }

  function visibleThreads() {
    let list = threads.slice();
    const q = filter.q.trim().toLowerCase();
    if (q) list = list.filter((t) => (displayTitle(t) + ' ' + (t.repo || '') + ' ' + messageToHuman(t)).toLowerCase().includes(q));
    if (filter.state) list = list.filter((t) => threadState(t) === filter.state);
    if (filter.harness) list = list.filter((t) => harnessOf(t) === filter.harness);
    const cmp = {
      recent: (x, y) => (Date.parse(y.lastTs) || 0) - (Date.parse(x.lastTs) || 0),
      'needs-first': (x, y) => (STATE_ORDER[threadState(x)] - STATE_ORDER[threadState(y)]) || ((Date.parse(y.lastTs) || 0) - (Date.parse(x.lastTs) || 0)),
      alpha: (x, y) => displayTitle(x).localeCompare(displayTitle(y)),
    }[filter.sort] || ((x, y) => (Date.parse(y.lastTs) || 0) - (Date.parse(x.lastTs) || 0));
    return list.sort(cmp);
  }

  // The three filter/sort controls are the bespoke HcSelect component (0.16.1
  // controls + a11y pass), mounted onto these placeholder spans by
  // wireToolbar below. Native <select> is never used per DESIGN.md.
  function toolbarHtml() {
    return `<div class="toolbar">
      <input class="hc-input tb-search" id="inbSearch" type="text" placeholder="Search inbox..." aria-label="Search inbox" value="${esc(filter.q)}" />
      <span id="inbState"></span>
      <span id="inbHarness"></span>
      <span id="inbSort"></span>
    </div>`;
  }

  // ---- render (list + a quiet preview until a thread is opened) ----
  function markRead(threadId) {
    const t = threads.find((x) => x.sessionId === threadId);
    if (!t) return;
    const newest = t.items[t.items.length - 1];
    const at = threadItemTs(newest) || Date.now();
    if ((lastReadTs[threadId] || 0) >= at) return;
    lastReadTs[threadId] = at;
    if (window.humanctl) window.humanctl.markThreadRead({ threadId, at });
    renderList();
    if (window.renderNavExternal) window.renderNavExternal();
  }
  function markAllRead() {
    const now = Date.now();
    for (const t of threads) lastReadTs[t.sessionId] = now;
    if (window.humanctl) window.humanctl.markAllThreadsRead();
    renderList();
    if (window.renderNavExternal) window.renderNavExternal();
  }

  // Selecting a thread renders the FULL session-detail component into the
  // second pane (renderer.js's renderThreadDetail -> renderDetail, host
  // 'inbPreview'): header + resume split button, notes stream prominent at
  // top, AI summary, conversation tail, composer, touched chips, disclosure.
  // Same component family as the full-width detail; never a fork.
  function selectThread(id) {
    selThreadId = id;
    markRead(id);
    renderList();
    renderPreview(true);
  }
  // Enter (or the context menu's open): the full-width session detail,
  // entered from Inbox; Esc returns here.
  function openSelected() { if (selThreadId && byId.has(selThreadId)) openDetail(selThreadId, 'inbox'); }
  function move(dir) {
    const list = visibleThreads();
    if (!list.length) return;
    let i = list.findIndex((t) => t.sessionId === selThreadId);
    i = i < 0 ? 0 : Math.max(0, Math.min(i + dir, list.length - 1));
    selectThread(list[i].sessionId);
    const row = document.querySelector(`#inbList .srow[data-id="${CSS.escape(list[i].sessionId)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  let lastListSig = null;
  function listSig(list) {
    // PR chips land asynchronously from a cache-only lookup (prChipHtml, PR-2
    // item 2) after the initial render, so their presence/label must be part
    // of the signature or a chip landing after the first paint would never
    // trigger the repaint that shows it.
    return list.map((t) => `${t.sessionId}:${t.lastTs}:${t.items.length}:${threadState(t)}:${t.sessionId === selThreadId ? 1 : 0}:${threadUnread(t) ? 1 : 0}:${prChipHtml(repoBase(t))}`).join('|')
      + `#${filter.q}:${filter.state}:${filter.harness}:${filter.sort}`;
  }
  function renderList() {
    const box = el('inbList');
    if (!box) return;
    const list = visibleThreads();
    el('inbox-ct').textContent = list.length + (list.length === 1 ? ' thread' : ' threads');
    const sig = listSig(list);
    if (sig === lastListSig && box.childElementCount) return; // signature gate: unchanged data does not rebuild
    lastListSig = sig;
    if (!list.length) {
      box.innerHTML = `<div class="view-empty">No agent updates match. Agents post here via <code>humanctl note</code>.</div>`;
    } else {
      box.innerHTML = list.map(threadRowHtml).join('');
      wireRowActivation(box.querySelectorAll('.srow'));
      box.querySelectorAll('.srow').forEach((r) => r.addEventListener('click', () => selectThread(r.dataset.id)));
      if (window.ContextMenu) box.querySelectorAll('.srow').forEach((r) => r.addEventListener('contextmenu', (e) => { e.preventDefault(); window.ContextMenu.open(e, { type: 'inbox-thread', thread: threads.find((t) => t.sessionId === r.dataset.id) }); }));
    }
  }

  // The thread-detail pane. When the thread's session is in the recent scan it
  // renders the full session-detail component (via renderer.js's
  // renderThreadDetail; not a fork). A thread whose session aged out of the
  // scan cannot offer resume/reply, so it gets an honest stream-only fallback.
  // Signature-gated so unchanged data does not rebuild the pane (and does not
  // clobber composer focus); a landed summary or ask repaints its own block
  // in place through repaintSummary/repaintAsk.
  let lastPrevSig = null;
  function renderPreview(force) {
    const wrap = el('inbPreview');
    if (!wrap) return;
    const t = threads.find((x) => x.sessionId === selThreadId);
    if (!t) {
      lastPrevSig = null;
      detailId = null; detailHostId = null;
      wrap.innerHTML = threads.length
        ? `<div class="view-empty">Select a thread to open it.</div>`
        : `<div class="view-empty">No agent updates yet. Agents post here via <code>humanctl note</code>.<br><br>Try: <code>humanctl note --level review "PR is up, need a review"</code></div>`;
      return;
    }
    const a = agentFor(t);
    if (a) {
      const sig = [t.sessionId, t.lastTs, t.items.length, a.state, a.stateReason, a.when, pins.has(a.id) ? 1 : 0].join(':');
      if (!force && sig === lastPrevSig && wrap.childElementCount) return;
      lastPrevSig = sig;
      renderThreadDetail(t.sessionId);
      return;
    }
    lastPrevSig = null;
    detailId = null; detailHostId = null;
    const stream = t.items.slice().reverse().map(streamItemHtml).join('') || `<div class="tl-empty">no updates in this thread yet.</div>`;
    wrap.innerHTML = `<div class="prev-fallback">
      <div class="prev-hd">
        ${harnessGlyph(harnessOf(t))}
        <div class="prev-meta"><h2>${esc(displayTitle(t))}</h2><div class="prev-sub">${esc(t.repo || 'no repo')}</div></div>
      </div>
      <div class="prev-note">this session is no longer in the recent scan; resume and reply are unavailable.</div>
      <div class="tstream" id="inbFallbackStream">${stream}</div>
    </div>`;
    const streamEl = el('inbFallbackStream');
    if (streamEl) { wireThumbClicks(streamEl); hydrateThumbs(streamEl); }
  }

  function wireToolbar() {
    const s = el('inbSearch');
    if (s) s.addEventListener('input', () => { filter.q = s.value; renderList(); });
    if (window.HcSelect) {
      const stHost = el('inbState');
      if (stHost) HcSelect.create(stHost, {
        ariaLabel: 'Filter by state', value: filter.state,
        options: [['', 'all states'], ['need', 'needs input'], ['block', 'blocked'], ['work', 'running'], ['idle', 'stalled'], ['done', 'finished']],
        onChange: (v) => { filter.state = v; renderList(); },
      });
      const hhHost = el('inbHarness');
      if (hhHost) HcSelect.create(hhHost, {
        ariaLabel: 'Filter by harness', value: filter.harness,
        options: [['', 'all harnesses'], ['claude-code', 'claude'], ['codex', 'codex']],
        onChange: (v) => { filter.harness = v; renderList(); },
      });
      const soHost = el('inbSort');
      if (soHost) HcSelect.create(soHost, {
        ariaLabel: 'Sort inbox threads', value: filter.sort,
        options: [['recent', 'recent'], ['needs-first', 'needs first'], ['alpha', 'alpha']],
        onChange: (v) => { filter.sort = v; renderList(); },
      });
    }
    const mar = el('btnMarkAllRead');
    if (mar) mar.addEventListener('click', markAllRead);
  }

  function setData(nextThreads, nextLastReadTs) {
    threads = nextThreads || [];
    lastReadTs = nextLastReadTs || {};
  }
  // Full render (called on view entry and data refresh). The two-pane shell is
  // built ONCE and kept (so the search input never loses focus to a refresh);
  // after that only the list and the detail pane repaint, each behind its own
  // signature gate. selThreadId defaults to the first visible thread.
  function render() {
    const box = el('view-inbox');
    if (!box) return;
    if (!el('inbList')) {
      box.innerHTML = `
      <div class="inbox-shell">
        <aside class="inb-list">
          <div class="view-hd"><span class="glyph">&#9993;</span><span class="ttl">Inbox</span><span class="sub" id="inbox-ct"></span>
            <button class="hdbtn" id="btnMarkAllRead" title="mark all read">mark all read</button>
          </div>
          ${toolbarHtml()}
          <div class="srows" id="inbList"></div>
        </aside>
        <section class="inb-preview" id="inbPreview"></section>
      </div>`;
      lastListSig = null;
      lastPrevSig = null;
      wireToolbar();
    }
    const list = visibleThreads();
    if (!selThreadId && list.length) selThreadId = list[0].sessionId;
    else if (selThreadId && !threads.some((t) => t.sessionId === selThreadId)) selThreadId = list[0] ? list[0].sessionId : null;
    renderList();
    renderPreview();
  }

  function fixtureThreads() {
    const now = Date.now();
    return [
      { sessionId: 'fixture-c3c3c3c3', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Activity feed adapter',
        items: [{ kind: 'note', level: 'review', message: 'PR is up for the activity feed; needs a review + merge.', ts: new Date(now - 4 * 6e4).toISOString(), id: 'fn1' }], lastTs: new Date(now - 4 * 6e4).toISOString() },
      { sessionId: 'rollout-fixture-b2b2', repo: '~/demo/core', harness: 'codex', cwd: '~/demo/core', path: '', title: 'Choose the rename-persistence path',
        items: [{ kind: 'ask', level: 'review', reason: 'Both paths verified; say the word and I take path B.', ts: new Date(now - 6 * 6e4).toISOString() }], lastTs: new Date(now - 6 * 6e4).toISOString() },
      { sessionId: 'rollout-fixture-d4d4', repo: '~/demo/tokens', harness: 'codex', cwd: '~/demo/tokens', path: '', title: 'Rotate the activity token',
        items: [{ kind: 'note', level: 'blocked', message: 'Blocked: the activity token is missing from the environment.', ts: new Date(now - 7 * 6e4).toISOString(), id: 'fn2' }], lastTs: new Date(now - 7 * 6e4).toISOString() },
      { sessionId: 'fixture-a1a1a1a1', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Multi-source spine, renderer wiring pass',
        items: [{ kind: 'qa', question: 'status?', answer: 'Spine is wired end to end; the last open question is the watcher debounce window.', engine: 'claude', ts: new Date(now - 15 * 6e4).toISOString() }], lastTs: new Date(now - 15 * 6e4).toISOString() },
      { sessionId: 'fixture-h8h8h8h8', repo: '~/demo/exports', harness: 'claude-code', cwd: '~/demo/exports', path: '', title: 'Backfill the export manifest',
        items: [{ kind: 'ask-interrupted', question: 'what does the manifest schema look like now?', ts: new Date(now - 20 * 6e4).toISOString() }], lastTs: new Date(now - 20 * 6e4).toISOString() },
    ];
  }

  function openThread(id) {
    if (view !== 'inbox') setView('inbox');
    selectThread(id);
  }

  window.Inbox = { render, renderList, move, openSelected, fixtureThreads, setData, openThread, markRead };
})();
