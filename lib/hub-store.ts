// The hub store: the folded state behind `humanctl hub`, and the files that
// back it. Design: docs/hub.md. Electron-free; selftested by lib/hub.selftest.ts.
//
// Durable writes are one appended line (ingest.jsonl), one whole-file replace
// (a digest, an artifact body), or nothing (a poll). State is folded from the
// files at boot and updated in memory on every write, so a state read never
// re-reads the log. Every id that becomes a path component or a key segment
// passes isSafeName; everything free-text is clipped.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

function home(): string { return process.env.HOME || os.homedir(); }
export function hubDir(): string { return path.join(home(), '.humanctl', 'hub'); }

const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isSafeName(v: unknown): v is string {
  return typeof v === 'string' && SAFE_NAME_RE.test(v) && v !== '.' && v !== '..';
}

export function safeHost(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 64);
  return v || 'unknown-host';
}

export function safeWorkspace(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80);
  return v || 'default';
}

// ---- origin -----------------------------------------------------------------

export interface Origin {
  host: string;
  workspace: string;
  harness?: string;
  session?: string;
  cwd?: string;
  repo?: string;
  agent?: string;
}

export function normalizeOrigin(raw: unknown): Origin | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.host !== 'string' || !o.host) return null;
  const out: Origin = { host: safeHost(o.host), workspace: safeWorkspace(o.workspace) };
  for (const k of ['harness', 'session', 'cwd', 'repo', 'agent'] as const) {
    if (typeof o[k] === 'string' && o[k]) out[k] = String(o[k]).slice(0, k === 'cwd' ? 512 : 128);
  }
  return out;
}

// ---- events -----------------------------------------------------------------

export const HUB_EVENT_KINDS = ['note', 'note.ack', 'ask.upsert', 'ask.answer', 'ask.close', 'artifact.put', 'digest'] as const;
export type HubEventKind = typeof HUB_EVENT_KINDS[number];

export interface HubEvent {
  id: string;
  ts: string;
  kind: HubEventKind;
  origin: Origin;
  payload: Record<string, unknown>;
}

export interface IngestInput {
  kind: HubEventKind;
  origin: Origin;
  payload: Record<string, unknown>;
  id?: string;
}

export const ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;
export const ARTIFACT_HOST_QUOTA_BYTES = 256 * 1024 * 1024;
const DIGEST_MAX_SESSIONS = 200;
const TEXT_MAX = 4000;
export const WAITING_WINDOW_MS = 2 * 60 * 1000;

function clip(v: unknown, max = TEXT_MAX): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

// ---- folded state -----------------------------------------------------------

export type QueueGroup = 'blocked' | 'decide' | 'needs-words' | 'review';
export const QUEUE_GROUP_ORDER: QueueGroup[] = ['blocked', 'decide', 'needs-words', 'review'];

export interface HubOption { id: string; label: string; description?: string; recommended?: boolean }
export interface HubAnswer { choiceId?: string; note?: string; answeredAt: string; actor: string; via: 'hub' | 'origin' }
export interface HubClose { status: string; proceededWith?: string; note?: string; closedAt: string }

export interface HubAsk {
  key: string;
  host: string;
  workspace: string;
  id: string;
  title: string;
  prompt?: string;
  summary?: string;
  status: string;
  escalation: string;
  reason?: string;
  unblocks?: string;
  whyNow?: string;
  ifIgnored?: string;
  options: HubOption[];
  recommendedId?: string;
  recommendedExplicit: boolean;
  artifactIds: string[];
  origin: Origin;
  createdAt: string;
  updatedAt: string;
  receivedAt: string;
  answer?: HubAnswer;
  close?: HubClose;
  lastPolledAt?: string;
}

export interface HubNote {
  key: string;
  host: string;
  workspace: string;
  id: string;
  ts: string;
  level: string;
  message: string;
  repo?: string;
  cwd?: string;
  session?: string;
  agent?: string;
  artifactIds: string[];
  origin: Origin;
  ackedAt?: string;
  supersededAt?: string;
  supersededBy?: string;
}

export interface HubArtifact {
  key: string;
  host: string;
  workspace: string;
  id: string;
  title: string;
  kind: string;
  summary?: string;
  render: { type: string; entry: string };
  updatedAt: string;
  url: string;
}

