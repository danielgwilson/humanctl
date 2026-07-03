'use strict';

// Selftest for the live-timeline readers in sessions.js: backward pages
// (readTimelinePage) and the incremental append cursor (readAppended).
// Plain node, zero deps, no network, no real data: every fixture is a
// synthetic transcript written to a throwaway temp dir and removed after.
// Run: npm run reader:selftest

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTimelinePage, readAppended, primeTailCursor, readBlocks } = require('./sessions');

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-reader-'));
let fileNo = 0;
function tmpFile() { return path.join(TMP, `fixture-${++fileNo}.jsonl`); }

// ---- synthetic line builders (claude-code shape) ----
const T0 = Date.parse('2026-01-15T12:00:00Z');
const iso = (i) => new Date(T0 + i * 60000).toISOString();
const uLine = (i, text) => JSON.stringify({ type: 'user', timestamp: iso(i), message: { role: 'user', content: text } }) + '\n';
const aLine = (i, text) => JSON.stringify({ type: 'assistant', timestamp: iso(i), message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n';
const toolUse = (i) => JSON.stringify({ type: 'assistant', timestamp: iso(i), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true' } }] } }) + '\n';
const toolResult = (i, pad) => JSON.stringify({ type: 'user', timestamp: iso(i), message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'x'.repeat(pad || 64) }] }] } }) + '\n';
const titleLine = (t) => JSON.stringify({ type: 'custom-title', customTitle: t }) + '\n';
// codex shapes
const cxUser = (i, text) => JSON.stringify({ timestamp: iso(i), type: 'event_msg', payload: { type: 'user_message', message: text } }) + '\n';
const cxAgent = (i, text) => JSON.stringify({ timestamp: iso(i), type: 'event_msg', payload: { type: 'agent_message', message: text } }) + '\n';
const cxTurnCtx = (m, e) => JSON.stringify({ type: 'turn_context', payload: { model: m, effort: e } }) + '\n';
const cxAborted = (i) => JSON.stringify({ timestamp: iso(i), type: 'event_msg', payload: { type: 'turn_aborted' } }) + '\n';

const subst = (evs) => evs.filter((e) => e.k === 'user' || e.k === 'assistant' || e.k === 'interrupt');

// ---- page 1: whole small file, ordering, alignment ----
check('page over a small file covers it whole, in order, atStart', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'first ask') + toolUse(1) + toolResult(2) + aLine(3, 'first answer') + uLine(4, 'second ask') + aLine(5, 'second answer'));
  const p = readTimelinePage(f, { harness: 'claude-code' });
  assert.ok(p, 'page exists');
  assert.strictEqual(p.atStart, true);
  assert.strictEqual(p.start, 0);
  assert.strictEqual(p.end, fs.statSync(f).size, 'end is line-aligned EOF');
  assert.strictEqual(p.estEarlier, 0);
  const kinds = p.events.map((e) => e.k);
  assert.deepStrictEqual(kinds, ['user', 'tools', 'assistant', 'user', 'assistant']);
  assert.strictEqual(p.events[1].n, 2, 'tool_use + tool_result collapse into one run');
  assert.strictEqual(p.events[4].t, 'second answer');
  assert.ok(p.events[4].ts === T0 + 5 * 60000, 'events carry real timestamps');
});

check('a partially flushed last line is held out of the page end', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  const aligned = fs.statSync(f).size;
  fs.appendFileSync(f, '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cut mid li'); // no newline
  const p = readTimelinePage(f, { harness: 'claude-code' });
  assert.strictEqual(p.end, aligned, 'end stops at the last complete line');
  assert.strictEqual(subst(p.events).length, 2);
});

// ---- backward paging: continuity, no dupes, no gaps ----
check('backward pages tile the file exactly (no dupes, no gaps)', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 40; i++) all += uLine(2 * i, `ask number ${i}`) + aLine(2 * i + 1, `answer number ${i}`);
  fs.writeFileSync(f, all);
  const opts = { harness: 'claude-code', chunkBytes: 2048, maxBytes: 1 << 20, minEvents: 10 };
  const pages = [];
  let before;
  for (let guard = 0; guard < 50; guard++) {
    const p = readTimelinePage(f, Object.assign({}, opts, before != null ? { before } : {}));
    pages.unshift(p);
    if (p.atStart) break;
    assert.ok(p.start < p.end, 'page covers a nonempty span');
    before = p.start;
  }
  assert.ok(pages.length > 2, `paged more than twice (got ${pages.length})`);
  assert.strictEqual(pages[0].atStart, true);
  for (let i = 1; i < pages.length; i++) assert.strictEqual(pages[i - 1].end, pages[i].start, 'pages are contiguous');
  const texts = [].concat(...pages.map((p) => subst(p.events).map((e) => e.t)));
  assert.strictEqual(texts.length, 80, 'every substantive event appears exactly once');
  assert.strictEqual(texts[0], 'ask number 0');
  assert.strictEqual(texts[79], 'answer number 39');
});

// ---- budgeting by substantive events, not bytes ----
check('fat tool_result noise does not starve the page of real messages', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 12; i++) all += uLine(4 * i, `real ask ${i}`) + aLine(4 * i + 1, `real answer ${i}`);
  // tail: pure tool noise, each line far bigger than the chunk budget slice
  for (let i = 0; i < 30; i++) all += toolUse(100 + i) + toolResult(100 + i, 4000);
  fs.writeFileSync(f, all);
  const p = readTimelinePage(f, { harness: 'claude-code', chunkBytes: 8 * 1024, maxBytes: 1 << 20, minEvents: 8 });
  assert.ok(subst(p.events).length >= 8, `page kept scanning past tool noise (got ${subst(p.events).length} substantive)`);
  assert.ok(p.events.some((e) => e.k === 'tools' && e.n >= 30), 'tool noise collapsed into a countable run');
});

