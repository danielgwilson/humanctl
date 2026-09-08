// Selftest for the hub (lib/hub.ts, lib/hub-store.ts, lib/hub-server.ts):
// plain node, zero deps, a temp HOME, and a real server on an ephemeral
// loopback port. Nothing here reaches beyond 127.0.0.1. Covers the fold
// (groups, first-answer-wins, close, supersede, ack, digest, dedupe, a torn
// last line), the trust model (host header, cross-site, token scoping, the
// ingest listener), artifact serving and path traversal, the token store,
// harness inference, the client push, and the URL privacy rule.
// Run: npm run hub:selftest

import assert from 'assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import {
  ARTIFACT_MAX_BYTES,
  CLIENT_HEADER,
  askGroup,
  askPath,
  createHubServer,
  createHubStore,
  createIngestServer,
  createTokenStore,
  crossSiteReason,
  detectOrigin,
  hostAllowed,
  hubRequest,
  inferHarness,
  isPrivateHubUrl,
  isSafeName,
  pushEvent,
  readHubConfig,
  workspaceTag,
  writeHubConfig,
  type HubConfig,
  type HubState,
  type Origin,
} from './hub';
import { renderHubPage } from './hub-page';

let passed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); passed += 1; } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && (e as Error).stack ? (e as Error).stack : e);
    process.exitCode = 1;
  }
}
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed += 1; } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && (e as Error).stack ? (e as Error).stack : e);
    process.exitCode = 1;
  }
}
function tempDir(label: string): string { return fs.mkdtempSync(path.join(os.tmpdir(), `humanctl-hub-selftest-${label}-`)); }

const laptop: Origin = { host: 'laptop', workspace: 'app-1a2b3c', harness: 'claude-code', cwd: '/work/app', repo: 'app' };
const vm: Origin = { host: 'vm-1', workspace: 'app-9f9f9f', harness: 'codex', cwd: '/srv/app', repo: 'app' };

