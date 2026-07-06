// The command registry: one declared surface for everything humanctl does.
//
// Invariant (AGENTS.md "Command registry"): every mutation of durable state,
// every process spawn, and every cross-session observation is a registered
// command, declared once here, invocable from the UI (IPC), from the CLI
// against the running app (unix socket), and logged as one event line.
// Renderer-only ephemera (hover, selection, scroll) are exempt.
// CommandRegistry >= control API >= CLI >= UI.
//
// This module is plain Node (no Electron imports) so the registry, the event
// log, and the control-socket server run and selftest without a display
// (lib/commands.selftest.ts). Electron-only handlers (window state, shell
// opens, CLI spawns) are injected by electron/main.ts; commands marked
// `direct` are implemented here over lib/ alone, so the CLI can still answer
// them from disk when the app is not running (source "cli-direct").

import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

function controlDir(): string { return path.join(os.homedir(), '.humanctl'); }
function controlSocketPath(): string { return path.join(controlDir(), 'app.sock'); }

export type ParamType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ParamSpec {
  type: ParamType;
  required?: boolean;
  enum?: string[];
  max?: number;
}

export type CommandKind = 'action' | 'observation';

export interface CommandDecl {
  name: string;
  kind: CommandKind;
  direct?: boolean;
  desc: string;
  params: Record<string, ParamSpec>;
}

