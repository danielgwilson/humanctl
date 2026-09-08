// The hub's HTTP surface. Design and trust model: docs/hub.md.
//
// Two listeners share one store:
//   - the main listener serves the page, state, answers, acks, artifacts, and
//     accepts pushes from the network it trusts (loopback by default; any
//     other bind address needs --trust-network);
//   - the optional ingest listener serves only POST /api/ingest, GET
//     /api/asks/..., and /healthz, and always requires a host-scoped token.
//     It is what a public tunnel should point at, so the human surface is
//     never on the tunnel.
//
// Browser-side hardening on the main listener, because an artifact is
// agent-authored HTML running in a sandboxed frame on an opaque origin:
//   - every POST must carry Content-Type: application/json and the
//     X-Humanctl-Client header, so a browser must preflight it (and the hub
//     never answers a preflight), which stops no-cors fetches and form posts;
//   - a request with Origin: null or a cross-site Origin / Sec-Fetch-Site is
//     rejected;
//   - the Host header must name an IP literal, localhost, a *.ts.net name, or
//     an --allow-host entry, which defeats DNS rebinding.

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import { URL } from 'url';

import {
  ARTIFACT_MAX_BYTES,
  type AppendError,
  type AppendResult,
  type HubEventKind,
  type HubStore,
  type IngestInput,
  isSafeName,
  normalizeOrigin,
} from './hub-store';

export const HUB_DEFAULT_PORT = 4187;
export const INGEST_MAX_BYTES = ARTIFACT_MAX_BYTES + 2 * 1024 * 1024; // a 4 MB body as base64 plus its manifest
export const CLIENT_HEADER = 'x-humanctl-client';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);
export function isLoopbackAddress(host: string): boolean { return LOOPBACK.has(host.trim().toLowerCase().replace(/^\[|\]$/g, '')); }

export type IngestFn = (input: IngestInput) => Promise<AppendResult | AppendError> | AppendResult | AppendError;
export type ResolveTokenFn = (token: string) => string | null;

export interface HubServerOpts {
  store: HubStore;
  bind?: string;
  port?: number;
  trustNetwork?: boolean;
  allowHosts?: string[];
  page: (nonce: string) => string;
  ingest?: IngestFn;
  resolveToken?: ResolveTokenFn;
}

export interface IngestServerOpts {
  store: HubStore;
  bind?: string;
  port: number;
  ingest?: IngestFn;
  resolveToken: ResolveTokenFn;
}

export interface Listener {
  server: http.Server;
  listen: () => Promise<{ bind: string; port: number; url: string }>;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const txt = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(txt), 'X-Content-Type-Options': 'nosniff' });
  res.end(txt);
}

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

function bearer(req: http.IncomingMessage): string {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function hostnameOf(hostHeader: string | undefined): string {
  const raw = String(hostHeader || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) return raw.slice(1, raw.indexOf(']'));
  const i = raw.lastIndexOf(':');
  return i > -1 && !raw.includes(']') && raw.indexOf(':') === i ? raw.slice(0, i) : raw;
}

export function hostAllowed(hostHeader: string | undefined, allowHosts: string[]): boolean {
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (name === 'localhost' || net.isIP(name)) return true;
  if (name.endsWith('.ts.net')) return true;
  return allowHosts.some((h) => h.toLowerCase() === name);
}

// Rejects requests a browser could have made from another origin. Same-origin
// page fetches pass (their Origin matches Host); CLI pushes pass (no Origin,
// no Sec-Fetch-Site).
export function crossSiteReason(req: http.IncomingMessage): string | null {
  const sfs = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (sfs === 'cross-site') return 'cross-site request';
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const o = String(origin).toLowerCase();
    if (o === 'null') return 'sandboxed origin';
    let originHost = '';
    try { originHost = new URL(o).host; } catch { return 'malformed origin'; }
    if (originHost !== String(req.headers.host || '').toLowerCase()) return 'origin does not match host';
  }
  if ((req.method || 'GET') !== 'GET') {
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('application/json')) return 'content-type must be application/json';
    if (!req.headers[CLIENT_HEADER]) return `missing ${CLIENT_HEADER} header`;
  }
  return null;
}

