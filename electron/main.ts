// humanctl desktop (Electron) main process.
// Local-first, read-only over agent session transcripts. No network egress.
// It writes local UI state (pins, theme) under userData; the one deliberate
// exception to transcript read-only is the opt-in Codex "ask the session"
// path, which appends a sentinel-marked question into the thread through the
// user's own codex CLI (disclosed in the UI, acknowledged once, persisted).
//
// Everything the app can do is a registered command (lib/commands.ts): the
// renderer's IPC channels and the ~/.humanctl/app.sock control socket both
// route through one registry, and every invoke is logged to
// ~/.humanctl/events.jsonl. See docs/commands.md.

import { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage, utilityProcess, MessageChannelMain, type UtilityProcess } from 'electron';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import path from 'path';
// This compiled file lives at dist/electron/main.js (see tsup.config.ts), two
// directories below the packaged app root; electron-builder's `files` config
// packages electron/renderer-vite/dist-electron-vite/renderer/**/*,
// electron/assets/**/*, and dist/electron/**/* each preserving their
// project-relative path, so the renderer and the app icon are found relative
// to APP_ROOT (the app root), never __dirname (which is dist/electron/, not
// electron/).
const APP_ROOT = path.join(__dirname, '..', '..');
const ICON_PATH = path.join(APP_ROOT, 'electron', 'assets', 'icon.png');
let APP_VERSION = '0.0.0';
try { APP_VERSION = require('../package.json').version; } catch { /* fall back to 0.0.0 */ }
import fs from 'fs';
import os from 'os';
import { execFile } from 'child_process';
// NOTE (AGENTS.md "Never block the Electron main process"): main.ts does NOT
// import lib/sessions's fs/parse functions (listRecent, readBlocks, etc.) or
// lib/commands's resolveSessionRow/inboxThreads for runtime use anymore.
// Every observation that touches a session transcript is relayed to the
// reader-service utilityProcess below (see spawnReader()/callReader()) so
// that work runs on ITS event loop, never main's. BTW_SENTINEL is a plain
// string constant (not reader work); the two types are erased at compile time.
import { BTW_SENTINEL, type SessionRow } from '../lib/sessions';
import {
  createRegistry, createEventLog, createControlServer,
  appendAskLog, attachmentsDir, answerAsk, codexReplyArgv, type RegistryInvokeCtx, type AskAnswerDeps,
} from '../lib/commands';
import { resolveHarnessIconPath, cachedIconPath } from '../lib/harness-icons';

let win: BrowserWindow | null = null;

// ---- reader-service: the transcript fs/parse pipeline, off main ----
// Spawned as a real, separate Node process (Electron utilityProcess), never
// on the main/browser process.
//
// TWO transport channels exist to it, deliberately kept separate:
//  1. utilityProcess's own message channel (child.postMessage / child.on
//     ('message', ...), i.e. the reader's process.parentPort on its side):
//     a thin async relay -- post `{ id, cmd, args }`, await the matching
//     `{ id, ok, result | error }` reply -- used ONLY for main's OWN needs
//     (the control-socket/CLI path, and the Electron-native action handlers
//     below that must resolve/pin/summarize/ask on main but still need a
//     reader-backed lookup first). This is one-shot-ish, not the hot poll,
//     so relaying its (small) replies through main is fine.
//  2. A direct `MessageChannelMain` port, brokered by main (this section)
//     and used EXCLUSIVELY by the renderer <-> reader-service: main hands
//     one end to the reader-service (`reader.postMessage({ type:
//     'renderer-port' }, [port1])`) and the other straight to the window's
//     preload (`win.webContents.postMessage('reader-port', null, [port2])`),
//     then never touches a message on it again. This is what actually fixes
//     the perf gate: the hot poll (sessions.list/notes.list/inbox.threads/
//     app.status, ~200 rows + ~200 threads, 4 calls every 20s or on every
//     fs-watcher fire) and the live session:append stream now go straight
//     renderer <-> reader-service, so main never structured-clone
//     deserializes a reader reply and re-serializes it to the renderer --
//     see electron/preload.ts and electron/reader-service.ts for the other
//     two sides of this port. Main re-brokers a FRESH channel after a
//     reader-service respawn (its old port1 died with the old process) and
//     after every window `did-finish-load` (a reload discards the old
//     page's port2), see brokerReaderPort() below.
let reader: UtilityProcess | null = null;
let readerSpawned = false; // pid is undefined (per Electron's docs) until 'spawn' fires; never post before then
let readerBreakerOpen = false; // crash-loop breaker: stop respawning after too many fast crashes
let readerCrashCount = 0;
let readerCrashWindowStart = 0;
let readerRespawnAttempt = 0;
const READER_CRASH_WINDOW_MS = 60000;
const READER_CRASH_LIMIT = 5;
const READER_RESPAWN_BASE_MS = 500;
const READER_RESPAWN_MAX_MS = 8000;
const READER_TIMEOUT_MS = 20000;
// Has the window loaded its page (preload run, `ipcRenderer.on('reader-port',
// ...)` registered) at least once? Gates brokerReaderPort() below: a port
// handed to a webContents whose page has not run its preload's listener yet
// is silently dropped (nothing missed on this side to re-queue -- that is
// why the first broker always happens from did-finish-load, never earlier).
let windowLoadedOnce = false;
// Set only under HUMANCTL_PERF_EVENTLOOP: resets the event-loop histogram once
// the UI is up, so the gate measures felt stalls and not window creation.
let perfEldReset: (() => void) | null = null;

// Broker a FRESH direct renderer <-> reader-service MessageChannelMain port.
// Called once the window has loaded (did-finish-load, including reloads) and
// again on every reader-service respawn while the window is already up. Main
// creates the channel, hands one end to each side, and never touches either
// port again -- see the comment block above this section. A no-op until BOTH
// sides are ready (reader spawned, window loaded at least once); whichever of
// the two events happens last is the one that actually triggers the broker.
function brokerReaderPort(): void {
  if (!reader || !readerSpawned || !win || win.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  try {
    reader.postMessage({ type: 'renderer-port' }, [port1]);
  } catch (err) {
    console.error(`humanctl: failed handing the renderer port to reader-service: ${String((err as Error)?.message || err)}`);
    return;
  }
  try {
    win.webContents.postMessage('reader-port', null, [port2]);
    console.log('humanctl: brokered a fresh renderer <-> reader-service port');
  } catch (err) {
    console.error(`humanctl: failed handing the renderer port to the window: ${String((err as Error)?.message || err)}`);
  }
}

interface PendingReaderReq { resolve: (result: Record<string, unknown>) => void; timer: NodeJS.Timeout }
const pendingReaderReqs = new Map<number, PendingReaderReq>();
let nextReaderReqId = 1;

// One request/reply round trip to the reader-service. ALWAYS resolves (never
// rejects/throws): a down/crashed/breaker-tripped/timed-out reader resolves
// `{ ok: false, error }` instead, so a reader hiccup degrades one read to an
// honest failure rather than ever throwing into the renderer or hanging a
// caller forever (per the spec: "reader calls should fail soft").
function callReader(cmd: string, args?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (readerBreakerOpen) { resolve({ ok: false, error: 'reader-service unavailable (crash-looped)' }); return; }
    if (!reader || !readerSpawned) { resolve({ ok: false, error: 'reader-service not ready' }); return; }
    const id = nextReaderReqId++;
    const timer = setTimeout(() => { pendingReaderReqs.delete(id); resolve({ ok: false, error: `reader-service timed out on "${cmd}"` }); }, READER_TIMEOUT_MS);
    pendingReaderReqs.set(id, { resolve, timer });
    try { reader.postMessage({ id, cmd, args }); }
    catch (err) { clearTimeout(timer); pendingReaderReqs.delete(id); resolve({ ok: false, error: String((err as Error)?.message || err) }); }
  });
}

// Only handles id-keyed request/reply traffic now (main's own control-socket/
// action calls, channel 1 above). The watcher push events (sessions:changed/
// inbox:fast/session:append) used to be forwarded here to the renderer; the
// reader-service now posts them straight onto the direct renderer port
// instead (see electron/reader-service.ts's postToRenderer()), so main never
// sees them at all -- nothing to relay, nothing lost.
function handleReaderMessage(msg: unknown): void {
  const m = msg as { id?: number; ok?: boolean; result?: Record<string, unknown>; error?: string } | null;
  if (!m || typeof m !== 'object' || typeof m.id !== 'number') return;
  const p = pendingReaderReqs.get(m.id);
  if (!p) return; // late reply after our own timeout already resolved the caller
  pendingReaderReqs.delete(m.id);
  clearTimeout(p.timer);
  p.resolve(m.ok ? Object.assign({ ok: true }, m.result) : { ok: false, error: m.error || 'reader-service error' });
}

