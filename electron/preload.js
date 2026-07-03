'use strict';

// Minimal, explicit bridge. The renderer gets exactly these calls, nothing else.
// Read-only over transcripts; the only writes are local UI state (pins/theme).
// No direct fs, no network.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanctl', {
  listSessions: (opts) => ipcRenderer.invoke('sessions:list', opts),
  getStatus: (opts) => ipcRenderer.invoke('status:get', opts),
  readSession: (arg) => ipcRenderer.invoke('sessions:read', arg),
  readTimeline: (arg) => ipcRenderer.invoke('sessions:timeline', arg),
  setHotSession: (arg) => ipcRenderer.invoke('session:hot', arg),
  aggregateSkills: (opts) => ipcRenderer.invoke('skills:aggregate', opts),
  summarize: (arg) => ipcRenderer.invoke('session:summarize', arg),
  askSession: (arg) => ipcRenderer.invoke('session:ask', arg),
  getNotes: (opts) => ipcRenderer.invoke('notes:get', opts),
  resumeSession: (arg) => ipcRenderer.invoke('session:resume', arg),
  openInApp: (arg) => ipcRenderer.invoke('session:open-app', arg),
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
  onSessionAppend: (cb) => {
    const handler = (_e, payload) => { try { cb(payload); } catch {} };
    ipcRenderer.on('session:append', handler);
    return () => ipcRenderer.removeListener('session:append', handler);
  },
  // State mutated outside the renderer (a CLI/socket command wrote state.json);
  // carries the fresh state so the open window can apply it live.
  onStateChanged: (cb) => {
    const handler = (_e, state) => { try { cb(state); } catch {} };
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
});
