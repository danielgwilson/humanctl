'use strict';

// Minimal, explicit bridge. The renderer gets exactly these calls, nothing else.
// Read-only over transcripts; the only writes are local UI state (pins/theme).
// No direct fs, no network.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanctl', {
  listSessions: (opts) => ipcRenderer.invoke('sessions:list', opts),
  getStatus: (opts) => ipcRenderer.invoke('status:get', opts),
  readSession: (arg) => ipcRenderer.invoke('sessions:read', arg),
  aggregateSkills: (opts) => ipcRenderer.invoke('skills:aggregate', opts),
  summarize: (arg) => ipcRenderer.invoke('session:summarize', arg),
  revealSession: (filePath) => ipcRenderer.invoke('sessions:reveal', filePath),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  openPath: (p) => ipcRenderer.invoke('open:path', p),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch) => ipcRenderer.invoke('state:set', patch),
  onSessionsChanged: (cb) => {
    const handler = () => { try { cb(); } catch {} };
    ipcRenderer.on('sessions:changed', handler);
    return () => ipcRenderer.removeListener('sessions:changed', handler);
  },
});