// utilityProcess.fork can only be called after app 'ready' (Electron docs),
// so this is invoked from app.whenReady() below, before createWindow().
function spawnReader(): void {
  if (readerBreakerOpen) return;
  const entry = path.join(__dirname, 'reader-service.js');
  const child = utilityProcess.fork(entry, [], { stdio: 'pipe' });
  reader = child;
  readerSpawned = false;
  child.on('spawn', () => {
    readerSpawned = true;
    readerRespawnAttempt = 0; // a clean spawn resets backoff; only a fast repeat crash trips the breaker
    console.log(`humanctl: reader-service spawned (pid ${child.pid})`);
    // One-time (per spawn) hand-off of the bits app.status must merge in that
    // only main can compute (APP_VERSION, and deepLinkApps() which needs the
    // Electron `app` module -- unavailable in a utilityProcess): the reader
    // now serves the renderer's app.status calls directly over the port
    // (see brokerReaderPort() below), so it needs these cached values itself
    // rather than main enriching every reply, same as it used to.
    child.postMessage({ type: 'init', version: APP_VERSION, apps: deepLinkApps() });
    // A fresh reader-service process means the OLD port1 (if any) died with
    // it; re-broker so the renderer gets a live port again. Only do this for
    // a genuine respawn-while-running -- on the very first boot the window
    // has not loaded yet, so did-finish-load's own brokerReaderPort() call
    // (below) is what fires the initial broker once both sides are ready.
    if (windowLoadedOnce) brokerReaderPort();
  });
  // Pipe the utility's own stdout/stderr through so its logs (including its
  // "hot append" timing line) stay visible; does not touch main's OWN
  // stderr, which is what scripts/perf-selftest/eventloop-gate.js parses.
  child.stdout?.on('data', (d) => process.stdout.write(d));
  child.stderr?.on('data', (d) => process.stderr.write(d));
  child.on('message', handleReaderMessage);
  child.on('exit', (code) => {
    console.error(`humanctl: reader-service exited (code ${code})`);
    readerSpawned = false;
    // Fail every in-flight request rather than leave a caller hanging until
    // its own timeout; each still resolves (never rejects) per callReader's contract.
    for (const [id, p] of pendingReaderReqs) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'reader-service exited' }); pendingReaderReqs.delete(id); }
    const now = Date.now();
    if (now - readerCrashWindowStart > READER_CRASH_WINDOW_MS) { readerCrashWindowStart = now; readerCrashCount = 0; }
    readerCrashCount++;
    if (readerCrashCount > READER_CRASH_LIMIT) {
      readerBreakerOpen = true;
      console.error('humanctl: reader-service crash-looped; giving up on respawning it this run (reads will fail soft from here on)');
      return;
    }
    const delay = Math.min(READER_RESPAWN_MAX_MS, READER_RESPAWN_BASE_MS * 2 ** readerRespawnAttempt);
    readerRespawnAttempt++;
    setTimeout(spawnReader, delay);
  });
}

// ---- local UI state (pins + theme), persisted under userData, never the repo ----
function statePath(): string { return path.join(app.getPath('userData'), 'state.json'); }

interface UiState {
  pins: string[];
  theme: 'light' | 'dark' | 'system';
  view: string;
  navPinned: boolean;
  rightRailOpen: boolean;
  mode?: string;
  __migrated?: boolean;
  lastReadTs?: Record<string, number>;
  summaryBudgetUSD?: number;
  summarizer?: string;
  askCodexAck?: boolean;
  [key: string]: unknown;
}

// Shell v2 migration: the legacy `mode` key (focus/wall/inbox) is replaced by
// the new `view` key (inbox/metrics/fleet/sessions/settings). Map any legacy
// mode forward once, on read, and drop the old key. This runs on every read so
// a state.json written by a pre-0.15 build boots straight into the mapped view
// and never leaves a dangling `mode`; it must never throw or blank-screen, so a
// missing/corrupt file falls back to a clean default object.
const LEGACY_MODE_TO_VIEW: Record<string, string> = { focus: 'inbox', wall: 'sessions', inbox: 'inbox' };
function migrateState(raw: unknown): UiState {
  const s: UiState = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as UiState;
  if (s.mode !== undefined) {
    if (s.view === undefined) s.view = LEGACY_MODE_TO_VIEW[s.mode] || 'inbox';
    delete s.mode;
    s.__migrated = true; // signals writeState to persist the rewrite (see readState)
  }
  return s;
}
function readState(): UiState {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return { pins: [], theme: 'system', view: 'inbox', navPinned: false, rightRailOpen: false }; }
  const migrated = migrateState(raw);
  if (migrated.__migrated) {
    delete migrated.__migrated;
    // Rewrite once so the legacy `mode` key is gone from disk, not just from
    // this read. Best-effort: if the write fails, the in-memory value is still
    // correct and the next boot retries the same migration.
    try { fs.writeFileSync(statePath(), JSON.stringify(migrated, null, 2)); } catch { /* retried next boot */ }
  }
  return migrated;
}
function writeState(next: UiState): boolean {
  const clean: UiState = Object.assign({}, next);
  delete clean.mode;         // never re-introduce the legacy key
  delete clean.__migrated;   // internal migration flag, never persisted
  try { fs.writeFileSync(statePath(), JSON.stringify(clean, null, 2)); return true; } catch { return false; }
}

// The renderer is the electron-vite React/Tailwind/shadcn app
// (electron/renderer-vite/); there is no other renderer. Normal boot loads
// the built output at
// electron/renderer-vite/dist-electron-vite/renderer/index.html.
// HUMANCTL_DEV_URL points at the Vite dev server instead (fast loop, HMR):
// run `npm run renderer` (electron/renderer-vite's `vite`) in one terminal
// and set HUMANCTL_DEV_URL=http://localhost:5183 for `npm run desktop` in
// another.
const VITE_RENDERER_DIST = path.join(APP_ROOT, 'electron', 'renderer-vite', 'dist-electron-vite', 'renderer', 'index.html');
function rendererTarget(): { file?: string; url?: string } {
  if (process.env.HUMANCTL_DEV_URL) return { url: process.env.HUMANCTL_DEV_URL };
  return { file: VITE_RENDERER_DIST };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 760,
    minHeight: 500,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0c10' : '#f7f8fa',
    titleBarStyle: 'hiddenInset',
    title: 'humanctl',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const target = rendererTarget();
  if (target.url) win.loadURL(target.url);
  else win.loadFile(target.file!);

  win.once('ready-to-show', () => { win!.show(); win!.focus(); });

  // `.on`, not `.once`: a window reload (HUMANCTL_DEV_URL's HMR reload path,
  // or a manual reload) discards the page's JS context and the reader port
  // its preload was holding, so every did-finish-load re-brokers a fresh one
  // (brokerReaderPort() is a no-op until the reader is also spawned).
  win.webContents.on('did-finish-load', () => {
    console.log('humanctl: window loaded');
    // Perf gate only: the UI is up, so drop the boot-time samples and measure
    // the stalls a user could actually feel from here on (see the histogram
    // setup in app.whenReady). Reset once, not on every reload, so a reload
    // cannot silently erase a stall the gate should have caught.
    if (perfEldReset && !windowLoadedOnce) perfEldReset();
    windowLoadedOnce = true;
    brokerReaderPort();
    // The reader-service starts its own fleet watcher as soon as it spawns
    // (electron/reader-service.ts's watchSessions(); its dirs are fixed), so
    // main has nothing to attach here anymore -- see spawnReader() above.
    if (process.env.HUMANCTL_SMOKE) {
      (async () => {
        let n = -1;
        try {
          const r = await callReader('sessions.list', { maxAgeH: 72, limit: 40 });
          if (r.ok) n = (r.rows as unknown[]).length;
        } catch { /* smoke count is advisory */ }
        console.log(`HUMANCTL_SMOKE ok: ${n} sessions`);
        app.quit();
      })();
    }
  });
}

// ---- realtime: sessions:changed / inbox:fast / session:append ----
// All three now originate in the reader-service utilityProcess (its own
// watchers over the harness transcript dirs + ~/.humanctl), pushed straight
// onto the direct renderer <-> reader-service MessagePort (see
// brokerReaderPort() above and electron/reader-service.ts's
// postToRenderer()). main.ts itself no longer watches anything, holds no
// hot-path state, and never sees these events at all. See
// electron/reader-service.ts for the watcher, the debounce/coalesce
// constants, and the incremental hot-append pump; electron/preload.ts for
// where the renderer's onSessionsChanged/onInboxFast/onSessionAppend
// subscriptions now attach.

