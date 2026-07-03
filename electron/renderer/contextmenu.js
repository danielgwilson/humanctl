'use strict';

// Custom right-click context menu (spec: docs/inbox-ui-v1-spec.md). Native
// menus break the app's design language and cannot show reasons/shortcuts
// consistently, so this is plain HTML positioned at the click point.
//
// Hardline invariant (repo AGENTS.md / docs/commands.md): every entry here
// calls a function that already routes through a registered command
// (session.resume, session.open-app, session.reveal, session.summarize,
// app.set-state for pins, inbox.mark-read, app.set-mode, app.set-theme, ...).
// This module never touches window.humanctl directly and never invents a new
// mutation path; it only decides which of the EXISTING actions apply to the
// clicked target and renders them.
//
// Depends on globals from renderer.js/inbox.js/atlas.js (el, esc, resumeActs,
// resumeAgent, openAppAgent, revealAgent, summarizeAgent, openLinear,
// togglePin, pins, setMode, mode, theme, applyTheme). Loaded last.

(function () {
  let openFor = null; // { type, ... } the target the menu is currently showing
  let hiIndex = -1;

  function menuEl() { return el('ctxmenu'); }

  function entriesForSession(a) {
    if (!a) return [];
    const ra = resumeActs(a);
    const items = [
      { label: ra.primary.label, run: () => (ra.primary.act === 'resume-app' ? openAppAgent(a) : resumeAgent(a)) },
    ];
    if (ra.secondary) items.push({ label: ra.secondary.label, run: () => (ra.secondary.act === 'resume-app' ? openAppAgent(a) : resumeAgent(a)) });
    items.push({ sep: true });
    items.push({ label: 'Reveal transcript', run: () => revealAgent(a) });
    items.push({ label: summaries.has(a.id) ? 'Refresh AI summary' : 'AI summary', run: () => summarizeAgent(a) });
    const d = detailCache.get(a.id);
    const hasLinear = d && d !== 'loading' && d !== 'error' && d.detail && d.detail.linearRefs && d.detail.linearRefs.length;
    if (hasLinear) items.push({ label: 'Open in Linear', run: () => openLinear(a) });
    items.push({ sep: true });
    items.push({ label: pins.has(a.id) ? 'Unpin' : 'Pin', run: () => togglePin(a.id) });
    if (window.Inbox && inboxThreads.some((t) => t.sessionId === a.id)) {
      items.push({ label: 'Mark thread read', run: () => window.Inbox.markRead(a.id) });
    }
    return items;
  }

  function entriesForInboxThread(t) {
    if (!t) return [];
    const a = byId.get(t.sessionId);
    const items = [
      { label: 'Open thread', run: () => window.Inbox && window.Inbox.openThread(t.sessionId) },
      { label: 'Mark read', run: () => window.Inbox && window.Inbox.markRead(t.sessionId) },
    ];
    if (a) {
      items.push({ sep: true });
      const ra = resumeActs(a);
      items.push({ label: ra.primary.label, run: () => (ra.primary.act === 'resume-app' ? openAppAgent(a) : resumeAgent(a)) });
    }
    return items;
  }

  function entriesForBackground() {
    return [
      { label: 'Inbox', k: '1', run: () => setMode('inbox') },
      { label: 'Focus', k: '2', run: () => setMode('focus') },
      { label: 'Wall', k: '3', run: () => setMode('wall') },
      { sep: true },
      { label: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', run: () => el('tTheme').click() },
      { label: leftRailCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar', run: () => setLeftRail(!leftRailCollapsed) },
      { label: rightRailCollapsed ? 'Expand right sidebar' : 'Collapse right sidebar', run: () => setRightRail(!rightRailCollapsed) },
    ];
  }

  function entriesFor(target) {
    if (!target) return [];
    if (target.type === 'session') return entriesForSession(target.agent);
    if (target.type === 'inbox-thread') return entriesForInboxThread(target.thread);
    if (target.type === 'background') return entriesForBackground();
    return [];
  }

  function render(entries) {
    const m = menuEl();
    m.innerHTML = entries.map((e, i) => e.sep
      ? '<div class="ctxsep"></div>'
      : `<div class="ctxitem" data-i="${i}" role="menuitem" tabindex="-1">${esc(e.label)}${e.k ? `<span class="k2">${esc(e.k)}</span>` : ''}</div>`).join('');
    m.querySelectorAll('.ctxitem').forEach((node) => {
      node.addEventListener('click', () => { runEntry(entries[+node.dataset.i]); });
      node.addEventListener('mouseenter', () => setHighlight(+node.dataset.i, entries));
    });
  }

  function setHighlight(i, entries) {
    hiIndex = i;
    menuEl().querySelectorAll('.ctxitem').forEach((n) => n.classList.toggle('hi', +n.dataset.i === i));
  }

  function runEntry(e) {
    close();
    if (e && typeof e.run === 'function') { try { e.run(); } catch (err) { toast(String((err && err.message) || err)); } }
  }

  function open(evt, target) {
    const entries = entriesFor(target).filter(Boolean);
    if (!entries.length) return;
    openFor = { target, entries };
    hiIndex = -1;
    const m = menuEl();
    render(entries);
    m.hidden = false;
    // Position at the click point, clamped inside the viewport.
    const rect = m.getBoundingClientRect();
    const x = Math.min(evt.clientX, window.innerWidth - rect.width - 8);
    const y = Math.min(evt.clientY, window.innerHeight - rect.height - 8);
    m.style.left = Math.max(4, x) + 'px';
    m.style.top = Math.max(4, y) + 'px';
  }
  function close() {
    openFor = null;
    hiIndex = -1;
    menuEl().hidden = true;
  }
  function isOpen() { return !!openFor; }

  document.addEventListener('mousedown', (e) => {
    if (isOpen() && !menuEl().contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const entries = (openFor && openFor.entries) || [];
    const selectable = entries.map((e2, i) => ({ e: e2, i })).filter((x) => !x.e.sep);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const pos = selectable.findIndex((x) => x.i === hiIndex);
      const next = selectable[(pos + 1) % selectable.length];
      if (next) setHighlight(next.i, entries);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const pos = selectable.findIndex((x) => x.i === hiIndex);
      const next = selectable[(pos - 1 + selectable.length) % selectable.length];
      if (next) setHighlight(next.i, entries);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hiIndex >= 0) runEntry(entries[hiIndex]);
    }
  });
  // Background target: anywhere that did not already open a more specific
  // menu (session row / inbox thread wire their own 'contextmenu' handlers
  // and call e.preventDefault() + stopPropagation is unnecessary since this
  // bubbling handler only fires when the event was not already handled).
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    open(e, { type: 'background' });
  });

  window.ContextMenu = { open, close, isOpen };
})();
