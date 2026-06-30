'use strict';

// humanctl desktop (Electron) main process.
// Local-first, read-only over agent session transcripts. No network egress.
// The only thing it writes is local UI state (pins, theme) under userData.

const { app, BrowserWindow, ipcMain, shell, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const fs = require('fs');
const { execFile } = require('child_process');
const { listRecent, readBlocks, readUsage, readDetail, aggregateSkills, accountStatus, HARNESSES } = require('./sessions');

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
  for (const h of HARNESSES) {
    try {
      const w = fs.watch(h.dir, { recursive: true }, () => {
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('sessions:changed'); }, 1200);
      });
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
  try { return { ok: true, status: accountStatus(opts || {}) }; }
  catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
ipcMain.handle('sessions:read', (_e, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    const detail = readDetail ? readDetail(arg.path, arg.harness) : null;
    return { ok: true, data: readBlocks(arg.path, { harness: arg.harness }), usage: readUsage(arg.path, arg.harness), detail };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});
// Opt-in only: summarize a session's recent activity via the local `claude` CLI.
// This is the one action that sends data off the machine (to the model, through
// the user's own CLI auth), so the renderer must label it explicitly. Cached by mtime.
const summaryCache = new Map();
ipcMain.handle('session:summarize', async (_e, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    const st = fs.statSync(arg.path);
    const key = `${arg.path}:${st.mtimeMs}`;
    if (summaryCache.has(key)) return { ok: true, summary: summaryCache.get(key), cached: true };
    const d = readDetail(arg.path, arg.harness) || {};
    const ex = d.lastExchange || {};
    const tail = (readBlocks(arg.path, { harness: arg.harness }).blocks || []).slice(-16).map((b) => `[${b.kind}] ${b.preview}`).join('\n');
    const prompt = `Summarize the recent tail of an autonomous coding-agent session for an operator dashboard. In 1-2 plain sentences say what the agent is currently working on and its immediate next step. Be concrete and terse, no preamble.\n\nLatest user instruction: ${ex.lastUser || '(none)'}\n\nRecent blocks:\n${tail}`;
    const out = await new Promise((res, rej) => {
      const cp = execFile('claude', ['-p', '--model', 'claude-haiku-4-5', '--allowed-tools', ''], { timeout: 45000, maxBuffer: 1 << 20 },
        (err, stdout, stderr) => err ? rej(new Error(String(stderr || err.message || 'summarize failed').slice(0, 200))) : res(String(stdout).trim()));
      try { cp.stdin.end(prompt); } catch (e) { rej(e); }
    });
    const summary = out.slice(0, 600);
    summaryCache.set(key, summary);
    if (summaryCache.size > 200) summaryCache.clear();
    return { ok: true, summary };
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
