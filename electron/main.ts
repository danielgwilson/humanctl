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

import { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage } from 'electron';
import path from 'path';
// This compiled file lives at dist/electron/main.js (see tsup.config.ts), two
// directories below the packaged app root; electron-builder's `files` config
// packages electron/renderer/**/*, electron/assets/**/*, and dist/electron/**/*
// each preserving their project-relative path, so the renderer and the app
// icon are found relative to APP_ROOT (the app root), never __dirname (which
// is dist/electron/, not electron/).
const APP_ROOT = path.join(__dirname, '..', '..');
const ICON_PATH = path.join(APP_ROOT, 'electron', 'assets', 'icon.png');
let APP_VERSION = '0.0.0';
try { APP_VERSION = require('../package.json').version; } catch { /* fall back to 0.0.0 */ }
import fs from 'fs';
import os from 'os';
import { execFile, execFileSync } from 'child_process';
import {
  listRecent, readBlocks, readUsage, readDetail, aggregateSkills, accountStatus, readNotes,
  readNeedSignals, deriveNeedState, readAppended, primeTailCursor, HARNESSES, BTW_SENTINEL,
  type Harness, type SessionRow,
} from '../lib/sessions';
import {
  createRegistry, createEventLog, createControlServer, resolveSessionRow, inboxThreads,
  appendAskLog, isInboxRelevantChange, attachmentsDir, type RegistryInvokeCtx,
} from '../lib/commands';
import { resolveHarnessIconPath, cachedIconPath } from '../lib/harness-icons';

let win: BrowserWindow | null = null;

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
      sandbox: false,
    },
  });
  win.loadFile(path.join(APP_ROOT, 'electron', 'renderer', 'index.html'));

  win.once('ready-to-show', () => { win!.show(); win!.focus(); });

  win.webContents.once('did-finish-load', () => {
    console.log('humanctl: window loaded');
    watchSessions();
    if (process.env.HUMANCTL_SMOKE) {
      let n = -1;
      try { n = listRecent({ maxAgeH: 72, limit: 40 }).length; } catch { /* smoke count is advisory */ }
      console.log(`HUMANCTL_SMOKE ok: ${n} sessions`);
      app.quit();
    }
  });
}

// ---- realtime: watch the session dirs, debounce, tell the renderer to refresh ----
// Three speeds now. LIST refreshes (harness transcript dirs) stay behind the
// 2.5s trailing debounce (a fleet of active agents writes constantly; the
// scan is mtime-cached but not free). The HOT session, the one open in the
// dossier, skips the debounce: its fs events run a cursor-based incremental
// read of only the appended bytes and push the new events straight to the
// renderer, so a message landing in the watched transcript appears in the
// open dossier in well under 2 seconds. ~/.humanctl itself (notes.jsonl +
// asks/) gets its own fast path: those are tiny appends, high-signal (a
// posted note or a persisted ask answer), and cheap to react to, so they skip
// the 2.5s list debounce entirely and push a dedicated inbox-refresh event on
// a short coalesce window instead of waiting on the general list ping.
let watchTimer: NodeJS.Timeout | null = null;
const watchers: fs.FSWatcher[] = [];
let hotPath: string | null = null, hotHarness: Harness | string | null = null, hotTimer: NodeJS.Timeout | null = null;
const HOT_COALESCE_MS = 120;
let inboxTimer: NodeJS.Timeout | null = null;
const INBOX_COALESCE_MS = 200;