export interface DigestSession {
  harness: string;
  id: string;
  repo: string;
  title: string;
  state: string;
  stateReason: string;
  tier: string;
  lastActiveMs: number;
  contextPct?: number | null;
  costUSD?: number | null;
  model?: string;
}

export interface HubDigest {
  host: string;
  ts: string;
  needsYou: number;
  working: number;
  sessions: DigestSession[];
  titles: boolean;
  origin: Origin;
}

export interface QueueItem {
  type: 'ask' | 'note';
  group: QueueGroup;
  key: string;
  host: string;
  workspace: string;
  id: string;
  title: string;
  detail?: string;
  origin: Origin;
  ts: string;
  waiting: boolean;
  ask?: HubAsk;
  note?: HubNote;
  artifacts: HubArtifact[];
}

export interface RecentItem {
  type: 'ask' | 'note';
  key: string;
  host: string;
  workspace: string;
  id: string;
  title: string;
  detail?: string;
  outcome: string;
  origin: Origin;
  ts: string;
}

export interface HubState {
  generatedAt: string;
  counts: { needsYou: number; blocked: number; decide: number; needsWords: number; review: number };
  queue: QueueItem[];
  fleet: HubDigest[];
  recent: RecentItem[];
  origins: string[];
}

export function itemKey(host: string, workspace: string, id: string): string { return `${host}/${workspace}/${id}`; }

// The one place that decides which group an ask belongs to. Decide is earned
// on signals that are only present when the agent supplied them: an explicit
// recommended option plus a reason. The CLI always fills in placeholder
// options, so "has options" says nothing.
export function askGroup(ask: Pick<HubAsk, 'status' | 'escalation' | 'recommendedId' | 'recommendedExplicit' | 'reason' | 'answer' | 'close'>): QueueGroup | null {
  if (ask.answer || ask.close) return null;
  if (['answered', 'closed', 'deleted', 'withdrawn', 'expired'].includes(ask.status)) return null;
  if (ask.escalation === 'block' || ask.status === 'blocked') return 'blocked';
  if (ask.recommendedExplicit && ask.recommendedId && ask.reason) return 'decide';
  return 'needs-words';
}

export function noteGroup(note: Pick<HubNote, 'level' | 'ackedAt' | 'supersededAt'>): QueueGroup | null {
  if (note.ackedAt || note.supersededAt) return null;
  if (note.level === 'blocked') return 'blocked';
  if (note.level === 'review') return 'review';
  return null;
}

interface FoldState {
  asks: Map<string, HubAsk>;
  notes: Map<string, HubNote>;
  artifacts: Map<string, HubArtifact>;
  digests: Map<string, HubDigest>;
  seen: Set<string>;
}

function parseOptions(raw: unknown): HubOption[] {
  const out: HubOption[] = [];
  if (!Array.isArray(raw)) return out;
  for (const o of raw.slice(0, 12)) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.label !== 'string') continue;
    out.push({ id: r.id.slice(0, 64), label: r.label.slice(0, 120), description: clip(r.description, 400), recommended: r.recommended === true });
  }
  return out;
}