async function parseJsonBody(req: http.IncomingMessage, res: http.ServerResponse, max: number): Promise<Record<string, unknown> | null> {
  const raw = await readBody(req, max);
  if (raw === null) { sendJson(res, 413, { ok: false, error: `body exceeds ${max} bytes` }); return null; }
  if (!raw.length) return {};
  try {
    const body = JSON.parse(raw.toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { ok: false, error: 'body must be a JSON object' }); return null; }
    return body;
  } catch {
    sendJson(res, 400, { ok: false, error: 'body must be JSON' });
    return null;
  }
}

interface Routes {
  store: HubStore;
  ingest: IngestFn;
  resolveToken?: ResolveTokenFn;
  tokenRequired: boolean;
}

// The routes shared by both listeners. `tokenHost` is the host a valid token
// resolved to: the sender's identity, which overrides whatever origin.host it
// claimed. On the main listener a token is optional; on the ingest listener
// the caller has already required one.
async function handleIngest(r: Routes, req: http.IncomingMessage, res: http.ServerResponse, tokenHost: string | null): Promise<void> {
  if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST only' }); return; }
  const body = await parseJsonBody(req, res, INGEST_MAX_BYTES);
  if (!body) return;
  const origin = normalizeOrigin(body.origin);
  if (!origin) { sendJson(res, 400, { ok: false, error: 'event needs an origin with a host' }); return; }
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : null;
  if (!payload) { sendJson(res, 400, { ok: false, error: 'event needs an object payload' }); return; }
  if (tokenHost) {
    // The token is the sender's identity: it pins the origin, and a payload
    // that names another host is refused outright (the fold would ignore it
    // anyway; refusing makes the attempt visible).
    origin.host = tokenHost;
    if (typeof payload.host === 'string' && payload.host.trim().toLowerCase() !== tokenHost) { sendJson(res, 403, { ok: false, error: 'token is scoped to another host' }); return; }
  }
  const kind = body.kind as HubEventKind;
  if (kind === 'artifact.put') {
    const manifest = (payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : null) as Record<string, unknown> | null;
    const entry = (manifest?.render as Record<string, unknown> | undefined)?.entry;
    if (!manifest || !isSafeName(manifest.id) || !isSafeName(entry)) { sendJson(res, 400, { ok: false, error: 'artifact.put needs manifest.id and manifest.render.entry as plain names' }); return; }
    if (typeof payload.content !== 'string') { sendJson(res, 400, { ok: false, error: 'artifact.put needs string content' }); return; }
    const buf = Buffer.from(payload.content, payload.encoding === 'base64' ? 'base64' : 'utf8');
    const put = r.store.putArtifactBody(origin, manifest.id, entry, buf);
    if (!put.ok) { sendJson(res, 413, put); return; }
  }
  const result = await r.ingest({ kind, origin, payload, id: isSafeName(body.id) ? body.id : undefined });
  if (!result.ok) { sendJson(res, /bytes/.test(result.error) ? 413 : 400, result); return; }
  sendJson(res, 200, { ok: true, id: result.event.id, ts: result.event.ts, deduped: result.deduped, origin, conflict: result.conflict });
}

function handleAskGet(r: Routes, req: http.IncomingMessage, res: http.ServerResponse, host: string, ws: string, id: string): void {
  // The poll has a side effect (the "agent waiting" mark), so it wants the
  // same header a POST does; a bare navigation from an artifact cannot send it.
  if (!req.headers[CLIENT_HEADER]) { sendJson(res, 403, { ok: false, error: `missing ${CLIENT_HEADER} header` }); return; }
  const ask = r.store.getAsk(host, ws, id);
  if (!ask) { sendJson(res, 404, { ok: false, error: 'no such ask' }); return; }
  r.store.markPolled(host, ws, id);
  sendJson(res, 200, { ok: true, ask });
}

