'use strict';

// Inbox: the DEFAULT mode (spec: docs/inbox-ui-v1-spec.md). Message-centric
// rather than session-centric: one thread per session, built from agent notes
// (`humanctl note`), detected needs-you asks (the v3 reader's state
// transitions), and persisted btw Q&A. The thread detail is the
// humanctl-updates stream by default; "Show full conversation" expands the
// EXISTING dossier timeline component (renderer.js's timelineHtml/bindTimeline)
// inline rather than forking it.
//
// Depends on globals from renderer.js (el, esc, agoTxt, byId, allRows, mode,
// select, ensureTimeline, timelineHtml, bindTimeline, resumeActs, resumeAgent,
// openAppAgent, revealAgent, openLinear, askBlockHtml, wireAsk, detailCache,
// loadDetail, toast, engineLabel, identity, esc). Loaded after renderer.js.

(function () {
  let threads = [];         // from window.humanctl.getInboxThreads() (or the demo fixture)
  let lastReadTs = {};       // threadId -> ms, mirrors renderer.js's copy (state.json)
  let selThreadId = null;
  let showFull = false;      // "Show full conversation" toggle for the selected thread

  const LEVEL_LABEL = { blocked: 'blocked', review: 'review', done: 'done', fyi: 'fyi' };
  const LEVEL_HUE = { blocked: 'var(--s-block)', review: 'var(--s-need)', done: 'var(--s-done)', fyi: 'var(--iris)' };

  function threadItemTs(it) { return Date.parse(it.ts) || 0; }
  function threadUnread(t) {
    const last = lastReadTs[t.sessionId] || 0;
    return t.items.some((it) => threadItemTs(it) > last);
  }
  function threadPreview(t) {
    const newest = t.items[t.items.length - 1];
    if (!newest) return '';
    if (newest.kind === 'note') return newest.message;
    if (newest.kind === 'ask') return newest.reason || 'needs you';
    if (newest.kind === 'qa') return newest.answer;
    if (newest.kind === 'ask-interrupted') return 'a question was interrupted when the app closed';
    return '';
  }
  function threadLevel(t) {
    // Emphasis order for the level chip: blocked > review > done > fyi,
    // taking the newest item's shape when it is not already a note.
    const newest = t.items[t.items.length - 1];
    if (!newest) return 'fyi';
    if (newest.kind === 'note') return newest.level;
    if (newest.kind === 'ask') return newest.level; // 'blocked' | 'review'
    if (newest.kind === 'ask-interrupted') return 'blocked';
    return 'fyi';
  }
  function agentFor(t) {
    return byId.get(t.sessionId) || null;
  }
  function displayTitle(t) {
    const a = agentFor(t);
    if (a) return (a.titled ? a.name : nameHtml(a).replace(/<[^>]+>/g, ''));
    return t.title || t.repo || t.sessionId.slice(0, 10);
  }
  function faceFor(t) {
    const a = agentFor(t);
    return a ? a.face : identity(t.sessionId).face;
  }

  // ---- thread list (left pane inside Inbox mode) ----
  function threadRowHtml(t) {
    const level = threadLevel(t);
    const unread = threadUnread(t);
    const a = agentFor(t);
    const when = a ? a.when : agoTxt(threadItemTs(t.items[t.items.length - 1]));
    return `<div class="thread-row ${t.sessionId === selThreadId ? 'sel' : ''}" data-id="${esc(t.sessionId)}" title="${esc(t.repo || '')}">
      <span class="face">${faceFor(t)}</span>
      <span class="tbody">
        <span class="t1"><span class="nm">${esc(displayTitle(t))}</span><span class="chip c-${level === 'blocked' ? 'block' : level === 'review' ? 'need' : level === 'done' ? 'done' : 'idle'}"><span class="dt"></span>${esc(LEVEL_LABEL[level] || level)}</span></span>
        <span class="snippet">${esc(threadPreview(t))}</span>
        <span class="meta3">${esc(t.repo || '')}</span>
      </span>
      <span class="tside">
        ${unread ? '<span class="unreaddot" title="unread"></span>' : ''}
        <span class="tw">${esc(when || '')}</span>
      </span>
    </div>`;
  }
  function renderThreadList() {
    const box = el('threadList');
    if (!box) return;
    el('inbox-ct').textContent = threads.length + (threads.length === 1 ? ' thread' : ' threads');
    if (!threads.length) {
      box.innerHTML = `<div class="inbox-empty">No agent updates yet. Agents post here via <code>humanctl note</code>.</div>`;
      return;
    }
    box.innerHTML = threads.map(threadRowHtml).join('');
    box.querySelectorAll('.thread-row').forEach((r) => r.addEventListener('click', () => selectThread(r.dataset.id)));
    if (window.ContextMenu) {
      box.querySelectorAll('.thread-row').forEach((r) => r.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.ContextMenu.open(e, { type: 'inbox-thread', thread: threads.find((t) => t.sessionId === r.dataset.id) });
      }));
    }
  }

  // ---- thread detail (center pane) ----
  function markRead(threadId) {
    const t = threads.find((x) => x.sessionId === threadId);
    if (!t) return;
    const newest = t.items[t.items.length - 1];
    const at = threadItemTs(newest) || Date.now();
    if ((lastReadTs[threadId] || 0) >= at) return; // already read up to here
    lastReadTs[threadId] = at;
    if (window.humanctl) window.humanctl.markThreadRead({ threadId, at });
    renderThreadList(); // clears the unread dot immediately
  }
  function markAllRead() {
    const now = Date.now();
    for (const t of threads) lastReadTs[t.sessionId] = now;
    if (window.humanctl) window.humanctl.markAllThreadsRead();
    renderThreadList();
  }
  function selectThread(id) {
    if (selThreadId !== id) showFull = false;
    selThreadId = id;
    const a = agentFor({ sessionId: id });
    if (a) select(a.id); // keep the persistent roster's selection in sync
    renderThreadList();
    renderDetail();
    markRead(id);
  }
  function move(dir) {
    if (!threads.length) return;
    let i = threads.findIndex((t) => t.sessionId === selThreadId);
    i = i < 0 ? 0 : clamp(i + dir, 0, threads.length - 1);
    selectThread(threads[i].sessionId);
    const row = document.querySelector(`.thread-row[data-id="${CSS.escape(threads[i].sessionId)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function streamItemHtml(it) {
    if (it.kind === 'note') {
      return `<div class="tsitem" style="--il:${LEVEL_HUE[it.level] || 'var(--iris)'}">
        <div class="th2"><span class="lvl">${esc(LEVEL_LABEL[it.level] || it.level)} &middot; note</span><span class="when2">${esc(agoTxt(threadItemTs(it)))}</span></div>
        <div class="body2">${esc(it.message)}</div>
      </div>`;
    }
    if (it.kind === 'ask') {
      return `<div class="tsitem" style="--il:${LEVEL_HUE[it.level] || 'var(--s-need)'}">
        <div class="th2"><span class="lvl">detected ask</span><span class="when2">${esc(agoTxt(threadItemTs(it)))}</span></div>
        <div class="body2">${esc(it.reason || 'the session is waiting on you')}</div>
      </div>`;
    }
    if (it.kind === 'qa') {
      return `<div class="tsitem" style="--il:var(--s-done)">
        <div class="th2"><span class="lvl">btw</span><span class="when2">${esc(agoTxt(threadItemTs(it)))}</span></div>
        <div class="qtag">you asked</div>
        <div class="body2">${esc(it.question)}</div>
        <div class="qtag" style="margin-top:8px">session answered &middot; via ${esc(engineLabel(it.engine))}</div>
        <div class="body2">${esc(it.answer)}</div>
      </div>`;
    }
    if (it.kind === 'ask-interrupted') {
      return `<div class="tsitem" style="--il:var(--s-block)">
        <div class="th2"><span class="lvl">interrupted</span><span class="when2">${esc(agoTxt(threadItemTs(it)))}</span></div>
        <div class="qtag">you asked</div>
        <div class="body2">${esc(it.question)}</div>
        <div class="body2" style="color:var(--ink3);font-size:12px">The app closed before this probe finished. Nothing was lost silently; retry it.</div>
        <button class="retry" data-retry-q="${esc(it.question)}">Retry this question</button>
      </div>`;
    }
    return '';
  }

  function threadHeaderActsHtml(t, a) {
    const acts = [];
    if (a) {
      const ra = resumeActs(a);
      acts.push(`<button class="btn" data-tact="resume">${esc(ra.primary.label)}</button>`);
      if (ra.secondary) acts.push(`<button class="btn ghost" data-tact="resume-alt">${esc(ra.secondary.label)}</button>`);
      const d = detailCache.get(a.id);
      const hasLinear = d && d !== 'loading' && d !== 'error' && d.detail && d.detail.linearRefs && d.detail.linearRefs.length;
      acts.push(`<button class="btn ghost" data-tact="linear" ${hasLinear ? '' : 'disabled'}>Open in Linear</button>`);
    } else {
      acts.push(`<span class="hint">this session is no longer in the recent scan; resume and reply are unavailable.</span>`);
    }
    return `<div class="thread-hdr-acts">${acts.join('')}</div>`;
  }

  function renderDetail() {
    const wrap = el('threadDetail');
    const dock = el('inboxDock');
    const sub = el('thread-sub');
    if (!wrap) return;
    const t = threads.find((x) => x.sessionId === selThreadId);
    if (!t) {
      sub.textContent = '';
      wrap.innerHTML = threads.length
        ? `<div class="watch-empty">select a thread from the inbox.</div>`
        : `<div class="inbox-empty">No agent updates yet. Agents post here via <code>humanctl note</code>.<br><br>Try: <code>humanctl note --level review "PR is up, need a review"</code></div>`;
      dock.innerHTML = '';
      return;
    }
    const a = agentFor(t);
    sub.textContent = (a ? a.harnessLabel : t.harness) + (a && a.when ? ' · ' + a.when : '');
    const stream = t.items.slice().reverse().map(streamItemHtml).join('') || `<div class="tl-empty">no updates in this thread yet.</div>`;
    wrap.innerHTML = `
      <div class="watch-id">
        <div class="face">${faceFor(t)}</div>
        <div class="idmeta">
          <div class="row1"><h1>${esc(displayTitle(t))}</h1></div>
          <div class="subline"><span>${esc(t.repo || 'no repo')}</span></div>
        </div>
      </div>
      ${threadHeaderActsHtml(t, a)}
      <div class="tstream" id="tstream">${stream}</div>
      <div class="expand-full"><button id="btnFullConv">${showFull ? 'Hide full conversation' : 'Show full conversation'}</button></div>
      <div id="fullConvBody"></div>
      ${a ? `<div id="inboxAskHost">${askBlockHtml(a)}</div>` : ''}`;
    wrap.querySelectorAll('[data-tact]').forEach((b) => b.addEventListener('click', () => runThreadAction(b.dataset.tact, t, a)));
    wrap.querySelectorAll('[data-retry-q]').forEach((b) => b.addEventListener('click', () => {
      if (a) { const host = el('inboxAskHost'); if (host) host.scrollIntoView({ block: 'nearest' }); runAsk(a, b.dataset.retryQ); }
      else toast('this session is no longer available to retry.');
    }));
    el('btnFullConv').addEventListener('click', toggleFullConversation);
    if (a) wireAsk(a);
    if (showFull && a) paintFullConversation(a);
    dock.innerHTML = '';
  }

  function toggleFullConversation() {
    showFull = !showFull;
    const t = threads.find((x) => x.sessionId === selThreadId);
    const a = t && agentFor(t);
    const btn = el('btnFullConv');
    if (btn) btn.textContent = showFull ? 'Hide full conversation' : 'Show full conversation';
    if (showFull && a) paintFullConversation(a);
    else { const body = el('fullConvBody'); if (body) body.innerHTML = ''; }
  }
  // Reuses the EXISTING dossier timeline component verbatim (spec: "reuse, do
  // not fork it"): ensureTimeline primes the live cursor + fetches the first
  // page, timelineHtml/bindTimeline render exactly what the Focus dossier
  // renders. facet is left untouched (Focus's own facet state is unaffected).
  function paintFullConversation(a) {
    const body = el('fullConvBody');
    if (!body) return;
    const cached = detailCache.get(a.id);
    if (!cached || cached === 'loading') {
      body.innerHTML = `<div class="tl-empty">reading transcript...</div>`;
      loadDetail(a).then(() => { if (showFull && selThreadId === a.id) paintFullConversation(a); });
      return;
    }
    if (cached === 'error') { body.innerHTML = `<div class="tl-empty">could not read this session.</div>`; return; }
    body.innerHTML = timelineHtml(a, cached);
    bindTimeline(body, a, cached);
  }

  async function runThreadAction(act, t, a) {
    if (!a) return;
    if (act === 'resume') return resumeActs(a).primary.act === 'resume-app' ? openAppAgent(a) : resumeAgent(a);
    if (act === 'resume-alt') return resumeActs(a).secondary && resumeActs(a).secondary.act === 'resume-app' ? openAppAgent(a) : resumeAgent(a);
    if (act === 'linear') return openLinear(a);
  }

  // ---- boot / refresh ----
  // renderer.js owns the fetch (window.humanctl.getInboxThreads / lastReadTs
  // from state.json); it calls setData() whenever either changes, right
  // before render() so this module never talks to IPC directly.
  function setData(nextThreads, nextLastReadTs) {
    threads = nextThreads || [];
    lastReadTs = nextLastReadTs || {};
  }
  function render() {
    if (!selThreadId && threads.length) selThreadId = threads[0].sessionId;
    else if (selThreadId && !threads.some((t) => t.sessionId === selThreadId)) selThreadId = threads[0] ? threads[0].sessionId : null;
    renderThreadList();
    renderDetail();
  }

  el('btnMarkAllRead').addEventListener('click', markAllRead);

  // Demo-mode fixture: covers a note thread, a detected-ask thread, a
  // persisted btw thread, and an interrupted-probe thread, so the empty state,
  // unread dots, and every stream item shape are all screenshot-able without
  // real data.
  function fixtureThreads() {
    const now = Date.now();
    return [
      {
        sessionId: 'fixture-c3c3c3c3', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Activity feed adapter',
        items: [{ kind: 'note', level: 'review', message: 'PR is up for the activity feed; needs a review + merge.', ts: new Date(now - 4 * 6e4).toISOString(), id: 'fn1' }],
        lastTs: new Date(now - 4 * 6e4).toISOString(),
      },
      {
        sessionId: 'rollout-fixture-b2b2', repo: '~/demo/core', harness: 'codex', cwd: '~/demo/core', path: '', title: 'Choose the rename-persistence path',
        items: [{ kind: 'ask', level: 'review', reason: 'awaiting your go-ahead', ts: new Date(now - 6 * 6e4).toISOString() }],
        lastTs: new Date(now - 6 * 6e4).toISOString(),
      },
      {
        sessionId: 'rollout-fixture-d4d4', repo: '~/demo/tokens', harness: 'codex', cwd: '~/demo/tokens', path: '', title: 'Rotate the activity token',
        items: [{ kind: 'note', level: 'blocked', message: 'Blocked: the activity token is missing from the environment.', ts: new Date(now - 7 * 6e4).toISOString(), id: 'fn2' }],
        lastTs: new Date(now - 7 * 6e4).toISOString(),
      },
      {
        sessionId: 'fixture-a1a1a1a1', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Multi-source spine, renderer wiring pass',
        items: [{ kind: 'qa', question: 'status?', answer: 'Spine is wired end to end; the last open question is the watcher debounce window.', engine: 'claude', ts: new Date(now - 15 * 6e4).toISOString() }],
        lastTs: new Date(now - 15 * 6e4).toISOString(),
      },
      {
        sessionId: 'fixture-h8h8h8h8', repo: '~/demo/exports', harness: 'claude-code', cwd: '~/demo/exports', path: '', title: 'Backfill the export manifest',
        items: [{ kind: 'ask-interrupted', question: 'what does the manifest schema look like now?', ts: new Date(now - 20 * 6e4).toISOString() }],
        lastTs: new Date(now - 20 * 6e4).toISOString(),
      },
    ];
  }

  function openThread(id) {
    if (mode !== 'inbox') setMode('inbox');
    selectThread(id);
  }

  window.Inbox = { render, move, toggleFullConversation, fixtureThreads, setData, openThread, markRead };
})();