function askPayload(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, title: `${id}?`, prompt: 'context', status: 'open', escalation: 'ask',
    artifactIds: [],
    response: { type: 'single-select', recommendedBy: 'implicit', options: [{ id: 'yes', label: 'Yes', recommended: true }, { id: 'no', label: 'No', recommended: false }] },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

// Raw request with full header control, for the cases hubRequest deliberately cannot produce.
function raw(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; host?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: opts.method || 'GET', headers: { ...(opts.host ? { host: opts.host } : {}), ...(opts.headers || {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function run(): Promise<void> {
  // ---- pure helpers ----
  check('isSafeName: plain names only', () => {
    for (const ok of ['a', 'app-1a2b3c', 'content.html', 'note_ab12', 'x'.repeat(128)]) assert.ok(isSafeName(ok), ok);
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', '-lead', 'x'.repeat(129), 'sp ace', undefined, 3]) assert.ok(!isSafeName(bad), String(bad));
  });

  check('inferHarness: explicit wins, then the harness env markers, then unknown', () => {
    assert.strictEqual(inferHarness({ HUMANCTL_HARNESS: 'Cursor-Agent', CLAUDECODE: '1' }), 'cursor-agent');
    assert.strictEqual(inferHarness({ CLAUDECODE: '1' }), 'claude-code');
    assert.strictEqual(inferHarness({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'claude-code');
    assert.strictEqual(inferHarness({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
    assert.strictEqual(inferHarness({ CODEX_THREAD_ID: 'abc' }), 'codex');
    assert.strictEqual(inferHarness({}), 'unknown');
  });

  check('workspaceTag: stable, path-derived, and a safe name', () => {
    const a = workspaceTag('/work/app');
    assert.strictEqual(a, workspaceTag('/work/app/'));
    assert.notStrictEqual(a, workspaceTag('/work/app-2'));
    assert.ok(a.startsWith('app-'));
    assert.ok(isSafeName(a));
  });

  check('detectOrigin: HUMANCTL_HOST and HUMANCTL_SESSION are honored and sanitized', () => {
    const o = detectOrigin({ cwd: '/work/app' }, { HUMANCTL_HOST: 'My Sandbox!!', HUMANCTL_SESSION: 's1', CLAUDECODE: '1' });
    assert.strictEqual(o.host, 'my-sandbox');
    assert.strictEqual(o.session, 's1');
    assert.strictEqual(o.harness, 'claude-code');
    assert.strictEqual(o.repo, 'app');
    assert.ok(o.workspace.startsWith('app-'));
  });

  check('isPrivateHubUrl: loopback, private ranges, the overlay range, and *.ts.net are private; the internet is not', () => {
    for (const u of ['http://127.0.0.1:4187', 'http://localhost:4187', 'http://10.1.2.3:4187', 'http://192.168.1.9:4187', 'http://172.20.0.1:4187', 'http://100.101.102.103:4187', 'http://[::1]:4187', 'http://[fd00::1]:4187', 'https://box.example.ts.net']) assert.ok(isPrivateHubUrl(u), u);
    for (const u of ['https://hub.example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'http://100.128.0.1', 'not a url']) assert.ok(!isPrivateHubUrl(u), u);
  });

  check('hostAllowed: IP literals, localhost, *.ts.net, and the allow list; nothing else (DNS rebinding)', () => {
    assert.ok(hostAllowed('127.0.0.1:4187', []));
    assert.ok(hostAllowed('[::1]:4187', []));
    assert.ok(hostAllowed('localhost', []));
    assert.ok(hostAllowed('100.64.1.2', []));
    assert.ok(hostAllowed('box.tailnet.ts.net', []));
    assert.ok(hostAllowed('hub.internal:4187', ['hub.internal']));
    assert.ok(!hostAllowed('attacker.example.com:4187', []));
    assert.ok(!hostAllowed('', []));
  });

  check('crossSiteReason: same-origin page fetches and CLI pushes pass; sandboxed, cross-site, form, and text posts fail', () => {
    const mk = (headers: Record<string, string>, method = 'POST') => ({ headers, method } as unknown as http.IncomingMessage);
    assert.strictEqual(crossSiteReason(mk({ host: 'h:1', origin: 'http://h:1', 'content-type': 'application/json', [CLIENT_HEADER]: 'page' })), null);
    assert.strictEqual(crossSiteReason(mk({ host: 'h:1', 'content-type': 'application/json', [CLIENT_HEADER]: 'cli' })), null);
    assert.strictEqual(crossSiteReason(mk({ host: 'h:1' }, 'GET')), null);
    assert.ok(crossSiteReason(mk({ host: 'h:1', origin: 'null', 'content-type': 'application/json', [CLIENT_HEADER]: 'page' })));
    assert.ok(crossSiteReason(mk({ host: 'h:1', origin: 'http://evil:1', 'content-type': 'application/json', [CLIENT_HEADER]: 'page' })));
    assert.ok(crossSiteReason(mk({ host: 'h:1', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json', [CLIENT_HEADER]: 'page' })));
    assert.ok(crossSiteReason(mk({ host: 'h:1', origin: 'http://h:1', 'content-type': 'text/plain', [CLIENT_HEADER]: 'page' })));
    assert.ok(crossSiteReason(mk({ host: 'h:1', origin: 'http://h:1', 'content-type': 'application/x-www-form-urlencoded', [CLIENT_HEADER]: 'page' })));
    assert.ok(crossSiteReason(mk({ host: 'h:1', origin: 'http://h:1', 'content-type': 'application/json' })), 'missing client header');
  });

  check('askGroup: Decide is earned by an explicit default plus a reason; block outranks; answered and closed leave the queue', () => {
    const base = { status: 'open', escalation: 'ask', recommendedId: 'yes', recommendedExplicit: false, reason: undefined as string | undefined, answer: undefined, close: undefined };
    assert.strictEqual(askGroup(base), 'needs-words');
    assert.strictEqual(askGroup({ ...base, recommendedExplicit: true }), 'needs-words');
    assert.strictEqual(askGroup({ ...base, reason: 'because' }), 'needs-words');
    assert.strictEqual(askGroup({ ...base, recommendedExplicit: true, reason: 'because' }), 'decide');
    assert.strictEqual(askGroup({ ...base, recommendedExplicit: true, reason: 'because', escalation: 'block' }), 'blocked');
    assert.strictEqual(askGroup({ ...base, status: 'answered' }), null);
    assert.strictEqual(askGroup({ ...base, close: { status: 'withdrawn', closedAt: 'x' } }), null);
  });

  // ---- store and fold ----
  check('store: fold groups, first answer wins, close, ack, supersede, digest overwrite, dedupe', () => {
    const dir = tempDir('store');
    const s = createHubStore({ dir });
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('vague') }).ok);
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('clear', { reason: 'spec matches', response: { type: 'single-select', recommendedBy: 'agent', options: [{ id: 'ship', label: 'Ship', recommended: true }, { id: 'hold', label: 'Hold' }] } }) }).ok);
    assert.ok(s.append({ kind: 'ask.upsert', origin: vm, payload: askPayload('stuck', { escalation: 'block', status: 'blocked' }) }).ok);
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'note_1', level: 'blocked', message: 'need creds', session: 'sess-a', ts: '2026-01-01T00:00:01.000Z' } }).ok);
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'note_2', level: 'review', message: 'PR up', session: 'sess-b', ts: '2026-01-01T00:00:02.000Z' } }).ok);
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'note_3', level: 'fyi', message: 'fyi', ts: '2026-01-01T00:00:03.000Z' } }).ok);
    let st = s.state();
    assert.deepStrictEqual(st.counts, { needsYou: 5, blocked: 2, decide: 1, needsWords: 1, review: 1 });
    assert.deepStrictEqual(st.queue.map((q) => q.group), ['blocked', 'blocked', 'decide', 'needs-words', 'review']);
    assert.deepStrictEqual(st.queue.slice(0, 2).map((q) => q.id), ['stuck', 'note_1'], 'older first within a group');
    const clear = st.queue.find((q) => q.id === 'clear')!;
    assert.strictEqual(clear.detail, 'Ship: spec matches');
    assert.ok(st.recent.some((r) => r.id === 'note_3' && r.outcome === 'fyi'));
    assert.deepStrictEqual(st.origins, ['laptop', 'vm-1']);

    // first answer wins; the second stays in the log only
    assert.ok(s.append({ kind: 'ask.answer', origin: { host: 'hub', workspace: 'hub' }, payload: { host: 'laptop', workspace: laptop.workspace, askId: 'clear', choiceId: 'hold', actor: 'human' } }).ok);
    assert.ok(s.append({ kind: 'ask.answer', origin: laptop, payload: { askId: 'clear', choiceId: 'ship', actor: 'human' } }).ok);
    const answered = s.getAsk('laptop', laptop.workspace, 'clear')!;
    assert.strictEqual(answered.answer!.choiceId, 'hold');
    assert.strictEqual(answered.answer!.via, 'hub');
    assert.strictEqual(answered.status, 'answered');

    // close moves the ask to Recent with what the agent took
    assert.ok(s.append({ kind: 'ask.close', origin: laptop, payload: { askId: 'vague', status: 'withdrawn', proceededWith: 'yes' } }).ok);
    // a done note from the same session supersedes the blocked note; the other stays
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'note_4', level: 'done', message: 'unblocked', session: 'sess-a', ts: '2026-01-01T00:00:09.000Z' } }).ok);
    assert.ok(s.append({ kind: 'note.ack', origin: { host: 'hub', workspace: 'hub' }, payload: { host: 'vm-1', workspace: vm.workspace, noteId: 'note_2' } }).ok);
    st = s.state();
    assert.deepStrictEqual(st.queue.map((q) => q.id), ['stuck']);
    assert.ok(st.recent.some((r) => r.id === 'vague' && r.outcome === 'withdrawn' && r.detail === 'agent took Yes'));
    assert.ok(st.recent.some((r) => r.id === 'note_1' && r.outcome === 'superseded'));
    assert.ok(st.recent.some((r) => r.id === 'note_2' && r.outcome === 'seen'));
    assert.ok(st.recent.some((r) => r.id === 'clear' && r.outcome === 'answered' && r.detail === 'Hold'));

    // digests: latest per host, a file not a log line
    const before = s.eventCount();
    assert.ok(s.append({ kind: 'digest', origin: { host: 'vm-1', workspace: 'fleet' }, payload: { sessions: [{ harness: 'codex', id: 'a', repo: 'app', title: 'first', state: 'need', tier: 'hot', lastActiveMs: 1 }], titles: true } }).ok);
    assert.ok(s.append({ kind: 'digest', origin: { host: 'vm-1', workspace: 'fleet' }, payload: { sessions: [], needsYou: 0, working: 2 } }).ok);
    assert.strictEqual(s.eventCount(), before);
    st = s.state();
    assert.strictEqual(st.fleet.length, 1);
    assert.strictEqual(st.fleet[0].working, 2);
    assert.strictEqual(st.fleet[0].sessions.length, 0);
    assert.ok(fs.existsSync(path.join(dir, 'digests', 'vm-1.json')));

    // dedupe by client id, across a reload
    const r1 = s.append({ kind: 'note', origin: laptop, payload: { id: 'note_9', level: 'review', message: 'once' }, id: 'evt_fixed' });
    const r2 = s.append({ kind: 'note', origin: laptop, payload: { id: 'note_9', level: 'review', message: 'twice' }, id: 'evt_fixed' });
    assert.ok(r1.ok && !r1.deduped && r2.ok && r2.deduped);
    const reloaded = createHubStore({ dir });
    const r3 = reloaded.append({ kind: 'note', origin: laptop, payload: { id: 'note_9', level: 'review', message: 'thrice' }, id: 'evt_fixed' });
    assert.ok(r3.ok && r3.deduped);
    assert.deepStrictEqual(reloaded.state().counts, s.state().counts);
  });

  check('store: reopen drops a stale hub answer, a restated close stays in Recent, a re-sent note stays superseded, senders stay in their namespace, digest and payload bounds', () => {
    const dir = tempDir('fixes');
    const s = createHubStore({ dir });
    // A hub-side answer survives a retry upsert with the same updatedAt, is
    // reported as a conflict to a second answer, and is dropped by a newer
    // open upsert (a cleared answer, a re-created ask).
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('b1') }).ok);
    assert.ok(s.append({ kind: 'ask.answer', origin: { host: 'hub', workspace: 'hub' }, payload: { host: 'laptop', workspace: laptop.workspace, askId: 'b1', choiceId: 'no' } }).ok);
    const second = s.append({ kind: 'ask.answer', origin: laptop, payload: { askId: 'b1', choiceId: 'yes' } });
    assert.ok(second.ok && second.conflict && second.conflict.choiceId === 'no', 'conflict reported');
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('b1') }).ok);
    assert.strictEqual(s.getAsk('laptop', laptop.workspace, 'b1')!.answer!.choiceId, 'no', 'retry upsert keeps the answer');
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('b1', { updatedAt: '2099-01-01T00:00:00.000Z' }) }).ok);
    assert.strictEqual(s.getAsk('laptop', laptop.workspace, 'b1')!.answer, undefined, 'newer open upsert reopens');
    assert.ok(s.state().queue.some((q) => q.id === 'b1'));
    // A close survives being restated, with or without its details.
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('a1') }).ok);
    assert.ok(s.append({ kind: 'ask.close', origin: laptop, payload: { askId: 'a1', status: 'withdrawn', proceededWith: 'yes' } }).ok);
    const closedAt = s.getAsk('laptop', laptop.workspace, 'a1')!.close!.closedAt;
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('a1', { status: 'withdrawn', updatedAt: '2099-01-01T00:00:00.000Z', close: { status: 'withdrawn', proceededWith: 'yes', closedAt } }) }).ok);
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('a2', { status: 'deleted' }) }).ok);
    let st = s.state();
    assert.ok(!st.queue.some((q) => q.id === 'a1' || q.id === 'a2'));
    assert.ok(st.recent.some((r) => r.id === 'a1' && r.outcome === 'withdrawn' && r.detail === 'agent took Yes'));
    assert.ok(st.recent.some((r) => r.id === 'a2' && r.outcome === 'deleted'));
    // A re-sent blocked note that a done note already superseded stays out.
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'nb', level: 'blocked', message: 'x', session: 's1', ts: '2026-01-01T00:00:01.000Z' } }).ok);
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'nd', level: 'done', message: 'y', session: 's1', ts: '2026-01-01T00:00:02.000Z' } }).ok);
    assert.ok(s.append({ kind: 'note', origin: vm, payload: { id: 'nb', level: 'blocked', message: 'x', session: 's1', ts: '2026-01-01T00:00:01.000Z' } }).ok);
    assert.ok(!s.state().queue.some((q) => q.id === 'nb'));
    // A sender's answer, close, or ack lands in its own namespace whatever
    // host/workspace its payload names; only the hub's page may cross.
    assert.ok(s.append({ kind: 'ask.upsert', origin: laptop, payload: askPayload('mine') }).ok);
    assert.ok(s.append({ kind: 'ask.answer', origin: vm, payload: { host: 'laptop', workspace: laptop.workspace, askId: 'mine', choiceId: 'yes' } }).ok);
    assert.ok(s.append({ kind: 'ask.close', origin: vm, payload: { host: 'laptop', workspace: laptop.workspace, askId: 'mine', status: 'deleted' } }).ok);
    assert.ok(s.append({ kind: 'note', origin: laptop, payload: { id: 'ln', level: 'review', message: 'l' } }).ok);
    assert.ok(s.append({ kind: 'note.ack', origin: vm, payload: { host: 'laptop', workspace: laptop.workspace, noteId: 'ln' } }).ok);
    const mine = s.getAsk('laptop', laptop.workspace, 'mine')!;
    assert.ok(!mine.answer && !mine.close, 'foreign answer and close ignored');
    st = s.state();
    assert.ok(st.queue.some((q) => q.id === 'ln'), 'foreign ack ignored');
    // Digest values are bounded; an absurd epoch becomes 0 rather than a throw downstream.
    assert.ok(s.append({ kind: 'digest', origin: { host: 'vm-1', workspace: 'fleet' }, payload: { sessions: [{ harness: 'codex', id: 'z', lastActiveMs: 1e300, state: 'work', tier: 'hot' }] } }).ok);
    assert.strictEqual(s.state().fleet[0].sessions[0].lastActiveMs, 0);
    // Payload bytes are capped per event; the log never holds more than the fold keeps.
    const big = s.append({ kind: 'note', origin: laptop, payload: { id: 'big', level: 'fyi', message: 'x'.repeat(70 * 1024) } });
    assert.strictEqual(big.ok, false);
    assert.strictEqual(fs.statSync(path.join(dir, 'ingest.jsonl')).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
  });

  await checkAsync('hub.ingest through the registry carries the conflict field (the shape hub serve relays)', async () => {
    const { createRegistry } = require('./commands') as typeof import('./commands');
    const dir = tempDir('registry');
    const reg = createRegistry({ log: { append: () => undefined, file: path.join(dir, 'events.jsonl') } });
    const up = await reg.invoke('hub.ingest', { kind: 'ask.upsert', origin: laptop, payload: askPayload('c1'), dir }, { source: 'selftest' });
    assert.ok(up.ok && up.event);
    const first = await reg.invoke('hub.ingest', { kind: 'ask.answer', origin: { host: 'hub', workspace: 'hub' }, payload: { host: 'laptop', workspace: laptop.workspace, askId: 'c1', choiceId: 'yes' }, dir }, { source: 'selftest' });
    assert.ok(first.ok && first.conflict === undefined);
    const second = await reg.invoke('hub.ingest', { kind: 'ask.answer', origin: laptop, payload: { askId: 'c1', choiceId: 'no' }, dir }, { source: 'selftest' });
    assert.ok(second.ok, String(second.error));
    assert.strictEqual((second.conflict as { choiceId: string }).choiceId, 'yes');
  });

  check('store: a torn last line is skipped at boot and the next append starts on its own line', () => {
    const dir = tempDir('torn');
    const s = createHubStore({ dir });
    assert.ok(s.append({ kind: 'note', origin: laptop, payload: { id: 'n1', level: 'review', message: 'ok' } }).ok);
    fs.appendFileSync(path.join(dir, 'ingest.jsonl'), '{"id":"evt_torn","kind":"note","origin":{"host":"laptop"},"pay');
    const s2 = createHubStore({ dir });
    assert.strictEqual(s2.state().counts.needsYou, 1);
    assert.ok(s2.append({ kind: 'note', origin: laptop, payload: { id: 'n2', level: 'review', message: 'after' } }).ok);
    const s3 = createHubStore({ dir });
    assert.strictEqual(s3.state().counts.needsYou, 2);
  });

  check('store: artifact paths never leave the artifacts directory', () => {
    const dir = tempDir('paths');
    const s = createHubStore({ dir });
    assert.ok(s.artifactPath('laptop', 'ws', 'a', 'content.html'));
    for (const bad of [['..', 'ws', 'a', 'content.html'], ['laptop', '..', 'a', 'x'], ['laptop', 'ws', '..', 'x'], ['laptop', 'ws', 'a', '../ingest.jsonl'], ['laptop', 'ws', 'a', '..'], ['laptop/x', 'ws', 'a', 'x']]) {
      assert.strictEqual(s.artifactPath(bad[0], bad[1], bad[2], bad[3]), null, bad.join(' '));
    }
    const big = s.putArtifactBody(laptop, 'a', 'content.html', Buffer.alloc(ARTIFACT_MAX_BYTES + 1));
    assert.strictEqual(big.ok, false);
  });

  check('token store: issue, resolve, list, revoke; the file never holds the token itself', () => {
    const dir = tempDir('tokens');
    const t = createTokenStore(dir);
    const { token, record } = t.issue('VM 1', 'sandbox');
    assert.ok(token.startsWith('hct_'));
    assert.strictEqual(record.host, 'vm-1');
    assert.strictEqual(t.resolve(token), 'vm-1');
    assert.strictEqual(t.resolve('hct_nope'), null);
    assert.strictEqual(t.resolve('Bearer x'), null);
    assert.ok(!fs.readFileSync(t.file, 'utf8').includes(token));
    assert.strictEqual(t.list().length, 1);
    assert.strictEqual(t.revoke(record.prefix), 1);
    assert.strictEqual(t.resolve(token), null);
  });

  check('hub config: env overrides the file; the file is written 0600 and cleared cleanly', () => {
    const home = tempDir('home');
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      assert.strictEqual(readHubConfig({}), null);
      const file = writeHubConfig({ url: 'http://127.0.0.1:4187/', token: 'hct_x' });
      assert.strictEqual((fs.statSync(file).mode & 0o777), 0o600);
      assert.deepStrictEqual(readHubConfig({}), { url: 'http://127.0.0.1:4187', token: 'hct_x' });
      assert.deepStrictEqual(readHubConfig({ HUMANCTL_HUB_URL: 'http://10.0.0.2:4187/' }), { url: 'http://10.0.0.2:4187', token: undefined });
      writeHubConfig(null);
      assert.strictEqual(readHubConfig({}), null);
    } finally { process.env.HOME = prev; }
  });

  check('createHubServer refuses a non-loopback bind without --trust-network', () => {
    const s = createHubStore({ dir: tempDir('bind') });
    assert.throws(() => createHubServer({ store: s, bind: '0.0.0.0', port: 0, page: renderHubPage }), /trust-network/);
    const ok = createHubServer({ store: s, bind: '0.0.0.0', port: 0, page: renderHubPage, trustNetwork: true });
    assert.ok(ok.server);
  });

  check('renderHubPage: self-contained, nonce-bound, no external requests', () => {
    const html = renderHubPage('N0NCE');
    assert.ok(html.includes('<style nonce="N0NCE">') && html.includes('<script nonce="N0NCE">'));
    assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/hub/g, '')), 'no absolute URLs');
    assert.ok(html.includes("sandbox=\"allow-scripts allow-forms allow-popups\""));
    assert.ok(!html.includes('allow-same-origin'));
    assert.ok(html.includes("'x-humanctl-client': 'page'"));
  });

  // ---- a real server ----
  const dir = tempDir('server');
  const store = createHubStore({ dir });
  const tokens = createTokenStore(dir);
  const main = createHubServer({ store, bind: '127.0.0.1', port: 0, page: renderHubPage, resolveToken: tokens.resolve, allowHosts: ['hub.internal'] });
  const ingestL = createIngestServer({ store, bind: '127.0.0.1', port: 0, resolveToken: tokens.resolve });
  const mainAddr = await main.listen();
  const ingestAddr = await ingestL.listen();
  const cfg: HubConfig = { url: mainAddr.url };

  await checkAsync('server: the page carries a per-response nonce CSP and denies framing', async () => {
    const r = await raw(`${mainAddr.url}/`);
    assert.strictEqual(r.status, 200);
    const csp = String(r.headers['content-security-policy']);
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)![1];
    assert.ok(r.body.includes(`nonce="${nonce}"`));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    const r2 = await raw(`${mainAddr.url}/`);
    assert.notStrictEqual(r2.headers['content-security-policy'], csp, 'nonce rotates');
  });

  await checkAsync('server: a foreign Host header is refused (DNS rebinding), an allow-listed one is served', async () => {
    const bad = await raw(`${mainAddr.url}/api/state`, { host: 'attacker.example.com' });
    assert.strictEqual(bad.status, 421);
    const ok = await raw(`${mainAddr.url}/api/state`, { host: 'hub.internal' });
    assert.strictEqual(ok.status, 200);
  });

  await checkAsync('server: ingest, state, artifact serving, and the client push', async () => {
    const push = await pushEvent(cfg, { kind: 'ask.upsert', origin: laptop, payload: askPayload('ship-it', { reason: 'copy matches', artifactIds: ['preview'], response: { type: 'single-select', recommendedBy: 'agent', options: [{ id: 'ship', label: 'Ship', recommended: true }, { id: 'hold', label: 'Hold' }] } }) });
    assert.ok(push.ok, push.error);
    const art = await pushEvent(cfg, { kind: 'artifact.put', origin: laptop, payload: { manifest: { id: 'preview', title: 'Preview', kind: 'preview', render: { type: 'html', entry: 'content.html' } }, content: '<h1>hi</h1><script>parent.postMessage({type:"humanctl:height",height:300},"*")</script>', encoding: 'utf8' } });
    assert.ok(art.ok, art.error);
    const st = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.strictEqual(st.counts.decide, 1);
    const item = st.queue[0];
    assert.strictEqual(item.artifacts.length, 1);
    assert.strictEqual(item.artifacts[0].url, `/a/laptop/${laptop.workspace}/preview/content.html`);
    const body = await raw(`${mainAddr.url}${item.artifacts[0].url}`);
    assert.strictEqual(body.status, 200);
    assert.ok(body.body.startsWith('<h1>hi</h1>'));
    assert.ok(String(body.headers['content-security-policy']).startsWith('sandbox allow-scripts'));
    assert.strictEqual(body.headers['x-content-type-options'], 'nosniff');
    assert.ok(!fs.readFileSync(path.join(dir, 'ingest.jsonl'), 'utf8').includes('<h1>hi</h1>'), 'bodies stay out of the log');
    for (const p of ['/a/laptop/x/%2e%2e/ingest.jsonl', `/a/laptop/${laptop.workspace}/preview/..%2fcontent.html`, '/a/../tokens.json']) {
      assert.strictEqual((await raw(`${mainAddr.url}${p}`)).status, 404, p);
    }
  });

  await checkAsync('server: browser-side hardening rejects what a sandboxed artifact or a foreign page could send', async () => {
    const p = `/api/asks/laptop/${laptop.workspace}/ship-it/answer`;
    const cases: [string, Record<string, string>][] = [
      ['text/plain no-cors post', { 'content-type': 'text/plain' }],
      ['form post', { 'content-type': 'application/x-www-form-urlencoded', origin: 'null' }],
      ['sandboxed origin', { 'content-type': 'application/json', [CLIENT_HEADER]: 'page', origin: 'null' }],
      ['cross-site fetch', { 'content-type': 'application/json', [CLIENT_HEADER]: 'page', 'sec-fetch-site': 'cross-site' }],
      ['foreign origin', { 'content-type': 'application/json', [CLIENT_HEADER]: 'page', origin: 'http://evil.example' }],
      ['json without the client header', { 'content-type': 'application/json' }],
    ];
    for (const [label, headers] of cases) {
      const r = await raw(`${mainAddr.url}${p}`, { method: 'POST', headers, body: JSON.stringify({ choiceId: 'ship' }) });
      assert.strictEqual(r.status, 403, label);
    }
    assert.strictEqual((await raw(`${mainAddr.url}/api/state`, { method: 'OPTIONS' })).headers['access-control-allow-origin'], undefined);
    assert.ok(!store.getAsk('laptop', laptop.workspace, 'ship-it')!.answer, 'nothing landed');
  });

  await checkAsync('server: polling marks the ask waiting; answering once succeeds, twice is 409; the answer is a logged event', async () => {
    const before = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.strictEqual(before.queue[0].waiting, false);
    const poll = await hubRequest(cfg, 'GET', askPath(laptop, 'ship-it'));
    assert.ok(poll.ok && !(poll.json!.ask as { answer?: unknown }).answer);
    const mid = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.strictEqual(mid.queue[0].waiting, true);
    const bad = await hubRequest(cfg, 'POST', askPath(laptop, 'ship-it') + '/answer', { choiceId: 'nope' });
    assert.strictEqual(bad.status, 400);
    const ok = await hubRequest(cfg, 'POST', askPath(laptop, 'ship-it') + '/answer', { choiceId: 'ship', note: 'go' });
    assert.ok(ok.ok, ok.error);
    const again = await hubRequest(cfg, 'POST', askPath(laptop, 'ship-it') + '/answer', { choiceId: 'hold' });
    assert.strictEqual(again.status, 409);
    const polled = (await hubRequest(cfg, 'GET', askPath(laptop, 'ship-it'))).json!.ask as { answer: { choiceId: string; note: string; via: string; actor: string } };
    assert.deepStrictEqual([polled.answer.choiceId, polled.answer.note, polled.answer.via, polled.answer.actor], ['ship', 'go', 'hub', 'human']);
    const log = fs.readFileSync(path.join(dir, 'ingest.jsonl'), 'utf8');
    assert.ok(log.includes('"kind":"ask.answer"') && log.includes('"host":"hub"'));
    const after = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.strictEqual(after.counts.needsYou, 0);
    assert.strictEqual(after.recent[0].outcome, 'answered');
  });

  await checkAsync('server: notes ack, and a done note supersedes over HTTP too', async () => {
    assert.ok((await pushEvent(cfg, { kind: 'note', origin: vm, payload: { id: 'n1', level: 'review', message: 'PR 12 up', session: 's' } })).ok);
    assert.ok((await pushEvent(cfg, { kind: 'note', origin: vm, payload: { id: 'n2', level: 'blocked', message: 'need a key', session: 't' } })).ok);
    let st = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.deepStrictEqual(st.queue.map((q) => q.id), ['n2', 'n1']);
    assert.ok((await hubRequest(cfg, 'POST', `/api/notes/vm-1/${vm.workspace}/n1/ack`, {})).ok);
    assert.ok((await pushEvent(cfg, { kind: 'note', origin: vm, payload: { id: 'n3', level: 'done', message: 'got it', session: 't' } })).ok);
    st = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.strictEqual(st.counts.needsYou, 0);
  });

  await checkAsync('server: a token on the main listener pins the sender to its host', async () => {
    const { token } = tokens.issue('sandbox-7');
    const spoof = await pushEvent({ url: mainAddr.url, token }, { kind: 'note', origin: { ...laptop, host: 'laptop' }, payload: { id: 'spoof', level: 'blocked', message: 'as laptop' } });
    assert.ok(spoof.ok, spoof.error);
    assert.strictEqual((spoof.json!.origin as Origin).host, 'sandbox-7');
    const st = (await hubRequest(cfg, 'GET', '/api/state')).json as unknown as HubState;
    assert.strictEqual(st.queue.find((q) => q.id === 'spoof')!.host, 'sandbox-7');
    const badToken = await pushEvent({ url: mainAddr.url, token: 'hct_bogus' }, { kind: 'note', origin: laptop, payload: { id: 'x', level: 'fyi', message: 'x' } });
    assert.strictEqual(badToken.status, 401);
  });

  await checkAsync('ingest listener: token required, scoped polling only, no human surface', async () => {
    const icfg: HubConfig = { url: ingestAddr.url };
    assert.strictEqual((await pushEvent(icfg, { kind: 'note', origin: vm, payload: { id: 'y', level: 'fyi', message: 'y' } })).status, 401);
    const { token } = tokens.issue('vm-1');
    const tcfg: HubConfig = { url: ingestAddr.url, token };
    const ask = await pushEvent(tcfg, { kind: 'ask.upsert', origin: vm, payload: askPayload('from-vm') });
    assert.ok(ask.ok, ask.error);
    assert.ok((await hubRequest(tcfg, 'GET', askPath(vm, 'from-vm'))).ok);
    assert.strictEqual((await hubRequest(tcfg, 'GET', askPath(laptop, 'ship-it'))).status, 403);
    // A scoped sender cannot answer, close, or ack another host's items, by
    // naming the host (refused) or by omitting it (resolved in its own namespace).
    const named = await pushEvent(tcfg, { kind: 'ask.answer', origin: vm, payload: { host: 'laptop', workspace: laptop.workspace, askId: 'ship-it', choiceId: 'hold' } });
    assert.strictEqual(named.status, 403);
    const unnamed = await pushEvent(tcfg, { kind: 'ask.close', origin: { ...laptop }, payload: { askId: 'ship-it', status: 'deleted' } });
    assert.ok(unnamed.ok);
    assert.ok(!store.getAsk('laptop', laptop.workspace, 'ship-it')!.close, 'the laptop ask is untouched');
    assert.strictEqual((await raw(`${mainAddr.url}${askPath(laptop, 'ship-it')}`)).status, 403, 'a poll without the client header is refused');
    assert.strictEqual((await hubRequest(tcfg, 'GET', '/api/state')).status, 404);
    assert.strictEqual((await raw(`${ingestAddr.url}/`)).status, 404);
    assert.strictEqual((await raw(`${ingestAddr.url}/a/laptop/${laptop.workspace}/preview/content.html`)).status, 404);
    assert.strictEqual((await hubRequest(tcfg, 'POST', askPath(vm, 'from-vm') + '/answer', { choiceId: 'yes' })).status, 404);
  });

  await checkAsync('client: an unreachable hub is an error result, never a throw', async () => {
    const r = await hubRequest({ url: 'http://127.0.0.1:1' }, 'GET', '/api/state', undefined, { timeoutMs: 500 });
    assert.strictEqual(r.ok, false);
    assert.ok(/unreachable/.test(r.error || ''));
  });

  await main.close();
  await ingestL.close();

  if (process.exitCode) console.error(`hub selftest: FAILED (${passed} passed before failure)`);
  else console.log(`hub selftest: ok (${passed} checks)`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