function tokenHostFor(r: Routes, req: http.IncomingMessage, res: http.ServerResponse): string | null | false {
  const t = bearer(req);
  if (!t) {
    if (r.tokenRequired) { sendJson(res, 401, { ok: false, error: 'a hub token is required on this listener' }); return false; }
    return null;
  }
  const host = r.resolveToken ? r.resolveToken(t) : null;
  if (!host) { sendJson(res, 401, { ok: false, error: 'unknown or revoked token' }); return false; }
  return host;
}

function segments(req: http.IncomingMessage): string[] | null {
  const url = new URL(req.url || '/', 'http://hub');
  const out: string[] = [];
  for (const p of url.pathname.split('/')) {
    if (!p) continue;
    try { out.push(decodeURIComponent(p)); } catch { return null; }
  }
  return out;
}

export function createHubServer(opts: HubServerOpts): Listener {
  const bind = opts.bind || '127.0.0.1';
  const port = opts.port ?? HUB_DEFAULT_PORT;
  if (!isLoopbackAddress(bind) && !opts.trustNetwork) {
    throw new Error(`listening on ${bind} lets every device on that network read the page and answer as you; pass --trust-network to acknowledge, or keep 127.0.0.1`);
  }
  const allowHosts = opts.allowHosts || [];
  const routes: Routes = { store: opts.store, ingest: opts.ingest || ((i) => opts.store.append(i)), resolveToken: opts.resolveToken, tokenRequired: false };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parts = segments(req);
    if (!parts) { sendJson(res, 400, { ok: false, error: 'bad path' }); return; }
    const method = req.method || 'GET';
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; } // never a CORS grant
    if (!hostAllowed(req.headers.host, allowHosts)) { sendJson(res, 421, { ok: false, error: 'host header not recognized; use an address, localhost, or --allow-host' }); return; }

    if (method === 'GET' && parts.length === 0) {
      const nonce = crypto.randomBytes(16).toString('base64');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      });
      res.end(opts.page(nonce));
      return;
    }
    if (method === 'GET' && parts[0] === 'healthz' && parts.length === 1) { sendJson(res, 200, { ok: true, events: opts.store.eventCount() }); return; }

    if (parts[0] === 'a') {
      if (method !== 'GET') { sendJson(res, 405, { ok: false, error: 'GET only' }); return; }
      const p = parts.length === 5 ? opts.store.artifactPath(parts[1], parts[2], parts[3], parts[4]) : null;
      if (!p || !fs.existsSync(p)) { sendJson(res, 404, { ok: false, error: 'no such artifact' }); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        // Agent-authored content: it may run its own scripts, but on an opaque
        // origin (no cookies, no storage, no hub API as the human).
        'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups; frame-ancestors 'self'",
      });
      fs.createReadStream(p).pipe(res);
      return;
    }

    if (parts[0] !== 'api') { sendJson(res, 404, { ok: false, error: 'not found' }); return; }
    const why = crossSiteReason(req);
    if (why) { sendJson(res, 403, { ok: false, error: why }); return; }

    if (method === 'GET' && parts[1] === 'state' && parts.length === 2) { sendJson(res, 200, { ok: true, ...opts.store.state() }); return; }

    if (parts[1] === 'ingest' && parts.length === 2) {
      const tokenHost = tokenHostFor(routes, req, res);
      if (tokenHost === false) return;
      await handleIngest(routes, req, res, tokenHost);
      return;
    }

    if (parts[1] === 'asks' && (parts.length === 5 || parts.length === 6)) {
      const [, , host, ws, id, action] = parts;
      if (method === 'GET' && parts.length === 5) { handleAskGet(routes, req, res, host, ws, id); return; }
      if (method === 'POST' && action === 'answer') {
        const ask = opts.store.getAsk(host, ws, id);
        if (!ask) { sendJson(res, 404, { ok: false, error: 'no such ask' }); return; }
        if (ask.answer) { sendJson(res, 409, { ok: false, error: 'already answered', answer: ask.answer }); return; }
        if (ask.close) { sendJson(res, 409, { ok: false, error: `ask is ${ask.close.status}`, close: ask.close }); return; }
        const body = await parseJsonBody(req, res, 64 * 1024);
        if (!body) return;
        const choiceId = typeof body.choiceId === 'string' && body.choiceId.trim() ? body.choiceId.trim() : undefined;
        const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : undefined;
        if (!choiceId && !note) { sendJson(res, 400, { ok: false, error: 'an answer needs a choiceId or a note' }); return; }
        if (choiceId && !ask.options.some((o) => o.id === choiceId)) { sendJson(res, 400, { ok: false, error: `"${choiceId}" is not an option of this ask` }); return; }
        const r = await routes.ingest({ kind: 'ask.answer', origin: { host: 'hub', workspace: 'hub' }, payload: { host: ask.host, workspace: ask.workspace, askId: ask.id, choiceId, note, actor: 'human' } });
        if (!r.ok) { sendJson(res, 500, r); return; }
        sendJson(res, 200, { ok: true, ask: opts.store.getAsk(host, ws, id) });
        return;
      }
    }

    if (parts[1] === 'notes' && parts.length === 6 && parts[5] === 'ack' && method === 'POST') {
      const [, , host, ws, id] = parts;
      const r = await routes.ingest({ kind: 'note.ack', origin: { host: 'hub', workspace: 'hub' }, payload: { host, workspace: ws, noteId: id } });
      if (!r.ok) { sendJson(res, 500, r); return; }
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  }

  return wrap(bind, port, handle);
}

