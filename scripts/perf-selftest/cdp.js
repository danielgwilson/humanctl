'use strict';

// Minimal CDP client for the LOCAL perf gate (see docs/perf.md for the
// local/CI split this is part of). Adapted from the lab investigation's
// throwaway harness (humanctl-lab reports/2026-07-03-perf-profile/harness/),
// but reimplemented against Node's own built-in `WebSocket` global (stable
// since Node 22, this repo targets Node 24) instead of the `ws` npm package,
// so this stays a zero-new-runtime-dependency tool -- it never ships in
// package.json `dependencies`, and now it does not need a devDependency
// either. Node's global `fetch` covers the CDP HTTP endpoint the same way.
//
// Port discovery: run.js launches Electron with
// `--remote-debugging-port=0` (kernel-assigned ephemeral port, immune to
// collisions with any other Electron/Chromium instance on the machine) and
// reads the actual `ws://` endpoint straight out of the child's own stderr
// ("DevTools listening on ws://..."). That means the harness always attaches
// to a URL its own child process just reported, never a guess -- there is no
// scenario where it discovers and attaches to a ghost/unrelated Electron
// instance. getPageTarget's `/json/list` HTTP fetch below is kept only as a
// fallback for a caller that already knows a fixed port (e.g. manual
// debugging via HUMANCTL_PERF_PORT); it is no longer the primary discovery
// path for perf:selftest itself.
function getPageTarget(port) {
  return fetch(`http://localhost:${port}/json/list`)
    .then((r) => r.json())
    .then((list) => {
      const page = list.find((t) => t.type === 'page') || list[0];
      if (!page) throw new Error('no page target found (is the profiling instance up?)');
      return page;
    });
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.eventHandlers = new Map(); // method -> [fn]
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error(`CDP socket error: ${(e && e.message) || 'unknown'}`)));
      this.ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error)));
          else res(msg.result);
        } else if (msg.method) {
          const hs = this.eventHandlers.get(msg.method);
          if (hs) for (const h of hs) h(msg.params);
        }
      });
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
    this.eventHandlers.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

module.exports = { CDP, getPageTarget };