function pumpHot(): void {
  hotTimer = null;
  if (!hotPath || !win || win.isDestroyed()) return;
  const t0 = Date.now();
  let res;
  try { res = readAppended(hotPath, { harness: hotHarness || undefined }); } catch { return; }
  if (res.reset) {
    // rotation / truncation / oversized gap: tell the renderer to re-read a
    // full page rather than splicing across a rewrite.
    win.webContents.send('session:append', { path: hotPath, reset: true, reason: res.reason });
    return;
  }
  if (!res.events || (!res.events.length && !res.meta)) return;
  // Re-derive the state through the existing needs-you v3 logic (bounded tail
  // read, keyed by mtime+size, so this is the same classifier the list uses).
  let need = null;
  try {
    const st = fs.statSync(hotPath);
    need = deriveNeedState(readNeedSignals(hotPath, hotHarness as string, st), st, Date.now());
  } catch { /* advisory; the debounced list refresh will still catch up */ }
  // epoch stamp makes append-to-render latency measurable from stdout
  console.log(`humanctl: hot append ${res.events.length} events (read ${Date.now() - t0}ms) at ${Date.now()}`);
  win.webContents.send('session:append', {
    path: hotPath, events: res.events, meta: res.meta, need, end: res.end, size: res.size, at: Date.now(),
  });
}
function scheduleHot(): void {
  if (hotTimer) return;
  hotTimer = setTimeout(pumpHot, HOT_COALESCE_MS);
}

function pumpInbox(): void {
  inboxTimer = null;
  if (win && !win.isDestroyed()) win.webContents.send('inbox:fast');
}
function scheduleInbox(): void {
  if (inboxTimer) return;
  inboxTimer = setTimeout(pumpInbox, INBOX_COALESCE_MS);
}

