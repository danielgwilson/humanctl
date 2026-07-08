// humanctl reader-service: the transcript fs/parse pipeline, hosted in its
// OWN Electron utilityProcess (a real, separate Node process), never on the
// Electron main/browser process.
//
// Why this file exists (AGENTS.md "Never block the Electron main process"):
// main.ts owns the native window and must service window-drag/click/paint
// every frame. Reading and parsing a real fleet of agent transcripts
// (lib/sessions.ts: readFileSync/statSync/readdirSync + JSONL parsing) is
// synchronous CPU + fs work that used to run directly inside main's
// ipcMain.handle callbacks, blocking its event loop for tens of ms on every
// 20s poll and every fs-watcher fire (measured: p99 ~22.7ms, max ~66.6ms on a
// realistic fleet -- a dropped frame on every scan; see
// scripts/perf-selftest/eventloop-gate.js). Moving that work here means ITS
// event loop absorbs the blocking, not main's; main.ts is now a thin async
// relay (see spawnReader()/callReader() there).
//
// Two transports in and out of this process (see main.ts's comment above its
// spawnReader()/brokerReaderPort() for the full rationale):
//
//  1. `process.parentPort` <-> main.ts's `reader`/`callReader()`: main posts
//     `{ id, cmd, args }`, this process replies `{ id, ok, result | error }`
//     on the SAME port. Used only for main's own needs now (control-socket/
//     CLI dispatch, and the Electron-native action handlers that need a
//     reader-backed lookup first) -- never the hot poll.
//  2. A direct `MessagePortMain` handed to us by main over `parentPort`
//     itself, as a one-off `{ type: 'renderer-port' }` message with the port
//     transferred (`e.ports[0]`): this is the renderer's own end of a
//     `MessageChannelMain` main brokered, and it is EXCLUSIVELY the
//     renderer's. Every renderer-facing `window.humanctl` observation that
//     used to relay through main (sessions.list/notes.list/inbox.threads/
//     app.status/session.hot) is served here instead, replying on this same
//     port, and the watcher push events (`sessions:changed` / `inbox:fast` /
//     `session:append`) are posted on it too -- main never sees any of this
//     traffic. main re-brokers a fresh one after every respawn of this
//     process and after every renderer page load/reload, so a stale port
//     here is simply replaced, never patched.
//
// app.status needs two bits only main can compute (APP_VERSION and
// deepLinkApps(), which needs the Electron `app` module -- unavailable in a
// utilityProcess): main sends them once per spawn as `{ type: 'init',
// version, apps }` over parentPort (see `appMeta` below), so this process can
// merge them into every app.status reply itself instead of main enriching
// each one.
//
// This process must never auto-quit (HUMANCTL_SMOKE and friends are handled
// entirely on the main-process side, which decides when to print the smoke
// marker and call app.quit()); it lives for the app's whole run and is only
// torn down by main killing it (app quit) or by main respawning it after a
// crash (see main.ts's spawnReader()).

// NOTE: `process.parentPort` is a Node `process` global that Electron's
// utility-process bootstrap installs directly on `process` for the CHILD
// -- it is NOT a runtime export of `require('electron')` (verified: a plain
// `import { parentPort } from 'electron'` resolves to `undefined` inside a
// real utilityProcess and crash-loops this whole service, even though
// Electron's .d.ts lists `parentPort` as a CrossProcessExports member for
// typing convenience across all process kinds). Import ONLY the type from
// 'electron' (erased at compile time, no runtime require) and read the
// value off `process` itself.
import type { ParentPort, MessagePortMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listRecent, readBlocks, readUsage, readDetail, aggregateSkills, accountStatus, readNotes,
  readNeedSignals, deriveNeedState, readAppended, primeTailCursor, readTimelinePage, harnesses,
  type Harness,
} from '../lib/sessions';
import { resolveSessionRow, inboxThreads, isInboxRelevantChange } from '../lib/commands';

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  // This file only ever runs forked via `utilityProcess.fork` (see main.ts);
  // fail loudly rather than silently sit there doing nothing.
  throw new Error('reader-service: no process.parentPort (must run as an Electron utilityProcess)');
}
function postToMain(msg: unknown): void {
  try { parentPort.postMessage(msg); } catch { /* main may be gone during shutdown */ }
}

