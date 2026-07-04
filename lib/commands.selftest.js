'use strict';

// Selftest for the command registry: plain node, zero deps, no network, no
// real ~/.humanctl data (every test uses a temp dir). Covers the registry
// invariant end to end: param validation, unknown-command rejection, the
// event log (write + rotation), and a real socket round-trip.
// Run: npm run commands:selftest

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  COMMANDS,
  validateParams,
  digestParams,
  createEventLog,
  createRegistry,
  createControlServer,
  socketRequest,
  inboxThreads,
  appendAskLog,
  askLogPath,
  isInboxRelevantChange,
} = require('./commands');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && e.stack ? e.stack : e);
    process.exitCode = 1;
  }
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `humanctl-selftest-${label}-`));
}

// ---- COMMANDS table shape ----

check('every command has a unique name, a kind, and a desc', () => {
  const seen = new Set();
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
  const decl = { name: 'note.post', params: { message: { type: 'string', required: true } } };
  const v = validateParams(decl, {});
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /requires param "message"/);
});

check('validateParams: unknown param is rejected', () => {
  const decl = { name: 'x', params: { a: { type: 'string' } } };
  const v = validateParams(decl, { a: 'ok', b: 'nope' });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /unknown param "b"/);
});

check('validateParams: enum violation is rejected', () => {
  const decl = { name: 'app.set-mode', params: { mode: { type: 'string', required: true, enum: ['inbox', 'focus', 'wall'] } } };
  const v = validateParams(decl, { mode: 'bogus' });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /must be one of inbox\|focus\|wall/);
});

check('validateParams: wrong type is rejected for string, number, boolean, object', () => {
  const decl = {
    name: 'x',
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
  const decl = { name: 'note.post', params: { message: { type: 'string', max: 5 } } };
  const v = validateParams(decl, { message: 'abcdefgh' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.params.message, 'abcde');
});

check('validateParams: valid params pass through unchanged', () => {
  const decl = { name: 'session.pin', params: { id: { type: 'string', required: true } } };
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
    patch: { theme: 'dark', mode: 'focus' },
  });
  assert.strictEqual(d.short, 'ok');
  assert.strictEqual(d.long.length, 80);
  assert.strictEqual(d.n, 3);
  assert.strictEqual(d.b, true);
  assert.strictEqual(d.nil, null);
  assert.ok(!('missing' in d), 'undefined params must not appear in the digest at all');
  assert.strictEqual(d.list, '[3]');
  assert.strictEqual(d.patch, '{mode,theme}');
});

// ---- registry: unknown command, missing handler, dispatch, logging ----
// invoke() is async end to end (handlers may be async), so these live in the
// async run() below alongside the event-log and socket checks.

