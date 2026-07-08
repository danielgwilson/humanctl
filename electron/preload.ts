// Minimal, explicit bridge. The renderer gets exactly these calls, nothing else.
// Read-only over transcripts; the only writes are local UI state (pins/theme).
// No direct fs, no network.
//
// Perf (see electron/main.ts's brokerReaderPort()/electron/reader-service.ts):
// the hot-poll observations (sessions.list/notes.list/inbox.threads/
// app.status), session.hot, and the sessions:changed/inbox:fast/session:append
// push events go straight over a direct renderer <-> reader-service
// MessagePort main hands this preload script -- never through ipcMain, so
// main never structured-clone deserializes a reader reply and re-serializes
// it to the renderer. Everything else below is unchanged, still plain
// ipcRenderer.invoke. The window.humanctl surface below is byte-identical to
// before this refactor (same method names, same param/return shapes, same
// event-callback contracts): no renderer component needed to change.

import { contextBridge, ipcRenderer } from 'electron';

// ---- direct renderer <-> reader-service port plumbing ----
// Main hands this preload a fresh MessagePort over the 'reader-port' channel:
// once at boot (after did-finish-load) and again after every reader-service
// respawn or window reload (main.ts's brokerReaderPort()). Until the first
// port arrives -- or whenever the reader-service is down between a crash and
// its respawn's re-broker -- calls are queued and eventually time out with a
// fail-soft `{ok:false}` rather than hanging the caller forever, mirroring
// main.ts's own callReader() contract (a reader hiccup degrades one read to
// an honest failure, never a throw or an infinite wait).
const PORT_TIMEOUT_MS = 20000;
interface PendingPortReq { resolve: (v: Record<string, unknown>) => void; timer: ReturnType<typeof setTimeout> }

let readerPort: MessagePort | null = null;
let nextPortReqId = 1;
const pendingPortReqs = new Map<number, PendingPortReq>();
let queuedSends: Array<() => void> = [];

function failAllPending(reason: string): void {
  for (const [id, p] of pendingPortReqs) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, error: reason });
    pendingPortReqs.delete(id);
  }
}

function callReaderPort(cmd: string, args?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const send = () => {
      if (!readerPort) { resolve({ ok: false, error: 'reader-service port not connected' }); return; }
      const id = nextPortReqId++;
      const timer = setTimeout(() => {
        pendingPortReqs.delete(id);
        resolve({ ok: false, error: `reader-service timed out on "${cmd}"` });
      }, PORT_TIMEOUT_MS);
      pendingPortReqs.set(id, { resolve, timer });
      try { readerPort.postMessage({ id, cmd, args }); }
      catch (err) { clearTimeout(timer); pendingPortReqs.delete(id); resolve({ ok: false, error: String((err as Error)?.message || err) }); }
    };
    // No port yet (very first calls at boot, or a reader-service crash still
    // waiting on its respawn/re-broker): queue rather than fail immediately,
    // so a call made a beat before the port arrives still gets answered
    // instead of surfacing a spurious error.
    if (readerPort) send(); else queuedSends.push(send);
  });
}

// A tiny in-preload pub/sub so onSessionsChanged/onInboxFast/onSessionAppend
// keep their exact existing subscribe/unsubscribe contract (register a
// callback, get an unsubscribe function back) while the transport underneath
// is now the port instead of an ipcRenderer channel.
type PortListener = (payload?: unknown) => void;
const PUSH_EVENTS = ['sessions:changed', 'inbox:fast', 'session:append'] as const;
type PushEvent = (typeof PUSH_EVENTS)[number];
const listeners: Record<PushEvent, Set<PortListener>> = {
  'sessions:changed': new Set(),
  'inbox:fast': new Set(),
  'session:append': new Set(),
};
function dispatchPush(name: PushEvent, payload?: unknown): void {
  for (const cb of listeners[name]) { try { cb(payload); } catch { /* renderer callback threw; ignore */ } }
}

function handlePortMessage(e: MessageEvent): void {
  const m = e.data as { id?: number; ok?: boolean; result?: Record<string, unknown>; error?: string; type?: string; payload?: unknown } | null;
  if (!m || typeof m !== 'object') return;
  if (typeof m.id === 'number') {
    const p = pendingPortReqs.get(m.id);
    if (!p) return; // late reply after our own timeout already resolved the caller
    pendingPortReqs.delete(m.id);
    clearTimeout(p.timer);
    p.resolve(m.ok ? Object.assign({ ok: true }, m.result) : { ok: false, error: m.error || 'reader-service error' });
    return;
  }
  // Proactive watcher push (no id): sessions:changed / inbox:fast /
  // session:append, posted straight from the reader-service now, never
  // relayed by main (see electron/reader-service.ts's postToRenderer()).
  if (m.type === 'sessions:changed' || m.type === 'inbox:fast' || m.type === 'session:append') {
    dispatchPush(m.type, m.payload);
  }
}