// The direct renderer <-> reader-service port (transport 2 above). Starts
// null (nothing to push to before main brokers one); replaced wholesale, not
// mutated, whenever a fresh `renderer-port` handshake arrives, so a stale
// port from a since-reloaded page or a since-respawned prior instance of
// this very process can never linger and receive traffic meant for its
// replacement.
let rendererPort: MessagePortMain | null = null;
function postToRenderer(msg: unknown): void {
  if (!rendererPort) return; // no port yet (early boot) or between a respawn and re-broker: push events are advisory, the next poll/reconnect catches up
  try { rendererPort.postMessage(msg); } catch { /* port may be stale across a reload race; main will re-broker */ }
}

// version/apps main hands over once per spawn (see the header comment);
// app.status merges these in below. Sane fallbacks if a request somehow
// lands before 'init' does (should not happen -- see main.ts's spawnReader(),
// which sends 'init' synchronously right after 'spawn' fires, well before
// main could broker a port for the renderer to request anything over).
let appMeta: { version: string; apps: { claude: boolean; codex: boolean } } = {
  version: '0.0.0',
  apps: { claude: false, codex: false },
};

// ---- fleet watcher (ported verbatim from the old electron/main.ts
// watchSessions/pumpHot/scheduleHot/scheduleInbox -- only the transport
// changed: `win.webContents.send(...)` there is `postToRenderer({...})` here,
// straight onto the direct renderer port (main is not involved at all).
// Same debounce constants, same coalescing behavior, same "never a re-scan
// storm" invariant -- just running on this process's event loop instead of
// main's. ----
let watchTimer: NodeJS.Timeout | null = null;
const watchers: fs.FSWatcher[] = [];
let hotPath: string | null = null;
let hotHarness: Harness | string | null = null;
let hotTimer: NodeJS.Timeout | null = null;
const HOT_COALESCE_MS = 120;
let inboxTimer: NodeJS.Timeout | null = null;
const INBOX_COALESCE_MS = 200;

function pumpHot(): void {
  hotTimer = null;
  if (!hotPath) return;
  const t0 = Date.now();
  let res: ReturnType<typeof readAppended>;
  try { res = readAppended(hotPath, { harness: hotHarness || undefined }); } catch { return; }
  if (res.reset) {
    postToRenderer({ type: 'session:append', payload: { path: hotPath, reset: true, reason: res.reason } });
    return;
  }
  if (!res.events || (!res.events.length && !res.meta)) return;
  let need = null;
  try {
    const st = fs.statSync(hotPath);
    need = deriveNeedState(readNeedSignals(hotPath, hotHarness as string, st), st, Date.now());
  } catch { /* advisory; the debounced list refresh still catches up */ }
  console.log(`humanctl: [reader] hot append ${res.events.length} events (read ${Date.now() - t0}ms) at ${Date.now()}`);
  postToRenderer({
    type: 'session:append',
    payload: { path: hotPath, events: res.events, meta: res.meta, need, end: res.end, size: res.size, at: Date.now() },
  });
}
function scheduleHot(): void {
  if (hotTimer) return;
  hotTimer = setTimeout(pumpHot, HOT_COALESCE_MS);
}

function pumpInbox(): void {
  inboxTimer = null;
  postToRenderer({ type: 'inbox:fast' });
}
function scheduleInbox(): void {
  if (inboxTimer) return;
  inboxTimer = setTimeout(pumpInbox, INBOX_COALESCE_MS);
}