function watchSessions(): void {
  // Trailing debounce: active agents write constantly, so coalesce a burst of
  // fs events into one refresh. 2.5s keeps the UI live without pinning the main
  // thread on the (now mtime-cached) session scan.
  const ping = () => { if (watchTimer) clearTimeout(watchTimer); watchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('sessions:changed'); }, 2500); };
  const harnessDirs = HARNESSES.map((h) => h.dir);
  for (const dir of harnessDirs) {
    try {
      // macOS recursive fs.watch (FSEvents) reports files in subdirectories
      // created after the watch attached (verified: fresh Codex date dirs
      // surface as "2026/07/04/rollout-x.jsonl"), so both roots stay covered
      // without re-attaching. filename can be null on some platforms; treat
      // that as "maybe the hot file" (the pump stat-guards for free).
      const w = fs.watch(dir, { recursive: true }, (_ev, fn) => {
        ping();
        if (hotPath && (!fn || path.join(dir, String(fn)) === hotPath)) scheduleHot();
      });
      w.on('error', () => { /* a watched dir vanishing must not crash the process */ });
      watchers.push(w);
    } catch { /* dir may not exist; ignore */ }
  }
  // ensure the inbox dir exists so its watcher attaches even before the first note
  const inboxDir = path.join(os.homedir(), '.humanctl');
  try { fs.mkdirSync(inboxDir, { recursive: true }); } catch { /* best effort */ }
  try {
    // notes.jsonl and asks/*.jsonl are small append-only writes; a short
    // coalesce here (INBOX_COALESCE_MS) is cheap because the consumer side
    // (inbox.threads) is itself mtime-cached (lib/sessions.ts's baseScan has
    // a 1.5s TTL), so firing this more often than the list debounce does not
    // add a second full session scan on every keystroke of a note.
    //
    // ~/.humanctl also holds the registry's OWN outputs (events.jsonl and its
    // events.1.jsonl rotation today, more over time). Without a filter, every
    // registered command's event-log append is itself a write inside this
    // watched dir, which re-fires this callback, which schedules the very
    // inbox refresh that just invoked more commands -- a closed, self-
    // sustaining loop with no natural damping beyond the coalesce window.
    // isInboxRelevantChange allowlists the two inputs the Inbox actually
    // reads (notes.jsonl, asks/*.jsonl) so anything else under ~/.humanctl,
    // present today or added later, is ignored here by construction.
    const w = fs.watch(inboxDir, { recursive: true }, (_ev, fn) => {
      if (!isInboxRelevantChange(fn)) return;
      ping();
      scheduleInbox();
    });
    w.on('error', () => { /* a watched dir vanishing must not crash the process */ });
    watchers.push(w);
  } catch { /* dir may not exist; ignore */ }
}

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
const ICON_SIZE = 40; // CSS px; @2x handled by nativeImage's own scale factors
const iconCache = new Map<string, string | null>(); // harness -> data URL | null, populated once per app run
function extractHarnessIcon(harness: string): string | null {
  if (iconCache.has(harness)) return iconCache.get(harness) ?? null;
  let dataUrl: string | null = null;
  try {
    const userDataDir = app.getPath('userData');
    const cachePath = cachedIconPath(userDataDir, harness);
    // Reuse a prior run's cached PNG when present; still re-derive from the
    // source .icns if the cache is missing (first run, or userData was
    // cleared), never from the repo or a watched dir either way.
    if (fs.existsSync(cachePath)) {
      const buf = fs.readFileSync(cachePath);
      if (buf && buf.length) dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    }
    if (!dataUrl) {
      const resolved = resolveHarnessIconPath(harness);
      if (resolved.ok) {
        const img = nativeImage.createFromPath(resolved.path);
        if (img && !img.isEmpty()) {
          const resized = img.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' });
          const png = resized.toPNG();
          if (png && png.length) {
            try { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); fs.writeFileSync(cachePath, png); } catch { /* cache is best-effort; still return the data URL below */ }
            dataUrl = `data:image/png;base64,${png.toString('base64')}`;
          }
        }
      }
    }
  } catch { dataUrl = null; } // any failure at all: silent fallback to the glyph
  iconCache.set(harness, dataUrl);
  return dataUrl;
}
function harnessIcons(): { 'claude-code': string | null; codex: string | null } {
  return { 'claude-code': extractHarnessIcon('claude-code'), codex: extractHarnessIcon('codex') };
}
// The renderer names the session open in the dossier; only that file gets the
// immediate append pump. `from` seeds the cursor at the page's line-aligned
// end so nothing between the page read and this call is lost. Purely an
// in-memory watch pointer (which file the hot-append pump follows): it
// mutates no durable state and spawns nothing, so it stays outside the
// command registry as renderer-adjacent ephemera, same as scroll position.
ipcMain.handle('session:hot', (_e, arg: { path?: string; harness?: string; from?: number } | undefined) => {
  try {
    hotPath = arg && arg.path ? String(arg.path) : null;
    hotHarness = (arg && arg.harness) || null;
    if (hotPath) {
      primeTailCursor(hotPath, arg && typeof arg.from === 'number' ? arg.from : undefined);
      // pump once right away: on reselection this catches up anything appended
      // while the session was not hot, without waiting for its next fs event.
      scheduleHot();
    }
    return { ok: true };
  } catch (err) { return { ok: false, error: String((err as Error)?.message || err) }; }
});