// Honest capability probe: ask the OS which app (if any) handles each harness
// deep link scheme. The renderer only offers "open in app" when a real handler
// is registered, so the button can never be a fictional action.
function deepLinkApps(): { claude: boolean; codex: boolean } {
  try {
    return {
      claude: !!app.getApplicationNameForProtocol('claude://'),
      codex: !!app.getApplicationNameForProtocol('codex://'),
    };
  } catch { return { claude: false, codex: false }; }
}

// ---- harness icon extraction (PR-2 item 1) ----
// Runtime-only, never committed: read the LOCALLY INSTALLED app's own icon
// (lib/harness-icons.ts resolves the .icns path via Info.plist
// CFBundleIconFile, never a hardcoded filename), decode it with Electron's
// nativeImage (the one piece that needs Electron, hence living here and not
// in lib/), downscale to a UI-sized PNG, and cache the PNG under Electron
// userData -- never the repo, never a ~/.humanctl watched path (DESIGN.md's
// write/watch separation rule). ANY failure at any step (app not installed,
// plist unreadable, icon file missing, decode failure, empty image) resolves
// to null so the caller falls back to the built-in glyph silently; this
// function itself never throws.
//
// Async end to end (never main.ts's doctrine-forbidden sync fs or sync spawn).
// The warm-cache read/write uses fs.promises; `resolveHarnessIconPath`
// (lib/harness-icons.ts) is async too, because it shells out to `plutil` and a
// SYNCHRONOUS spawn cost 31.9ms of main-process stall -- two dropped frames --
// as measured by `npm run perf:eventloop`. "It only runs on a cache miss" is
// not an excuse: userData starts empty, so the miss happens on the first
// launch of every install, after boot, exactly when the user is grabbing the
// window. The one irreducible sync island is `nativeImage`'s
// decode/resize/toPNG, which Electron exposes in no async form; it is a pixel
// decode of a single small .icns with no process spawn and no path lookups,
// and the gate is what holds it honest.
const ICON_SIZE = 40; // CSS px; @2x handled by nativeImage's own scale factors
const iconCache = new Map<string, string | null>(); // harness -> data URL | null, populated once per app run
async function extractHarnessIcon(harness: string): Promise<string | null> {
  if (iconCache.has(harness)) return iconCache.get(harness) ?? null;
  let dataUrl: string | null = null;
  try {
    const userDataDir = app.getPath('userData');
    const cachePath = cachedIconPath(userDataDir, harness);
    // Reuse a prior run's cached PNG when present; still re-derive from the
    // source .icns if the cache is missing (first run, or userData was
    // cleared), never from the repo or a watched dir either way.
    try {
      const buf = await fs.promises.readFile(cachePath);
      if (buf && buf.length) dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } catch { /* no cache yet (or unreadable): fall through to the cold path below */ }
    if (!dataUrl) {
      const resolved = await resolveHarnessIconPath(harness);
      if (resolved.ok) {
        const img = nativeImage.createFromPath(resolved.path);
        if (img && !img.isEmpty()) {
          const resized = img.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' });
          const png = resized.toPNG();
          if (png && png.length) {
            try { await fs.promises.mkdir(path.dirname(cachePath), { recursive: true }); await fs.promises.writeFile(cachePath, png); } catch { /* cache is best-effort; still return the data URL below */ }
            dataUrl = `data:image/png;base64,${png.toString('base64')}`;
          }
        }
      }
    }
  } catch { dataUrl = null; } // any failure at all: silent fallback to the glyph
  iconCache.set(harness, dataUrl);
  return dataUrl;
}
async function harnessIcons(): Promise<{ 'claude-code': string | null; codex: string | null }> {
  const [claudeCode, codex] = await Promise.all([extractHarnessIcon('claude-code'), extractHarnessIcon('codex')]);
  return { 'claude-code': claudeCode, codex };
}
// `session:hot` (the renderer naming the session open in the dossier, so
// only that file gets the immediate append pump) is now served directly by
// the reader-service over the renderer port -- see electron/preload.ts's
// setHotSession/`lastHotArg` (it re-issues the last hot arg itself after a
// fresh port arrives, the same "re-establish across a respawn" job main used
// to do here) and electron/reader-service.ts's `session.hot` handler. main no
// longer sees this call at all, so there is no ipcMain handler for it here.

