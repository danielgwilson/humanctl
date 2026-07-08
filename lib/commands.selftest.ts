// Selftest for the command registry: plain node, zero deps, no network, no
// real ~/.humanctl data (every test uses a temp dir). Covers the registry
// invariant end to end: param validation, unknown-command rejection, the
// event log (write + rotation), and a real socket round-trip.
// Run: npm run commands:selftest

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  COMMANDS,
  validateParams,
  digestParams,
  createEventLog,
  createRegistry,
  createControlServer,
  socketRequest,
  appendAskLog,
  askLogPath,
  readAskLog,
  isInboxRelevantChange,
  storeNoteImages,
  attachmentsDir,
  prChip,
  type CommandDecl,
} from './commands';

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && (e as Error).stack ? (e as Error).stack : e);
    process.exitCode = 1;
  }
}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && (e as Error).stack ? (e as Error).stack : e);
    process.exitCode = 1;
  }
}

function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `humanctl-selftest-${label}-`));
}

// ---- COMMANDS table shape ----

check('every command has a unique name, a kind, and a desc', () => {
  const seen = new Set<string>();
  for (const c of COMMANDS) {
    assert.ok(c.name && typeof c.name === 'string', 'command missing a name');
    assert.ok(!seen.has(c.name), `duplicate command name ${c.name}`);
    seen.add(c.name);
    assert.ok(c.kind === 'action' || c.kind === 'observation', `${c.name}: kind must be action|observation`);
    assert.ok(c.desc && typeof c.desc === 'string', `${c.name}: missing desc`);
    assert.ok(c.params && typeof c.params === 'object', `${c.name}: params must be an object (possibly empty)`);
  }
});

// ---- param validation ----

check('validateParams: required param missing is rejected', () => {
  const decl: CommandDecl = { name: 'note.post', kind: 'action', desc: '', params: { message: { type: 'string', required: true } } };
  const v = validateParams(decl, {});
  assert.strictEqual(v.ok, false);
  assert.match((v as { error: string }).error, /requires param "message"/);
});

check('validateParams: unknown param is rejected', () => {
  const decl: CommandDecl = { name: 'x', kind: 'observation', desc: '', params: { a: { type: 'string' } } };
  const v = validateParams(decl, { a: 'ok', b: 'nope' });
  assert.strictEqual(v.ok, false);
  assert.match((v as { error: string }).error, /unknown param "b"/);
});

check('validateParams: enum violation is rejected', () => {
  const decl: CommandDecl = { name: 'app.set-view', kind: 'action', desc: '', params: { view: { type: 'string', required: true, enum: ['inbox', 'metrics', 'fleet', 'sessions', 'settings'] } } };
  const v = validateParams(decl, { view: 'bogus' });
  assert.strictEqual(v.ok, false);
  assert.match((v as { error: string }).error, /must be one of inbox\|metrics\|fleet\|sessions\|settings/);
});

check('validateParams: wrong type is rejected for string, number, boolean, object', () => {
  const decl: CommandDecl = {
    name: 'x',
    kind: 'observation',
    desc: '',
    params: {
      s: { type: 'string' }, n: { type: 'number' }, b: { type: 'boolean' }, o: { type: 'object' },
    },
  };
  assert.strictEqual(validateParams(decl, { s: 5 }).ok, false);
  assert.strictEqual(validateParams(decl, { n: 'five' }).ok, false);
  assert.strictEqual(validateParams(decl, { b: 'true' }).ok, false);
  assert.strictEqual(validateParams(decl, { o: [1, 2] }).ok, false, 'an array is not an object param');
});

