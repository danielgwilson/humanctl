'use strict';

// humanctl desktop (Electron) main process.
// Local-first, read-only over agent session transcripts. No network egress.
// The only thing it writes is local UI state (pins, theme) under userData.

const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
let APP_VERSION = '0.0.0';
try { APP_VERSION = require('../package.json').version; } catch {}
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { listRecent, readBlocks, readUsage, readDetail, aggregateSkills, accountStatus, readNotes, HARNESSES } = require('./sessions');

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
let watchTimer = null;
const watchers = [];
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
      const w = fs.watch(dir, { recursive: true }, ping);
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
ipcMain.handle('status:get', (_e, opts) => {
  try { return { ok: true, status: Object.assign(accountStatus(opts || {}), { version: APP_VERSION }) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('sessions:read', (_e, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    const detail = readDetail ? readDetail(arg.path, arg.harness) : null;
    return { ok: true, data: readBlocks(arg.path, { harness: arg.harness }), usage: readUsage(arg.path, arg.harness), detail };
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
      out = await new Promise((res, rej) => {
        const cp = execFile(bin, ['-p', '--model', 'claude-haiku-4-5', '--allowed-tools', ''], { timeout: 60000, maxBuffer: 1 << 20, env },
          (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'summarize failed').slice(0, 300))) : res(String(stdout).trim()));
        try { cp.stdin.end(prompt); } catch (e) { rej(e); }
      });
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