// A Dock/Finder-launched app inherits a minimal PATH (/usr/bin:/bin:...), not the
// user's shell PATH, so bare `claude` / `codex` are not found. Resolve the real
// absolute path via the login shell (which sources the user's rc), cached, with a
// dir scan as a fallback. This is why summaries failed only in the packaged app.
// Async (never `execFileSync` on main: a full interactive login shell can take
// the whole 6s timeout sourcing a slow .zshrc/.zprofile, which would stall
// main's event loop for that entire span -- see AGENTS.md "Never block the
// Electron main process"). Concurrent lookups for the same name share one
// in-flight promise rather than spawning duplicate shells.
const cliCache = new Map<string, string | null>();
const cliLookupInFlight = new Map<string, Promise<string | null>>();
function resolveCliDirScan(name: string): string | null {
  const home = os.homedir();
  const cands = [`${home}/.local/bin/${name}`, `${home}/.bun/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `${home}/.npm-global/bin/${name}`];
  return cands.find((c) => { try { return fs.existsSync(c); } catch { return false; } }) || null;
}
async function resolveCli(name: string): Promise<string | null> {
  if (cliCache.has(name)) return cliCache.get(name) ?? null;
  const inFlight = cliLookupInFlight.get(name);
  if (inFlight) return inFlight;
  const lookup = (async (): Promise<string | null> => {
    let bin: string | null = null;
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const out = await new Promise<string>((resolve, reject) => {
        execFile(shell, ['-ilc', `command -v ${name} 2>/dev/null`], { timeout: 6000, encoding: 'utf8' },
          (err, stdout) => { if (err) reject(err); else resolve(stdout); });
      });
      const line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop();
      if (line && path.isAbsolute(line) && fs.existsSync(line)) bin = line;
    } catch { /* fall through to dir scan */ }
    if (!bin) bin = resolveCliDirScan(name);
    cliCache.set(name, bin);
    return bin;
  })();
  cliLookupInFlight.set(name, lookup);
  try { return await lookup; } finally { cliLookupInFlight.delete(name); }
}

interface TargetParams {
  id?: string;
  path?: string;
  harness?: string;
  cwd?: string;
  [key: string]: unknown;
}

type ResolveTargetResult = { ok: true; target: TargetParams } | { ok: false; error?: string; ambiguous?: boolean };

// The renderer always passes a full target ({id, path, harness, cwd}); the
// control socket and CLI may pass only an id (or a unique id fragment).
// Resolve once, here, so every action shares the same rule. `need` names the
// keys the handler cannot work without; when they are all present the params
// pass through untouched (the renderer fast path, zero behavior change).
// Resolution itself (a fleet scan keyed by id) is relayed to the
// reader-service (see callReader('resolve-session-row', ...)); this function
// is async purely because that round trip is, never because of local fs work.
async function resolveTarget(p: TargetParams, need: string[]): Promise<ResolveTargetResult> {
  const have = (k: string) => p[k] !== undefined && p[k] !== null && p[k] !== '';
  if (need.every(have)) return { ok: true, target: p };
  if (!have('id') && !have('path')) return { ok: false, error: 'no session id or path' };
  const r = await callReader('resolve-session-row', { id: (p.id || p.path) as string });
  const row = r.row as SessionRow | undefined;
  if (!r.ok || !row) return { ok: false, error: r.error as string | undefined, ambiguous: r.ambiguous as boolean | undefined };
  return { ok: true, target: Object.assign({}, p, { id: row.id, path: row.path, harness: row.harness, cwd: p.cwd || row.cwd }) };
}

// ---- state mutations ----
// Mutations arriving from outside the renderer (socket/CLI) are pushed back so
// the open window reflects them immediately; ipc-sourced mutations came FROM
// the renderer, which already knows.
function pushStateToRenderer(ctx?: RegistryInvokeCtx): void {
  if (ctx && ctx.source === 'ipc') return;
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', readState());
}
function applyStatePatch(patch: Partial<UiState> | undefined, ctx?: RegistryInvokeCtx): { ok: true; state: UiState } | { ok: false; error: string } {
  const next = Object.assign(readState(), patch || {});
  if (!writeState(next)) return { ok: false, error: 'could not write state.json' };
  pushStateToRenderer(ctx);
  return { ok: true, state: next };
}
async function pinSession(id: string, on: boolean, ctx?: RegistryInvokeCtx): Promise<Record<string, unknown>> {
  const r = await callReader('resolve-session-row', { id });
  const row = r.row as SessionRow | undefined;
  if (!r.ok || !row) return { ok: false, error: r.error, ambiguous: r.ambiguous }; // pinning an id that matches nothing would be a silent no-op lie
  const s = readState();
  const pins = new Set(Array.isArray(s.pins) ? s.pins : []);
  if (on) pins.add(row.id); else pins.delete(row.id);
  const res = applyStatePatch({ pins: [...pins] }, ctx);
  if (!res.ok) return res;
  return { ok: true, id: row.id, pinned: on, pins: res.state.pins };
}

// Inbox unread state: lastReadTs[threadId] persists in state.json (same store
// as pins/theme). Unread is real: a thread is unread when it has an item
// newer than its lastReadTs (or no entry at all), computed in the renderer
// from data it already has; this command only owns the watermark.
function markThreadRead(threadId: string, at: number | undefined, ctx?: RegistryInvokeCtx): Record<string, unknown> {
  const id = String(threadId || '').trim();
  if (!id) return { ok: false, error: 'inbox.mark-read requires a threadId' };
  const s = readState();
  const lastReadTs = Object.assign({}, s.lastReadTs || {});
  lastReadTs[id] = Number.isFinite(at) ? (at as number) : Date.now();
  const res = applyStatePatch({ lastReadTs }, ctx);
  if (!res.ok) return res;
  return { ok: true, threadId: id, at: lastReadTs[id] };
}
async function markAllThreadsRead(ctx?: RegistryInvokeCtx): Promise<Record<string, unknown>> {
  const now = Date.now();
  const r = await callReader('inbox.threads', {});
  const threads = (r.ok ? (r.threads as { sessionId: string }[]) : []) || [];
  const s = readState();
  const lastReadTs = Object.assign({}, s.lastReadTs || {});
  for (const t of threads) lastReadTs[t.sessionId] = now;
  const res = applyStatePatch({ lastReadTs }, ctx);
  if (!res.ok) return res;
  return { ok: true, at: now, count: threads.length };
}

// Opt-in only: summarize a session's recent activity via the user's chosen local
// CLI (Claude Code `claude -p`, or Codex `codex exec`). This is the one action
// that sends data off the machine (to the model, through the user's own CLI auth),
// so the renderer labels it explicitly. Cached by engine + mtime.
const summaryCache = new Map<string, string>();
const SUMMARIZE_PROMPT = (ex: { lastUser?: string }, tail: string) => `Summarize the recent tail of an autonomous coding-agent session for an operator dashboard. In 1-2 plain sentences say what the agent is currently working on and its immediate next step. Be concrete and terse, no preamble. Respond directly with the summary only; do not use any tools.\n\nLatest user instruction: ${ex.lastUser || '(none)'}\n\nRecent blocks:\n${tail}`;
// Always-on summary engine (PR-2 item 4): `auto: true` marks a call the
// renderer's background engine made (unread AND needs-* threads only, see
// the renderer's runAutoSummaries) rather than the manual "Generate/Refresh
// AI summary" button. Auto calls are budget-gated (dailyBudgetUSD, default from
// summary-budget.ts, configurable via app.set-state's summaryBudgetUSD) and,
// on a persistent 401 (retried once already below), SKIP silently rather than
// surfacing an error toast -- a skip must never count against the budget
// (nothing was spent) and must never blank out an existing stale summary (the
// caller keeps showing the old one with its age label).
async function sessionSummarize(p: TargetParams & { engine?: string; auto?: boolean }): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  const engine = arg.engine === 'codex' ? 'codex' : 'claude';
  const st = fs.statSync(arg.path as string);
  const key = `${engine}:${arg.path}:${st.mtimeMs}`;
  if (summaryCache.has(key)) return { ok: true, summary: summaryCache.get(key), cached: true, engine };
  const bin = await resolveCli(engine);
  if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
  // Reuses the exact same reader-service call the session.detail IPC channel
  // makes (electron/reader-service.ts's sessionDetail): one relay, one shape,
  // no separate readDetail/readBlocks import here.
  const detailRes = await callReader('session.detail', { path: arg.path, harness: arg.harness });
  const d = (detailRes.ok ? (detailRes.detail as { lastExchange?: { lastUser?: string } } | null) : null) || {};
  const ex = d.lastExchange || {};
  const blocks = (detailRes.ok ? (detailRes.data as { blocks?: { kind: string; preview: string }[] })?.blocks : []) || [];
  const tail = blocks.slice(-16).map((b) => `[${b.kind}] ${b.preview}`).join('\n');
  const prompt = SUMMARIZE_PROMPT(ex, tail);
  if (arg.auto && engine === 'claude') {
    const { wouldExceedBudget } = require('../lib/summary-budget') as typeof import('../lib/summary-budget');
    const dailyBudgetUSD = Number.isFinite(readState().summaryBudgetUSD) ? readState().summaryBudgetUSD : undefined;
    const check = wouldExceedBudget(prompt, dailyBudgetUSD);
    if (check.exceeded) return { ok: false, paused: true, engine, spentUSD: check.spentUSD, dailyBudgetUSD: check.dailyBudgetUSD };
  }
  const env = Object.assign({}, process.env, { PATH: [path.dirname(bin), process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':') });
  let out: string;
  if (engine === 'codex') {
    // `codex exec` is an agent; keep it read-only, out-of-repo, and ephemeral so
    // it does no work and leaves no session file, and read the clean final
    // message from --output-last-message rather than parsing the event stream.
    const outFile = path.join(os.tmpdir(), `humanctl-sum-${Date.now()}-${Math.round(st.mtimeMs)}.txt`);
    out = await new Promise<string>((res, rej) => {
      const cp = execFile(bin, ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', os.tmpdir(), '-o', outFile, '-'],
        { timeout: 90000, maxBuffer: 4 << 20, env },
        (err, stdout, stderr) => {
          let msg = '';
          try { msg = fs.readFileSync(outFile, 'utf8').trim(); } catch { /* no file */ }
          try { fs.unlinkSync(outFile); } catch { /* best effort */ }
          if (msg) return res(msg);
          if (err) return rej(new Error(String(stderr || err.message || 'summarize failed').slice(0, 300)));
          return res(String(stdout).trim());
        });
      try { cp.stdin!.end(prompt); } catch (e) { rej(e); }
    });
  } else {
    const runClaude = () => new Promise<string>((res, rej) => {
      const cp = execFile(bin, ['-p', '--model', 'claude-haiku-4-5', '--allowed-tools', ''], { timeout: 60000, maxBuffer: 1 << 20, env },
        (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'summarize failed').slice(0, 300))) : res(String(stdout).trim()));
      try { cp.stdin!.end(prompt); } catch (e) { rej(e); }
    });
    out = await runClaude();
    // The API can reject valid OAuth credentials in short transient bursts
    // (401s and successes interleave within the same minute). Interactive
    // Claude Code rides those out with automatic retries, but a one-shot -p
    // run dies on its first request and prints "Failed to authenticate." to
    // stdout, so give it one spaced retry before surfacing the failure.
    if (/^failed to authenticate\b/i.test(out)) {
      await new Promise((r) => setTimeout(r, 2500));
      out = await runClaude();
      // Still failing after the one retry: for an auto call this is a SKIP,
      // not an error -- persistent auth trouble should not spam the UI with
      // failures for a background engine the user never directly triggered,
      // and (per the spec) a skip must never be counted against the budget
      // (nothing was spent) and must not clobber a still-valid stale summary.
      if (arg.auto && /^failed to authenticate\b/i.test(out)) {
        return { ok: false, skipped: true, reason: '401-retry-exhausted', engine };
      }
    }
  }
  const summary = out.slice(0, 600);
  if (!summary) return { ok: false, error: `the ${engine} CLI returned no output`, engine };
  // Both CLIs print auth failures to stdout and exit 0, so guard against
  // surfacing "Not logged in" as if it were a real summary.
  if (/\b(not logged in|please run \/login|invalid authentication credentials|invalid api key|not authenticated)\b/i.test(summary)) {
    if (arg.auto) return { ok: false, skipped: true, reason: 'not-authenticated', engine };
    return { ok: false, error: `${engine} CLI is not authenticated: ${summary.slice(0, 140)}`, engine };
  }
  summaryCache.set(key, summary);
  if (summaryCache.size > 200) summaryCache.clear();
  if (arg.auto && engine === 'claude') {
    const { recordSpend } = require('../lib/summary-budget') as typeof import('../lib/summary-budget');
    recordSpend(prompt, summary);
  }
  return { ok: true, summary, engine };
}

// ---- Atlas: the right-rail advisory chat (spec: docs/inbox-ui-v1-spec.md) ----
// Same headless-probe plumbing as ask-the-session (a one-shot local CLI call,
// no persisted session), but grounded in the FLEET rather than one
// transcript: the pulse lane summary, recent notes, and the top-N session
// states with their reasons. Advisory only: Atlas answers and recommends, it
// never invokes a registry command itself. Every exchange is logged (this IS
// the atlas.ask observation, via the registry) and persisted to
// ~/.humanctl/atlas.jsonl so the thread survives a restart.
const ATLAS_LOG = () => path.join(os.homedir(), '.humanctl', 'atlas.jsonl');
function appendAtlasLog(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(ATLAS_LOG()), { recursive: true });
    fs.appendFileSync(ATLAS_LOG(), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch { /* best effort; the state.json copy the renderer keeps is the fast path */ }
}
function readAtlasLog(limit = 200): Record<string, unknown>[] {
  let txt: string;
  try { txt = fs.readFileSync(ATLAS_LOG(), 'utf8'); } catch { return []; }
  const out: Record<string, unknown>[] = [];
  for (const line of txt.split('\n')) {
    if (!line) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') out.push(o); } catch { /* skip a corrupt line */ }
  }
  return out.slice(-limit);
}
const ATLAS_TOP_N = 20;
async function atlasContext(): Promise<{ rows: Record<string, unknown>[]; notes: Record<string, unknown>[] }> {
  const listRes = await callReader('sessions.list', { maxAgeH: 24 * 30, limit: 200, withUsage: false });
  const rowsRaw = (listRes.ok ? (listRes.rows as SessionRow[]) : []) || [];
  const rows = rowsRaw
    .filter((r) => r.tier !== 'archived')
    .slice(0, ATLAS_TOP_N)
    .map((r: SessionRow) => ({ id: r.id.slice(0, 12), repo: r.repo, harness: r.harness, state: r.state, reason: r.stateReason, age: r.age }));
  const notesRes = await callReader('notes.list', { limit: 20 });
  const notesRaw = (notesRes.ok ? (notesRes.notes as { level: string; message: string; repo: string; session?: string; ts: string }[]) : []) || [];
  const notes = notesRaw.map((n) => ({ level: n.level, message: n.message, repo: n.repo, session: n.session ? n.session.slice(0, 12) : '', ts: n.ts }));
  return { rows, notes };
}
const ATLAS_PROMPT = (ctx: { rows: unknown; notes: unknown }, pulseSummary: string, question: string) => `You are Atlas, the advisory chief-of-staff panel in humanctl, a control room for one human overseeing many autonomous coding-agent sessions. Answer the operator's question using ONLY the data below. Cite the specific sessions (by their short id) or lanes you are referring to. If the data does not cover the question, say "I don't see that in the current fleet data" rather than guessing. Be terse and concrete; no preamble, no fabricated actions (you are advisory only and cannot execute anything).

Pulse lane summary (read-only reconciliation across issues, worktrees, PRs, sessions, notes):
${pulseSummary}

Recent notes (agents posting to the human inbox):
${JSON.stringify(ctx.notes, null, 0)}

Top session states (id, repo, harness, state, reason, age):
${JSON.stringify(ctx.rows, null, 0)}

Operator's question: ${question}`;
async function atlasAsk(p: { question?: string; engine?: string }): Promise<Record<string, unknown>> {
  const question = String((p && p.question) || '').trim();
  if (!question) return { ok: false, error: 'no question' };
  const engine = p.engine === 'codex' ? 'codex' : 'claude';
  const bin = await resolveCli(engine);
  if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
  const { runPulse } = require('../lib/pulse') as typeof import('../lib/pulse');
  let pulseSummary = '(pulse unavailable)';
  try {
    let out = '';
    const code = await runPulse({ json: false }, { out: (s: string) => { out += `${s}\n`; }, err: () => { /* Atlas still answers from notes + session states alone */ } });
    if (code === 0 && out.trim()) pulseSummary = out.trim().slice(0, 4000);
  } catch { /* Atlas still answers from notes + session states alone */ }
  const ctx = await atlasContext();
  const prompt = ATLAS_PROMPT(ctx, pulseSummary, question);
  const env = Object.assign({}, process.env, { PATH: [path.dirname(bin), process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':') });
  delete (env as Record<string, string | undefined>).CLAUDE_CODE_ENTRYPOINT;
  delete (env as Record<string, string | undefined>).CLAUDECODE;
  let out: string;
  if (engine === 'codex') {
    const outFile = path.join(os.tmpdir(), `humanctl-atlas-${Date.now()}-${process.pid}.txt`);
    out = await new Promise<string>((res, rej) => {
      const cp = execFile(bin, ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '-C', os.tmpdir(), '-o', outFile, '-'],
        { timeout: 90000, maxBuffer: 4 << 20, env },
        (err, stdout, stderr) => {
          let msg = '';
          try { msg = fs.readFileSync(outFile, 'utf8').trim(); } catch { /* no file */ }
          try { fs.unlinkSync(outFile); } catch { /* best effort */ }
          if (msg) return res(msg);
          if (err) return rej(new Error(String(stderr || err.message || 'atlas ask failed').slice(0, 300)));
          return res(String(stdout).trim());
        });
      try { cp.stdin!.end(prompt); } catch (e) { rej(e); }
    });
  } else {
    const runClaude = () => new Promise<string>((res, rej) => {
      const cp = execFile(bin, ['-p', '--model', 'claude-haiku-4-5', '--allowed-tools', ''], { timeout: 60000, maxBuffer: 1 << 20, env },
        (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'atlas ask failed').slice(0, 300))) : res(String(stdout).trim()));
      try { cp.stdin!.end(prompt); } catch (e) { rej(e); }
    });
    out = await runClaude();
    if (/^failed to authenticate\b/i.test(out)) {
      await new Promise((r) => setTimeout(r, 2500));
      out = await runClaude();
    }
  }
  const answer = out.slice(0, 3000);
  if (!answer) return { ok: false, error: `the ${engine} CLI returned no output`, engine };
  if (/\b(not logged in|please run \/login|invalid authentication credentials|invalid api key|not authenticated)\b/i.test(answer)) {
    return { ok: false, error: `${engine} CLI is not authenticated: ${answer.slice(0, 140)}`, engine };
  }
  const at = Date.now();
  appendAtlasLog({ q: question, a: answer, engine, ts: new Date(at).toISOString() });
  return { ok: true, answer, engine, at };
}

