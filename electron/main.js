'use strict';

// humanctl desktop (Electron) main process.
// Local-first, read-only over agent session transcripts. No network egress.
// It writes local UI state (pins, theme) under userData; the one deliberate
// exception to transcript read-only is the opt-in Codex "ask the session"
// path, which appends a sentinel-marked question into the thread through the
// user's own codex CLI (disclosed in the UI, acknowledged once, persisted).

const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
let APP_VERSION = '0.0.0';
try { APP_VERSION = require('../package.json').version; } catch {}
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { listRecent, readBlocks, readUsage, readDetail, aggregateSkills, accountStatus, readNotes, readNeedSignals, deriveNeedState, readTimelinePage, readAppended, primeTailCursor, HARNESSES, BTW_SENTINEL } = require('../lib/sessions');

let win = null;

// ---- local UI state (pins + theme), persisted under userData, never the repo ----
function statePath() { return path.join(app.getPath('userData'), 'state.json'); }
function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return { pins: [], theme: 'system' }; }
}
function writeState(next) {
  try { fs.writeFileSync(statePath(), JSON.stringify(next, null, 2)); return true; } catch { return false; }
}

function createWindow() {
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => { win.show(); win.focus(); });

  win.webContents.once('did-finish-load', () => {
    console.log('humanctl: window loaded');
    watchSessions();
    if (process.env.HUMANCTL_SMOKE) {
      let n = -1;
      try { n = listRecent({ maxAgeH: 72, limit: 40 }).length; } catch {}
      console.log(`HUMANCTL_SMOKE ok: ${n} sessions`);
      app.quit();
    }
  });
}

// ---- realtime: watch the session dirs, debounce, tell the renderer to refresh ----
// Two speeds. LIST refreshes stay behind the 2.5s trailing debounce (a fleet of
// active agents writes constantly; the scan is mtime-cached but not free). The
// HOT session, the one open in the dossier, skips the debounce: its fs events
// run a cursor-based incremental read of only the appended bytes and push the
// new events straight to the renderer, so a message landing in the watched
// transcript appears in the open dossier in well under 2 seconds.
let watchTimer = null;
const watchers = [];
let hotPath = null, hotHarness = null, hotTimer = null;
const HOT_COALESCE_MS = 120;

function pumpHot() {
  hotTimer = null;
  if (!hotPath || !win || win.isDestroyed()) return;
  const t0 = Date.now();
  let res;
  try { res = readAppended(hotPath, { harness: hotHarness }); } catch { return; }
  if (res.reset) {
    // rotation / truncation / oversized gap: tell the renderer to re-read a
    // full page rather than splicing across a rewrite.
    win.webContents.send('session:append', { path: hotPath, reset: true, reason: res.reason });
    return;
  }
  if (!res.events.length && !res.meta) return;
  // Re-derive the state through the existing needs-you v3 logic (bounded tail
  // read, keyed by mtime+size, so this is the same classifier the list uses).
  let need = null;
  try {
    const st = fs.statSync(hotPath);
    need = deriveNeedState(readNeedSignals(hotPath, hotHarness, st), st, Date.now());
  } catch { /* advisory; the debounced list refresh will still catch up */ }
  // epoch stamp makes append-to-render latency measurable from stdout
  console.log(`humanctl: hot append ${res.events.length} events (read ${Date.now() - t0}ms) at ${Date.now()}`);
  win.webContents.send('session:append', {
    path: hotPath, events: res.events, meta: res.meta, need, end: res.end, size: res.size, at: Date.now(),
  });
}
function scheduleHot() {
  if (hotTimer) return;
  hotTimer = setTimeout(pumpHot, HOT_COALESCE_MS);
}