function askFromPayload(ev: HubEvent, prev?: HubAsk): HubAsk | null {
  const p = ev.payload;
  const id = p.id;
  if (!isSafeName(id)) return null;
  const response = (p.response && typeof p.response === 'object' ? p.response : {}) as Record<string, unknown>;
  const options = parseOptions(response.options ?? p.options);
  const recommended = options.find((o) => o.recommended);
  const recommendedExplicit = response.recommendedBy === 'agent';
  const answerRaw = response.answer as Record<string, unknown> | undefined;
  const explicitAnswer: HubAnswer | undefined = answerRaw && typeof answerRaw === 'object' && typeof answerRaw.answeredAt === 'string'
    ? { choiceId: clip(answerRaw.choiceId, 64), note: clip(answerRaw.note, 2000), answeredAt: answerRaw.answeredAt, actor: clip(answerRaw.actor, 32) || 'human', via: 'origin' }
    : undefined;
  const updatedAt = typeof p.updatedAt === 'string' ? p.updatedAt : ev.ts;
  const status = typeof p.status === 'string' ? p.status.slice(0, 32) : (explicitAnswer ? 'answered' : 'open');
  // An upsert that carries no answer and an open status, newer than what the
  // hub holds, is a reopen (a cleared answer, a re-created ask, an edit made
  // before the answer was picked up). Otherwise a hub-side answer the origin
  // has not seen yet survives the upsert.
  const reopening = !explicitAnswer && (status === 'open' || status === 'blocked');
  const answer = explicitAnswer || (prev?.answer && !(reopening && updatedAt > prev.answer.answeredAt) ? prev.answer : undefined);
  const closeRaw = p.close as Record<string, unknown> | undefined;
  const explicitClose: HubClose | undefined = closeRaw && typeof closeRaw === 'object' && typeof closeRaw.closedAt === 'string'
    ? { status: clip(closeRaw.status, 32) || 'closed', proceededWith: clip(closeRaw.proceededWith, 64), note: clip(closeRaw.note, 500), closedAt: closeRaw.closedAt }
    : undefined;
  const close = explicitClose || (prev?.close && !(reopening && updatedAt > prev.close.closedAt) ? prev.close : undefined);
  return {
    key: itemKey(ev.origin.host, ev.origin.workspace, id),
    host: ev.origin.host,
    workspace: ev.origin.workspace,
    id,
    title: clip(p.title, 300) || id,
    prompt: clip(p.prompt),
    summary: clip(p.summary, 1000),
    status,
    escalation: typeof p.escalation === 'string' ? p.escalation.slice(0, 16) : 'ask',
    reason: clip(p.reason, 300),
    unblocks: clip(p.unblocks, 300),
    whyNow: clip(p.whyNow, 300),
    ifIgnored: clip(p.ifIgnored, 300),
    options,
    recommendedId: recommended?.id,
    recommendedExplicit,
    artifactIds: Array.isArray(p.artifactIds) ? (p.artifactIds as unknown[]).filter(isSafeName).slice(0, 12) : [],
    origin: ev.origin,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : prev?.createdAt || ev.ts,
    updatedAt,
    receivedAt: ev.ts,
    answer,
    close,
    lastPolledAt: prev?.lastPolledAt,
  };
}

// Only the hub's own page may address another origin's item (its answers and
// acks carry host/workspace in the payload). Every other sender, token-scoped
// or not, can act only inside its own namespace, whatever its payload claims.
function targetKey(ev: HubEvent, idField: string): string {
  const p = ev.payload;
  const fromHub = ev.origin.host === 'hub';
  const host = fromHub && typeof p.host === 'string' ? safeHost(p.host) : ev.origin.host;
  const ws = fromHub && typeof p.workspace === 'string' ? safeWorkspace(p.workspace) : ev.origin.workspace;
  return itemKey(host, ws, String(p[idField] || p.id || ''));
}

