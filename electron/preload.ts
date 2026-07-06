// Minimal, explicit bridge. The renderer gets exactly these calls, nothing else.
// Read-only over transcripts; the only writes are local UI state (pins/theme).
// No direct fs, no network.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('humanctl', {
  listCommands: () => ipcRenderer.invoke('app:commands'),
  listSessions: (opts: unknown) => ipcRenderer.invoke('sessions:list', opts),
  getStatus: (opts: unknown) => ipcRenderer.invoke('status:get', opts),
  getHarnessIcons: () => ipcRenderer.invoke('harness:icons'),
  getPrChip: (repo: string) => ipcRenderer.invoke('pulse:pr-chip', { repo }),
  getNoteImage: (filename: string) => ipcRenderer.invoke('note:get-image', filename),
  resolveAttachment: (filename: string) => ipcRenderer.invoke('note:resolve-attachment', filename),
  getSummaryBudget: (opts: unknown) => ipcRenderer.invoke('summary:budget', opts),
  readSession: (arg: unknown) => ipcRenderer.invoke('sessions:read', arg),
  readTimeline: (arg: unknown) => ipcRenderer.invoke('sessions:timeline', arg),
  setHotSession: (arg: unknown) => ipcRenderer.invoke('session:hot', arg),
  aggregateSkills: (opts: unknown) => ipcRenderer.invoke('skills:aggregate', opts),
  summarize: (arg: unknown) => ipcRenderer.invoke('session:summarize', arg),
  askSession: (arg: unknown) => ipcRenderer.invoke('session:ask', arg),
  getNotes: (opts: unknown) => ipcRenderer.invoke('notes:get', opts),
  getInboxThreads: (opts: unknown) => ipcRenderer.invoke('inbox:threads', opts),
  markThreadRead: (arg: unknown) => ipcRenderer.invoke('inbox:mark-read', arg),
  markAllThreadsRead: () => ipcRenderer.invoke('inbox:mark-all-read'),
  askAtlas: (arg: unknown) => ipcRenderer.invoke('atlas:ask', arg),
  getAtlasLog: () => ipcRenderer.invoke('atlas:get-log'),
  setView: (view: string) => ipcRenderer.invoke('view:set', { view }),
  setNav: (pinned: boolean) => ipcRenderer.invoke('nav:set', { pinned }),
  setCosDrawer: (open: boolean) => ipcRenderer.invoke('cos-drawer:set', { open }),
  resumeSession: (arg: unknown) => ipcRenderer.invoke('session:resume', arg),
  openInApp: (arg: unknown) => ipcRenderer.invoke('session:open-app', arg),
  revealSession: (filePath: string) => ipcRenderer.invoke('sessions:reveal', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
  openPath: (p: string) => ipcRenderer.invoke('open:path', p),
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch: unknown) => ipcRenderer.invoke('state:set', patch),
  onSessionsChanged: (cb: () => void) => {
    const handler = () => { try { cb(); } catch { /* renderer callback threw; ignore */ } };
    ipcRenderer.on('sessions:changed', handler);
    return () => ipcRenderer.removeListener('sessions:changed', handler);
  },
  // Fast path for ~/.humanctl itself (notes.jsonl + asks/): fires on a short
  // coalesce window independent of the general sessions:changed debounce, so
  // a posted note can update the Inbox without waiting on the full list
  // refresh floor.
  onInboxFast: (cb: () => void) => {
    const handler = () => { try { cb(); } catch { /* renderer callback threw; ignore */ } };
    ipcRenderer.on('inbox:fast', handler);
    return () => ipcRenderer.removeListener('inbox:fast', handler);
  },
  onSessionAppend: (cb: (payload: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => { try { cb(payload); } catch { /* renderer callback threw; ignore */ } };
    ipcRenderer.on('session:append', handler);
    return () => ipcRenderer.removeListener('session:append', handler);
  },
  // State mutated outside the renderer (a CLI/socket command wrote state.json);
  // carries the fresh state so the open window can apply it live.
  onStateChanged: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => { try { cb(state); } catch { /* renderer callback threw; ignore */ } };
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
});
