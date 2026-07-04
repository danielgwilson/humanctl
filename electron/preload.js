'use strict';

// Minimal, explicit bridge. The renderer gets exactly these calls, nothing else.
// Read-only over transcripts; the only writes are local UI state (pins/theme).
// No direct fs, no network.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('humanctl', {
  listCommands: () => ipcRenderer.invoke('app:commands'),
  listSessions: (opts) => ipcRenderer.invoke('sessions:list', opts),
  getStatus: (opts) => ipcRenderer.invoke('status:get', opts),
  getHarnessIcons: () => ipcRenderer.invoke('harness:icons'),
  getPrChip: (repo) => ipcRenderer.invoke('pulse:pr-chip', { repo }),
  getNoteImage: (filename) => ipcRenderer.invoke('note:get-image', filename),
  resolveAttachment: (filename) => ipcRenderer.invoke('note:resolve-attachment', filename),
  getSummaryBudget: (opts) => ipcRenderer.invoke('summary:budget', opts),
  readSession: (arg) => ipcRenderer.invoke('sessions:read', arg),
  readTimeline: (arg) => ipcRenderer.invoke('sessions:timeline', arg),
  setHotSession: (arg) => ipcRenderer.invoke('session:hot', arg),
  aggregateSkills: (opts) => ipcRenderer.invoke('skills:aggregate', opts),
  summarize: (arg) => ipcRenderer.invoke('session:summarize', arg),
  askSession: (arg) => ipcRenderer.invoke('session:ask', arg),
  getNotes: (opts) => ipcRenderer.invoke('notes:get', opts),
  getInboxThreads: (opts) => ipcRenderer.invoke('inbox:threads', opts),
  markThreadRead: (arg) => ipcRenderer.invoke('inbox:mark-read', arg),
  markAllThreadsRead: () => ipcRenderer.invoke('inbox:mark-all-read'),
  askAtlas: (arg) => ipcRenderer.invoke('atlas:ask', arg),
  getAtlasLog: () => ipcRenderer.invoke('atlas:get-log'),
  setView: (view) => ipcRenderer.invoke('view:set', { view }),
  setNav: (pinned) => ipcRenderer.invoke('nav:set', { pinned }),
  setCosDrawer: (open) => ipcRenderer.invoke('cos-drawer:set', { open }),
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
  // Fast path for ~/.humanctl itself (notes.jsonl + asks/): fires on a short
  // coalesce window independent of the general sessions:changed debounce, so
  // a posted note can update the Inbox without waiting on the full list
  // refresh floor.
  onInboxFast: (cb) => {
    const handler = () => { try { cb(); } catch {} };
    ipcRenderer.on('inbox:fast', handler);
    return () => ipcRenderer.removeListener('inbox:fast', handler);
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