function applyEvent(st: FoldState, ev: HubEvent): void {
  const p = ev.payload || {};
  switch (ev.kind) {
    case 'note': {
      const id = isSafeName(p.id) ? p.id : ev.id;
      const key = itemKey(ev.origin.host, ev.origin.workspace, id);
      const prev = st.notes.get(key);
      const level = ['fyi', 'review', 'blocked', 'done'].includes(p.level as string) ? String(p.level) : 'fyi';
      const session = clip(p.session, 128) || ev.origin.session;
      const note: HubNote = {
        key, host: ev.origin.host, workspace: ev.origin.workspace, id,
        ts: typeof p.ts === 'string' ? p.ts : ev.ts,
        level,
        message: clip(p.message, 2000) || '',
        repo: clip(p.repo, 128), cwd: clip(p.cwd, 512), session, agent: clip(p.agent, 64),
        artifactIds: Array.isArray(p.artifactIds) ? (p.artifactIds as unknown[]).filter(isSafeName).slice(0, 4) : [],
        origin: ev.origin,
        ackedAt: prev?.ackedAt,
        supersededAt: prev?.supersededAt,
        supersededBy: prev?.supersededBy,
      };
      st.notes.set(key, note);
      // A done note from the same session settles that session's earlier
      // open blocked/review notes: the agent moved on, the human need not tap.
      if (level === 'done' && session) {
        for (const other of st.notes.values()) {
          if (other.key === key || other.host !== note.host || other.session !== session) continue;
          if (other.ts < note.ts && !other.ackedAt && !other.supersededAt && (other.level === 'blocked' || other.level === 'review')) {
            other.supersededAt = note.ts;
            other.supersededBy = note.id;
          }
        }
      }
      return;
    }
    case 'note.ack': {
      const n = st.notes.get(targetKey(ev, 'noteId'));
      if (n && !n.ackedAt) n.ackedAt = ev.ts;
      return;
    }
    case 'ask.upsert': {
      const next = askFromPayload(ev, st.asks.get(itemKey(ev.origin.host, ev.origin.workspace, String(p.id))));
      if (next) st.asks.set(next.key, next);
      return;
    }
    case 'ask.answer': {
      const a = st.asks.get(targetKey(ev, 'askId'));
      if (!a || a.answer) return; // first answer wins; a later one stays in the log only
      a.answer = { choiceId: clip(p.choiceId, 64), note: clip(p.note, 2000), answeredAt: ev.ts, actor: clip(p.actor, 32) || 'human', via: ev.origin.host === 'hub' ? 'hub' : 'origin' };
      a.status = 'answered';
      a.updatedAt = ev.ts;
      return;
    }
    case 'ask.close': {
      const a = st.asks.get(targetKey(ev, 'askId'));
      if (!a || a.close) return;
      const status = ['withdrawn', 'deleted', 'expired', 'closed'].includes(p.status as string) ? String(p.status) : 'closed';
      a.close = { status, proceededWith: clip(p.proceededWith, 64), note: clip(p.note, 500), closedAt: ev.ts };
      a.status = status;
      a.updatedAt = ev.ts;
      return;
    }
    case 'artifact.put': {
      const m = (p.manifest && typeof p.manifest === 'object' ? p.manifest : p) as Record<string, unknown>;
      const id = m.id;
      const render = m.render as Record<string, unknown> | undefined;
      const entry = render?.entry;
      if (!isSafeName(id) || !isSafeName(entry)) return;
      const key = itemKey(ev.origin.host, ev.origin.workspace, id);
      st.artifacts.set(key, {
        key, host: ev.origin.host, workspace: ev.origin.workspace, id,
        title: clip(m.title, 300) || id,
        kind: clip(m.kind, 32) || 'preview',
        summary: clip(m.summary, 1000),
        render: { type: clip(render?.type, 32) || 'file', entry },
        updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : ev.ts,
        url: `/a/${encodeURIComponent(ev.origin.host)}/${encodeURIComponent(ev.origin.workspace)}/${encodeURIComponent(id)}/${encodeURIComponent(entry)}`,
      });
      return;
    }
    case 'digest': {
      const sessionsRaw = Array.isArray(p.sessions) ? (p.sessions as unknown[]) : [];
      const sessions: DigestSession[] = [];
      for (const s of sessionsRaw.slice(0, DIGEST_MAX_SESSIONS)) {
        if (!s || typeof s !== 'object') continue;
        const r = s as Record<string, unknown>;
        sessions.push({
          harness: clip(r.harness, 32) || 'unknown', id: clip(r.id, 128) || '', repo: clip(r.repo, 128) || '',
          title: clip(r.title, 120) || '', state: clip(r.state, 16) || 'idle', stateReason: clip(r.stateReason, 120) || '', tier: clip(r.tier, 16) || 'hot',
          // A finite, in-range epoch only: an absurd value would throw inside
          // the page's date formatting and blank the whole surface.
          lastActiveMs: typeof r.lastActiveMs === 'number' && Number.isFinite(r.lastActiveMs) && Math.abs(r.lastActiveMs) <= 8.64e15 ? r.lastActiveMs : 0,
          contextPct: typeof r.contextPct === 'number' ? r.contextPct : null,
          costUSD: typeof r.costUSD === 'number' ? r.costUSD : null,
          model: clip(r.model, 64),
        });
      }
      st.digests.set(ev.origin.host, {
        host: ev.origin.host, ts: ev.ts,
        needsYou: typeof p.needsYou === 'number' ? p.needsYou : sessions.filter((s) => s.state === 'need' && s.tier !== 'archived').length,
        working: typeof p.working === 'number' ? p.working : sessions.filter((s) => s.state === 'work' && s.tier !== 'archived').length,
        sessions, titles: p.titles !== false, origin: ev.origin,
      });
      return;
    }
  }
}