// A Dock/Finder-launched app inherits a minimal PATH (/usr/bin:/bin:...), not the
// user's shell PATH, so bare `claude` / `codex` are not found. Resolve the real
// absolute path via the login shell (which sources the user's rc), cached, with a
// dir scan as a fallback. This is why summaries failed only in the packaged app.
const cliCache = new Map<string, string | null>();
function resolveCli(name: string): string | null {
  if (cliCache.has(name)) return cliCache.get(name) ?? null;
  let bin: string | null = null;
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shell, ['-ilc', `command -v ${name} 2>/dev/null`], { timeout: 6000, encoding: 'utf8' });
    const line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop();
    if (line && path.isAbsolute(line) && fs.existsSync(line)) bin = line;
  } catch { /* fall through to dir scan */ }
  if (!bin) {
    const home = os.homedir();
    const cands = [`${home}/.local/bin/${name}`, `${home}/.bun/bin/${name}`, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `${home}/.npm-global/bin/${name}`];
    bin = cands.find((c) => { try { return fs.existsSync(c); } catch { return false; } }) || null;
  }
  cliCache.set(name, bin);
  return bin;
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
function resolveTarget(p: TargetParams, need: string[]): ResolveTargetResult {
  const have = (k: string) => p[k] !== undefined && p[k] !== null && p[k] !== '';
  if (need.every(have)) return { ok: true, target: p };
  if (!have('id') && !have('path')) return { ok: false, error: 'no session id or path' };
  const r = resolveSessionRow((p.id || p.path) as string);
  if (!r.ok || !r.row) return { ok: false, error: r.error, ambiguous: r.ambiguous };
  return { ok: true, target: Object.assign({}, p, { id: r.row.id, path: r.row.path, harness: r.row.harness, cwd: p.cwd || r.row.cwd }) };
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
function pinSession(id: string, on: boolean, ctx?: RegistryInvokeCtx): Record<string, unknown> {
  const r = resolveSessionRow(id);
  if (!r.ok || !r.row) return { ok: false, error: r.error, ambiguous: r.ambiguous }; // pinning an id that matches nothing would be a silent no-op lie
  const s = readState();
  const pins = new Set(Array.isArray(s.pins) ? s.pins : []);
  if (on) pins.add(r.row.id); else pins.delete(r.row.id);
  const res = applyStatePatch({ pins: [...pins] }, ctx);
  if (!res.ok) return res;
  return { ok: true, id: r.row.id, pinned: on, pins: res.state.pins };
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
function markAllThreadsRead(ctx?: RegistryInvokeCtx): Record<string, unknown> {
  const now = Date.now();
  const threads = inboxThreads({});
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
// runAutoSummaries in renderer.js) rather than the manual "Generate/Refresh AI
// summary" button. Auto calls are budget-gated (dailyBudgetUSD, default from
// summary-budget.ts, configurable via app.set-state's summaryBudgetUSD) and,
// on a persistent 401 (retried once already below), SKIP silently rather than
// surfacing an error toast -- a skip must never count against the budget
// (nothing was spent) and must never blank out an existing stale summary (the
// caller keeps showing the old one with its age label).
async function sessionSummarize(p: TargetParams & { engine?: string; auto?: boolean }): Promise<Record<string, unknown>> {
  const t = resolveTarget(p, ['path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  const engine = arg.engine === 'codex' ? 'codex' : 'claude';
  const st = fs.statSync(arg.path as string);
  const key = `${engine}:${arg.path}:${st.mtimeMs}`;
  if (summaryCache.has(key)) return { ok: true, summary: summaryCache.get(key), cached: true, engine };
  const bin = resolveCli(engine);
  if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
  const d = readDetail(arg.path as string, arg.harness as string) || ({} as { lastExchange?: { lastUser?: string } });
  const ex = d.lastExchange || {};
  const tail = (readBlocks(arg.path as string, { harness: arg.harness }).blocks || []).slice(-16).map((b) => `[${b.kind}] ${b.preview}`).join('\n');
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
function atlasContext(): { rows: Record<string, unknown>[]; notes: Record<string, unknown>[] } {
  const rows = listRecent({ maxAgeH: 24 * 30, limit: 200, withUsage: false })
    .filter((r) => r.tier !== 'archived')
    .slice(0, ATLAS_TOP_N)
    .map((r: SessionRow) => ({ id: r.id.slice(0, 12), repo: r.repo, harness: r.harness, state: r.state, reason: r.stateReason, age: r.age }));
  const notes = readNotes({ limit: 20 }).map((n) => ({ level: n.level, message: n.message, repo: n.repo, session: n.session ? n.session.slice(0, 12) : '', ts: n.ts }));
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
  const bin = resolveCli(engine);
  if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
  const { runPulse } = require('../lib/pulse') as typeof import('../lib/pulse');
  let pulseSummary = '(pulse unavailable)';
  try {
    let out = '';
    const code = await runPulse({ json: false }, { out: (s: string) => { out += `${s}\n`; }, err: () => { /* Atlas still answers from notes + session states alone */ } });
    if (code === 0 && out.trim()) pulseSummary = out.trim().slice(0, 4000);
  } catch { /* Atlas still answers from notes + session states alone */ }
  const ctx = atlasContext();
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
  const t = resolveTarget(p, ['id', 'path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  const arg = t.target;
  const question = String(arg.question || '').trim();
  if (!question) return { ok: false, error: 'no question' };
  const codex = arg.harness === 'codex';
  const engine = codex ? 'codex' : 'claude';
  const bin = resolveCli(engine);
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
    let st: fs.Stats | null = null; try { st = fs.statSync(arg.path as string); } catch { /* stat is advisory */ }
    const need = deriveNeedState(readNeedSignals(arg.path as string, arg.harness as string, st || undefined), st, Date.now());
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
  const t = resolveTarget(p, ['id', 'path']);
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

// Open/resume the actual session in a Terminal window (hands it back to the human).
function sessionResume(p: TargetParams): Record<string, unknown> {
  const t = resolveTarget(p, ['id', 'harness', 'cwd']);
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
  const t = resolveTarget(p, ['id', 'harness']);
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

function sessionReveal(p: TargetParams): Record<string, unknown> {
  const t = resolveTarget(p, ['path']);
  if (!t.ok) return t as unknown as Record<string, unknown>;
  shell.showItemInFolder(t.target.path as string);
  return { ok: true, path: t.target.path };
}

// ---- the registry: every IPC channel and the control socket route through it ----
// Observations implemented purely over lib/ (sessions.list, notes.list,
// pulse.run, ...) come from the registry's built-in direct handlers; only the
// Electron-specific implementations are injected here.
const eventLog = createEventLog();
const registry = createRegistry({
  log: eventLog,
  handlers: {
    'app.status': (p) => ({ ok: true, status: Object.assign(accountStatus(p || {}), { version: APP_VERSION, apps: deepLinkApps() }) }),
    'app.harness-icons': () => ({ ok: true, icons: harnessIcons() }),
    'session.detail': (p) => {
      // Same result shape the renderer has always consumed from sessions:read.
      const t = resolveTarget(p, ['path']);
      if (!t.ok) return t as unknown as Record<string, unknown>;
      const detail = readDetail ? readDetail(t.target.path as string, t.target.harness as string) : null;
      return { ok: true, data: readBlocks(t.target.path as string, { harness: t.target.harness }), usage: readUsage(t.target.path as string, t.target.harness as string), detail };
    },
    'skills.aggregate': (p) => ({ ok: true, agg: aggregateSkills(p || {}) }),
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
    'atlas.ask': (p) => atlasAsk(p),
  },
});

// IPC choke point: every channel is a thin adapter onto a registered command.
// The legacy channels that passed bare strings are wrapped into params objects
// here so the renderer needs no changes.
type IpcRoute = [string, string, ((arg: unknown) => Record<string, unknown>)?];
const IPC_ROUTES: IpcRoute[] = [
  ['app:commands', 'app.commands', () => ({})],
  ['sessions:list', 'sessions.list'],
  ['status:get', 'app.status'],
  ['harness:icons', 'app.harness-icons', () => ({})],
  ['pulse:pr-chip', 'pulse.pr-chip'],
  ['summary:budget', 'summary.budget', (arg) => (arg && typeof arg === 'object' ? arg as Record<string, unknown> : {})],
  ['sessions:read', 'session.detail'],
  ['sessions:timeline', 'session.timeline'],
  ['session:summarize', 'session.summarize'],
  ['session:ask', 'session.ask'],
  ['notes:get', 'notes.list'],
  ['inbox:threads', 'inbox.threads'],
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
  createWindow();
  startControlServer();
});
app.on('will-quit', () => {
  flushInFlightAsksAsInterrupted();
  if (controlServer) { try { controlServer.close(); } catch { /* best effort */ } }
});
app.on('window-all-closed', () => { for (const w of watchers) { try { w.close(); } catch { /* best effort */ } } if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