function watchSessions(): void {
  const ping = () => { if (watchTimer) clearTimeout(watchTimer); watchTimer = setTimeout(() => postToRenderer({ type: 'sessions:changed' }), 2500); };
  const harnessDirs = harnesses().map((h) => h.dir);
  for (const dir of harnessDirs) {
    try {
      const w = fs.watch(dir, { recursive: true }, (_ev, fn) => {
        ping();
        if (hotPath && (!fn || path.join(dir, String(fn)) === hotPath)) scheduleHot();
      });
      w.on('error', () => { /* a watched dir vanishing must not crash this process */ });
      watchers.push(w);
    } catch { /* dir may not exist; ignore */ }
  }
  const inboxDir = path.join(os.homedir(), '.humanctl');
  try { fs.mkdirSync(inboxDir, { recursive: true }); } catch { /* best effort */ }
  try {
    const w = fs.watch(inboxDir, { recursive: true }, (_ev, fn) => {
      if (!isInboxRelevantChange(fn)) return;
      ping();
      scheduleInbox();
    });
    w.on('error', () => { /* a watched dir vanishing must not crash this process */ });
    watchers.push(w);
  } catch { /* dir may not exist; ignore */ }
}

// session:hot: the renderer names the session open in the dossier; only that
// file gets the immediate append pump. `from` seeds the cursor at the page's
// line-aligned end so nothing between the page read and this call is lost.
function setHot(arg: { path?: string; harness?: string; from?: number } | undefined): { ok: true } {
  hotPath = arg && arg.path ? String(arg.path) : null;
  hotHarness = (arg && arg.harness) || null;
  if (hotPath) {
    primeTailCursor(hotPath, arg && typeof arg.from === 'number' ? arg.from : undefined);
    scheduleHot(); // catch up anything appended while the session was not hot
  }
  return { ok: true };
}

// ---- observation handlers (moved off main; same shapes main.ts's IPC
// handlers/lib/commands.ts's DIRECT_HANDLERS returned before this refactor,
// so the renderer sees byte-identical results, just relayed) ----
interface SessionTarget { id?: string; path?: string; harness?: string }

function sessionDetail(p: SessionTarget & { [k: string]: unknown }): Record<string, unknown> {
  let target: { path?: string; harness?: string } = { path: p.path, harness: p.harness };
  if (!target.path) {
    if (!p.id) return { ok: false, error: 'session.detail needs an id or a path' };
    const r = resolveSessionRow(p.id);
    if (!r.ok || !r.row) return { ok: false, error: r.error, ambiguous: r.ambiguous };
    target = { path: r.row.path, harness: r.row.harness };
  }
  const detail = readDetail(target.path as string, target.harness as string);
  return {
    ok: true,
    data: readBlocks(target.path as string, { harness: target.harness }),
    usage: readUsage(target.path as string, target.harness as string),
    detail,
  };
}

function sessionTimeline(p: SessionTarget & { before?: number }): Record<string, unknown> {
  let target: { path?: string; harness?: string } = { path: p.path, harness: p.harness };
  if (!target.path) {
    if (!p.id) return { ok: false, error: 'session.timeline needs an id or a path' };
    const r = resolveSessionRow(p.id);
    if (!r.ok || !r.row) return { ok: false, error: r.error, ambiguous: r.ambiguous };
    target = { path: r.row.path, harness: r.row.harness };
  }
  const page = readTimelinePage(target.path as string, { harness: target.harness, before: p.before });
  return page ? { ok: true, page } : { ok: false, error: 'could not read this session' };
}

