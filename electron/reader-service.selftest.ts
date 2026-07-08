// Selftest for electron/reader-service.ts: the transcript fs/parse pipeline
// that runs in its own Electron utilityProcess (AGENTS.md "Never block the
// Electron main process"). Plain node, zero deps, no real Electron: the
// module's only electron import is TYPE-only (import type { ParentPort,
// MessagePortMain } from 'electron', erased at compile time), and its one
// hard runtime dependency is process.parentPort, guarded by a throw at
// import time. This selftest fakes that global with a tiny EventEmitter-
// based port BEFORE dynamically importing the module, and points HOME at a
// throwaway temp dir before that import too, so every fixture read
// (lib/sessions.ts and lib/commands.ts both resolve HOME per call, never at
// module load, see lib/reader.selftest.ts's HOME-swap check) is sandboxed.
//
// quota.claude is deliberately NOT covered here: it spawns the real `claude`
// CLI through lib/claude-quota.ts's default execFile-based runner, and
// reader-service.ts's claudeQuotaCached() calls readClaudeQuota() with no
// injection seam (unlike lib/claude-quota.selftest.ts, which drives the
// parser directly with an injected runner). Exercising it here would mean
// either shelling out to a real `claude` binary from this selftest or not
// testing it at all; this is a known seam gap in reader-service.ts, not an
// oversight, and quota.claude has its own coverage at the parser level.
//
// watchSessions() (called at import time) starts real fs.watch() watchers
// that keep the event loop alive forever with no public teardown (this
// process is normally killed by main.ts on app quit); this file ends with an
// explicit process.exit(0) rather than letting the event loop hang. No
// assertion below depends on a watcher actually firing (debounced fs.watch
// behavior is flaky under selftest timing; see AGENTS.md's write/watch
// separation notes for why this file avoids it entirely).
// Run: npm run reader-service:selftest

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

let passed = 0;
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

// ---- sandbox HOME before anything under test can resolve it ----
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-reader-service-'));
process.env.HOME = HOME;

// ---- fake parentPort / MessagePortMain ----
// reader-service.ts's usage of both is identical: `.on('message', cb)` +
// `.postMessage(msg)`, plus `.start()`/`.close()` for the renderer port. One
// EventEmitter-backed class covers both fakes.
class FakePort extends EventEmitter {
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  postMessage(msg: unknown): void {
    this.sent.push(msg as Record<string, unknown>);
    this.emit('sent', msg);
  }
  start(): void { /* no-op, matches MessagePortMain's start() */ }
  close(): void { this.closed = true; }
}

const fakeParentPort = new FakePort();
// process.parentPort has no ambient type on NodeJS.Process; reader-service.ts
// itself casts through NodeJS.Process & { parentPort?: ParentPort } to read
// it, so assigning through `unknown` here keeps this file free of any
// runtime or type dependency on the 'electron' package.
(process as unknown as { parentPort: unknown }).parentPort = fakeParentPort;

let nextId = 1;
function request(port: FakePort, cmd: string, args?: unknown): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      port.off('sent', onSent);
      reject(new Error(`timed out waiting for a reply to "${cmd}" (id ${id})`));
    }, 4000);
    const onSent = (msg: unknown) => {
      const m = msg as Record<string, unknown> | undefined;
      if (m && m.id === id) {
        clearTimeout(timer);
        port.off('sent', onSent);
        resolve(m);
      }
    };
    port.on('sent', onSent);
    port.emit('message', { data: { id, cmd, args } });
  });
}
function handshake(port: FakePort): void {
  fakeParentPort.emit('message', { data: { type: 'renderer-port' }, ports: [port] });
}