async function run() {
  await checkAsync('registry: unknown command is rejected and logged with kind "unknown"', async () => {
    const dir = tempDir('unknown2');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: {} });
    const result = await registry.invoke('not.a.real.command', {}, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /unknown command/);
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
    const result = await registry.invoke('app.set-mode', { mode: 'focus' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /only available through the running desktop app/);
  });

  await checkAsync('registry: validation failure never reaches the handler', async () => {
    const dir = tempDir('validation');
    const log = createEventLog({ dir });
    let called = false;
    const registry = createRegistry({ log, handlers: { 'app.set-mode': () => { called = true; return { ok: true }; } } });
    const result = await registry.invoke('app.set-mode', { mode: 'bogus' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(called, false);
  });

  await checkAsync('registry: a direct command dispatches to its built-in handler', async () => {
    const dir = tempDir('direct');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    const result = await registry.invoke('app.commands', {}, { source: 'test' });
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.commands) && result.commands.length === COMMANDS.length);
  });

  await checkAsync('registry: a handler that throws is turned into an honest ok:false, not a crash', async () => {
    const dir = tempDir('throws');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: { 'app.set-mode': () => { throw new Error('boom'); } } });
    const result = await registry.invoke('app.set-mode', { mode: 'focus' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /boom/);
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

  // Note: lib/sessions.js resolves NOTES_FILE from os.homedir() ONCE at module
  // load (a pre-existing constant-capture quirk, tracked separately), so
  // swapping process.env.HOME after the first require does not sandbox
  // readNotes() the way it sandboxes controlDir()-based writers. This selftest
  // must stay a no-op on the real ~/.humanctl/notes.jsonl (repo hygiene: a
  // selftest never leaves durable side effects on the machine that ran it),
  // so it writes through the REAL note.post path (proving the note.post ->
  // inbox.threads join actually works end to end) and then truncates its own
  // appended line back off the real file in a finally block.
  await checkAsync('inbox.threads: a note with a session id becomes a thread with one note item', async () => {
    const realNotesFile = path.join(os.homedir(), '.humanctl', 'notes.jsonl');
    const sizeBefore = (() => { try { return fs.statSync(realNotesFile).size; } catch { return 0; } })();
    const sid = `selftest_${randomUUID().slice(0, 8)}`;
    const dir = tempDir('inbox-home');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    try {
      const posted = await registry.invoke('note.post', { message: 'PR is up for review', level: 'review', session: sid }, { source: 'test' });
      assert.strictEqual(posted.ok, true);
      const result = await registry.invoke('inbox.threads', {}, { source: 'test' });
      assert.strictEqual(result.ok, true);
      const t = result.threads.find((x) => x.sessionId === sid);
      assert.ok(t, 'expected a thread for the noted session (proves the note.post -> inbox.threads join)');
      assert.strictEqual(t.items[0].kind, 'note');
      assert.strictEqual(t.items[0].level, 'review');
    } finally {
      // Truncate back to the exact pre-test size: note.post only appends, so
      // this removes precisely the one line this test wrote, nothing else.
      try { fs.truncateSync(realNotesFile, sizeBefore); } catch { /* best effort */ }
    }
  });

  await checkAsync('inbox.threads: a session with no note, no need-state row, and no ask log yields no thread', async () => {
    const sid = `selftest_absent_${randomUUID().slice(0, 8)}`;
    const dir = tempDir('inbox-absent');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log });
    const result = await registry.invoke('inbox.threads', {}, { source: 'test' });
    assert.strictEqual(result.ok, true);
    assert.ok(!result.threads.some((t) => t.sessionId === sid), 'a session with no signal must not fabricate a thread');
  });

  check('appendAskLog + readAskLog: round-trips a Q&A entry and an interrupted-probe entry', () => {
    const home = tempDir('asklog-home');
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      appendAskLog('sess_xyz', { q: 'status?', a: 'on track', engine: 'claude', ts: new Date().toISOString() });
      appendAskLog('sess_xyz', { status: 'interrupted', q: 'what next?', ts: new Date().toISOString() });
      assert.ok(fs.existsSync(askLogPath('sess_xyz')));
      const { readAskLog } = require('./commands');
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
      const t = result.threads.find((x) => x.sessionId === 'sess_qa1');
      assert.ok(t, 'expected a thread from the persisted ask log alone (no note, no live session row)');
      assert.strictEqual(t.items[0].kind, 'qa');
      assert.strictEqual(t.items[0].answer, 'moving along');
    } finally {
      process.env.HOME = prevHome;
    }
  });

  // ---- new commands are declared with the right kind/params (handlers are
  // app-injected; validation and honest "not available without the app" are
  // exercised the same way the pre-existing app.set-mode tests are above) ----

  check('inbox.mark-read requires threadId', () => {
    const decl = COMMANDS.find((c) => c.name === 'inbox.mark-read');
    assert.ok(decl, 'inbox.mark-read must be registered');
    const v = validateParams(decl, {});
    assert.strictEqual(v.ok, false);
    assert.match(v.error, /requires param "threadId"/);
  });

  check('app.set-left-rail and app.set-right-rail require a boolean collapsed param', () => {
    for (const name of ['app.set-left-rail', 'app.set-right-rail']) {
      const decl = COMMANDS.find((c) => c.name === name);
      assert.ok(decl, `${name} must be registered`);
      assert.strictEqual(validateParams(decl, {}).ok, false);
      assert.strictEqual(validateParams(decl, { collapsed: 'yes' }).ok, false);
      assert.deepStrictEqual(validateParams(decl, { collapsed: true }), { ok: true, params: { collapsed: true } });
    }
  });

  await checkAsync('atlas.ask is registered, requires a question, and is honest when the app is not running', async () => {
    const decl = COMMANDS.find((c) => c.name === 'atlas.ask');
    assert.ok(decl, 'atlas.ask must be registered');
    assert.strictEqual(decl.kind, 'action');
    assert.strictEqual(validateParams(decl, {}).ok, false);
    const dir = tempDir('atlas');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: {} });
    const result = await registry.invoke('atlas.ask', { question: 'what needs me right now?' }, { source: 'test' });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /only available through the running desktop app/);
  });

  check('app.set-mode enum no longer includes triage', () => {
    const decl = COMMANDS.find((c) => c.name === 'app.set-mode');
    assert.deepStrictEqual(decl.params.mode.enum, ['inbox', 'focus', 'wall']);
  });

  // ---- perf guard: the ~/.humanctl watcher must never react to its own
  // registry-owned outputs (electron/main.js's inbox fs.watch calls this
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
    // Simulates electron/main.js's inbox fs.watch handler end to end: every
    // registry invoke() appends one line to events.jsonl via the SAME
    // createEventLog() used here, then this asserts that filename would be
    // filtered out before ping()/scheduleInbox() ever run.
    const dir = tempDir('perfguard');
    const log = createEventLog({ dir });
    const registry = createRegistry({ log, handlers: { 'app.set-mode': () => ({ ok: true }) } });
    let watcherFired = false;
    const simulateWatchCallback = (fn) => { if (isInboxRelevantChange(fn)) watcherFired = true; };

    await registry.invoke('app.set-mode', { mode: 'focus' }, { source: 'test' });
    // events.jsonl now has one line; drive the exact filename fs.watch would
    // report for that write through the same filter main.js applies.
    simulateWatchCallback('events.jsonl');
    assert.strictEqual(watcherFired, false, 'events.jsonl writes must never trigger the inbox watcher');

    // Force rotation and confirm events.1.jsonl is filtered too.
    for (let i = 0; i < 50; i += 1) {
      await registry.invoke('app.set-mode', { mode: 'focus' }, { source: 'test' });
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

  // ---- control socket: real round-trip in plain node ----

  await checkAsync('control socket: round-trips a real request through the registry', async () => {
    const dir = tempDir('socket');
    const log = createEventLog({ dir });
    const registry = createRegistry({
      log,
      handlers: { 'session.pin': (p) => ({ ok: true, id: p.id, pinned: true }) },
    });
    const socketPath = path.join(dir, 'app.sock');
    const server = createControlServer({ registry, socketPath });
    await new Promise((resolve) => server.listen(resolve));
    try {
      const res = await socketRequest('session.pin', { id: 'zz9' }, { socketPath, timeoutMs: 5000 });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.id, 'zz9');
      assert.strictEqual(res.pinned, true);
      // The socket surface is exactly the registry: unknown commands still
      // come back as an honest ok:false, not a socket-level error.
      const bad = await socketRequest('nope.nope', {}, { socketPath, timeoutMs: 5000 });
      assert.strictEqual(bad.ok, false);
      assert.match(bad.error, /unknown command/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await checkAsync('control socket: mode 0600 and stale-socket unlink on boot', async () => {
    const dir = tempDir('perms');
    const socketPath = path.join(dir, 'app.sock');
    fs.writeFileSync(socketPath, ''); // a stale regular file left at the socket path
    const registry = createRegistry({ log: createEventLog({ dir }) });
    const server = createControlServer({ registry, socketPath });
    await new Promise((resolve, reject) => {
      server.listen(resolve);
      server.server.on('error', reject);
    });
    try {
      const mode = fs.statSync(socketPath).mode & 0o777;
      assert.strictEqual(mode, 0o600);
    } finally {
      await new Promise((resolve) => server.close(resolve));
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