export function createIngestServer(opts: IngestServerOpts): Listener {
  const bind = opts.bind || '127.0.0.1';
  const routes: Routes = { store: opts.store, ingest: opts.ingest || ((i) => opts.store.append(i)), resolveToken: opts.resolveToken, tokenRequired: true };

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parts = segments(req);
    if (!parts) { sendJson(res, 400, { ok: false, error: 'bad path' }); return; }
    const method = req.method || 'GET';
    if (method === 'GET' && parts[0] === 'healthz' && parts.length === 1) { sendJson(res, 200, { ok: true }); return; }
    if (parts[0] !== 'api') { sendJson(res, 404, { ok: false, error: 'not found' }); return; }
    const tokenHost = tokenHostFor(routes, req, res);
    if (tokenHost === false) return;
    if (parts[1] === 'ingest' && parts.length === 2) { await handleIngest(routes, req, res, tokenHost); return; }
    if (parts[1] === 'asks' && parts.length === 5 && method === 'GET') {
      // A scoped sender may only poll its own asks.
      if (parts[2] !== tokenHost) { sendJson(res, 403, { ok: false, error: 'token is scoped to another host' }); return; }
      handleAskGet(routes, req, res, parts[2], parts[3], parts[4]);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not found' });
  }

  return wrap(bind, opts.port, handle);
}

function wrap(bind: string, port: number, handle: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>): Listener {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: Error) => {
      // The detail (which can carry a filesystem path) stays on the server.
      console.error(`hub: ${req.method} ${req.url}: ${String(err?.message || err)}`);
      try { sendJson(res, 500, { ok: false, error: 'internal error' }); } catch { /* socket gone */ }
    });
  });
  server.keepAliveTimeout = 5000;
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, bind, () => {
        const addr = server.address();
        const p = typeof addr === 'object' && addr ? addr.port : port;
        const shown = bind.includes(':') ? `[${bind}]` : bind;
        resolve({ bind, port: p, url: `http://${shown}:${p}` });
      });
    }),
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