// Ask the session: inject one sentinel-marked question into an existing session
// through the harness's own CLI and return the answer. The mechanics are
// empirically verified (docs/ask-session.md):
//   Claude Code  `claude -p --resume <id> --no-session-persistence` answers from
//                the session's full context and writes NOTHING: the original
//                transcript stays byte-identical and no new file appears, so it
//                is safe by default, even while the session is open elsewhere.
//   Codex        `codex exec resume <id>` ALWAYS appends the question and answer
//                into the real rollout (there is no headless fork), so it runs
//                only after the user's persisted acknowledgement, refuses while
//                the session is actively working, and must pin
//                sandbox_mode=read-only: resume otherwise runs with
//                danger-full-access regardless of the original thread's sandbox.
const ASK_TIMEOUT_MS = 90000;
const AUTH_FAIL_RE = /\b(not logged in|please run \/login|invalid authentication credentials|invalid api key|not authenticated|failed to authenticate)\b/i;
async function sessionAsk(p: TargetParams & { question?: string }): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['id', 'path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  const question = String(arg.question || '').trim();
  if (!question) return { ok: false, error: 'no question' };
  const codex = arg.harness === 'codex';
  const engine = codex ? 'codex' : 'claude';
  const bin = await resolveCli(engine);
  if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
  const prompt = `${BTW_SENTINEL} ${question}`;
  const env = Object.assign({}, process.env, { PATH: [path.dirname(bin), process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':') });
  // A probe spawned from inside another Claude session would inherit these
  // markers and stamp the injected turn differently; scrub for a clean SDK run.
  delete (env as Record<string, string | undefined>).CLAUDE_CODE_ENTRYPOINT;
  delete (env as Record<string, string | undefined>).CLAUDECODE;
  // Claude resolves --resume <id> against the CURRENT project (cwd), so the
  // probe must run in the session's own working directory (verified: an
  // unrelated cwd fails with "No conversation found"). Codex resumes by uuid
  // from anywhere, but the same cwd keeps its appended environment_context
  // faithful to the thread.
  const cwd = arg.cwd && fs.existsSync(arg.cwd) ? arg.cwd : os.homedir();
  let out = '';
  if (codex) {
    // Codex asks write into the real thread. Two honest gates before spawning:
    // the user acknowledged that once (persisted in state.json by the
    // renderer's disclosure flow), and the session is not actively working
    // (appending into a live turn is unsupported territory).
    if (readState().askCodexAck !== true) {
      return { ok: false, needsAck: true, engine, error: 'Codex questions are written into the thread itself; confirm the disclosure first.' };
    }
    // This gate exists to stop a Codex ask from appending into a thread the
    // agent itself is actively writing into right now, so a reader-service
    // hiccup must refuse (return an honest error) rather than silently treat
    // an unknown state as safe.
    const needRes = await callReader('need-state', { path: arg.path, harness: arg.harness });
    if (!needRes.ok) return { ok: false, engine, error: `could not check whether this session is active: ${needRes.error}` };
    const need = needRes.need as { state: string };
    if (need.state === 'work') {
      return { ok: false, engine, error: 'this session is working right now; a Codex ask would append into the live thread. Try again once it settles.' };
    }
    const m = String(arg.id).match(UUID_RE);
    if (!m) return { ok: false, engine, error: 'no thread uuid in this session id' };
    // -o writes the clean final agent message; read that, never the stdout stream.
    const outFile = path.join(os.tmpdir(), `humanctl-ask-${Date.now()}-${process.pid}.txt`);
    out = await new Promise<string>((res, rej) => {
      const cp = execFile(bin, ['exec', 'resume', m[1], '--skip-git-repo-check',
        '-c', 'sandbox_mode=read-only', '-c', 'model_reasoning_effort=low',
        '-o', outFile, prompt],
        { timeout: ASK_TIMEOUT_MS, maxBuffer: 4 << 20, env, cwd },
        (err, stdout, stderr) => {
          let msg = '';
          try { msg = fs.readFileSync(outFile, 'utf8').trim(); } catch { /* no file */ }
          try { fs.unlinkSync(outFile); } catch { /* best effort */ }
          if (msg) return res(msg);
          if (err) return rej(new Error(String(stderr || err.message || 'ask failed').slice(0, 300)));
          return res(String(stdout).trim());
        });
      try { cp.stdin!.end(); } catch { /* prompt is argv, not stdin */ }
    });
  } else {
    const runClaude = () => new Promise<string>((res, rej) => {
      const cp = execFile(bin, ['-p', '--resume', String(arg.id), '--no-session-persistence', '--model', 'haiku', '--output-format', 'json', prompt],
        { timeout: ASK_TIMEOUT_MS, maxBuffer: 4 << 20, env, cwd },
        (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'ask failed').slice(0, 300))) : res(String(stdout)));
      try { cp.stdin!.end(); } catch { /* prompt is argv, not stdin */ }
    });
    // The API can reject valid OAuth credentials in short transient bursts and
    // a one-shot -p run dies on its first request with exit 0 and the error on
    // stdout (same failure the summarize path guards). One spaced retry.
    let raw = await runClaude();
    let parsed: { result?: string; is_error?: boolean } | null = null;
    try { parsed = JSON.parse(raw.trim()); } catch { /* non-JSON output handled below */ }
    const authFail = (!parsed && /failed to authenticate/i.test(raw))
      || (!!parsed && !!parsed.is_error && AUTH_FAIL_RE.test(String(parsed.result || '')));
    if (authFail) {
      await new Promise((r) => setTimeout(r, 2500));
      raw = await runClaude();
      parsed = null;
      try { parsed = JSON.parse(raw.trim()); } catch { /* shape-checked below */ }
    }
    // Shape-validate: a result object with a string .result, not is_error.
    if (!parsed || typeof parsed.result !== 'string') {
      return { ok: false, engine, error: `unexpected claude output: ${raw.trim().replace(/\s+/g, ' ').slice(0, 160) || 'empty'}` };
    }
    if (parsed.is_error) return { ok: false, engine, error: String(parsed.result).replace(/\s+/g, ' ').slice(0, 300) };
    out = parsed.result.trim();
  }
  const answer = String(out).trim().slice(0, 4000);
  if (!answer) return { ok: false, engine, error: `the ${engine} CLI returned no output` };
  // Both CLIs print auth failures to stdout and exit 0; never surface one as an answer.
  if (AUTH_FAIL_RE.test(answer.slice(0, 200))) {
    return { ok: false, engine, error: `${engine} CLI is not authenticated: ${answer.slice(0, 140)}` };
  }
  return { ok: true, answer, engine, at: Date.now() };
}