function buildState(st: FoldState, now: number): HubState {
  const queue: QueueItem[] = [];
  const recent: RecentItem[] = [];
  const artifactsFor = (host: string, ws: string, ids: string[]): HubArtifact[] =>
    ids.map((id) => st.artifacts.get(itemKey(host, ws, id))).filter((a): a is HubArtifact => !!a);
  for (const a of st.asks.values()) {
    const group = askGroup(a);
    const base = { key: a.key, host: a.host, workspace: a.workspace, id: a.id, title: a.title, origin: a.origin };
    if (group) {
      const rec = a.recommendedExplicit && a.recommendedId ? a.options.find((o) => o.id === a.recommendedId) : undefined;
      const detail = rec ? (a.reason ? `${rec.label}: ${a.reason}` : rec.label) : undefined;
      const waiting = !!a.lastPolledAt && now - Date.parse(a.lastPolledAt) < WAITING_WINDOW_MS;
      queue.push({ type: 'ask', group, ...base, detail, ts: a.createdAt, waiting, ask: a, artifacts: artifactsFor(a.host, a.workspace, a.artifactIds) });
    } else if (a.answer) {
      const choice = a.answer.choiceId ? a.options.find((o) => o.id === a.answer!.choiceId)?.label || a.answer.choiceId : undefined;
      recent.push({ type: 'ask', ...base, detail: [choice, a.answer.note].filter(Boolean).join(' · ') || undefined, outcome: 'answered', ts: a.answer.answeredAt });
    } else if (a.close) {
      const took = a.close.proceededWith ? a.options.find((o) => o.id === a.close!.proceededWith)?.label || a.close.proceededWith : undefined;
      recent.push({ type: 'ask', ...base, detail: [took ? `agent took ${took}` : undefined, a.close.note].filter(Boolean).join(' · ') || undefined, outcome: a.close.status, ts: a.close.closedAt });
    } else {
      // A closed status with no close record (an origin restated it without
      // the details) still belongs in Recent, never nowhere.
      recent.push({ type: 'ask', ...base, outcome: a.status, ts: a.updatedAt });
    }
  }
  for (const n of st.notes.values()) {
    const group = noteGroup(n);
    const base = { key: n.key, host: n.host, workspace: n.workspace, id: n.id, title: n.message, origin: n.origin };
    if (group) queue.push({ type: 'note', group, ...base, ts: n.ts, waiting: false, note: n, artifacts: artifactsFor(n.host, n.workspace, n.artifactIds) });
    else if (n.supersededAt) recent.push({ type: 'note', ...base, outcome: 'superseded', ts: n.supersededAt });
    else if (n.ackedAt) recent.push({ type: 'note', ...base, outcome: 'seen', ts: n.ackedAt });
    else recent.push({ type: 'note', ...base, outcome: n.level, ts: n.ts });
  }
  const rank = (g: QueueGroup): number => QUEUE_GROUP_ORDER.indexOf(g);
  queue.sort((x, y) => rank(x.group) - rank(y.group) || Number(y.waiting) - Number(x.waiting) || x.ts.localeCompare(y.ts));
  recent.sort((x, y) => y.ts.localeCompare(x.ts));
  const counts = { needsYou: queue.length, blocked: 0, decide: 0, needsWords: 0, review: 0 };
  for (const q of queue) {
    if (q.group === 'blocked') counts.blocked += 1;
    else if (q.group === 'decide') counts.decide += 1;
    else if (q.group === 'needs-words') counts.needsWords += 1;
    else counts.review += 1;
  }
  const fleet = [...st.digests.values()].sort((x, y) => y.ts.localeCompare(x.ts));
  const origins = new Set<string>();
  for (const q of queue) origins.add(q.host);
  for (const d of fleet) origins.add(d.host);
  for (const r of recent) origins.add(r.host);
  return { generatedAt: new Date(now).toISOString(), counts, queue, fleet, recent: recent.slice(0, 100), origins: [...origins].sort() };
}

// ---- store ------------------------------------------------------------------