// ---- multibyte safety ----
check('byte offsets stay aligned through multibyte content', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 20; i++) all += uLine(2 * i, `emoji ask \u{1F9ED}\u{1F52C}\u{2728} nr ${i}`) + aLine(2 * i + 1, `emoji answer \u{1F419}\u{1F433} nr ${i}`);
  fs.writeFileSync(f, all);
  const opts = { harness: 'claude-code', chunkBytes: 1024, maxBytes: 1 << 20, minEvents: 6 };
  let before, total = 0;
  for (let guard = 0; guard < 60; guard++) {
    const p = readTimelinePage(f, Object.assign({}, opts, before != null ? { before } : {}));
    total += subst(p.events).length;
    for (const e of subst(p.events)) assert.ok(/^emoji (ask|answer)/.test(e.t), `clean parse, got: ${e.t.slice(0, 24)}`);
    if (p.atStart) break;
    before = p.start;
  }
  assert.strictEqual(total, 40);
});

// ---- append cursor ----
check('append cursor: only new bytes are parsed, offset math holds', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer \u{1F9ED}'));
  const p = readTimelinePage(f, { harness: 'claude-code' });
  primeTailCursor(f, p.end);
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.reset, undefined);
  assert.strictEqual(r.events.length, 0, 'no appends yet');
  fs.appendFileSync(f, uLine(2, 'follow-up ask') + aLine(3, 'follow-up answer'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.deepStrictEqual(r.events.map((e) => e.k), ['user', 'assistant']);
  assert.strictEqual(r.events[1].t, 'follow-up answer');
  assert.strictEqual(r.end, fs.statSync(f).size, 'cursor advanced to EOF');
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events.length, 0, 'append consumed exactly once');
});

check('append cursor: a partial line is not consumed until its newline lands', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  primeTailCursor(f);
  const full = aLine(2, 'streamed answer');
  fs.appendFileSync(f, full.slice(0, 40)); // mid-line flush
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events.length, 0);
  const offBefore = r.end;
  fs.appendFileSync(f, full.slice(40)); // completes the line
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].t, 'streamed answer');
  assert.strictEqual(r.end, offBefore + Buffer.byteLength(full), 'offset advanced by the full line');
});

check('append cursor: truncation and rotation reset honestly', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  primeTailCursor(f);
  fs.truncateSync(f, 10); // size shrank
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.reset, true);
  assert.strictEqual(r.reason, 'truncated');
  // unprimed after a reset: the caller must re-read a page and re-prime
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.reason, 'unprimed');
  // rotation: same path, new inode
  fs.writeFileSync(f, uLine(0, 'ask'));
  primeTailCursor(f);
  fs.unlinkSync(f);
  fs.writeFileSync(f, uLine(0, 'reborn ask') + aLine(1, 'reborn answer'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.reset, true);
  assert.strictEqual(r.reason, 'rotated');
});

check('append cursor: an oversized gap asks for a full re-read', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask'));
  primeTailCursor(f);
  fs.appendFileSync(f, aLine(1, 'y'.repeat(9 * 1024 * 1024)));
  const r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.reset, true);
  assert.strictEqual(r.reason, 'gap');
});

// ---- meta pickup from appended bytes ----
check('claude custom-title lines are picked up from appended bytes', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask'));
  primeTailCursor(f);
  fs.appendFileSync(f, titleLine('Renamed session title') + aLine(1, 'answer'));
  const r = readAppended(f, { harness: 'claude-code' });
  assert.ok(r.meta && r.meta.customTitle === 'Renamed session title');
  assert.deepStrictEqual(r.events.map((e) => e.k), ['assistant']);
});

check('codex turn markers are picked up from appended bytes', () => {
  const f = tmpFile();
  fs.writeFileSync(f, cxUser(0, 'ask'));
  primeTailCursor(f);
  fs.appendFileSync(f, cxTurnCtx('gpt-5.5', 'xhigh') + cxAgent(1, 'answer') + cxAborted(2));
  const r = readAppended(f, { harness: 'codex' });
  assert.ok(r.meta && r.meta.model === 'gpt-5.5' && r.meta.effort === 'xhigh');
  assert.deepStrictEqual(r.events.map((e) => e.k), ['assistant', 'interrupt']);
});

// ---- probe filtering across append batches ----
check('ask-the-session probe turns never surface, even split across appends', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  primeTailCursor(f);
  fs.appendFileSync(f, uLine(2, '[humanctl btw] status?'));
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events.length, 0, 'probe question dropped');
  fs.appendFileSync(f, aLine(3, 'probe answer, not a real turn'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events.length, 0, 'probe answer dropped across the batch boundary');
  fs.appendFileSync(f, uLine(4, 'real follow-up'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.deepStrictEqual(r.events.map((e) => e.k), ['user'], 'a genuine user turn closes the window');
});

// ---- readBlocks tail anchoring ----
check('readBlocks keeps the newest blocks when the cap trims', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 4300; i++) all += aLine(i, `block ${i}`);
  fs.writeFileSync(f, all);
  const b = readBlocks(f, { harness: 'claude-code' });
  assert.strictEqual(b.truncated, true);
  assert.strictEqual(b.blocks.length, 4000);
  assert.ok(/block 4299$/.test(b.blocks[b.blocks.length - 1].preview), 'newest block survives the trim');
});

fs.rmSync(TMP, { recursive: true, force: true });
if (process.exitCode) {
  console.error(`reader selftest: FAILURES (passed ${passed})`);
} else {
  console.log(`reader selftest: ${passed} checks passed`);
}