// btw persistence (docs/ask-session.md): every ask thread survives a restart
// in ~/.humanctl/asks/<sessionId>.jsonl (see lib/commands.ts appendAskLog),
// restored by the inbox.threads command. A probe still in flight when the
// window closes is recorded as {status:"interrupted"} rather than silently
// lost, so the inbox can render it with a retry affordance next launch.
// inFlightAsks tracks the (session id -> question) of every ask this process
// has started but not yet settled; app 'will-quit' sweeps it.
const inFlightAsks = new Map<string, { q: string; ts: string }>();
async function sessionAskPersisted(p: TargetParams & { question?: string }): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['id', 'path']);
  if (!t.ok) return t as unknown as Record<string, unknown>; // resolution failure: nothing to persist, nothing was in flight
  const sessionId = t.target.id as string | undefined;
  const question = String(t.target.question || '').trim();
  if (sessionId && question) inFlightAsks.set(sessionId, { q: question, ts: new Date().toISOString() });
  let res: Record<string, unknown>;
  try { res = await sessionAsk(p); }
  finally { if (sessionId) inFlightAsks.delete(sessionId); }
  if (sessionId && question && res && res.ok) {
    appendAskLog(sessionId, { q: question, a: res.answer, engine: res.engine, ts: new Date((res.at as number) || Date.now()).toISOString() });
  }
  return res;
}
function flushInFlightAsksAsInterrupted(): void {
  for (const [sessionId, entry] of inFlightAsks) {
    appendAskLog(sessionId, { status: 'interrupted', q: entry.q, ts: entry.ts });
  }
  inFlightAsks.clear();
}

// ask.answer: reply to a session's ask/needs-input thread. lib/commands.ts's
// answerAsk owns validation, the durable asks/<sessionId>.jsonl record, and
// the codex/claude delivery routing; this wraps it with the same target
// resolution sessionAsk uses and supplies the real Electron-side deps (state.json
// for the disclosure ack, the reader-service for the work-state check, and the
// actual spawns), so the two ask commands share one verified invocation shape.
// See docs/ask-session.md and lib/commands.ts's answerAsk header comment for
// the full per-channel contract (including the deliberate sandbox_mode=read-only
// pin and the absence of session.ask's model_reasoning_effort=low pin).
async function askAnswer(p: TargetParams & { text?: string; askId?: string }): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['id', 'path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  const deps: AskAnswerDeps = {
    askCodexAck: () => readState().askCodexAck === true,
    // Normalize the reader-service's {ok, need: {state, ...}} reply into the
    // flat {ok, state, error} shape AskAnswerDeps declares, so lib/commands.ts
    // (and its selftest) never needs to know reader-service's wire shape.
    needState: async (np) => {
      const r = await callReader('need-state', np);
      if (!r.ok) return { ok: false, error: r.error as string | undefined };
      const need = r.need as { state: string } | undefined;
      return { ok: true, state: need?.state };
    },
    deliverCodexReply: async ({ uuid, cwd, prompt }) => {
      const bin = await resolveCli('codex');
      if (!bin) return { ok: false, error: 'could not find the codex CLI on your PATH' };
      const env = Object.assign({}, process.env, { PATH: [path.dirname(bin), process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':') });
      delete (env as Record<string, string | undefined>).CLAUDE_CODE_ENTRYPOINT;
      delete (env as Record<string, string | undefined>).CLAUDECODE;
      const outFile = path.join(os.tmpdir(), `humanctl-reply-${Date.now()}-${process.pid}.txt`);
      const argv = codexReplyArgv(uuid, prompt, outFile);
      return new Promise<{ ok: boolean; error?: string }>((res) => {
        const cp = execFile(bin, argv, { timeout: ASK_TIMEOUT_MS, maxBuffer: 4 << 20, env, cwd },
          (err, _stdout, stderr) => {
            try { fs.unlinkSync(outFile); } catch { /* best effort */ }
            if (err) { res({ ok: false, error: String(stderr || err.message || 'reply delivery failed').slice(0, 300) }); return; }
            res({ ok: true });
          });
        try { cp.stdin!.end(); } catch { /* prompt is argv, not stdin */ }
      });
    },
    // Staged handoff for Claude Code (no live-injection channel exists):
    // copy the reply text to the clipboard, async, never on main synchronously.
    deliverClipboard: (text) => new Promise<{ ok: boolean; error?: string }>((res) => {
      const cp = execFile('pbcopy', [], { timeout: 5000 }, (err) => {
        res(err ? { ok: false, error: String(err.message || 'pbcopy failed') } : { ok: true });
      });
      try { cp.stdin!.end(text); } catch (e) { res({ ok: false, error: String((e as Error)?.message || e) }); }
    }),
  };
  const res = await answerAsk(arg, deps);
  // Staged delivery is two steps: the clipboard copy above, then reusing the
  // existing sessionResume flow (Terminal resume in the session cwd) so the
  // human can paste the reply in. A resume failure does not undo the
  // already-recorded/copied reply, so it is reported alongside ok:true rather
  // than turned into a whole-command failure.
  if (res.ok && res.delivery === 'staged') {
    const resumed = await sessionResume(arg);
    return Object.assign({}, res, { resumed: !!resumed.ok, resumeError: resumed.ok ? undefined : resumed.error });
  }
  return res;
}