async function main(): Promise<void> {
  // Assigning process.parentPort and HOME above, BEFORE this import, is
  // load-bearing: reader-service.ts reads process.parentPort at module
  // top-level (throwing if absent, lines ~72-77) and calls watchSessions()
  // (which reads HOME via lib/sessions.ts's harnesses()) synchronously at
  // import time, both before any of this file's own code could run.
  await import('./reader-service');

  // ---- fixtures: a synthetic Claude Code session + a notes.jsonl entry ----
  const T0 = Date.parse('2026-01-15T12:00:00Z');
  const iso = (i: number) => new Date(T0 + i * 60000).toISOString();
  const uLine = (i: number, text: string) => JSON.stringify({ type: 'user', timestamp: iso(i), message: { role: 'user', content: text } }) + '\n';
  const aLine = (i: number, text: string) => JSON.stringify({ type: 'assistant', timestamp: iso(i), message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n';

  const projDir = path.join(HOME, '.claude', 'projects', 'fixture-proj');
  fs.mkdirSync(projDir, { recursive: true });
  const sessionId = 'sess-fixture-1';
  fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), uLine(0, 'fixture ask') + aLine(1, 'fixture answer'));

  const notesPath = path.join(HOME, '.humanctl', 'notes.jsonl');
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(notesPath, JSON.stringify({ id: 'note-1', ts: iso(2), level: 'review', message: 'PR is up', session: sessionId }) + '\n');

  // ---- transport 1: process.parentPort (main.ts's own requests) ----

  await checkAsync('sessions.list replies { id, ok, result } with the synthetic session', async () => {
    const r = await request(fakeParentPort, 'sessions.list', {});
    assert.strictEqual(typeof r.id, 'number', 'reply carries a numeric id echoing the request');
    assert.strictEqual(r.ok, true);
    const rows = (r.result as { rows: Array<{ id: string }> }).rows;
    assert.ok(rows.some((row) => row.id === sessionId), `expected ${sessionId} among ${rows.map((x) => x.id)}`);
  });

  await checkAsync('notes.list replies with the synthetic note', async () => {
    const r = await request(fakeParentPort, 'notes.list', {});
    assert.strictEqual(r.ok, true);
    const notes = (r.result as { notes: Array<{ message: string }> }).notes;
    assert.ok(notes.some((n) => n.message === 'PR is up'));
  });

  await checkAsync('inbox.threads joins the note to its session', async () => {
    const r = await request(fakeParentPort, 'inbox.threads', {});
    assert.strictEqual(r.ok, true);
    const threads = (r.result as { threads: Array<{ sessionId: string; items: Array<{ kind: string }> }> }).threads;
    const t = threads.find((x) => x.sessionId === sessionId);
    assert.ok(t, 'expected a thread for the noted session (proves the notes.jsonl -> inbox.threads join)');
    assert.strictEqual((t as { items: Array<{ kind: string }> }).items[0].kind, 'note');
  });

  await checkAsync('an unknown cmd replies ok:false with an "unknown cmd" error', async () => {
    const r = await request(fakeParentPort, 'not.a.real.cmd', {});
    assert.strictEqual(r.ok, false);
    assert.match(String(r.error), /unknown cmd "not\.a\.real\.cmd"/);
  });

  await checkAsync('a request missing a numeric id is silently dropped, not replied to', async () => {
    const before = fakeParentPort.sent.length;
    fakeParentPort.emit('message', { data: { cmd: 'sessions.list', args: {} } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(fakeParentPort.sent.length, before, 'no reply should have been posted for a malformed request');
  });

  await checkAsync('a request missing a string cmd is silently dropped, not replied to', async () => {
    const before = fakeParentPort.sent.length;
    fakeParentPort.emit('message', { data: { id: nextId++ } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(fakeParentPort.sent.length, before, 'no reply should have been posted for a malformed request');
  });

  await checkAsync('need-state with no path throws inside the handler and comes back as an honest ok:false', async () => {
    const r = await request(fakeParentPort, 'need-state', {});
    assert.strictEqual(r.ok, false);
    assert.match(String(r.error), /need-state requires a path/);
  });

  await checkAsync('resolve-session-row for an id with no match replies ok:true with a nested ok:false result', async () => {
    const r = await request(fakeParentPort, 'resolve-session-row', { id: 'zz-definitely-not-a-real-session-zz' });
    assert.strictEqual(r.ok, true, 'the transport-level reply is ok:true even when the lookup itself fails');
    const nested = r.result as { ok: boolean; error?: string };
    assert.strictEqual(nested.ok, false);
    assert.match(String(nested.error), /no recent session matches/);
  });

  await checkAsync('session.timeline with neither an id nor a path is an honest ok:false, not a crash', async () => {
    const r = await request(fakeParentPort, 'session.timeline', {});
    assert.strictEqual(r.ok, true);
    const nested = r.result as { ok: boolean; error?: string };
    assert.strictEqual(nested.ok, false);
    assert.match(String(nested.error), /needs an id or a path/);
  });

  await checkAsync('session.detail with neither an id nor a path is an honest ok:false, not a crash', async () => {
    const r = await request(fakeParentPort, 'session.detail', {});
    assert.strictEqual(r.ok, true);
    const nested = r.result as { ok: boolean; error?: string };
    assert.strictEqual(nested.ok, false);
    assert.match(String(nested.error), /needs an id or a path/);
  });

  await checkAsync('session.hot dispatches to setHot and replies { ok: true }', async () => {
    const r = await request(fakeParentPort, 'session.hot', { path: null });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.result, { ok: true });
  });

  await checkAsync('before any "init" message, app.status falls back to version 0.0.0 and both apps false', async () => {
    const r = await request(fakeParentPort, 'app.status', {});
    assert.strictEqual(r.ok, true);
    const status = r.result as { status: { version: string; apps: { claude: boolean; codex: boolean } } };
    assert.strictEqual(status.status.version, '0.0.0');
    assert.deepStrictEqual(status.status.apps, { claude: false, codex: false });
  });

  await checkAsync('an "init" message merges version/apps into every later app.status reply', async () => {
    fakeParentPort.emit('message', { data: { type: 'init', version: '9.9.9', apps: { claude: true, codex: false } } });
    const r = await request(fakeParentPort, 'app.status', {});
    assert.strictEqual(r.ok, true);
    const status = r.result as { status: { version: string; apps: { claude: boolean; codex: boolean } } };
    assert.strictEqual(status.status.version, '9.9.9');
    assert.deepStrictEqual(status.status.apps, { claude: true, codex: false });
  });

  // ---- transport 2: a direct renderer MessagePortMain, brokered by a
  // { type: 'renderer-port' } handshake over parentPort ----

  const rendererPort1 = new FakePort();
  handshake(rendererPort1);

  await checkAsync('after a renderer-port handshake, requests dispatch and reply on that SAME port, never on parentPort', async () => {
    const before = fakeParentPort.sent.length;
    const r = await request(rendererPort1, 'sessions.list', {});
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fakeParentPort.sent.length, before, 'a renderer-port request must not also reply on parentPort');
  });

  await checkAsync('notes.list also dispatches over the renderer port (byte-identical handler, different transport)', async () => {
    const r = await request(rendererPort1, 'notes.list', {});
    assert.strictEqual(r.ok, true);
    const notes = (r.result as { notes: unknown[] }).notes;
    assert.ok(notes.length >= 1);
  });

  await checkAsync('an unknown cmd over the renderer port replies the same as over parentPort', async () => {
    const r = await request(rendererPort1, 'nope.nope', {});
    assert.strictEqual(r.ok, false);
    assert.match(String(r.error), /unknown cmd "nope\.nope"/);
  });

  const rendererPort2 = new FakePort();
  handshake(rendererPort2);

  await checkAsync('a second renderer-port handshake closes the first port', async () => {
    assert.strictEqual(rendererPort1.closed, true);
    assert.strictEqual(rendererPort2.closed, false);
  });

  await checkAsync('the new renderer port serves requests after the handoff', async () => {
    const r = await request(rendererPort2, 'sessions.list', {});
    assert.strictEqual(r.ok, true);
  });

  console.log('reader-service selftest: quota.claude skipped (spawns the real claude CLI via a non-injectable default runner in lib/claude-quota.ts; see the header comment and lib/claude-quota.selftest.ts for the injected-runner pattern this file cannot reuse)');

  fs.rmSync(HOME, { recursive: true, force: true });
  if (process.exitCode) {
    console.error(`reader-service selftest: FAILURES (passed ${passed})`);
  } else {
    console.log(`reader-service selftest: ${passed} checks passed`);
  }
  // watchSessions() starts real fs.watch() watchers at import time that keep
  // the event loop alive forever (no public teardown outside of main.ts
  // killing this process on app quit). Exit explicitly once every check has
  // settled, preserving the pass/fail exit code.
  process.exit(process.exitCode || 0);
}

main();
