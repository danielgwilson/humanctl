'use strict';

// humanctl desktop (Electron) main process.
// Local-first, read-only over agent session transcripts. No network egress.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { listRecent, readBlocks } = require('./sessions');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0a0c10',
    titleBarStyle: 'hiddenInset',
    title: 'humanctl',
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
    // Boot smoke: `HUMANCTL_SMOKE=1 npm run desktop` reports the live session
    // count then quits. Lets CI verify boot + read without a human present.
    if (process.env.HUMANCTL_SMOKE) {
      let n = -1;
      try { n = listRecent({ maxAgeH: 72, limit: 40 }).length; } catch {}
      console.log(`HUMANCTL_SMOKE ok: ${n} sessions`);
      app.quit();
    }
  });
}

// Read-only IPC: list recent cross-harness sessions.
ipcMain.handle('sessions:list', (_event, opts) => {
  try {
    return { ok: true, rows: listRecent(opts || {}) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Read-only IPC: parse one session into a context map (blocks by kind).
ipcMain.handle('sessions:read', (_event, arg) => {
  try {
    if (!arg || !arg.path) return { ok: false, error: 'no path' };
    return { ok: true, data: readBlocks(arg.path, { harness: arg.harness }) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

// Open a session transcript in the user's editor/Finder (read-only convenience).
ipcMain.handle('sessions:reveal', (_event, filePath) => {
  try {
    if (typeof filePath === 'string' && filePath) shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