// Open/resume the actual session in a Terminal window (hands it back to the human).
async function sessionResume(p: TargetParams): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['id', 'harness', 'cwd']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  const shq = (s: unknown) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const cwd = arg.cwd && fs.existsSync(arg.cwd) ? arg.cwd : os.homedir();
  let id = arg.id, cmd: string;
  if (arg.harness === 'codex') {
    const m = String(arg.id).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    id = m ? m[1] : arg.id;
    cmd = `codex resume ${shq(id)}`;
  } else {
    cmd = `claude --resume ${shq(id)}`;
  }
  const file = path.join(os.tmpdir(), `humanctl-resume-${Date.now()}.command`);
  fs.writeFileSync(file, `#!/bin/bash\ncd ${shq(cwd)} && exec ${cmd}\n`, { mode: 0o755 });
  execFile('open', [file], () => { setTimeout(() => fs.unlink(file, () => { /* best effort cleanup */ }), 8000); });
  return { ok: true, cmd };
}

// Open the session in the harness's own desktop app via its registered deep
// link (the same links the apps use themselves; both verified end to end):
//   Claude desktop  claude://resume?session=<uuid>   imports + opens the CLI session
//   Codex desktop   codex://threads/<thread-uuid>    opens that thread in the app
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
async function sessionOpenApp(p: TargetParams): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['id', 'harness']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  try {
    const m = String(arg.id).match(UUID_RE);
    if (!m) return { ok: false, error: 'no session uuid in this id' };
    const codex = arg.harness === 'codex';
    const url = codex ? `codex://threads/${m[1]}` : `claude://resume?session=${m[1]}`;
    // openExternal rejects when no app is registered for the scheme, so a
    // missing desktop app surfaces as a real error instead of a silent no-op.
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (err) {
    const appName = arg.harness === 'codex' ? 'Codex' : 'Claude';
    return { ok: false, error: `could not open the ${appName} desktop app: ${String((err as Error)?.message || err)}` };
  }
}