// ---- command declarations (the single source of truth) ----
// params is a minimal plain-JS schema: { key: { type, required?, enum?, max? } }
// kind: 'action' mutates durable state or spawns a process; 'observation' reads.
export const COMMANDS: CommandDecl[] = [
  {
    name: 'sessions.list', kind: 'observation', direct: true,
    desc: 'recent agent sessions across harnesses',
    params: { maxAgeH: { type: 'number' }, limit: { type: 'number' }, withUsage: { type: 'boolean' }, includeAutomation: { type: 'boolean' } },
  },
  {
    name: 'session.detail', kind: 'observation', direct: true,
    desc: 'blocks, usage, and detail for one session (by id or path)',
    params: { id: { type: 'string' }, path: { type: 'string' }, harness: { type: 'string' } },
  },
  {
    name: 'session.timeline', kind: 'observation', direct: true,
    desc: 'a substantive-event-budgeted backward page of one session transcript, with explicit [start, end) coverage',
    params: { id: { type: 'string' }, path: { type: 'string' }, harness: { type: 'string' }, before: { type: 'number' } },
  },
  {
    name: 'skills.aggregate', kind: 'observation', direct: true,
    desc: 'skill usage aggregated across recent sessions',
    params: { maxAgeH: { type: 'number' }, limit: { type: 'number' } },
  },
  {
    name: 'notes.list', kind: 'observation', direct: true,
    desc: 'agent inbox notes (~/.humanctl/notes.jsonl)',
    params: { limit: { type: 'number' } },
  },
  {
    name: 'inbox.threads', kind: 'observation', direct: true,
    desc: 'inbox threads (one per session) assembled from notes, detected needs-you asks, and persisted btw Q&A',
    params: { limit: { type: 'number' } },
  },
  {
    name: 'note.post', kind: 'action', direct: true,
    desc: 'post a note to the human inbox, optionally with up to 4 image attachments',
    params: {
      message: { type: 'string', required: true, max: 2000 },
      level: { type: 'string', enum: ['fyi', 'review', 'blocked', 'done'] },
      repo: { type: 'string' }, session: { type: 'string' }, agent: { type: 'string' }, cwd: { type: 'string' },
      // Local file paths (e.g. an agent's own proof screenshot); postNote
      // copies each into ~/.humanctl/attachments/ and the note gains an
      // `attachments` array of the copies. Extension/size/count are validated
      // in postNote itself (an honest per-file reason beats a generic schema
      // rejection here).
      images: { type: 'array', max: 4 },
    },
  },
  {
    name: 'span.run', kind: 'observation', direct: true,
    desc: 'daily span-of-control counts (record: true upserts the day into span.jsonl)',
    params: { date: { type: 'string' }, record: { type: 'boolean' } },
  },
  {
    name: 'pulse.run', kind: 'observation', direct: true,
    desc: 'read-only reconciliation of issues, worktrees, PRs, sessions, notes',
    params: { repo: { type: 'string' }, lane: { type: 'string' }, fresh: { type: 'boolean' } },
  },
  {
    name: 'app.commands', kind: 'observation', direct: true,
    desc: 'list every registered command',
    params: {},
  },
  {
    name: 'pulse.pr-chip', kind: 'observation', direct: true,
    desc: 'PR counts for one repo, read ONLY from the existing pulse cache (~/.humanctl/pulse-cache.json): zero network, zero git/gh spawns. A cache miss returns ok:true with chip:null (never an error), so a missing cache is honest, not a fault.',
    params: { repo: { type: 'string', required: true } },
  },
  {
    name: 'summary.budget', kind: 'observation', direct: true,
    desc: 'today\'s always-on-summary spend estimate (USD) against the configured daily budget (lib/summary-budget.ts), for the honest pause chip',
    params: { dailyBudgetUSD: { type: 'number' } },
  },
  // ---- app-only commands (handlers injected by electron/main.ts) ----
  {
    name: 'app.harness-icons', kind: 'observation',
    desc: 'runtime-extracted harness icons (data URLs) for the installed Claude/Codex apps, cached under userData; never committed, silent glyph fallback on any failure',
    params: {},
  },
  {
    name: 'app.status', kind: 'observation',
    desc: 'account status, app version, deep-link availability',
    params: { maxAgeH: { type: 'number' }, limit: { type: 'number' } },
  },
  {
    name: 'app.state', kind: 'observation',
    desc: 'local UI state (pins, mode, theme, engine)',
    params: {},
  },
  {
    name: 'app.set-state', kind: 'action',
    desc: 'apply a raw patch to local UI state (the renderer state channel)',
    params: { patch: { type: 'object', required: true } },
  },
  {
    name: 'app.set-view', kind: 'action',
    desc: 'switch the desktop view (nav rail destinations)',
    params: { view: { type: 'string', required: true, enum: ['inbox', 'metrics', 'fleet', 'sessions', 'settings'] } },
  },
  {
    name: 'app.set-nav', kind: 'action',
    desc: 'pin the nav rail open as a fixed column, or leave it as a hover overlay (persisted)',
    params: { pinned: { type: 'boolean', required: true } },
  },
  {
    name: 'app.set-cos-drawer', kind: 'action',
    desc: 'open or close the chief-of-staff (summonable right drawer, chat-only) (persisted; default closed). Named distinctly from the retired shell-v2 app.set-right-rail (the old persistent-rail collapse command) to avoid resurrecting that deleted name for an unrelated, newer concept.',
    params: { open: { type: 'boolean', required: true } },
  },
  {
    name: 'app.set-theme', kind: 'action',
    desc: 'switch the desktop theme',
    params: { theme: { type: 'string', required: true, enum: ['light', 'dark', 'system'] } },
  },
  {
    name: 'app.set-engine', kind: 'action',
    desc: 'pick the AI-summary engine',
    params: { engine: { type: 'string', required: true, enum: ['claude', 'codex'] } },
  },
  {
    name: 'inbox.mark-read', kind: 'action',
    desc: 'mark one inbox thread read up to the given timestamp (persists lastReadTs[threadId])',
    params: { threadId: { type: 'string', required: true }, at: { type: 'number' } },
  },
  {
    name: 'inbox.mark-all-read', kind: 'action',
    desc: 'mark every current inbox thread read',
    params: {},
  },
  {
    name: 'session.pin', kind: 'action',
    desc: 'pin a session (persists in state.json)',
    params: { id: { type: 'string', required: true } },
  },
  {
    name: 'session.unpin', kind: 'action',
    desc: 'unpin a session',
    params: { id: { type: 'string', required: true } },
  },
  {
    name: 'session.resume', kind: 'action',
    desc: 'open a Terminal window resuming the session',
    params: { id: { type: 'string', required: true }, harness: { type: 'string' }, cwd: { type: 'string' } },
  },
  {
    name: 'session.open-app', kind: 'action',
    desc: 'open the session in its harness desktop app via deep link',
    params: { id: { type: 'string', required: true }, harness: { type: 'string' } },
  },
  {
    name: 'session.reveal', kind: 'action',
    desc: 'reveal the transcript file in Finder (by id or path)',
    params: { id: { type: 'string' }, path: { type: 'string' } },
  },
  {
    name: 'session.summarize', kind: 'action',
    desc: 'AI-summarize a session via your local claude/codex CLI (spawns a process; sends recent messages to the model)',
    params: {
      id: { type: 'string' }, path: { type: 'string' }, harness: { type: 'string' }, engine: { type: 'string', enum: ['claude', 'codex'] },
      // Marks a call the always-on background engine made (unread AND
      // needs-* threads only) rather than the manual trigger button: gated by
      // the daily dollar budget, and a persistent 401 skips silently instead
      // of surfacing an error (see electron/main.ts sessionSummarize).
      auto: { type: 'boolean' },
    },
  },
  {
    name: 'session.ask', kind: 'action',
    desc: 'inject one sentinel-marked question into a session via its harness CLI',
    params: { id: { type: 'string' }, path: { type: 'string' }, harness: { type: 'string' }, cwd: { type: 'string' }, question: { type: 'string', required: true, max: 2000 } },
  },
  {
    name: 'atlas.ask', kind: 'action',
    desc: 'ask Atlas (a headless probe grounded in pulse, notes, and session states) a question about the fleet; advisory only, never executes actions',
    params: { question: { type: 'string', required: true, max: 2000 }, engine: { type: 'string', enum: ['claude', 'codex'] } },
  },
  {
    name: 'app.open-external', kind: 'action',
    desc: 'open an http(s)/linear URL externally',
    params: { url: { type: 'string', required: true } },
  },
  {
    name: 'app.open-path', kind: 'action',
    desc: 'open a local file in its default app',
    params: { path: { type: 'string', required: true } },
  },
];

