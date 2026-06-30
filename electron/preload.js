'use strict';

// Minimal, explicit bridge. The renderer gets exactly these read-only calls,
// nothing else. No direct fs, no network.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanctl', {
  listSessions: (opts) => ipcRenderer.invoke('sessions:list', opts),
  readSession: (arg) => ipcRenderer.invoke('sessions:read', arg),
  revealSession: (filePath) => ipcRenderer.invoke('sessions:reveal', filePath),
});
