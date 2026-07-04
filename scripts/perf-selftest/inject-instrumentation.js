'use strict';
// Injected into the live renderer via Runtime.evaluate. Idempotent (checks
// window.__perf first) so repeated injection across multiple check phases is
// safe. Installs a MutationObserver on .app for DOM-rebuild counting and a
// PerformanceObserver for long tasks, matching the lab investigation's
// original instrumentation (humanctl-lab reports/2026-07-03-perf-profile/).
module.exports = `(() => {
  if (window.__perf) return true;
  window.__perf = { mutations: [], longTasks: [] };
  const root = document.querySelector('.app') || document.body;
  const mo = new MutationObserver((records) => {
    let added = 0, removed = 0;
    for (const r of records) { added += r.addedNodes.length; removed += r.removedNodes.length; }
    if (added || removed) window.__perf.mutations.push({ t: performance.now(), added, removed });
  });
  mo.observe(root, { childList: true, subtree: true });
  window.__perfMutationObserver = mo;
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.longTasks.push({ t: performance.now(), dur: e.duration });
    });
    po.observe({ entryTypes: ['longtask'] });
    window.__perfLongTaskObserver = po;
  } catch { /* longtask entry type unsupported in this Chromium build */ }
  return true;
})()`;