// The dossier's currently-open ("hot") session: the reader-service's
// in-memory tail-cursor state does not survive its own crash, or simply
// getting a brand-new port after a respawn/reload, so this preload remembers
// the last setHotSession() arg and re-issues it itself the moment a fresh
// port connects -- the same "re-establish across a respawn" job main.ts used
// to do (via `lastHotArg`) back when session:hot relayed through it.
let lastHotArg: { path?: string; harness?: string } | null = null;

ipcRenderer.on('reader-port', (event) => {
  const port = event.ports[0];
  if (!port) return;
  if (readerPort) { try { readerPort.close(); } catch { /* already gone */ } }
  failAllPending('reader-service port replaced (respawn or reload)');
  readerPort = port;
  readerPort.onmessage = handlePortMessage;
  readerPort.start();
  const queued = queuedSends;
  queuedSends = [];
  for (const send of queued) send();
  if (lastHotArg) callReaderPort('session.hot', lastHotArg).catch(() => { /* best effort re-establish */ });
});

contextBridge.exposeInMainWorld('humanctl', {
  listCommands: () => ipcRenderer.invoke('app:commands'),
  listSessions: (opts: unknown) => callReaderPort('sessions.list', opts),
  getStatus: (opts: unknown) => callReaderPort('app.status', opts),
  getHarnessIcons: () => ipcRenderer.invoke('harness:icons'),
  getPrChip: (repo: string) => ipcRenderer.invoke('pulse:pr-chip', { repo }),
  getNoteImage: (filename: string) => ipcRenderer.invoke('note:get-image', filename),
  resolveAttachment: (filename: string) => ipcRenderer.invoke('note:resolve-attachment', filename),
  getSummaryBudget: (opts: unknown) => ipcRenderer.invoke('summary:budget', opts),
  readSession: (arg: unknown) => ipcRenderer.invoke('sessions:read', arg),
  readTimeline: (arg: unknown) => ipcRenderer.invoke('sessions:timeline', arg),
  setHotSession: (arg: { path?: string; harness?: string; from?: number } | null | undefined) => {
    lastHotArg = arg && arg.path ? { path: String(arg.path), harness: arg.harness } : null;
    return callReaderPort('session.hot', arg || {});
  },
  aggregateSkills: (opts: unknown) => ipcRenderer.invoke('skills:aggregate', opts),
  summarize: (arg: unknown) => ipcRenderer.invoke('session:summarize', arg),
  askSession: (arg: unknown) => ipcRenderer.invoke('session:ask', arg),
  getNotes: (opts: unknown) => callReaderPort('notes.list', opts),
  getInboxThreads: (opts: unknown) => callReaderPort('inbox.threads', opts),
  markThreadRead: (arg: unknown) => ipcRenderer.invoke('inbox:mark-read', arg),
  markAllThreadsRead: () => ipcRenderer.invoke('inbox:mark-all-read'),
  askAtlas: (arg: unknown) => ipcRenderer.invoke('atlas:ask', arg),
  getAtlasLog: () => ipcRenderer.invoke('atlas:get-log'),
  setView: (view: string) => ipcRenderer.invoke('view:set', { view }),
  setNav: (pinned: boolean) => ipcRenderer.invoke('nav:set', { pinned }),
  setCosDrawer: (open: boolean) => ipcRenderer.invoke('cos-drawer:set', { open }),
  resumeSession: (arg: unknown) => ipcRenderer.invoke('session:resume', arg),
  openInApp: (arg: unknown) => ipcRenderer.invoke('session:open-app', arg),
  revealSession: (filePath: string) => ipcRenderer.invoke('sessions:reveal', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  openPath: (p: string) => ipcRenderer.invoke('open:path', p),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch: unknown) => ipcRenderer.invoke('state:set', patch),
  onSessionsChanged: (cb: () => void) => {
    listeners['sessions:changed'].add(cb);
    return () => { listeners['sessions:changed'].delete(cb); };
  },
  // Fast path for ~/.humanctl itself (notes.jsonl + asks/): fires on a short
  // coalesce window independent of the general sessions:changed debounce, so
  // a posted note can update the Inbox without waiting on the full list
  // refresh floor.
  onInboxFast: (cb: () => void) => {
    listeners['inbox:fast'].add(cb);
    return () => { listeners['inbox:fast'].delete(cb); };
  },
  onSessionAppend: (cb: (payload: unknown) => void) => {
    listeners['session:append'].add(cb);
    return () => { listeners['session:append'].delete(cb); };
  },
  // State mutated outside the renderer (a CLI/socket command wrote state.json);
  // carries the fresh state so the open window can apply it live.
  onStateChanged: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => { try { cb(state); } catch { /* renderer callback threw; ignore */ } };
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
});