async function sessionReveal(p: TargetParams): Promise<Record<string, unknown>> {
  const t = await resolveTarget(p, ['path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  shell.showItemInFolder(t.target.path as string);
  return { ok: true, path: t.target.path };
}

// ---- the registry: every IPC channel and the control socket route through it ----
// Observations that touch a session transcript (sessions.list, session.detail,
// session.timeline, skills.aggregate, notes.list, inbox.threads, app.status)
// are explicitly overridden here to relay to the reader-service utilityProcess
// (callReader) instead of falling through to lib/commands.ts's DIRECT_HANDLERS,
// which call lib/sessions synchronously -- fine for the CLI (a one-shot
// process with no window to keep responsive) but exactly the main-process
// blocking this refactor exists to remove. Only the Electron-specific
// implementations (shell opens, process spawns, local UI state) are native to
// this file.
//
// sessions.list / app.status / notes.list / inbox.threads keep this callReader
// relay ONLY for the control-socket/CLI path now (e.g. `humanctl status`):
// every registered command must stay reachable that way (AGENTS.md's command
// registry rule). The renderer never calls these four through ipcMain anymore
// -- IPC_ROUTES below has no entry for them -- it talks to the reader-service
// directly over the port brokered above (electron/preload.ts), which is the
// actual perf fix (main no longer marshals the hot poll's ~200 rows + ~200
// threads on every call).
const eventLog = createEventLog();
const registry = createRegistry({
  log: eventLog,
  handlers: {
    'app.status': async (p) => {
      const r = await callReader('app.status', p || {});
      if (!r.ok) return r; // fail soft: an honest error, never a fabricated status
      return { ok: true, status: Object.assign(r.status as object, { version: APP_VERSION, apps: deepLinkApps() }) };
    },
    'app.harness-icons': async () => ({ ok: true, icons: await harnessIcons() }),
    'sessions.list': (p) => callReader('sessions.list', p || {}),
    'session.detail': (p) => callReader('session.detail', p || {}),
    'session.timeline': (p) => callReader('session.timeline', p || {}),
    'skills.aggregate': (p) => callReader('skills.aggregate', p || {}),
    'notes.list': (p) => callReader('notes.list', p || {}),
    'inbox.threads': (p) => callReader('inbox.threads', p || {}),
    // MUST be relayed, not run here. lib/commands.ts's `quota.claude` direct
    // handler spawns the `claude` CLI; left un-overridden, a control-socket
    // call (`humanctl app quota.claude` against the running app) would execute
    // that spawn -- and claude-quota's sync PATH probe -- on the MAIN process,
    // and would miss the reader-service's cache entirely. Relaying gives the
    // socket the same cached, off-main read the renderer gets.
    'quota.claude': () => callReader('quota.claude'),
    'session.summarize': (p) => sessionSummarize(p),
    'session.resume': (p) => sessionResume(p),
    'session.open-app': (p) => sessionOpenApp(p),
    'session.reveal': (p) => sessionReveal(p),
    'session.pin': (p, ctx) => pinSession(p.id, true, ctx),
    'session.unpin': (p, ctx) => pinSession(p.id, false, ctx),
    'app.open-external': (p) => {
      if (/^https?:\/\/|^linear:\/\//.test(p.url)) { shell.openExternal(p.url); return { ok: true }; }
      return { ok: false, error: 'blocked url' };
    },
    'app.open-path': (p) => { shell.openPath(p.path); return { ok: true }; },
    'app.state': () => ({ ok: true, state: readState() }),
    'app.set-state': (p, ctx) => applyStatePatch(p.patch, ctx),
    'app.set-view': (p, ctx) => applyStatePatch({ view: p.view }, ctx),
    'app.set-nav': (p, ctx) => applyStatePatch({ navPinned: !!p.pinned }, ctx),
    'app.set-cos-drawer': (p, ctx) => applyStatePatch({ rightRailOpen: !!p.open }, ctx),
    'app.set-theme': (p, ctx) => applyStatePatch({ theme: p.theme }, ctx),
    'app.set-engine': (p, ctx) => applyStatePatch({ summarizer: p.engine }, ctx),
    'inbox.mark-read': (p, ctx) => markThreadRead(p.threadId, p.at, ctx),
    'inbox.mark-all-read': (_p, ctx) => markAllThreadsRead(ctx),
    'session.ask': (p) => sessionAskPersisted(p),
    'ask.answer': (p) => askAnswer(p),
    'atlas.ask': (p) => atlasAsk(p),
  },
});

// IPC choke point: every channel is a thin adapter onto a registered command.
// The legacy channels that passed bare strings are wrapped into params objects
// here so the renderer needs no changes.
type IpcRoute = [string, string, ((arg: unknown) => Record<string, unknown>)?];
// sessions:list / status:get / notes:get / inbox:threads are deliberately
// ABSENT here (see the registry comment above): the renderer gets them
// straight from the reader-service over the direct port now, never through
// ipcMain, so main never marshals their (large, hot-polled) replies.
const IPC_ROUTES: IpcRoute[] = [
  ['app:commands', 'app.commands', () => ({})],
  ['harness:icons', 'app.harness-icons', () => ({})],
  ['pulse:pr-chip', 'pulse.pr-chip'],
  ['summary:budget', 'summary.budget', (arg) => (arg && typeof arg === 'object' ? arg as Record<string, unknown> : {})],
  ['sessions:read', 'session.detail'],
  ['sessions:timeline', 'session.timeline'],
  ['session:summarize', 'session.summarize'],
  ['session:ask', 'session.ask'],
  // ask.answer -> ask:answer, the same "dot becomes colon, same words"
  // channel-naming rule session:ask already follows for session.ask.
  ['ask:answer', 'ask.answer'],
  ['inbox:mark-read', 'inbox.mark-read'],
  ['inbox:mark-all-read', 'inbox.mark-all-read', () => ({})],
  ['atlas:ask', 'atlas.ask'],
  ['session:resume', 'session.resume'],
  ['session:open-app', 'session.open-app'],
  ['skills:aggregate', 'skills.aggregate'],
  ['sessions:reveal', 'session.reveal', (arg) => ({ path: typeof arg === 'string' ? arg : (arg as { path?: string })?.path || '' })],
  ['open:external', 'app.open-external', (arg) => ({ url: typeof arg === 'string' ? arg : '' })],
  ['open:path', 'app.open-path', (arg) => ({ path: typeof arg === 'string' ? arg : '' })],
  ['state:get', 'app.state', () => ({})],
  ['state:set', 'app.set-state', (arg) => ({ patch: arg && typeof arg === 'object' ? arg : {} })],
  ['view:set', 'app.set-view', (arg) => ({ view: (arg as { view?: string })?.view || '' })],
  ['nav:set', 'app.set-nav', (arg) => ({ pinned: !!(arg as { pinned?: boolean })?.pinned })],
  ['cos-drawer:set', 'app.set-cos-drawer', (arg) => ({ open: !!(arg as { open?: boolean })?.open })],
];
for (const [channel, name, map] of IPC_ROUTES) {
  ipcMain.handle(channel, (_e, arg) => registry.invoke(name, map ? map(arg) : (arg || {}), { source: 'ipc' }));
}
// Atlas thread restore is a plain file read (not a mutation, not a
// cross-session observation over lib/ the registry table is meant for), so
// it stays a direct IPC read the same way session:hot does; the exchange
// itself is logged via the atlas.ask registry command above.
ipcMain.handle('atlas:get-log', () => ({ ok: true, log: readAtlasLog(200) }));

// Note-image thumbnails: a plain, sandboxed file read (not a mutation, not a
// cross-session observation), the same direct-IPC-read pattern as
// atlas:get-log above. Reads ONLY from attachmentsDir() -- resolved and
// path.relative-checked so a crafted filename can never escape that one
// directory -- and returns a data URL so the renderer never needs a raw
// file:// path (which would need webSecurity changes to load in a
// contextIsolation:true window). A note's own attachments array is the only
// source of filenames the renderer ever passes here.
ipcMain.handle('note:get-image', (_e, filename: string) => {
  try {
    const dir = attachmentsDir();
    const name = path.basename(String(filename || ''));
    const full = path.join(dir, name);
    if (path.relative(dir, full).startsWith('..')) return { ok: false, error: 'invalid attachment path' };
    const buf = fs.readFileSync(full);
    const ext = path.extname(name).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { ok: true, dataUrl: `data:image/${mime};base64,${buf.toString('base64')}` };
  } catch (err) { return { ok: false, error: String((err as Error)?.message || err) }; }
});
// Clicking a note-image thumbnail opens the full image in the OS default
// viewer via the ALREADY-REGISTERED app.open-path command (the command
// registry invariant: every action is one declared command, never a second
// bespoke IPC channel for the same kind of action). This handler only
// resolves a bare attachment filename to its real path within
// attachmentsDir(), so the renderer never needs (or can forge) a raw
// filesystem path; app.open-path's own handler does the actual shell.openPath.
ipcMain.handle('note:resolve-attachment', (_e, filename: string) => {
  try {
    const dir = attachmentsDir();
    const name = path.basename(String(filename || ''));
    const full = path.join(dir, name);
    if (path.relative(dir, full).startsWith('..') || !fs.existsSync(full)) return { ok: false, error: 'attachment not found' };
    return { ok: true, path: full };
  } catch (err) { return { ok: false, error: String((err as Error)?.message || err) }; }
});

// ---- control socket: the same registry, drivable from the CLI ----
// Local-trust model (docs/commands.md): a 0600 unix socket under $HOME; any
// process running as your uid can drive the app. No TCP, no network exposure
// ever. Skipped under HUMANCTL_SMOKE so a CI-style boot cannot steal (and then
// delete) a running app's socket.
let controlServer: ReturnType<typeof createControlServer> | null = null;
function startControlServer(): void {
  if (process.env.HUMANCTL_SMOKE) return;
  controlServer = createControlServer({
    registry,
    onError: (err) => console.error(`humanctl: control socket error: ${String((err as Error)?.message || err)}`),
  });
  controlServer.listen(() => console.log(`humanctl: control socket at ${controlServer!.socketPath}`));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(nativeImage.createFromPath(ICON_PATH)); } catch { /* icon is cosmetic */ } }
  // Spawn the reader-service before the window loads content: utilityProcess
  // can only be forked after 'ready' (Electron docs), and starting it first
  // gives it a head start warming its own fs.watch + first scan while the
  // renderer boots, so the first sessions:list poll is more likely to land
  // after 'spawn' rather than racing it (callReader() fails soft either way).
  spawnReader();
  createWindow();
  startControlServer();
  // PERF GATE INSTRUMENTATION (test-only, gated by HUMANCTL_PERF_EVENTLOOP;
  // never runs in the real app). Window-drag jank IS main-process event-loop
  // blocking, which cold-open/click-to-paint on empty fixtures cannot see.
  // This measures THIS (main) process's event-loop delay and logs the tail
  // percentiles to stderr every 2s so scripts/perf-selftest/run.js can assert
  // p99 stays under budget on a realistic-scale synthetic fleet. The interval
  // is flag-gated and unref'd; it does not exist in production.
  //
  // `resolution` is the histogram's OWN resampling interval, not a "only
  // report blocking coarser than this" knob -- on this Node/libuv build a
  // completely idle process's p50/p99/max all sit within ~1.3ms of
  // `resolution` itself (verified: resolution 20 -> ~21ms floor, 10 -> ~11ms,
  // 2 -> ~2.3ms, scaling almost exactly with the parameter, even with ZERO
  // application work on the loop). The gate's budget is 16.7ms (one 60fps
  // frame); a resolution of 20 made the histogram's own floor exceed that
  // budget before main did a single thing, so the gate could never pass
  // regardless of how little real work main did. 2ms leaves ~14ms of
  // headroom under budget for the noise floor while still clearly surfacing
  // real blocking (verified: an artificial 40ms main-thread stall at this
  // resolution shows up in `max` immediately, p50/p99 unaffected by the idle
  // floor).
  //
  // `max` is CUMULATIVE: the histogram never forgets its worst sample, so a
  // stall during window creation would keep pinning `max` for the rest of the
  // run and no amount of "ignore the first N samples" in the gate can remove
  // it. To make "steady state" mean something, the histogram is RESET exactly
  // once, at `did-finish-load`: the UI is up from that instant on, so every
  // stall after it is one the user can feel (this deliberately still includes
  // the harness-icon cold path, which runs when the renderer first asks for
  // icons -- that stall is real, and on a first launch it lands while the user
  // is reaching for the window).
  // Gate self-check (`npm run perf:eventloop:selfcheck`): deliberately block
  // main on a timer so the gate has a known-bad process to catch. A gate that
  // has never been observed to FAIL is decoration, and this one shipped once
  // already while asserting a statistic (p99) that is mathematically blind to
  // individual stalls. Env-gated, off in every real run.
  if (process.env.HUMANCTL_PERF_INJECT_STALL) {
    const stallMs = Number(process.env.HUMANCTL_PERF_INJECT_STALL) || 40;
    const stallTimer = setInterval(() => {
      const end = Date.now() + stallMs;
      while (Date.now() < end) { /* deliberately block the event loop */ }
    }, 3000);
    stallTimer.unref();
  }
  if (process.env.HUMANCTL_PERF_EVENTLOOP) {
    const eld = monitorEventLoopDelay({ resolution: 2 });
    eld.enable();
    const ms = (ns: number): number => ns / 1e6;
    perfEldReset = () => {
      eld.reset();
      console.error('humanctl: eventloop reset (UI loaded; steady state begins)');
    };
    // Reset after every print, so each line is the worst stall WITHIN that 2s
    // window instead of a running high-water mark. A recurring stall (a poll
    // blocking main) then appears in most windows; a one-off (the icon cold
    // path, or an unrelated process preempting us) appears in exactly one.
    // Without this, one bad window pins `max` for the whole run and the report
    // cannot tell you whether the problem recurs.
    let win = 0;
    const timer = setInterval(() => {
      console.error(
        `humanctl: eventloop p50=${ms(eld.percentile(50)).toFixed(1)}ms ` +
        `p99=${ms(eld.percentile(99)).toFixed(1)}ms max=${ms(eld.max).toFixed(1)}ms win=${win++}`,
      );
      eld.reset();
    }, 2000);
    timer.unref();
  }
});
app.on('will-quit', () => {
  flushInFlightAsksAsInterrupted();
  if (controlServer) { try { controlServer.close(); } catch { /* best effort */ } }
  // Electron tears down utilityProcess children with the app, but kill it
  // explicitly so a repeated dev-loop run never leaves an orphaned
  // reader-service holding its fs.watch handles open.
  readerBreakerOpen = true; // stop any pending respawn timer from re-forking during shutdown
  if (reader) { try { reader.kill(); } catch { /* best effort */ } }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