const COMMANDS_BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

export interface CommandSummary {
  name: string;
  kind: CommandKind;
  direct: boolean;
  desc: string;
  params: Record<string, ParamSpec>;
}

export function listCommands(): CommandSummary[] {
  return COMMANDS.map((c) => ({ name: c.name, kind: c.kind, direct: !!c.direct, desc: c.desc, params: c.params }));
}

export type ValidateResult = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

// ---- param validation (minimal, plain JS, honest errors) ----
export function validateParams(decl: CommandDecl, params: unknown): ValidateResult {
  const given: Record<string, unknown> = params && typeof params === 'object' && !Array.isArray(params) ? params as Record<string, unknown> : {};
  const schema = decl.params || {};
  for (const key of Object.keys(given)) {
    if (!schema[key]) return { ok: false, error: `unknown param "${key}" for ${decl.name}` };
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    const v = given[key];
    if (v === undefined || v === null || v === '') {
      if (spec.required) return { ok: false, error: `${decl.name} requires param "${key}"` };
      continue;
    }
    if (spec.type === 'string') {
      if (typeof v !== 'string') return { ok: false, error: `${decl.name}: param "${key}" must be a string` };
      if (spec.enum && !spec.enum.includes(v)) return { ok: false, error: `${decl.name}: param "${key}" must be one of ${spec.enum.join('|')}` };
      out[key] = spec.max ? v.slice(0, spec.max) : v;
    } else if (spec.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${decl.name}: param "${key}" must be a number` };
      out[key] = v;
    } else if (spec.type === 'boolean') {
      if (typeof v !== 'boolean') return { ok: false, error: `${decl.name}: param "${key}" must be a boolean` };
      out[key] = v;
    } else if (spec.type === 'object') {
      if (typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `${decl.name}: param "${key}" must be an object` };
      out[key] = v;
    } else if (spec.type === 'array') {
      if (!Array.isArray(v)) return { ok: false, error: `${decl.name}: param "${key}" must be an array` };
      out[key] = spec.max ? v.slice(0, spec.max) : v;
    } else {
      return { ok: false, error: `${decl.name}: param "${key}" has an undeclared type` };
    }
  }
  return { ok: true, params: out };
}

// ---- event log: the interaction spine ----
// One line per invoke in ~/.humanctl/events.jsonl. The log records SHAPES,
// never content: session ids and enum values pass through, free text is hard
// truncated, and nested objects contribute their key names only (a state
// patch can carry AI summaries of real session content). Bounded: rotates to
// events.1.jsonl at 5MB, one rotation kept. Two writers (the app and a
// cli-direct invoke) can race the rotation rename; worst case is one early
// rotation, accepted for a local personal tool.
export const EVENTS_MAX_BYTES = 5 * 1024 * 1024;
const DIGEST_MAX_STR = 80;

export function digestParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined) continue; // absent, not a value; do not log the string "undefined"
    if (typeof v === 'string') out[k] = v.length > DIGEST_MAX_STR ? v.slice(0, DIGEST_MAX_STR) : v;
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length}]`;
    else if (typeof v === 'object') out[k] = `{${Object.keys(v as Record<string, unknown>).sort().join(',')}}`;
    else out[k] = typeof v;
  }
  return out;
}

export interface EventLogEntry {
  ts: string;
  name: string;
  kind: CommandKind | 'unknown';
  source: string;
  paramsDigest: Record<string, unknown>;
  ok: boolean;
  ms: number;
}

export interface EventLog {
  append: (entry: EventLogEntry) => void;
  file: string;
}

export function createEventLog(opts: { dir?: string; maxBytes?: number } = {}): EventLog {
  const dir = opts.dir || controlDir();
  const maxBytes = opts.maxBytes || EVENTS_MAX_BYTES;
  const file = path.join(dir, 'events.jsonl');
  function append(entry: EventLogEntry): void {
    // Logging must never break the command it records.
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(file).size >= maxBytes) fs.renameSync(file, path.join(dir, 'events.1.jsonl'));
      } catch { /* first write */ }
      fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch { /* best effort */ }
  }
  return { append, file };
}

// ---- direct handlers (lib-only, no Electron; lazy requires keep the CLI fast) ----

export interface ResolveSessionResult {
  ok: boolean;
  row?: import('./sessions').SessionRow;
  error?: string;
  ambiguous?: boolean;
}

