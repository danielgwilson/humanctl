'use strict';

// Inbox v2 (shell v2): the default view. Two panes only, no other columns
// (the old persistent left roster and right rail are gone). A thread list plus
// a preview; opening a thread shows the full-width session detail
// (renderer.js's renderDetail, reused, not forked).
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
    return `<div class="srow ${t.sessionId === selThreadId ? 'sel' : ''} ${tierCls}" style="--c-sel:${cssvHue(s.hue)}" data-id="${esc(t.sessionId)}" title="${esc(t.repo || '')}">
      <span class="unread ${unread ? 'on' : ''}"></span>
      <span class="sbody">
        <span class="l1">${harnessGlyph(harnessOf(t))}<span class="nm">${esc(displayTitle(t))}</span><span class="when">${esc(whenOf(t) || '')}</span></span>
        <span class="l2"><span class="chip ${s.cls}"><span class="dt"></span>${esc(s.label)}</span><span class="msg">${esc(messageToHuman(t))}</span></span>
        <span class="l3">${esc(repoBase(t))}</span>
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

  function toolbarHtml() {
    return `<div class="toolbar">
      <input class="tb-search" id="inbSearch" type="text" placeholder="Search inbox..." value="${esc(filter.q)}" />
      <select class="tb-sel" id="inbState">
        <option value="">all states</option>
        <option value="need">needs input</option><option value="block">blocked</option>
        <option value="work">running</option><option value="idle">stalled</option><option value="done">finished</option>
      </select>
      <select class="tb-sel" id="inbHarness"><option value="">all harnesses</option><option value="claude-code">claude</option><option value="codex">codex</option></select>
      <select class="tb-sel" id="inbSort">
        <option value="recent">recent</option><option value="needs-first">needs first</option><option value="alpha">alpha</option>
      </select>
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

  function selectThread(id) {
    selThreadId = id;
    const t = threads.find((x) => x.sessionId === id);
    if (t) selectSession(id);
    markRead(id);
    // Opening a thread from Inbox shows the full-width session detail. A thread
    // whose session is no longer in the recent scan cannot open detail (resume/
    // reply need the live row); preview it in place instead.
    if (byId.has(id)) openDetail(id, 'inbox');
    else { renderList(); renderPreview(); }
  }
  function openSelected() { if (selThreadId) selectThread(selThreadId); }
  function move(dir) {
    const list = visibleThreads();
    if (!list.length) return;
    let i = list.findIndex((t) => t.sessionId === selThreadId);
    i = i < 0 ? 0 : Math.max(0, Math.min(i + dir, list.length - 1));
    selThreadId = list[i].sessionId;
    renderList();
    renderPreview();
    const row = document.querySelector(`#inbList .srow[data-id="${CSS.escape(list[i].sessionId)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  let lastListSig = null;
  function listSig(list) {
    return list.map((t) => `${t.sessionId}:${t.lastTs}:${t.items.length}:${threadState(t)}:${t.sessionId === selThreadId ? 1 : 0}:${threadUnread(t) ? 1 : 0}`).join('|')
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
      box.querySelectorAll('.srow').forEach((r) => r.addEventListener('click', () => selectThread(r.dataset.id)));
      if (window.ContextMenu) box.querySelectorAll('.srow').forEach((r) => r.addEventListener('contextmenu', (e) => { e.preventDefault(); window.ContextMenu.open(e, { type: 'inbox-thread', thread: threads.find((t) => t.sessionId === r.dataset.id) }); }));
    }
  }

  // A quiet preview column for when no thread is opened into detail yet, and
  // for threads whose session is gone from the scan.
  function renderPreview() {
    const wrap = el('inbPreview');
    if (!wrap) return;
    const t = threads.find((x) => x.sessionId === selThreadId);
    if (!t) {
      wrap.innerHTML = threads.length
        ? `<div class="view-empty">Select a thread to open it.</div>`
        : `<div class="view-empty">No agent updates yet. Agents post here via <code>humanctl note</code>.<br><br>Try: <code>humanctl note --level review "PR is up, need a review"</code></div>`;
      return;
    }
    const a = agentFor(t);
    const stream = t.items.slice().reverse().map(streamItemHtml).join('') || `<div class="tl-empty">no updates in this thread yet.</div>`;
    wrap.innerHTML = `
      <div class="prev-hd">
        ${harnessGlyph(harnessOf(t))}
        <div class="prev-meta"><h2>${esc(displayTitle(t))}</h2><div class="prev-sub">${esc(t.repo || 'no repo')}</div></div>
      </div>
      ${a ? '' : '<div class="prev-note">this session is no longer in the recent scan; open, resume, and reply are unavailable.</div>'}
      <div class="tstream">${stream}</div>`;
  }

  function wireToolbar() {
    const s = el('inbSearch'), st = el('inbState'), hh = el('inbHarness'), so = el('inbSort');
    if (st) st.value = filter.state;
    if (hh) hh.value = filter.harness;
    if (so) so.value = filter.sort;
    if (s) s.addEventListener('input', () => { filter.q = s.value; renderList(); });
    if (st) st.addEventListener('change', () => { filter.state = st.value; renderList(); });
    if (hh) hh.addEventListener('change', () => { filter.harness = hh.value; renderList(); });
    if (so) so.addEventListener('change', () => { filter.sort = so.value; renderList(); });
    const mar = el('btnMarkAllRead');
    if (mar) mar.addEventListener('click', markAllRead);
  }

  function setData(nextThreads, nextLastReadTs) {
    threads = nextThreads || [];
    lastReadTs = nextLastReadTs || {};
  }
  // Full render (called on view entry). Builds the shell, then the list and
  // preview. selThreadId defaults to the first visible thread.
  function render() {
    const box = el('view-inbox');
    if (!box) return;
    const list = visibleThreads();
    if (!selThreadId && list.length) selThreadId = list[0].sessionId;
    else if (selThreadId && !threads.some((t) => t.sessionId === selThreadId)) selThreadId = list[0] ? list[0].sessionId : null;
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
    wireToolbar();
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