export interface AppendResult { ok: true; event: HubEvent; deduped: boolean; conflict?: HubAnswer }
export interface AppendError { ok: false; error: string }

// The log stores what the fold keeps, bounded per event: an artifact's body
// never enters it, a digest is larger by nature, everything else is small.
export const PAYLOAD_MAX_BYTES = 64 * 1024;
export const DIGEST_MAX_BYTES = 1024 * 1024;

export interface HubStore {
  dir: string;
  append: (input: IngestInput) => AppendResult | AppendError;
  putArtifactBody: (origin: Origin, artifactId: string, entry: string, body: Buffer) => { ok: true; path: string } | AppendError;
  artifactPath: (host: string, workspace: string, artifactId: string, entry: string) => string | null;
  state: (now?: number) => HubState;
  getAsk: (host: string, workspace: string, id: string) => HubAsk | null;
  markPolled: (host: string, workspace: string, id: string, now?: number) => void;
  eventCount: () => number;
}

const storeCache = new Map<string, HubStore>();
export function getHubStore(dir?: string): HubStore {
  const d = path.resolve(dir || hubDir());
  const hit = storeCache.get(d);
  if (hit) return hit;
  const s = createHubStore({ dir: d });
  storeCache.set(d, s);
  return s;
}

export function createHubStore(opts: { dir?: string } = {}): HubStore {
  const dir = path.resolve(opts.dir || hubDir());
  const eventsFile = path.join(dir, 'ingest.jsonl');
  const digestsDir = path.join(dir, 'digests');
  const artifactsDir = path.join(dir, 'artifacts');
  const st: FoldState = { asks: new Map(), notes: new Map(), artifacts: new Map(), digests: new Map(), seen: new Set() };
  let count = 0;
  let cached: HubState | null = null;
  let cachedAt = 0;

  function dedupeKey(ev: { kind: string; origin: Origin; id: string }): string { return `${ev.origin.host}:${ev.kind}:${ev.id}`; }

  function load(): void {
    let txt = '';
    try { txt = fs.readFileSync(eventsFile, 'utf8'); } catch { /* fresh hub */ }
    // A process killed mid-append leaves a torn last line. Skip it, and make
    // sure the next append starts on its own line rather than gluing itself
    // onto the fragment (which would lose that write too).
    if (txt && !txt.endsWith('\n')) fs.appendFileSync(eventsFile, '\n', 'utf8');
    for (const line of txt.split('\n')) {
      if (!line) continue;
      let ev: HubEvent;
      try { ev = JSON.parse(line); } catch { continue; }
      if (!ev || typeof ev !== 'object' || !ev.origin || !ev.kind || !ev.id) continue;
      ev.origin = normalizeOrigin(ev.origin) || ev.origin;
      count += 1;
      st.seen.add(dedupeKey(ev));
      applyEvent(st, ev);
    }
    let names: string[] = [];
    try { names = fs.readdirSync(digestsDir).filter((n) => n.endsWith('.json')); } catch { /* none yet */ }
    for (const n of names) {
      try {
        const ev = JSON.parse(fs.readFileSync(path.join(digestsDir, n), 'utf8')) as HubEvent;
        if (ev && ev.kind === 'digest' && ev.origin) { ev.origin = normalizeOrigin(ev.origin) || ev.origin; applyEvent(st, ev); }
      } catch { /* skip a corrupt digest */ }
    }
  }
  load();

  function append(input: IngestInput): AppendResult | AppendError {
    if (!HUB_EVENT_KINDS.includes(input.kind)) return { ok: false, error: `unknown event kind "${String(input.kind)}"` };
    const origin = normalizeOrigin(input.origin);
    if (!origin) return { ok: false, error: 'event needs an origin with a host' };
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) return { ok: false, error: 'event needs an object payload' };
    const id = isSafeName(input.id) ? input.id : `evt_${crypto.randomUUID().slice(0, 12)}`;
    let payload = input.payload;
    if (input.kind === 'artifact.put' && ('content' in payload || 'encoding' in payload)) {
      // The body was written by putArtifactBody; the log keeps the manifest only.
      const { content: _content, encoding: _encoding, ...rest } = payload;
      payload = rest;
    }
    const ev: HubEvent = { id, ts: new Date().toISOString(), kind: input.kind, origin, payload };
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    const cap = ev.kind === 'digest' ? DIGEST_MAX_BYTES : PAYLOAD_MAX_BYTES;
    if (bytes > cap) return { ok: false, error: `${ev.kind} payload is ${bytes} bytes; the cap is ${cap}` };
    const dk = dedupeKey(ev);
    if (input.id && st.seen.has(dk)) return { ok: true, event: ev, deduped: true };
    // First answer wins; a second is kept in the log and reported back so the
    // sender knows the hub already holds a different one.
    const conflict = ev.kind === 'ask.answer' ? st.asks.get(targetKey(ev, 'askId'))?.answer : undefined;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (ev.kind === 'digest') {
      fs.mkdirSync(digestsDir, { recursive: true, mode: 0o700 });
      const file = path.join(digestsDir, `${origin.host}.json`);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(ev), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } else {
      fs.appendFileSync(eventsFile, `${JSON.stringify(ev)}\n`, { encoding: 'utf8', mode: 0o600 });
      count += 1;
    }
    st.seen.add(dk);
    applyEvent(st, ev);
    cached = null;
    return { ok: true, event: ev, deduped: false, conflict };
  }

  function artifactPath(host: string, workspace: string, artifactId: string, entry: string): string | null {
    if (!isSafeName(host) || !isSafeName(workspace) || !isSafeName(artifactId) || !isSafeName(entry)) return null;
    const p = path.resolve(artifactsDir, host, workspace, artifactId, entry);
    if (!p.startsWith(artifactsDir + path.sep)) return null;
    return p;
  }

  // Oldest artifact directories go first once a host is over its byte quota,
  // so one looping sender cannot fill the disk.
  function enforceQuota(hostDir: string): void {
    const dirs: { p: string; mtime: number; bytes: number }[] = [];
    let total = 0;
    let wsNames: string[] = [];
    try { wsNames = fs.readdirSync(hostDir); } catch { return; }
    for (const ws of wsNames) {
      let ids: string[] = [];
      try { ids = fs.readdirSync(path.join(hostDir, ws)); } catch { continue; }
      for (const id of ids) {
        const d = path.join(hostDir, ws, id);
        let bytes = 0; let mtime = 0;
        try {
          for (const f of fs.readdirSync(d)) { const s = fs.statSync(path.join(d, f)); bytes += s.size; mtime = Math.max(mtime, s.mtimeMs); }
        } catch { continue; }
        dirs.push({ p: d, mtime, bytes });
        total += bytes;
      }
    }
    dirs.sort((x, y) => x.mtime - y.mtime);
    while (total > ARTIFACT_HOST_QUOTA_BYTES && dirs.length) {
      const victim = dirs.shift()!;
      try { fs.rmSync(victim.p, { recursive: true, force: true }); } catch { /* best effort */ }
      total -= victim.bytes;
    }
  }

  function putArtifactBody(origin: Origin, artifactId: string, entry: string, body: Buffer): { ok: true; path: string } | AppendError {
    const p = artifactPath(origin.host, origin.workspace, artifactId, entry);
    if (!p) return { ok: false, error: 'artifact host, workspace, id, and entry must be plain names' };
    if (body.length > ARTIFACT_MAX_BYTES) return { ok: false, error: `artifact body exceeds ${ARTIFACT_MAX_BYTES} bytes` };
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, p);
    enforceQuota(path.join(artifactsDir, origin.host));
    return { ok: true, path: p };
  }

  return {
    dir,
    append,
    putArtifactBody,
    artifactPath,
    state: (now = Date.now()) => {
      // The waiting flag depends on the clock, so a cached state is good for a
      // few seconds only; a write clears it immediately.
      if (!cached || now - cachedAt > 5000) { cached = buildState(st, now); cachedAt = now; }
      return cached;
    },
    getAsk: (host, ws, id) => st.asks.get(itemKey(safeHost(host), safeWorkspace(ws), id)) || null,
    markPolled: (host, ws, id, now = Date.now()) => {
      const a = st.asks.get(itemKey(safeHost(host), safeWorkspace(ws), id));
      if (a) { a.lastPolledAt = new Date(now).toISOString(); cached = null; }
    },
    eventCount: () => count,
  };
}