type Handler = (args: any) => unknown | Promise<unknown>;
const HANDLERS: Record<string, Handler> = {
  'sessions.list': (p) => ({ rows: listRecent(p || {}) }),
  // Merges in the version/apps main hands over at spawn (`appMeta`, set from
  // the 'init' message on parentPort) so a renderer calling this directly
  // over the port gets the exact same shape main's own registry handler used
  // to produce (`Object.assign(status, { version, apps })`) -- see the
  // header comment.
  'app.status': (p) => ({ status: Object.assign(accountStatus(p || {}), appMeta) }),
  'notes.list': (p) => ({ notes: readNotes(p || {}) }),
  'inbox.threads': (p) => ({ threads: inboxThreads(p || {}) }),
  'skills.aggregate': (p) => ({ agg: aggregateSkills(p || {}) }),
  'session.detail': (p) => sessionDetail(p || {}),
  'session.timeline': (p) => sessionTimeline(p || {}),
  // Bounded tail read + the needs-you v3 classifier for one file, used by
  // main.ts's Codex-ask gate (a Codex ask appends into the real thread, so it
  // refuses while the session looks actively in-flight).
  'need-state': (p: { path?: string; harness?: string } | undefined) => {
    if (!p || !p.path) throw new Error('need-state requires a path');
    let st: fs.Stats | null = null;
    try { st = fs.statSync(p.path); } catch { /* stat is advisory; deriveNeedState tolerates null */ }
    return { need: deriveNeedState(readNeedSignals(p.path, p.harness || '', st || undefined), st, Date.now()) };
  },
  // Bare id/path -> row resolution, for main.ts's Electron-specific action
  // handlers (pin/resume/open-app/reveal/summarize/ask) that must run
  // shell/execFile work on main itself but still need the fleet-scan-backed
  // resolution `resolveSessionRow` (lib/commands.ts) does.
  'resolve-session-row': (p) => resolveSessionRow(String((p && p.id) || '')),
  'session.hot': (p) => setHot(p),
};

interface ReaderRequest { id: number; cmd: string; args?: unknown }

// Shared by both transports: dispatch one `{id, cmd, args}` to HANDLERS and
// reply on whichever `reply` was handed in (parentPort for main's own
// requests, the renderer port for the renderer's). Same dispatch, same reply
// shape, either way -- HANDLERS has no notion of which channel asked.
function handleRequest(req: ReaderRequest, reply: (msg: unknown) => void): void {
  if (!req || typeof req.id !== 'number' || typeof req.cmd !== 'string') return;
  const fn = HANDLERS[req.cmd];
  Promise.resolve()
    .then(() => {
      if (!fn) throw new Error(`reader-service: unknown cmd "${req.cmd}"`);
      return fn(req.args);
    })
    .then((result) => reply({ id: req.id, ok: true, result }))
    .catch((err) => reply({ id: req.id, ok: false, error: String((err as Error)?.message || err) }));
}

// Attach the renderer-port's own request handler + push-event target. Called
// once per `renderer-port` handshake (initial boot, every window reload,
// every re-broker after this process itself respawns from a crash -- though
// a respawn always starts this whole module fresh, so in practice this only
// ever runs more than once per process instance across reloads).
function attachRendererPort(p: MessagePortMain): void {
  if (rendererPort) { try { rendererPort.close(); } catch { /* already gone */ } }
  rendererPort = p;
  rendererPort.on('message', (e) => handleRequest(e.data as ReaderRequest, (msg) => postToRenderer(msg)));
  rendererPort.start();
  console.log('humanctl: [reader] direct renderer port connected');
}

parentPort.on('message', (e) => {
  const msg = e.data as { type?: string; version?: string; apps?: { claude: boolean; codex: boolean } };
  if (msg && msg.type === 'renderer-port') {
    const p = e.ports && e.ports[0];
    if (p) attachRendererPort(p);
    return;
  }
  if (msg && msg.type === 'init') {
    appMeta = { version: msg.version || appMeta.version, apps: msg.apps || appMeta.apps };
    return;
  }
  handleRequest(e.data as ReaderRequest, postToMain);
});

// Start watching immediately: harnesses() dirs are fixed (~/.claude,
// ~/.codex), so there is no handshake to wait for from main before attaching.
watchSessions();
console.log(`humanctl: reader-service up (pid ${process.pid})`);