// Resolve a session id (or unique fragment) to a row from the recent scan.
// Perf (2026-07 click-lag investigation): the naive version always ran the
// widest possible scan (30 days, 500 rows, includeAutomation) with no cache
// hit, because that exact {maxAgeH,limit,includeAutomation} key is never the
// one the renderer's own polling keeps warm. Measured on real data: 6.8s for
// that scan alone, which (per Electron's documented main-process model)
// blocks ALL window input for that entire span, not just the one IPC call --
// this is "session.pin" averaging ~8s in the 2026-07-03 perf profile's
// offender #5, left unfixed there. The renderer's default list scan
// ({maxAgeH:72, limit:40}) is the one `lib/sessions.ts`'s scanCache is almost
// always warm for (the 20s poll keeps refreshing it), and it covers the
// overwhelming majority of real lookups (a session someone just clicked, or
// just referenced from the CLI, is virtually always in the last 72h). Try
// that cheap, likely-cached path FIRST and only pay for the wide/uncached
// scan when the id genuinely is not a recent interactive session (an old or
// automation-only session referenced by exact id from the CLI).
export function resolveSessionRow(id: string): ResolveSessionResult {
  const { listRecent } = require('./sessions') as typeof import('./sessions');
  const findIn = (rows: import('./sessions').SessionRow[]): ResolveSessionResult | null => {
    const exact = rows.find((r) => r.id === id || r.path === id);
    if (exact) return { ok: true, row: exact };
    const partial = rows.filter((r) => r.id.includes(id));
    if (partial.length === 1) return { ok: true, row: partial[0] };
    if (partial.length > 1) return { ok: false, error: `session id "${id}" is ambiguous (${partial.length} matches)`, ambiguous: true };
    return null; // no match in this scope; caller decides whether to widen
  };
  let cheap: ResolveSessionResult | null;
  try { cheap = findIn(listRecent({ maxAgeH: 72, limit: 40 })); }
  catch (err) { return { ok: false, error: String((err as Error)?.message || err) }; }
  if (cheap) return cheap;
  let rows: import('./sessions').SessionRow[];
  try { rows = listRecent({ maxAgeH: 24 * 30, limit: 500, includeAutomation: true }); }
  catch (err) { return { ok: false, error: String((err as Error)?.message || err) }; }
  const wide = findIn(rows);
  if (wide) return wide;
  return { ok: false, error: `no recent session matches "${id}"` };
}

interface SessionDetailParams { id?: string; path?: string; harness?: string }

function sessionDetail(p: SessionDetailParams = {}): Record<string, unknown> {
  const sessions = require('./sessions') as typeof import('./sessions');
  let target: { path?: string; harness?: string } = { path: p.path, harness: p.harness };
  if (!target.path) {
    if (!p.id) return { ok: false, error: 'session.detail needs an id or a path' };
    const r = resolveSessionRow(p.id);
    if (!r.ok || !r.row) return { ok: r.ok, error: r.error, ambiguous: r.ambiguous };
    target = { path: r.row.path, harness: r.row.harness };
  }
  const detail = sessions.readDetail ? sessions.readDetail(target.path as string, target.harness as string) : null;
  return {
    ok: true,
    data: sessions.readBlocks(target.path as string, { harness: target.harness }),
    usage: sessions.readUsage(target.path as string, target.harness as string),
    detail,
  };
}

interface SessionTimelineParams { id?: string; path?: string; harness?: string; before?: number }

function sessionTimeline(p: SessionTimelineParams = {}): Record<string, unknown> {
  const sessions = require('./sessions') as typeof import('./sessions');
  let target: { path?: string; harness?: string } = { path: p.path, harness: p.harness };
  if (!target.path) {
    if (!p.id) return { ok: false, error: 'session.timeline needs an id or a path' };
    const r = resolveSessionRow(p.id);
    if (!r.ok || !r.row) return { ok: r.ok, error: r.error, ambiguous: r.ambiguous };
    target = { path: r.row.path, harness: r.row.harness };
  }
  const page = sessions.readTimelinePage(target.path as string, { harness: target.harness, before: p.before });
  return page ? { ok: true, page } : { ok: false, error: 'could not read this session' };
}

// ---- note images (PR-2 item 3): copy-in, never a reference to the caller's
// own path (a screenshot in /tmp can vanish; the note must survive that).
// Stored under ~/.humanctl/attachments/, a sibling of notes.jsonl but NOT on
// isInboxRelevantChange's allowlist: the inbox already refreshes on the
// notes.jsonl write that references these files, so watching the attachment
// copies themselves would just be a second, redundant trigger for the same event.
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 4;
export function attachmentsDir(): string { return path.join(controlDir(), 'attachments'); }

export interface StoreNoteImagesResult {
  stored: string[];
  skipped: { path: string; reason: string }[];
}