function watchSessions() {
  // Trailing debounce: active agents write constantly, so coalesce a burst of
  // fs events into one refresh. 2.5s keeps the UI live without pinning the main
  // thread on the (now mtime-cached) session scan.
  const ping = () => { clearTimeout(watchTimer); watchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('sessions:changed'); }, 2500); };
  // ensure the inbox dir exists so its watcher attaches even before the first note
  try { fs.mkdirSync(path.join(os.homedir(), '.humanctl'), { recursive: true }); } catch {}
  const dirs = [...HARNESSES.map((h) => h.dir), path.join(os.homedir(), '.humanctl')];
  for (const dir of dirs) {
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
      w.on('error', () => {}); // a watched dir vanishing must not crash the process
      watchers.push(w);
    } catch { /* dir may not exist; ignore */ }
  }
}

// ---- read-only IPC ----
ipcMain.handle('sessions:list', (_e, opts) => {
  try { return { ok: true, rows: listRecent(opts || {}) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
// Honest capability probe: ask the OS which app (if any) handles each harness
// deep link scheme. The renderer only offers "open in app" when a real handler
// is registered, so the button can never be a fictional action.
function deepLinkApps() {
  try {
    return {
      claude: !!app.getApplicationNameForProtocol('claude://'),
      codex: !!app.getApplicationNameForProtocol('codex://'),
    };
  } catch { return { claude: false, codex: false }; }
}
ipcMain.handle('status:get', (_e, opts) => {
  try { return { ok: true, status: Object.assign(accountStatus(opts || {}), { version: APP_VERSION, apps: deepLinkApps() }) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('sessions:read', (_e, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    const detail = readDetail ? readDetail(arg.path, arg.harness) : null;
    return { ok: true, data: readBlocks(arg.path, { harness: arg.harness }), usage: readUsage(arg.path, arg.harness), detail };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
// Timeline pages: substantive-event-budgeted backward slices of the transcript
// with explicit [start, end) coverage. `before` (a previous page's `start`)
// walks further back; the renderer renders every cut as a visible element.
ipcMain.handle('sessions:timeline', (_e, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    const page = readTimelinePage(arg.path, { harness: arg.harness, before: arg.before });
    return page ? { ok: true, page } : { ok: false, error: 'could not read this session' };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
// The renderer names the session open in the dossier; only that file gets the
// immediate append pump. `from` seeds the cursor at the page's line-aligned
// end so nothing between the page read and this call is lost.
ipcMain.handle('session:hot', (_e, arg) => {
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
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
// A Dock/Finder-launched app inherits a minimal PATH (/usr/bin:/bin:...), not the
// user's shell PATH, so bare `claude` / `codex` are not found. Resolve the real
// absolute path via the login shell (which sources the user's rc), cached, with a
// dir scan as a fallback. This is why summaries failed only in the packaged app.
const cliCache = new Map();
function resolveCli(name) {
  if (cliCache.has(name)) return cliCache.get(name);
  let bin = null;
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

// Opt-in only: summarize a session's recent activity via the user's chosen local
// CLI (Claude Code `claude -p`, or Codex `codex exec`). This is the one action
// that sends data off the machine (to the model, through the user's own CLI auth),
// so the renderer labels it explicitly. Cached by engine + mtime.
const summaryCache = new Map();
const SUMMARIZE_PROMPT = (ex, tail) => `Summarize the recent tail of an autonomous coding-agent session for an operator dashboard. In 1-2 plain sentences say what the agent is currently working on and its immediate next step. Be concrete and terse, no preamble. Respond directly with the summary only; do not use any tools.\n\nLatest user instruction: ${ex.lastUser || '(none)'}\n\nRecent blocks:\n${tail}`;
ipcMain.handle('session:summarize', async (_e, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    const engine = arg.engine === 'codex' ? 'codex' : 'claude';
    const st = fs.statSync(arg.path);
    const key = `${engine}:${arg.path}:${st.mtimeMs}`;
    if (summaryCache.has(key)) return { ok: true, summary: summaryCache.get(key), cached: true, engine };
    const bin = resolveCli(engine);
    if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
    const d = readDetail(arg.path, arg.harness) || {};
    const ex = d.lastExchange || {};
    const tail = (readBlocks(arg.path, { harness: arg.harness }).blocks || []).slice(-16).map((b) => `[${b.kind}] ${b.preview}`).join('\n');
    const prompt = SUMMARIZE_PROMPT(ex, tail);
    const env = Object.assign({}, process.env, { PATH: [path.dirname(bin), process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':') });
    let out;
    if (engine === 'codex') {
      // `codex exec` is an agent; keep it read-only, out-of-repo, and ephemeral so
      // it does no work and leaves no session file, and read the clean final
      // message from --output-last-message rather than parsing the event stream.
      const outFile = path.join(os.tmpdir(), `humanctl-sum-${Date.now()}-${Math.round(st.mtimeMs)}.txt`);
      out = await new Promise((res, rej) => {
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
        try { cp.stdin.end(prompt); } catch (e) { rej(e); }
      });
    } else {
      const runClaude = () => new Promise((res, rej) => {
        const cp = execFile(bin, ['-p', '--model', 'claude-haiku-4-5', '--allowed-tools', ''], { timeout: 60000, maxBuffer: 1 << 20, env },
          (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'summarize failed').slice(0, 300))) : res(String(stdout).trim()));
        try { cp.stdin.end(prompt); } catch (e) { rej(e); }
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
      }
    }
    const summary = out.slice(0, 600);
    if (!summary) return { ok: false, error: `the ${engine} CLI returned no output`, engine };
    // Both CLIs print auth failures to stdout and exit 0, so guard against
    // surfacing "Not logged in" as if it were a real summary.
    if (/\b(not logged in|please run \/login|invalid authentication credentials|invalid api key|not authenticated)\b/i.test(summary)) {
      return { ok: false, error: `${engine} CLI is not authenticated: ${summary.slice(0, 140)}`, engine };
    }
    summaryCache.set(key, summary);
    if (summaryCache.size > 200) summaryCache.clear();
    return { ok: true, summary, engine };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
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
const ASK_MAX_Q = 2000;
const AUTH_FAIL_RE = /\b(not logged in|please run \/login|invalid authentication credentials|invalid api key|not authenticated|failed to authenticate)\b/i;
ipcMain.handle('session:ask', async (_e, arg) => {
  try {
    if (!arg || !arg.id || !arg.path) return { ok: false, error: 'no session' };
    const question = String(arg.question || '').trim().slice(0, ASK_MAX_Q);
    if (!question) return { ok: false, error: 'no question' };
    const codex = arg.harness === 'codex';
    const engine = codex ? 'codex' : 'claude';
    const bin = resolveCli(engine);
    if (!bin) return { ok: false, error: `could not find the ${engine} CLI on your PATH`, engine };
    const prompt = `${BTW_SENTINEL} ${question}`;
    const env = Object.assign({}, process.env, { PATH: [path.dirname(bin), process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`].filter(Boolean).join(':') });
    // A probe spawned from inside another Claude session would inherit these
    // markers and stamp the injected turn differently; scrub for a clean SDK run.
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.CLAUDECODE;
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
      let st = null; try { st = fs.statSync(arg.path); } catch { /* stat is advisory */ }
      const need = deriveNeedState(readNeedSignals(arg.path, arg.harness, st || undefined), st, Date.now());
      if (need.state === 'work') {
        return { ok: false, engine, error: 'this session is working right now; a Codex ask would append into the live thread. Try again once it settles.' };
      }
      const m = String(arg.id).match(UUID_RE);
      if (!m) return { ok: false, engine, error: 'no thread uuid in this session id' };
      // -o writes the clean final agent message; read that, never the stdout stream.
      const outFile = path.join(os.tmpdir(), `humanctl-ask-${Date.now()}-${process.pid}.txt`);
      out = await new Promise((res, rej) => {
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
        try { cp.stdin.end(); } catch { /* prompt is argv, not stdin */ }
      });
    } else {
      const runClaude = () => new Promise((res, rej) => {
        const cp = execFile(bin, ['-p', '--resume', String(arg.id), '--no-session-persistence', '--model', 'haiku', '--output-format', 'json', prompt],
          { timeout: ASK_TIMEOUT_MS, maxBuffer: 4 << 20, env, cwd },
          (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'ask failed').slice(0, 300))) : res(String(stdout)));
        try { cp.stdin.end(); } catch { /* prompt is argv, not stdin */ }
      });
      // The API can reject valid OAuth credentials in short transient bursts and
      // a one-shot -p run dies on its first request with exit 0 and the error on
      // stdout (same failure the summarize path guards). One spaced retry.
      let raw = await runClaude();
      let parsed = null;
      try { parsed = JSON.parse(raw.trim()); } catch { /* non-JSON output handled below */ }
      const authFail = (!parsed && /failed to authenticate/i.test(raw))
        || (parsed && parsed.is_error && AUTH_FAIL_RE.test(String(parsed.result || '')));
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
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// Agent inbox: notes posted by `humanctl note`.
ipcMain.handle('notes:get', (_e, opts) => {
  try { return { ok: true, notes: readNotes(opts || {}) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// Open/resume the actual session in a Terminal window (hands it back to the human).
ipcMain.handle('session:resume', (_e, arg) => {
  try {
    if (!arg || !arg.id) return { ok: false, error: 'no id' };
    const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    const cwd = arg.cwd && fs.existsSync(arg.cwd) ? arg.cwd : os.homedir();
    let id = arg.id, cmd;
    if (arg.harness === 'codex') {
      const m = String(arg.id).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      id = m ? m[1] : arg.id;
      cmd = `codex resume ${shq(id)}`;
    } else {
      cmd = `claude --resume ${shq(id)}`;
    }
    const file = path.join(os.tmpdir(), `humanctl-resume-${Date.now()}.command`);
    fs.writeFileSync(file, `#!/bin/bash\ncd ${shq(cwd)} && exec ${cmd}\n`, { mode: 0o755 });
    execFile('open', [file], () => { setTimeout(() => fs.unlink(file, () => {}), 8000); });
    return { ok: true, cmd };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// Open the session in the harness's own desktop app via its registered deep
// link (the same links the apps use themselves; both verified end to end):
//   Claude desktop  claude://resume?session=<uuid>   imports + opens the CLI session
//   Codex desktop   codex://threads/<thread-uuid>    opens that thread in the app
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
ipcMain.handle('session:open-app', async (_e, arg) => {
  try {
    if (!arg || !arg.id) return { ok: false, error: 'no id' };
    const m = String(arg.id).match(UUID_RE);
    if (!m) return { ok: false, error: 'no session uuid in this id' };
    const codex = arg.harness === 'codex';
    const url = codex ? `codex://threads/${m[1]}` : `claude://resume?session=${m[1]}`;
    // openExternal rejects when no app is registered for the scheme, so a
    // missing desktop app surfaces as a real error instead of a silent no-op.
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (err) {
    const appName = arg && arg.harness === 'codex' ? 'Codex' : 'Claude';
    return { ok: false, error: `could not open the ${appName} desktop app: ${String((err && err.message) || err)}` };
  }
});

ipcMain.handle('skills:aggregate', (_e, opts) => {
  try { return { ok: true, agg: aggregateSkills(opts || {}) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('sessions:reveal', (_e, filePath) => {
  try { if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath); return { ok: true }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// Open a URL (Linear, etc.) externally, or a local file (html rollup) in its app.
ipcMain.handle('open:external', (_e, url) => {
  try { if (typeof url === 'string' && /^https?:\/\/|^linear:\/\//.test(url)) { shell.openExternal(url); return { ok: true }; } return { ok: false, error: 'blocked url' }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('open:path', (_e, p) => {
  try { if (typeof p === 'string' && p) { shell.openPath(p); return { ok: true }; } return { ok: false, error: 'no path' }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// Local UI state (pins, theme).
ipcMain.handle('state:get', () => { try { return { ok: true, state: readState() }; } catch (err) { return { ok: false, error: String(err) }; } });
ipcMain.handle('state:set', (_e, patch) => {
  try { const next = Object.assign(readState(), patch || {}); writeState(next); return { ok: true, state: next }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) { try { app.dock.setIcon(nativeImage.createFromPath(ICON_PATH)); } catch {} }
  createWindow();
});
app.on('window-all-closed', () => { for (const w of watchers) { try { w.close(); } catch {} } if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
