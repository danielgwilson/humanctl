// The hub, client side and glue: config, origin stamping, host-scoped tokens,
// the push client, the session digest, and re-exports of the store and server
// so bin/humanctl.ts and lib/commands.ts need one require. Design: docs/hub.md.

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import { URL } from 'url';

import { hubDir, safeHost, safeWorkspace, type DigestSession, type HubEventKind, type HubStore, type IngestInput, type Origin } from './hub-store';
import { CLIENT_HEADER } from './hub-server';

export * from './hub-store';
export * from './hub-server';

function home(): string { return process.env.HOME || os.homedir(); }

// ---- hub.ingest, one shape --------------------------------------------------

// The registry-facing result of appending one event: used by the default
// hub.ingest handler (lib/commands.ts) and by `hub serve`, which binds the
// same command to its own store instance. One helper, so the two can never
// disagree about what the response carries (the conflict field included).
export function ingestIntoStore(store: HubStore, p: { kind: HubEventKind; origin: Origin; payload: Record<string, unknown>; id?: string }): Record<string, unknown> {
  const r = store.append({ kind: p.kind, origin: p.origin, payload: p.payload, id: p.id });
  return r.ok ? { ok: true, event: r.event, deduped: r.deduped, conflict: r.conflict } : { ok: false, error: r.error };
}

// ---- client config ----------------------------------------------------------

export function hubConfigPath(): string { return path.join(home(), '.humanctl', 'hub.json'); }

export interface HubConfig { url: string; token?: string }

// Env overrides the file per process: that is how a sandbox or a cron job is
// pointed at the hub without touching the machine's config.
export function readHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig | null {
  const envUrl = env.HUMANCTL_HUB_URL;
  const envToken = env.HUMANCTL_HUB_TOKEN;
  if (envUrl) return { url: envUrl.replace(/\/+$/, ''), token: envToken || undefined };
  try {
    const raw = JSON.parse(fs.readFileSync(hubConfigPath(), 'utf8'));
    if (raw && typeof raw.url === 'string' && raw.url) {
      return { url: String(raw.url).replace(/\/+$/, ''), token: envToken || (typeof raw.token === 'string' && raw.token ? raw.token : undefined) };
    }
  } catch { /* no config */ }
  return null;
}

export function writeHubConfig(cfg: HubConfig | null): string {
  const file = hubConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!cfg) { fs.rmSync(file, { force: true }); return file; }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

// Loopback, RFC 1918, the CGNAT range overlay networks use, link-local, ULA,
// and *.ts.net count as private. Everything else is treated as public, which
// switches the digest to ids-and-states only unless --titles says otherwise.
export function isPrivateHubUrl(url: string): boolean {
  let name = '';
  try { name = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return false; }
  if (name === 'localhost' || name.endsWith('.ts.net') || name.endsWith('.local')) return true;
  if (net.isIPv4(name)) {
    const [a, b] = name.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  if (net.isIPv6(name)) return name === '::1' || name.startsWith('fc') || name.startsWith('fd') || name.startsWith('fe80');
  return false;
}

// ---- origin -----------------------------------------------------------------

// Explicit wins; inference is a convenience for the origin chip, never
// something the queue depends on. Pinned by lib/hub.selftest.ts.
export function inferHarness(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HUMANCTL_HARNESS;
  if (explicit) return String(explicit).trim().toLowerCase().slice(0, 32) || 'unknown';
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return 'claude-code';
  if (env.CODEX_SANDBOX || env.CODEX_THREAD_ID || env.CODEX_HOME) return 'codex';
  return 'unknown';
}

// Two checkouts on one machine can hold the same ask id, so the namespace
// carries the workspace: the directory's basename plus a short hash of its
// full path, readable and unique enough.
export function workspaceTag(cwd: string): string {
  const resolved = path.resolve(cwd);
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 6);
  return safeWorkspace(`${path.basename(resolved) || 'root'}-${hash}`);
}

export function detectOrigin(extra: Partial<Origin> = {}, env: NodeJS.ProcessEnv = process.env): Origin {
  const cwd = extra.cwd || process.cwd();
  const origin: Origin = {
    host: safeHost(extra.host || env.HUMANCTL_HOST || os.hostname() || 'unknown-host'),
    workspace: extra.workspace ? safeWorkspace(extra.workspace) : workspaceTag(cwd),
    harness: extra.harness || inferHarness(env),
    cwd,
    repo: extra.repo || path.basename(cwd),
  };
  const session = extra.session || env.HUMANCTL_SESSION;
  if (session) origin.session = String(session).slice(0, 128);
  const agent = extra.agent || env.HUMANCTL_AGENT;
  if (agent) origin.agent = String(agent).slice(0, 64);
  return origin;
}

// ---- host-scoped tokens (hub side) ------------------------------------------

export interface TokenRecord { host: string; label?: string; createdAt: string; prefix: string }
export interface TokenStore {
  file: string;
  issue: (host: string, label?: string) => { token: string; record: TokenRecord };
  list: () => TokenRecord[];
  revoke: (prefix: string) => number;
  resolve: (token: string) => string | null;
}