// Copies each valid image path into attachmentsDir(), returns the list of
// stored relative filenames (what the note persists). A bad individual path
// (missing, wrong extension, oversized, unreadable) is skipped with a reason
// collected for the caller, never thrown: one bad --image must not lose an
// otherwise-good note.
export function storeNoteImages(paths: unknown): StoreNoteImagesResult {
  const list: unknown[] = Array.isArray(paths) ? paths.slice(0, MAX_IMAGES) : [];
  if (!list.length) return { stored: [], skipped: [] };
  const dir = attachmentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const stored: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const raw of list) {
    const srcPath = String(raw || '').trim();
    if (!srcPath) continue;
    if (!IMAGE_EXT_RE.test(srcPath)) { skipped.push({ path: srcPath, reason: 'not a png/jpg/gif/webp file' }); continue; }
    let st: fs.Stats;
    try { st = fs.statSync(srcPath); } catch { skipped.push({ path: srcPath, reason: 'file not found' }); continue; }
    if (!st.isFile()) { skipped.push({ path: srcPath, reason: 'not a file' }); continue; }
    if (st.size > MAX_IMAGE_BYTES) { skipped.push({ path: srcPath, reason: `over the 10MB limit (${Math.round(st.size / 1024 / 1024)}MB)` }); continue; }
    const ext = path.extname(srcPath).toLowerCase();
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    try {
      fs.copyFileSync(srcPath, path.join(dir, name));
      stored.push(name);
    } catch (err) { skipped.push({ path: srcPath, reason: String((err as Error)?.message || err) }); }
  }
  return { stored, skipped };
}

interface PostNoteParams {
  message?: string;
  level?: string;
  cwd?: string;
  repo?: string;
  session?: string;
  agent?: string;
  images?: unknown;
}

function postNote(p: PostNoteParams = {}): Record<string, unknown> {
  const message = String(p.message || '').trim();
  if (!message) return { ok: false, error: 'note.post requires a message' };
  const level = ['fyi', 'review', 'blocked', 'done'].includes(p.level as string) ? p.level : 'fyi';
  const dir = controlDir();
  fs.mkdirSync(dir, { recursive: true });
  const cwd = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd();
  const { stored, skipped } = storeNoteImages(p.images);
  const note = {
    id: `note_${randomUUID().slice(0, 8)}`,
    ts: new Date().toISOString(),
    level,
    message,
    cwd,
    repo: p.repo || path.basename(cwd),
    session: p.session || '',
    agent: p.agent || '',
    attachments: stored,
  };
  fs.appendFileSync(path.join(dir, 'notes.jsonl'), `${JSON.stringify(note)}\n`, 'utf8');
  return { ok: true, note, skippedImages: skipped };
}