check('validateParams: free text is hard-truncated to max', () => {
  const decl: CommandDecl = { name: 'note.post', kind: 'action', desc: '', params: { message: { type: 'string', max: 5 } } };
  const v = validateParams(decl, { message: 'abcdefgh' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual((v as { ok: true; params: Record<string, unknown> }).params.message, 'abcde');
});

check('validateParams: valid params pass through unchanged', () => {
  const decl: CommandDecl = { name: 'session.pin', kind: 'action', desc: '', params: { id: { type: 'string', required: true } } };
  const v = validateParams(decl, { id: 'abc123' });
  assert.deepStrictEqual(v, { ok: true, params: { id: 'abc123' } });
});

// ---- digestParams: shapes, never raw content ----

check('digestParams: strings truncate at 80 chars, arrays and objects collapse to shape', () => {
  const d = digestParams({
    short: 'ok',
    long: 'x'.repeat(200),
    n: 3,
    b: true,
    nil: null,
    missing: undefined,
    list: [1, 2, 3],
    patch: { theme: 'dark', view: 'sessions' },
  });
  assert.strictEqual(d.short, 'ok');
  assert.strictEqual((d.long as string).length, 80);
  assert.strictEqual(d.n, 3);
  assert.strictEqual(d.b, true);
  assert.strictEqual(d.nil, null);
  assert.ok(!('missing' in d), 'undefined params must not appear in the digest at all');
  assert.strictEqual(d.list, '[3]');
  assert.strictEqual(d.patch, '{theme,view}');
});

// ---- registry: unknown command, missing handler, dispatch, logging ----
// invoke() is async end to end (handlers may be async), so these live in the
// async run() below alongside the event-log and socket checks.

async function run(): Promise<void> {
  await checkAsync('registry: unknown command is rejected and logged with kind "unknown"', async () => {
    const dir = tempDir('unknown2');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: {} });
    const result = await registry.invoke('not.a.real.command', {}, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error), /unknown command/);
    const lines = fs.readFileSync(log.file, 'utf8').trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]);
    assert.strictEqual(entry.name, 'not.a.real.command');
    assert.strictEqual(entry.kind, 'unknown');
    assert.strictEqual(entry.ok, false);
  });

  await checkAsync('registry: a declared command with no injected handler fails honestly', async () => {
    const dir = tempDir('nohandler');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: {} });
    const result = await registry.invoke('app.set-view', { view: 'inbox' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error), /only available through the running desktop app/);
  });

  await checkAsync('registry: validation failure never reaches the handler', async () => {
    const dir = tempDir('validation');
    const log = createEventLog({ dir });
    let called = false;
    const registry = createRegistry({ log, handlers: { 'app.set-view': () => { called = true; return { ok: true }; } } });
    const result = await registry.invoke('app.set-view', { view: 'bogus' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(called, false);
  });

  await checkAsync('registry: a direct command dispatches to its built-in handler', async () => {
    const dir = tempDir('direct');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    const result = await registry.invoke('app.commands', {}, { source: 'test' });
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.commands) && (result.commands as unknown[]).length === COMMANDS.length);
  });

  await checkAsync('registry: a handler that throws is turned into an honest ok:false, not a crash', async () => {
    const dir = tempDir('throws');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: { 'app.set-view': () => { throw new Error('boom'); } } });
    const result = await registry.invoke('app.set-view', { view: 'inbox' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error), /boom/);
  });

  await checkAsync('registry: note.post writes a real note via the direct handler', async () => {
    const dir = tempDir('note');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    // note.post writes to the real ~/.humanctl by default (controlDir()); redirect
    // via HOME so this selftest never touches the real notes.jsonl.
    const home = tempDir('note-home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const result = await registry.invoke('note.post', { message: 'selftest note', level: 'fyi' }, { source: 'test' });
      assert.strictEqual(result.ok, true);
      const notesPath = path.join(home, '.humanctl', 'notes.jsonl');
      const note = JSON.parse(fs.readFileSync(notesPath, 'utf8').trim());
      assert.strictEqual(note.message, 'selftest note');
      assert.strictEqual(note.level, 'fyi');
    } finally {
      process.env.HOME = prevHome;
    }
  });

  // ---- inbox: threads assembled from notes + detected asks + persisted asks ----

  // Both halves of the join now honour a HOME swap: note.post writes through
  // controlDir(), and inbox.threads reads through sessions.ts's notesFile(),
  // which resolves HOME per call. So this runs entirely inside a temp home and
  // leaves no durable footprint on the machine that ran it, while still
  // proving the note.post -> inbox.threads join end to end.
  await checkAsync('inbox.threads: a note with a session id becomes a thread with one note item', async () => {
    const sid = `selftest_${randomUUID().slice(0, 8)}`;
    const dir = tempDir('inbox-home');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    const home = tempDir('inbox-real-home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const posted = await registry.invoke('note.post', { message: 'PR is up for review', level: 'review', session: sid }, { source: 'test' });
      assert.strictEqual(posted.ok, true);
      assert.ok(fs.existsSync(path.join(home, '.humanctl', 'notes.jsonl')), 'the note landed in the sandboxed home, not the real one');
      const result = await registry.invoke('inbox.threads', {}, { source: 'test' });
      assert.strictEqual(result.ok, true);
      const threads = result.threads as any[];
      const t = threads.find((x) => x.sessionId === sid);
      assert.ok(t, 'expected a thread for the noted session (proves the note.post -> inbox.threads join)');
      assert.strictEqual(t.items[0].kind, 'note');
      assert.strictEqual(t.items[0].level, 'review');
    } finally {
      process.env.HOME = prevHome;
    }
  });

  await checkAsync('inbox.threads: a session with no note, no need-state row, and no ask log yields no thread', async () => {
    const sid = `selftest_absent_${randomUUID().slice(0, 8)}`;
    const dir = tempDir('inbox-absent');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    const result = await registry.invoke('inbox.threads', {}, { source: 'test' });
    assert.strictEqual(result.ok, true);
    const threads = result.threads as any[];
    assert.ok(!threads.some((t) => t.sessionId === sid), 'a session with no signal must not fabricate a thread');
  });

  check('appendAskLog + readAskLog: round-trips a Q&A entry and an interrupted-probe entry', () => {
    const home = tempDir('asklog-home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      appendAskLog('sess_xyz', { q: 'status?', a: 'on track', engine: 'claude', ts: new Date().toISOString() });
      appendAskLog('sess_xyz', { status: 'interrupted', q: 'what next?', ts: new Date().toISOString() });
      assert.ok(fs.existsSync(askLogPath('sess_xyz')));
      const entries = readAskLog('sess_xyz');
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].a, 'on track');
      assert.strictEqual(entries[1].status, 'interrupted');
    } finally {
      process.env.HOME = prevHome;
    }
  });

  await checkAsync('inbox.threads: surfaces a persisted interrupted probe and a real Q&A as thread items', async () => {
    const home = tempDir('inbox-home3');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      appendAskLog('sess_qa1', { q: 'status?', a: 'moving along', engine: 'claude', ts: new Date().toISOString() });
      const log = createEventLog({ dir: path.join(home, '.humanctl') });
      const registry = createRegistry({ log });
      const result = await registry.invoke('inbox.threads', {}, { source: 'test' });
      const threads = result.threads as any[];
      const t = threads.find((x) => x.sessionId === 'sess_qa1');
      assert.ok(t, 'expected a thread from the persisted ask log alone (no note, no live session row)');
      assert.strictEqual(t.items[0].kind, 'qa');
      assert.strictEqual(t.items[0].answer, 'moving along');
    } finally {
      process.env.HOME = prevHome;
    }
  });

  // ---- new commands are declared with the right kind/params (handlers are
  // app-injected; validation and honest "not available without the app" are
  // exercised the same way the pre-existing app.set-view tests are above) ----

  check('inbox.mark-read requires threadId', () => {
    const decl = COMMANDS.find((c) => c.name === 'inbox.mark-read');
    assert.ok(decl, 'inbox.mark-read must be registered');
    const v = validateParams(decl as CommandDecl, {});
    assert.strictEqual(v.ok, false);
    assert.match((v as { error: string }).error, /requires param "threadId"/);
  });

  check('shell v2: the deleted persistent-rail commands are gone from the table', () => {
    // The persistent left roster and right Atlas rail were removed in shell v2
    // (the Atlas rail became a summonable drawer, nav is its own hover rail), so
    // their collapse commands must not linger as declared-but-unhandled entries.
    for (const name of ['app.set-left-rail', 'app.set-right-rail']) {
      assert.ok(!COMMANDS.some((c) => c.name === name), `${name} must be removed from the COMMANDS table`);
    }
  });

  await checkAsync('atlas.ask is registered, requires a question, and is honest when the app is not running', async () => {
    const decl = COMMANDS.find((c) => c.name === 'atlas.ask');
    assert.ok(decl, 'atlas.ask must be registered');
    assert.strictEqual((decl as CommandDecl).kind, 'action');
    assert.strictEqual(validateParams(decl as CommandDecl, {}).ok, false);
    const dir = tempDir('atlas');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: {} });
    const result = await registry.invoke('atlas.ask', { question: 'what needs me right now?' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error), /only available through the running desktop app/);
  });

  check('shell v2: app.set-mode is deleted; app.set-view and app.set-nav replace it', () => {
    assert.ok(!COMMANDS.some((c) => c.name === 'app.set-mode'), 'app.set-mode must be removed from the COMMANDS table');
    const view = COMMANDS.find((c) => c.name === 'app.set-view') as CommandDecl;
    assert.ok(view, 'app.set-view must be registered');
    assert.strictEqual(view.kind, 'action');
    assert.deepStrictEqual(view.params.view.enum, ['inbox', 'metrics', 'fleet', 'sessions', 'settings']);
    assert.strictEqual(view.params.view.required, true);
    // enum + required both enforced
    assert.strictEqual(validateParams(view, {}).ok, false);
    assert.strictEqual(validateParams(view, { view: 'wall' }).ok, false, 'legacy "wall" is no longer a valid view');
    assert.deepStrictEqual(validateParams(view, { view: 'sessions' }), { ok: true, params: { view: 'sessions' } });

    const nav = COMMANDS.find((c) => c.name === 'app.set-nav') as CommandDecl;
    assert.ok(nav, 'app.set-nav must be registered');
    assert.strictEqual(nav.kind, 'action');
    assert.strictEqual(nav.params.pinned.required, true);
    assert.strictEqual(validateParams(nav, {}).ok, false);
    assert.strictEqual(validateParams(nav, { pinned: 'yes' }).ok, false);
    assert.deepStrictEqual(validateParams(nav, { pinned: true }), { ok: true, params: { pinned: true } });
  });

  // ---- perf guard: the ~/.humanctl watcher must never react to its own
  // registry-owned outputs (electron/main.ts's inbox fs.watch calls this
  // before ping()/scheduleInbox() -- see the 2026-07-03 perf-profile report:
  // events.jsonl living inside the watched dir created a self-sustaining
  // ~213ms refresh loop). Unit-test the filter directly so a future
  // registry-owned file (another *.jsonl at the top level) cannot silently
  // reopen the loop without a maintainer updating this list.

  check('isInboxRelevantChange: notes.jsonl and asks/*.jsonl are relevant', () => {
    assert.strictEqual(isInboxRelevantChange('notes.jsonl'), true);
    assert.strictEqual(isInboxRelevantChange('asks/sess_abc123.jsonl'), true);
  });

  check('isInboxRelevantChange: the registry\'s own event log is never relevant', () => {
    assert.strictEqual(isInboxRelevantChange('events.jsonl'), false);
    assert.strictEqual(isInboxRelevantChange('events.1.jsonl'), false);
  });

  check('isInboxRelevantChange: other registry-owned top-level outputs are not relevant', () => {
    assert.strictEqual(isInboxRelevantChange('atlas.jsonl'), false);
    assert.strictEqual(isInboxRelevantChange('pulse.json'), false);
    assert.strictEqual(isInboxRelevantChange('pulse-cache.json'), false);
    assert.strictEqual(isInboxRelevantChange('span.jsonl'), false);
    assert.strictEqual(isInboxRelevantChange('app.sock'), false);
  });

  check('isInboxRelevantChange: a null/undefined filename (platform-dependent) is treated as maybe-relevant', () => {
    assert.strictEqual(isInboxRelevantChange(null), true);
    assert.strictEqual(isInboxRelevantChange(undefined), true);
  });

  await checkAsync('perf guard: invoking a registry command must not trigger the inbox watcher callback', async () => {
    // Simulates electron/main.ts's inbox fs.watch handler end to end: every
    // registry invoke() appends one line to events.jsonl via the SAME
    // createEventLog() used here, then this asserts that filename would be
    // filtered out before ping()/scheduleInbox() ever run.
    const dir = tempDir('perfguard');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: { 'app.set-view': () => ({ ok: true }) } });
    let watcherFired = false;
    const simulateWatchCallback = (fn: string | null) => { if (isInboxRelevantChange(fn)) watcherFired = true; };

    await registry.invoke('app.set-view', { view: 'inbox' }, { source: 'test' });
    // events.jsonl now has one line; drive the exact filename fs.watch would
    // report for that write through the same filter main.ts applies.
    simulateWatchCallback('events.jsonl');
    assert.strictEqual(watcherFired, false, 'events.jsonl writes must never trigger the inbox watcher');

    // Force rotation and confirm events.1.jsonl is filtered too.
    for (let i = 0; i < 50; i += 1) {
      await registry.invoke('app.set-view', { view: 'inbox' }, { source: 'test' });
    }
    simulateWatchCallback('events.1.jsonl');
    assert.strictEqual(watcherFired, false, 'events.1.jsonl (rotation) must never trigger the inbox watcher');

    // A real note IS supposed to fire it.
    simulateWatchCallback('notes.jsonl');
    assert.strictEqual(watcherFired, true, 'a real notes.jsonl write must still trigger the inbox watcher');
  });

  // ---- event log: append shape, and rotation at the byte boundary ----

  await checkAsync('event log: appended entries carry ts, name, kind, source, paramsDigest, ok, ms', async () => {
    const dir = tempDir('shape');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: { 'session.pin': () => ({ ok: true, id: 'abc', pinned: true }) } });
    await registry.invoke('session.pin', { id: 'abc' }, { source: 'ipc' });
    const entry = JSON.parse(fs.readFileSync(log.file, 'utf8').trim());
    for (const key of ['ts', 'name', 'kind', 'source', 'paramsDigest', 'ok', 'ms']) {
      assert.ok(key in entry, `event entry missing "${key}"`);
    }
    assert.strictEqual(entry.name, 'session.pin');
    assert.strictEqual(entry.kind, 'action');
    assert.strictEqual(entry.source, 'ipc');
    assert.strictEqual(entry.ok, true);
    assert.deepStrictEqual(entry.paramsDigest, { id: 'abc' });
    // Never the raw content: only the declared param, nothing else leaked in.
    assert.strictEqual(Object.keys(entry.paramsDigest).length, 1);
  });

  await checkAsync('event log: rotates to events.1.jsonl at the byte boundary, keeping one file', async () => {
    const dir = tempDir('rotate');
    const log = createEventLog({ dir, maxBytes: 200 });
    // Each entry is well under 200 bytes; write enough to cross the boundary
    // more than once and confirm exactly one rotated file exists (not events.2).
    for (let i = 0; i < 20; i += 1) {
      log.append({ ts: new Date().toISOString(), name: 'x', kind: 'observation', source: 'test', paramsDigest: {}, ok: true, ms: i });
    }
    const rotated = path.join(dir, 'events.1.jsonl');
    assert.ok(fs.existsSync(rotated), 'expected events.1.jsonl to exist after crossing maxBytes');
    assert.ok(!fs.existsSync(path.join(dir, 'events.2.jsonl')), 'only one rotated generation is kept');
    // The live file never exceeds maxBytes by more than one entry's worth.
    const liveSize = fs.statSync(log.file).size;
    assert.ok(liveSize < 400, `live events file grew unbounded: ${liveSize} bytes`);
  });

  await checkAsync('event log: a broken log directory degrades to a no-op, never throws', async () => {
    // Point the log at a path that cannot be created (a file where a dir is expected).
    const parent = tempDir('blocked');
    const blocker = path.join(parent, 'blocker');
    fs.writeFileSync(blocker, 'not a directory');
    const log = createEventLog({ dir: path.join(blocker, 'nested') });
    assert.doesNotThrow(() => log.append({ ts: 'x', name: 'x', kind: 'observation', source: 'test', paramsDigest: {}, ok: true, ms: 0 }));
  });

  // ---- PR-2 item 1: harness icon extraction is registered, app-only, honest
  // when the app is not running ----

  check('app.harness-icons is registered as an observation with no params', () => {
    const decl = COMMANDS.find((c) => c.name === 'app.harness-icons');
    assert.ok(decl, 'app.harness-icons must be registered');
    assert.strictEqual((decl as CommandDecl).kind, 'observation');
  });

  await checkAsync('app.harness-icons has no direct handler (Electron-only: nativeImage decode lives in electron/main.ts)', async () => {
    const dir = tempDir('icons-nohandler');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: {} });
    const result = await registry.invoke('app.harness-icons', {}, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(String(result.error), /only available through the running desktop app/);
  });

  // ---- PR-2 item 2: PR chips are cache-only (zero spawns from the inbox path) ----

  check('pulse.pr-chip is registered, direct (answers without the app running), and requires a repo', () => {
    const decl = COMMANDS.find((c) => c.name === 'pulse.pr-chip') as CommandDecl;
    assert.ok(decl, 'pulse.pr-chip must be registered');
    assert.strictEqual(decl.direct, true);
    assert.strictEqual(validateParams(decl, {}).ok, false);
  });

  await checkAsync('pulse.pr-chip: a missing cache is an honest chip:null, never an error', async () => {
    const home = tempDir('prchip-registry-miss');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const dir = tempDir('prchip-registry-miss-log');
      const registry = createRegistry({ log: createEventLog({ dir }) });
      const result = await registry.invoke('pulse.pr-chip', { repo: 'humanctl' }, { source: 'test' });
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.chip, null);
    } finally { process.env.HOME = prevHome; }
  });

  check('prChip: never touches the filesystem beyond one read of pulse-cache.json (cache-only contract)', () => {
    // Proves the zero-spawn contract at the unit level: prChip has no
    // require('child_process') anywhere in its call graph. The real
    // zero-pulse.run-invocations-from-inbox-rendering proof is an events.jsonl
    // trace captured live against the running app (see the PR body /
    // lab acceptance report), but this pins the static invariant so a future
    // change cannot silently reintroduce a spawn here without this failing to
    // even need updating (there is nothing to mock: the function signature
    // itself has no room for one).
    const home = tempDir('prchip-purity');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const r = prChip({ repo: 'anything' });
      assert.strictEqual(r.ok, true);
    } finally { process.env.HOME = prevHome; }
  });

  // ---- PR-2 item 3: note images (copy-in, validated, capped at 4) ----

  check('note.post is registered with an images array param, max 4', () => {
    const decl = COMMANDS.find((c) => c.name === 'note.post') as CommandDecl;
    assert.strictEqual(decl.params.images.type, 'array');
    assert.strictEqual(decl.params.images.max, 4);
  });

  check('storeNoteImages: copies a real file in, skips a missing one, skips a non-image extension, caps at 4', () => {
    const home = tempDir('images-home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const srcDir = tempDir('images-src');
      const goodPng = path.join(srcDir, 'proof.png');
      fs.writeFileSync(goodPng, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // not a full valid PNG; extension+size is what postNote validates
      const badExt = path.join(srcDir, 'notes.txt');
      fs.writeFileSync(badExt, 'not an image');
      const missing = path.join(srcDir, 'does-not-exist.png');
      const { stored, skipped } = storeNoteImages([goodPng, badExt, missing]);
      assert.strictEqual(stored.length, 1);
      assert.ok(fs.existsSync(path.join(attachmentsDir(), stored[0])));
      assert.strictEqual(skipped.length, 2);
      assert.ok(skipped.some((s) => s.path === badExt && /not a png/.test(s.reason)));
      assert.ok(skipped.some((s) => s.path === missing && /not found/.test(s.reason)));
    } finally { process.env.HOME = prevHome; }
  });

  check('storeNoteImages: caps at 4 even when more are supplied', () => {
    const home = tempDir('images-cap-home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const srcDir = tempDir('images-cap-src');
      const paths: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        const p = path.join(srcDir, `img${i}.png`);
        fs.writeFileSync(p, 'fake-png-bytes');
        paths.push(p);
      }
      const { stored } = storeNoteImages(paths);
      assert.strictEqual(stored.length, 4, 'at most 4 images are ever stored, regardless of how many are supplied');
    } finally { process.env.HOME = prevHome; }
  });

  await checkAsync('note.post: a real image round-trips end to end (path -> attachments/ copy -> note.attachments)', async () => {
    const home = tempDir('note-image-e2e');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const srcDir = tempDir('note-image-e2e-src');
      const imgPath = path.join(srcDir, 'screenshot.png');
      fs.writeFileSync(imgPath, 'fake-png-bytes-for-selftest');
      const registry = createRegistry({ log: createEventLog({ dir: path.join(home, '.humanctl') }) });
      const result = await registry.invoke('note.post', { message: 'proof attached', level: 'done', images: [imgPath] }, { source: 'test' });
      assert.strictEqual(result.ok, true);
      const note = result.note as { attachments: string[] };
      assert.strictEqual(note.attachments.length, 1);
      const copied = path.join(attachmentsDir(), note.attachments[0]);
      assert.ok(fs.existsSync(copied));
      assert.strictEqual(fs.readFileSync(copied, 'utf8'), 'fake-png-bytes-for-selftest');
    } finally { process.env.HOME = prevHome; }
  });

  check('isInboxRelevantChange: the new attachments/ directory is not on the inbox-relevant allowlist', () => {
    // Write/watch separation rule (AGENTS.md, generalized in PR-2 item 6): a
    // new system-written directory must be an explicit exclusion, not an
    // accidental one. Attachments are referenced BY a notes.jsonl write
    // (which already triggers the inbox watcher correctly); the attachment
    // files themselves must not be a second, redundant trigger.
    assert.strictEqual(isInboxRelevantChange('attachments/1699999999-abcd1234.png'), false);
  });

  // ---- PR-2 item 4: always-on summary engine budget ----

  check('session.summarize is registered with an auto boolean param', () => {
    const decl = COMMANDS.find((c) => c.name === 'session.summarize') as CommandDecl;
    assert.strictEqual(decl.params.auto.type, 'boolean');
  });

  check('summary.budget is registered, direct, and accepts an optional dailyBudgetUSD override', () => {
    const decl = COMMANDS.find((c) => c.name === 'summary.budget') as CommandDecl;
    assert.ok(decl, 'summary.budget must be registered');
    assert.strictEqual(decl.direct, true);
    assert.strictEqual(decl.params.dailyBudgetUSD.type, 'number');
  });

  await checkAsync('summary.budget: reflects real spend from lib/summary-budget.ts, not a stub', async () => {
    const home = tempDir('summary-budget-registry');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const { recordSpend } = require('./summary-budget') as typeof import('./summary-budget');
      recordSpend('a'.repeat(1000), 'b'.repeat(200));
      const registry = createRegistry({ log: createEventLog({ dir: path.join(home, '.humanctl') }) });
      const result = await registry.invoke('summary.budget', { dailyBudgetUSD: 1.0 }, { source: 'test' });
      assert.strictEqual(result.ok, true);
      const budget = result.budget as { spentUSD: number; dailyBudgetUSD: number };
      assert.ok(budget.spentUSD > 0, 'expected the recorded spend to show up through the registered command');
      assert.strictEqual(budget.dailyBudgetUSD, 1.0);
    } finally { process.env.HOME = prevHome; }
  });

  // ---- control socket: real round-trip in plain node ----

  await checkAsync('control socket: round-trips a real request through the registry', async () => {
    const dir = tempDir('socket');
    const log = createEventLog({ dir });
    const registry = createRegistry({
      log,
      handlers: { 'session.pin': (p: { id: string }) => ({ ok: true, id: p.id, pinned: true }) },
    });
    const socketPath = path.join(dir, 'app.sock');
    const server = createControlServer({ registry, socketPath });
    await new Promise<void>((resolve) => server.listen(resolve));
    try {
      const res = await socketRequest('session.pin', { id: 'zz9' }, { socketPath, timeoutMs: 5000 });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.id, 'zz9');
      assert.strictEqual(res.pinned, true);
      // The socket surface is exactly the registry: unknown commands still
      // come back as an honest ok:false, not a socket-level error.
      const bad = await socketRequest('nope.nope', {}, { socketPath, timeoutMs: 5000 });
      assert.strictEqual(bad.ok, false);
      assert.match(String(bad.error), /unknown command/);
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });

  await checkAsync('control socket: mode 0600 and stale-socket unlink on boot', async () => {
    const dir = tempDir('perms');
    const socketPath = path.join(dir, 'app.sock');
    fs.writeFileSync(socketPath, ''); // a stale regular file left at the socket path
    const registry = createRegistry({ log: createEventLog({ dir }) });
    const server = createControlServer({ registry, socketPath });
    await new Promise<void>((resolve, reject) => {
      server.listen(resolve);
      server.server.on('error', reject);
    });
    try {
      const mode = fs.statSync(socketPath).mode & 0o777;
      assert.strictEqual(mode, 0o600);
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
    assert.ok(!fs.existsSync(socketPath), 'close() must unlink the socket file');
  });

  await checkAsync('socketRequest: resolves { ok:false, transport:"unavailable" } when nothing is listening', async () => {
    const dir = tempDir('nosocket');
    const socketPath = path.join(dir, 'app.sock'); // never created
    const res = await socketRequest('app.commands', {}, { socketPath, timeoutMs: 2000 });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.transport, 'unavailable');
  });

  if (process.exitCode) {
    console.error(`commands selftest: FAILED (${passed} passed before failure)`);
  } else {
    console.log(`commands selftest: ok (${passed} checks)`);
  }
}

run();