export function createTokenStore(dir: string = hubDir()): TokenStore {
  const file = path.join(dir, 'tokens.json');
  let cache: Record<string, TokenRecord> = {};
  let cacheMtime = -1;
  function load(): Record<string, TokenRecord> {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { cache = {}; cacheMtime = -1; return cache; }
    if (mtime === cacheMtime) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { cache = {}; }
    cacheMtime = mtime;
    return cache;
  }
  function save(next: Record<string, TokenRecord>): void {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
    cacheMtime = -1;
  }
  const digest = (t: string): string => crypto.createHash('sha256').update(t).digest('hex');
  return {
    file,
    issue: (host, label) => {
      const token = `hct_${crypto.randomBytes(24).toString('hex')}`;
      const record: TokenRecord = { host: safeHost(host), label: label ? String(label).slice(0, 64) : undefined, createdAt: new Date().toISOString(), prefix: token.slice(0, 10) };
      const all = { ...load(), [digest(token)]: record };
      save(all);
      return { token, record };
    },
    list: () => Object.values(load()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    revoke: (prefix) => {
      const all = load();
      let n = 0;
      for (const [k, v] of Object.entries(all)) if (v.prefix === prefix || v.host === prefix) { delete all[k]; n += 1; }
      if (n) save(all);
      return n;
    },
    resolve: (token) => {
      if (typeof token !== 'string' || !token.startsWith('hct_')) return null;
      const rec = load()[digest(token)];
      return rec ? rec.host : null;
    },
  };
}

// ---- push client ------------------------------------------------------------

export interface HubHttpResult { ok: boolean; status: number; json?: Record<string, unknown>; error?: string }

export function hubRequest(cfg: HubConfig, method: string, pathname: string, body?: unknown, opts: { timeoutMs?: number } = {}): Promise<HubHttpResult> {
  return new Promise((resolve) => {
    let target: URL;
    try { target = new URL(pathname, `${cfg.url}/`); } catch { resolve({ ok: false, status: 0, error: `bad hub url "${cfg.url}"` }); return; }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const headers: Record<string, string> = { Accept: 'application/json', [CLIENT_HEADER]: 'cli' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(payload.length); }
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(target, { method, headers, timeout: opts.timeoutMs ?? 8000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode || 0;
        let json: Record<string, unknown> | undefined;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not json */ }
        const ok = status >= 200 && status < 300 && (!json || json.ok !== false);
        resolve({ ok, status, json, error: ok ? undefined : String(json?.error || `hub responded ${status}`) });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    req.on('error', (err) => resolve({ ok: false, status: 0, error: `hub unreachable: ${err.message}` }));
    if (payload) req.write(payload);
    req.end();
  });
}

export function pushEvent(cfg: HubConfig, input: IngestInput): Promise<HubHttpResult> {
  return hubRequest(cfg, 'POST', '/api/ingest', { ...input, id: input.id || `evt_${crypto.randomUUID().slice(0, 12)}` });
}

export function askPath(origin: Pick<Origin, 'host' | 'workspace'>, askId: string): string {
  return `/api/asks/${encodeURIComponent(origin.host)}/${encodeURIComponent(origin.workspace)}/${encodeURIComponent(askId)}`;
}

// ---- digest -----------------------------------------------------------------

export interface DigestOpts { limit?: number; maxAgeH?: number; titles?: boolean; origin?: Partial<Origin> }

// Whitelist, not blacklist: only these fields of a session row leave the
// machine. lastUser / prevAgent / customTitle carry transcript text and are
// never forwarded; cwd is dropped too (repo basename is enough for a chip).
// A session's title is derived from its first prompt and can hold anything
// the human typed, so it is clipped and can be withheld (titles: false).
export function buildDigest(opts: DigestOpts = {}): { origin: Origin; payload: Record<string, unknown> } {
  const { listRecent, isNeedsYou, isWorking } = require('./sessions') as typeof import('./sessions');
  const rows = listRecent({ maxAgeH: opts.maxAgeH ?? 72, limit: opts.limit ?? 60, withUsage: true });
  const titles = opts.titles !== false;
  const sessions: DigestSession[] = rows.map((r) => ({
    harness: r.harness, id: r.id, repo: r.repo,
    title: titles ? String(r.title || '').slice(0, 120) : '',
    state: r.state, stateReason: titles ? String(r.stateReason || '').slice(0, 120) : '', tier: r.tier,
    lastActiveMs: r.lastActiveMs, contextPct: r.contextPct ?? null, costUSD: r.costUSD ?? r.apiEquivUSD ?? null, model: r.model,
  }));
  const origin = detectOrigin({ ...opts.origin, cwd: opts.origin?.cwd || home(), workspace: 'fleet', repo: 'fleet' });
  delete origin.cwd;
  delete origin.repo;
  return {
    origin,
    payload: { needsYou: rows.filter(isNeedsYou).length, working: rows.filter(isWorking).length, sessions, titles, generatedAt: new Date().toISOString() },
  };
}