// ---- Inbox: one thread per session, assembled from data already read ----
// asksDir/readAskLog mirror the persistence contract documented in
// docs/ask-session.md and used by electron/main.ts's sessionAsk: one
// append-only jsonl file per session under ~/.humanctl/asks/, so a probe
// round-trip and an "interrupted at window close" record both survive a
// restart. Reading is bounded (tail slice), matching sessions.readNotes.
export function asksDir(): string { return path.join(controlDir(), 'asks'); }
export function askLogPath(sessionId: string): string { return path.join(asksDir(), `${sessionId}.jsonl`); }
export function appendAskLog(sessionId: string | undefined, entry: Record<string, unknown>): void {
  if (!sessionId) return;
  try {
    fs.mkdirSync(asksDir(), { recursive: true });
    fs.appendFileSync(askLogPath(sessionId), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch { /* best effort; the in-memory/state.json copy is the fast path */ }
}
export function readAskLog(sessionId: string | undefined, limit = 200): Record<string, unknown>[] {
  if (!sessionId) return [];
  let txt: string;
  try { txt = fs.readFileSync(askLogPath(sessionId), 'utf8'); } catch { return []; }
  const out: Record<string, unknown>[] = [];
  for (const line of txt.split('\n')) {
    if (!line) continue;
    try { const o = JSON.parse(line); if (o && typeof o === 'object') out.push(o); } catch { /* skip a corrupt line */ }
  }
  return out.slice(-limit);
}

// ---- inbox watch scope: what inside ~/.humanctl actually feeds the Inbox ----
// electron/main.ts watches ~/.humanctl recursively so a posted note or a
// persisted ask answer refreshes the Inbox fast. But ~/.humanctl is also
// where the registry's OWN outputs live (events.jsonl + its events.1.jsonl
// rotation today; more will be added over time, e.g. atlas.jsonl, pulse
// caches, span logs). A watcher that reacts to every change in the directory
// reacts to its own writes: every invoke() appends to events.jsonl, which
// re-triggers the watcher, which invokes more commands, forever. Rather than
// blacklist each registry-owned file (a list that must be remembered on every
// future addition), this allowlists the two inputs the Inbox actually reads:
// notes.jsonl (note.post) and asks/<sessionId>.jsonl (appendAskLog). Anything
// else under ~/.humanctl -- present today or added later -- is ignored here
// by construction, not by omission.
export function isInboxRelevantChange(filename: string | null | undefined): boolean {
  if (!filename) return true; // some platforms report a null filename; treat as "maybe relevant"
  const norm = String(filename).split(path.sep).join('/');
  if (norm === 'notes.jsonl') return true;
  if (norm === 'asks' || norm.startsWith('asks/')) return norm.endsWith('.jsonl') || norm === 'asks';
  return false;
}

// Build one inbox thread per session from data already read elsewhere (the
// notes file + the reader's own row states): notes.jsonl entries, the
// session's current needs-you transition (state==='need'|'block' with its
// stateReason, sourced from the v3 reader), and persisted btw Q&A. No new
// heavy scans: this reuses listRecent + readNotes, both already mtime-cached.
function askLogSessionIds(): string[] {
  let ents: fs.Dirent[];
  try { ents = fs.readdirSync(asksDir(), { withFileTypes: true }); } catch { return []; }
  return ents.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name.slice(0, -'.jsonl'.length));
}

interface InboxThread {
  sessionId: string;
  repo: string;
  harness: string;
  cwd: string;
  path: string;
  title: string;
  items: Record<string, unknown>[];
  lastTs?: string | null;
}

export function inboxThreads(p: { limit?: number } = {}): InboxThread[] {
  const { listRecent, readNotes } = require('./sessions') as typeof import('./sessions');
  const limit = p.limit || 200;
  const rows = listRecent({ maxAgeH: 24 * 30, limit: 500 });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const notes = readNotes({ limit: 500 });
  const threads = new Map<string, InboxThread>(); // sessionId -> { sessionId, repo, harness, items: [] }
  const threadFor = (sessionId: string, row?: import('./sessions').SessionRow): InboxThread => {
    if (!threads.has(sessionId)) {
      threads.set(sessionId, {
        sessionId,
        repo: (row && row.repo) || '',
        harness: (row && row.harness) || '',
        cwd: (row && row.cwd) || '',
        path: (row && row.path) || '',
        title: (row && (row.customTitle || row.title)) || '',
        items: [],
      });
    }
    return threads.get(sessionId) as InboxThread;
  };
  for (const n of notes) {
    if (!n.session) continue; // unsessioned notes have no thread to join (system thread candidate; left to the renderer)
    const row = rowById.get(n.session);
    const t = threadFor(n.session, row);
    t.items.push({ kind: 'note', level: n.level, message: n.message, ts: n.ts, id: n.id, attachments: Array.isArray(n.attachments) ? n.attachments : [] });
  }
  for (const row of rows) {
    if (row.state !== 'need' && row.state !== 'block') continue;
    const t = threadFor(row.id, row);
    t.items.push({
      kind: 'ask', level: row.state === 'block' ? 'blocked' : 'review', reason: row.stateReason || '',
      ts: new Date(row.lastActiveMs || row.ageMs).toISOString(),
    });
  }
  // A session can carry persisted btw Q&A (or an interrupted-at-close probe)
  // with no note and no current need-state row (the ask may predate the
  // session's current state, or the session may have gone quiet since). The
  // ask log directory is the discovery source for those threads too.
  for (const sessionId of askLogSessionIds()) threadFor(sessionId, rowById.get(sessionId));
  for (const [sessionId, t] of threads) {
    const log = readAskLog(sessionId, 100);
    for (const e of log) {
      if (e.status === 'interrupted') t.items.push({ kind: 'ask-interrupted', question: e.q || '', ts: e.ts });
      else if (e.q && e.a) t.items.push({ kind: 'qa', question: e.q, answer: e.a, engine: e.engine, ts: e.ts });
    }
  }
  const out = [...threads.values()].map((t) => {
    t.items.sort((a, b) => (Date.parse(String(a.ts)) || 0) - (Date.parse(String(b.ts)) || 0));
    t.lastTs = t.items.length ? String(t.items[t.items.length - 1].ts) : null;
    return t;
  }).filter((t) => t.items.length);
  out.sort((a, b) => (Date.parse(String(b.lastTs)) || 0) - (Date.parse(String(a.lastTs)) || 0));
  return out.slice(0, limit);
}

// ---- PR chip (PR-2 item 2): cache-only contract, zero spawns from the inbox
// path. Reads ONLY ~/.humanctl/pulse-cache.json (lib/pulse.ts's own cache
// file, written whenever a `humanctl pulse` run completes); never runs git or
// gh itself. A miss (no cache, wrong signature, repo not in the cached
// config, cache entry expired past pulse's own TTL) returns chip:null, which
// the UI treats as "no chip", never as an error and never as a trigger to go
// fetch fresh data. Age is reported so a stale-but-present cache renders
// honestly ("as of 14m") instead of implying live data.
export const PR_CHIP_STALE_MS = 10 * 60 * 1000; // spec: label the age once older than 10 minutes
export function prChipCachePath(): string { return path.join(controlDir(), 'pulse-cache.json'); }

interface PulseCacheGhEntry {
  name?: string;
  open?: unknown[];
  merged?: unknown[];
  degraded?: string | null;
}

export function prChip(p: { repo?: string } = {}): Record<string, unknown> {
  const repo = String(p.repo || '').trim();
  if (!repo) return { ok: false, error: 'pulse.pr-chip requires a repo' };
  let raw: string;
  try { raw = fs.readFileSync(prChipCachePath(), 'utf8'); } catch { return { ok: true, chip: null }; }
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return { ok: true, chip: null }; }
  const gh = parsed && parsed.gh;
  if (!gh || !Number.isFinite(gh.at) || !Array.isArray(gh.data)) return { ok: true, chip: null };
  // Match by the pulse config's repo alias, case-insensitively, since a
  // session's `repo` field is a directory basename (see lib/pulse.ts's
  // config.repos[].name convention), not a github org/name.
  const entry: PulseCacheGhEntry | undefined = gh.data.find((r: PulseCacheGhEntry) => r && typeof r.name === 'string' && r.name.toLowerCase() === repo.toLowerCase());
  if (!entry || entry.degraded || !Array.isArray(entry.open)) return { ok: true, chip: null };
  const openCount = entry.open.length;
  const mergedCount = Array.isArray(entry.merged) ? entry.merged.length : 0;
  if (openCount === 0 && mergedCount === 0) return { ok: true, chip: null };
  const ageMs = Date.now() - gh.at;
  return {
    ok: true,
    chip: {
      repo: entry.name,
      open: openCount,
      merged: mergedCount,
      total: openCount + mergedCount,
      ageMs,
      stale: ageMs > PR_CHIP_STALE_MS,
    },
  };
}

function spanRun(p: { date?: string; record?: boolean } = {}): Record<string, unknown> {
  const span = require('./span') as typeof import('./span');
  let dayStart: Date | null;
  if (p.date) {
    dayStart = span.parseLocalDate(p.date);
    if (!dayStart) return { ok: false, error: 'span.run: date must be YYYY-MM-DD' };
  } else {
    const now = new Date();
    dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const record = span.computeSpanRecord(dayStart);
  const recordedTo = p.record ? span.upsertSpanRecord(record) : undefined;
  return recordedTo ? { ok: true, span: record, recordedTo } : { ok: true, span: record };
}

async function pulseRun(p: { repo?: string; lane?: string; fresh?: boolean } = {}): Promise<Record<string, unknown>> {
  const { runPulse } = require('./pulse') as typeof import('./pulse');
  let out = '';
  let err = '';
  const code = await runPulse(
    { json: true, repo: p.repo, lane: p.lane, fresh: !!p.fresh },
    { out: (s: string) => { out += `${s}\n`; }, err: (s: string) => { err += `${s}\n`; } }
  );
  if (code !== 0) return { ok: false, error: err.trim() || `pulse exited ${code}` };
  try { return { ok: true, pulse: JSON.parse(out) }; }
  catch { return { ok: false, error: 'pulse produced unparseable output' }; }
}

export type CommandHandler = (params: any, ctx: { source: string }) => Record<string, unknown> | Promise<Record<string, unknown>>;

const DIRECT_HANDLERS: Record<string, CommandHandler> = {
  'sessions.list': (p) => { const { listRecent } = require('./sessions'); return { ok: true, rows: listRecent(p || {}) }; },
  'session.detail': (p) => sessionDetail(p),
  'session.timeline': (p) => sessionTimeline(p),
  'skills.aggregate': (p) => { const { aggregateSkills } = require('./sessions'); return { ok: true, agg: aggregateSkills(p || {}) }; },
  'notes.list': (p) => { const { readNotes } = require('./sessions'); return { ok: true, notes: readNotes(p || {}) }; },
  'inbox.threads': (p) => ({ ok: true, threads: inboxThreads(p || {}) }),
  'note.post': (p) => postNote(p),
  'span.run': (p) => spanRun(p),
  'pulse.run': (p) => pulseRun(p),
  'pulse.pr-chip': (p) => prChip(p),
  'summary.budget': (p) => {
    const { budgetStatus, DEFAULT_DAILY_BUDGET_USD } = require('./summary-budget');
    const daily = Number.isFinite(p.dailyBudgetUSD) ? p.dailyBudgetUSD : DEFAULT_DAILY_BUDGET_USD;
    return { ok: true, budget: budgetStatus(daily) };
  },
  'app.commands': () => ({ ok: true, commands: listCommands() }),
};

export interface RegistryInvokeCtx {
  source?: string;
}

export interface Registry {
  invoke: (name: string, params: unknown, ctx?: RegistryInvokeCtx) => Promise<Record<string, unknown>>;
  has: (name: string) => boolean;
  list: () => CommandSummary[];
}

// ---- the registry: validate, dispatch, log. One choke point. ----
export function createRegistry(opts: { log?: EventLog; handlers?: Record<string, CommandHandler> } = {}): Registry {
  const log = opts.log || createEventLog();
  const handlers: Record<string, CommandHandler> = Object.assign({}, DIRECT_HANDLERS, opts.handlers || {});
  async function invoke(name: string, params: unknown, ctx: RegistryInvokeCtx = {}): Promise<Record<string, unknown>> {
    const source = ctx.source || 'unknown';
    const started = Date.now();
    const decl = COMMANDS_BY_NAME.get(name);
    const finish = (result: Record<string, unknown>, kind: CommandKind | 'unknown'): Record<string, unknown> => {
      log.append({
        ts: new Date(started).toISOString(),
        name: String(name).slice(0, DIGEST_MAX_STR),
        kind,
        source,
        paramsDigest: digestParams(params),
        ok: result.ok !== false,
        ms: Date.now() - started,
      });
      return result;
    };
    if (!decl) return finish({ ok: false, error: `unknown command "${name}" (see app.commands)` }, 'unknown');
    const v = validateParams(decl, params);
    if (!v.ok) return finish({ ok: false, error: v.error }, decl.kind);
    const handler = handlers[name];
    if (!handler) return finish({ ok: false, error: `command "${name}" is only available through the running desktop app` }, decl.kind);
    let result: Record<string, unknown>;
    try { result = await handler(v.params, { source }); }
    catch (err) { result = { ok: false, error: String((err as Error)?.message || err) }; }
    if (!result || typeof result !== 'object') result = { ok: false, error: 'command returned nothing' };
    return finish(result, decl.kind);
  }
  return { invoke, has: (name: string) => COMMANDS_BY_NAME.has(name), list: listCommands };
}

// ---- control socket: the local API surface ----
// One JSON request per connection ({name, params}, newline or half-close
// terminated), one JSON response ({ok, ...} or {ok:false, error}). The socket
// exposes exactly the registry, nothing more. Trust model: the socket is a
// 0600 unix socket in $HOME, so any process running as your uid can drive the
// app, same as it could edit your files; that is the accepted local-trust
// tradeoff for a personal tool. Never a TCP port, never network-exposed.
const SOCKET_MAX_REQUEST = 256 * 1024;

export interface ControlServer {
  listen: (cb?: () => void) => void;
  close: (cb?: () => void) => void;
  socketPath: string;
  server: net.Server;
}

export function createControlServer(opts: { registry: Registry; socketPath?: string; onError?: (err: Error) => void }): ControlServer {
  const registry = opts.registry;
  const socketPath = opts.socketPath || controlSocketPath();
  const onError = opts.onError || (() => {});
  const server = net.createServer((conn) => {
    let buf = '';
    let handled = false;
    const respond = (obj: Record<string, unknown>) => { try { conn.end(`${JSON.stringify(obj)}\n`); } catch { /* peer gone */ } };
    const handle = async (raw: string) => {
      if (handled) return;
      handled = true;
      let req: any;
      try { req = JSON.parse(raw); } catch { respond({ ok: false, error: 'invalid JSON request' }); return; }
      if (!req || typeof req.name !== 'string') { respond({ ok: false, error: 'request must be {name, params}' }); return; }
      respond(await registry.invoke(req.name, req.params || {}, { source: 'socket' }));
    };
    conn.on('data', (d) => {
      buf += d;
      if (buf.length > SOCKET_MAX_REQUEST) { conn.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl !== -1) handle(buf.slice(0, nl));
    });
    conn.on('end', () => { if (!handled && buf.trim()) handle(buf); });
    conn.on('error', () => {});
  });
  server.on('error', onError);
  function listen(cb?: () => void): void {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    try { fs.unlinkSync(socketPath); } catch { /* no stale socket */ }
    server.listen(socketPath, () => {
      try { fs.chmodSync(socketPath, 0o600); } catch { /* best effort */ }
      if (cb) cb();
    });
  }
  function close(cb?: () => void): void {
    try {
      server.close(() => {
        try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
        if (cb) cb();
      });
    } catch { if (cb) cb(); }
  }
  return { listen, close, socketPath, server };
}

// One request against a (possibly absent) running app. Resolves to the app's
// response, or { ok: false, transport: 'unavailable' } when nothing listens,
// so callers can distinguish "app said no" from "no app".
export function socketRequest(name: string, params?: unknown, opts: { socketPath?: string; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
  const socketPath = opts.socketPath || controlSocketPath();
  const timeoutMs = opts.timeoutMs || 210000; // session.ask can retry through ~3 minutes
  return new Promise((resolve) => {
    let conn: net.Socket;
    try { conn = net.connect(socketPath); }
    catch { resolve({ ok: false, transport: 'unavailable' }); return; }
    let buf = '';
    let settled = false;
    const settle = (v: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      try { conn.destroy(); } catch { /* already closed */ }
      resolve(v);
    };
    const parse = (raw: string) => {
      try { settle(JSON.parse(raw)); }
      catch { settle({ ok: false, error: 'invalid JSON from the app' }); }
    };
    conn.setTimeout(timeoutMs, () => settle({ ok: false, error: `timed out after ${timeoutMs}ms waiting for the app`, transport: 'timeout' }));
    conn.on('connect', () => { conn.write(`${JSON.stringify({ name, params: params || {} })}\n`); });
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl !== -1) parse(buf.slice(0, nl));
    });
    conn.on('end', () => { if (buf.trim()) parse(buf); else settle({ ok: false, transport: 'unavailable' }); });
    conn.on('error', () => settle({ ok: false, transport: 'unavailable' }));
  });
}

export { controlDir, controlSocketPath };
