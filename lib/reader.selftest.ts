// Selftest for the live-timeline readers in sessions.ts: backward pages
// (readTimelinePage) and the incremental append cursor (readAppended).
// Plain node, zero deps, no network, no real data: every fixture is a
// synthetic transcript written to a throwaway temp dir and removed after.
// Run: npm run reader:selftest

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTimelinePage, readAppended, primeTailCursor, readBlocks, readNotes, listRecent, readClaudeUsage, type TimelineEvent } from './sessions';
import { priceFor } from './pricing';

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-reader-'));
let fileNo = 0;
function tmpFile(): string { return path.join(TMP, `fixture-${++fileNo}.jsonl`); }

// ---- synthetic line builders (claude-code shape) ----
const T0 = Date.parse('2026-01-15T12:00:00Z');
const iso = (i: number) => new Date(T0 + i * 60000).toISOString();
const uLine = (i: number, text: string) => JSON.stringify({ type: 'user', timestamp: iso(i), message: { role: 'user', content: text } }) + '\n';
const aLine = (i: number, text: string) => JSON.stringify({ type: 'assistant', timestamp: iso(i), message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n';
const toolUse = (i: number) => JSON.stringify({ type: 'assistant', timestamp: iso(i), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'true' } }] } }) + '\n';
const toolResult = (i: number, pad?: number) => JSON.stringify({ type: 'user', timestamp: iso(i), message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'x'.repeat(pad || 64) }] }] } }) + '\n';
const titleLine = (t: string) => JSON.stringify({ type: 'custom-title', customTitle: t }) + '\n';
// codex shapes
const cxUser = (i: number, text: string) => JSON.stringify({ timestamp: iso(i), type: 'event_msg', payload: { type: 'user_message', message: text } }) + '\n';
const cxAgent = (i: number, text: string) => JSON.stringify({ timestamp: iso(i), type: 'event_msg', payload: { type: 'agent_message', message: text } }) + '\n';
const cxTurnCtx = (m: string, e: string) => JSON.stringify({ type: 'turn_context', payload: { model: m, effort: e } }) + '\n';
const cxAborted = (i: number) => JSON.stringify({ timestamp: iso(i), type: 'event_msg', payload: { type: 'turn_aborted' } }) + '\n';

const subst = (evs: TimelineEvent[]) => evs.filter((e) => e.k === 'user' || e.k === 'assistant' || e.k === 'interrupt');

// ---- page 1: whole small file, ordering, alignment ----
check('page over a small file covers it whole, in order, atStart', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'first ask') + toolUse(1) + toolResult(2) + aLine(3, 'first answer') + uLine(4, 'second ask') + aLine(5, 'second answer'));
  const p = readTimelinePage(f, { harness: 'claude-code' });
  assert.ok(p, 'page exists');
  assert.strictEqual(p!.atStart, true);
  assert.strictEqual(p!.start, 0);
  assert.strictEqual(p!.end, fs.statSync(f).size, 'end is line-aligned EOF');
  assert.strictEqual(p!.estEarlier, 0);
  const kinds = p!.events.map((e) => e.k);
  assert.deepStrictEqual(kinds, ['user', 'tools', 'assistant', 'user', 'assistant']);
  assert.strictEqual((p!.events[1] as { n: number }).n, 2, 'tool_use + tool_result collapse into one run');
  assert.strictEqual((p!.events[4] as { t?: string }).t, 'second answer');
  assert.ok(p!.events[4].ts === T0 + 5 * 60000, 'events carry real timestamps');
});

check('a partially flushed last line is held out of the page end', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  const aligned = fs.statSync(f).size;
  fs.appendFileSync(f, '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cut mid li'); // no newline
  const p = readTimelinePage(f, { harness: 'claude-code' });
  assert.strictEqual(p!.end, aligned, 'end stops at the last complete line');
  assert.strictEqual(subst(p!.events).length, 2);
});

// ---- backward paging: continuity, no dupes, no gaps ----
check('backward pages tile the file exactly (no dupes, no gaps)', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 40; i++) all += uLine(2 * i, `ask number ${i}`) + aLine(2 * i + 1, `answer number ${i}`);
  fs.writeFileSync(f, all);
  const opts = { harness: 'claude-code' as const, chunkBytes: 2048, maxBytes: 1 << 20, minEvents: 10 };
  const pages: NonNullable<ReturnType<typeof readTimelinePage>>[] = [];
  let before: number | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const p = readTimelinePage(f, Object.assign({}, opts, before != null ? { before } : {}))!;
    pages.unshift(p);
    if (p.atStart) break;
    assert.ok(p.start < p.end, 'page covers a nonempty span');
    before = p.start;
  }
  assert.ok(pages.length > 2, `paged more than twice (got ${pages.length})`);
  assert.strictEqual(pages[0].atStart, true);
  for (let i = 1; i < pages.length; i++) assert.strictEqual(pages[i - 1].end, pages[i].start, 'pages are contiguous');
  const texts: (string | undefined)[] = ([] as (string | undefined)[]).concat(...pages.map((p) => subst(p.events).map((e) => (e as { t?: string }).t)));
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
  const p = readTimelinePage(f, { harness: 'claude-code', chunkBytes: 8 * 1024, maxBytes: 1 << 20, minEvents: 8 })!;
  assert.ok(subst(p.events).length >= 8, `page kept scanning past tool noise (got ${subst(p.events).length} substantive)`);
  assert.ok(p.events.some((e) => e.k === 'tools' && (e as { n: number }).n >= 30), 'tool noise collapsed into a countable run');
});

// ---- multibyte safety ----
check('byte offsets stay aligned through multibyte content', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 20; i++) all += uLine(2 * i, `emoji ask \u{1F9ED}\u{1F52C}\u{2728} nr ${i}`) + aLine(2 * i + 1, `emoji answer \u{1F419}\u{1F433} nr ${i}`);
  fs.writeFileSync(f, all);
  const opts = { harness: 'claude-code' as const, chunkBytes: 1024, maxBytes: 1 << 20, minEvents: 6 };
  let before: number | undefined;
  let total = 0;
  for (let guard = 0; guard < 60; guard++) {
    const p = readTimelinePage(f, Object.assign({}, opts, before != null ? { before } : {}))!;
    total += subst(p.events).length;
    for (const e of subst(p.events)) assert.ok(/^emoji (ask|answer)/.test((e as { t: string }).t), `clean parse, got: ${(e as { t: string }).t.slice(0, 24)}`);
    if (p.atStart) break;
    before = p.start;
  }
  assert.strictEqual(total, 40);
});

// ---- append cursor ----
check('append cursor: only new bytes are parsed, offset math holds', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer \u{1F9ED}'));
  const p = readTimelinePage(f, { harness: 'claude-code' })!;
  primeTailCursor(f, p.end);
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.reset, undefined);
  assert.strictEqual(r.events!.length, 0, 'no appends yet');
  fs.appendFileSync(f, uLine(2, 'follow-up ask') + aLine(3, 'follow-up answer'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.deepStrictEqual(r.events!.map((e) => e.k), ['user', 'assistant']);
  assert.strictEqual((r.events![1] as { t?: string }).t, 'follow-up answer');
  assert.strictEqual(r.end, fs.statSync(f).size, 'cursor advanced to EOF');
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events!.length, 0, 'append consumed exactly once');
});

check('append cursor: a partial line is not consumed until its newline lands', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  primeTailCursor(f);
  const full = aLine(2, 'streamed answer');
  fs.appendFileSync(f, full.slice(0, 40)); // mid-line flush
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events!.length, 0);
  const offBefore = r.end as number;
  fs.appendFileSync(f, full.slice(40)); // completes the line
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events!.length, 1);
  assert.strictEqual((r.events![0] as { t?: string }).t, 'streamed answer');
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
  // rotation: same path, new inode. Modeled as write-new-then-rename (the
  // real rotation shape); creating the replacement while the original still
  // exists guarantees a distinct inode on every filesystem (a bare
  // unlink+recreate can recycle the inode on ext4).
  fs.writeFileSync(f, uLine(0, 'ask'));
  primeTailCursor(f);
  fs.writeFileSync(f + '.new', uLine(0, 'reborn ask') + aLine(1, 'reborn answer'));
  fs.renameSync(f + '.new', f);
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
  assert.deepStrictEqual(r.events!.map((e) => e.k), ['assistant']);
});

check('codex turn markers are picked up from appended bytes', () => {
  const f = tmpFile();
  fs.writeFileSync(f, cxUser(0, 'ask'));
  primeTailCursor(f);
  fs.appendFileSync(f, cxTurnCtx('gpt-5.5', 'xhigh') + cxAgent(1, 'answer') + cxAborted(2));
  const r = readAppended(f, { harness: 'codex' });
  assert.ok(r.meta && r.meta.model === 'gpt-5.5' && r.meta.effort === 'xhigh');
  assert.deepStrictEqual(r.events!.map((e) => e.k), ['assistant', 'interrupt']);
});

// ---- probe filtering across append batches ----
check('ask-the-session probe turns never surface, even split across appends', () => {
  const f = tmpFile();
  fs.writeFileSync(f, uLine(0, 'ask') + aLine(1, 'answer'));
  primeTailCursor(f);
  fs.appendFileSync(f, uLine(2, '[humanctl btw] status?'));
  let r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events!.length, 0, 'probe question dropped');
  fs.appendFileSync(f, aLine(3, 'probe answer, not a real turn'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.strictEqual(r.events!.length, 0, 'probe answer dropped across the batch boundary');
  fs.appendFileSync(f, uLine(4, 'real follow-up'));
  r = readAppended(f, { harness: 'claude-code' });
  assert.deepStrictEqual(r.events!.map((e) => e.k), ['user'], 'a genuine user turn closes the window');
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

// ---- whole-file usage totals via the per-file cursor ----
// A usage-bearing assistant line. Padding lines never contain the '"usage"'
// substring, so they exercise the scanner's pre-filter as well as its byte math.
interface Toks { i: number; o: number; cr?: number; cc?: number }
const usageLine = (n: number, model: string, u: Toks) => JSON.stringify({
  type: 'assistant', timestamp: iso(n),
  message: {
    role: 'assistant', model,
    usage: { input_tokens: u.i, output_tokens: u.o, cache_read_input_tokens: u.cr || 0, cache_creation_input_tokens: u.cc || 0 },
    content: [{ type: 'text', text: `turn ${n}` }],
  },
}) + '\n';
const costOf = (model: string, u: Toks) => {
  const p = priceFor(model);
  return (u.i * p.in + u.o * p.out + (u.cr || 0) * p.cacheRead + (u.cc || 0) * p.cacheWrite) / 1e6;
};
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: got ${a}, want ${b}`);

const MAX_READ = 12 * 1024 * 1024; // mirrors sessions.ts's bounded-read cap

check('usage: a file larger than MAX_READ is counted whole, head included', () => {
  const f = tmpFile();
  const head: Toks = { i: 1000, o: 200, cr: 50, cc: 10 };
  const tail: Toks = { i: 7, o: 3 };
  // The head usage line sits at byte 0, far outside the newest 12MB. The old
  // tail-anchored bounded read could not see it, so it undercounted by 1250
  // tokens and priced only the tail.
  const parts = [usageLine(0, 'claude-opus-4-8', head)];
  let bytes = Buffer.byteLength(parts[0]);
  for (let i = 0; bytes < MAX_READ + (512 * 1024); i++) {
    const pad = toolResult(i, 4000);
    parts.push(pad);
    bytes += Buffer.byteLength(pad);
  }
  parts.push(usageLine(9999, 'claude-opus-4-8', tail));
  fs.writeFileSync(f, parts.join(''));
  assert.ok(fs.statSync(f).size > MAX_READ, `fixture must exceed the old cap (got ${fs.statSync(f).size})`);
  const u = readClaudeUsage(f);
  assert.strictEqual(u.tokens.input, head.i + tail.i, 'every input token counted, not just the newest 12MB');
  assert.strictEqual(u.tokens.output, head.o + tail.o);
  assert.strictEqual(u.tokens.cacheRead, head.cr);
  assert.strictEqual(u.tokens.cacheCreate, head.cc);
  assert.strictEqual(u.tokens.total, 1000 + 200 + 50 + 10 + 7 + 3);
  near(u.costUSD as number, costOf('claude-opus-4-8', head) + costOf('claude-opus-4-8', tail), 'whole-file cost');
  assert.strictEqual(u.contextTokens, tail.i, 'context% still comes from the true last assistant turn');
});

check('usage: totals accumulate across appends, cursor reads only the new bytes', () => {
  const f = tmpFile();
  const a: Toks = { i: 100, o: 10 };
  fs.writeFileSync(f, usageLine(0, 'claude-sonnet-4-8', a));
  let u = readClaudeUsage(f, { chunkBytes: 256 });
  assert.strictEqual(u.tokens.total, 110);

  fs.appendFileSync(f, toolResult(1, 500) + usageLine(2, 'claude-sonnet-4-8', { i: 40, o: 5 }));
  u = readClaudeUsage(f, { chunkBytes: 256 });
  assert.strictEqual(u.tokens.total, 155, 'the append is added to the running sums');

  // A second call with no append must not double-count the bytes already folded in.
  u = readClaudeUsage(f, { chunkBytes: 256 });
  assert.strictEqual(u.tokens.total, 155, 'an unchanged file re-adds nothing');
  near(u.costUSD as number, costOf('claude-sonnet-4-8', { i: 140, o: 15 }), 'accumulated cost');
});

check('usage: a partial trailing line is held back until its newline lands', () => {
  const f = tmpFile();
  fs.writeFileSync(f, usageLine(0, 'claude-sonnet-4-8', { i: 100, o: 10 }));
  assert.strictEqual(readClaudeUsage(f, { chunkBytes: 128 }).tokens.total, 110);
  const next = usageLine(1, 'claude-sonnet-4-8', { i: 50, o: 5 });
  fs.appendFileSync(f, next.slice(0, 60)); // mid-line flush
  assert.strictEqual(readClaudeUsage(f, { chunkBytes: 128 }).tokens.total, 110, 'a half-written line contributes nothing');
  fs.appendFileSync(f, next.slice(60)); // completes the line
  assert.strictEqual(readClaudeUsage(f, { chunkBytes: 128 }).tokens.total, 165, 'the completed line is counted exactly once');
});

check('usage: truncation and rotation reset the cursor and re-scan from zero', () => {
  const f = tmpFile();
  fs.writeFileSync(f, usageLine(0, 'claude-sonnet-4-8', { i: 100, o: 10 }) + usageLine(1, 'claude-sonnet-4-8', { i: 100, o: 10 }));
  assert.strictEqual(readClaudeUsage(f, { chunkBytes: 128 }).tokens.total, 220);

  // truncation: size shrinks below the cursor offset
  fs.writeFileSync(f, usageLine(0, 'claude-sonnet-4-8', { i: 7, o: 3 }));
  assert.strictEqual(readClaudeUsage(f, { chunkBytes: 128 }).tokens.total, 10, 'totals re-scanned, not carried over the truncation');

  // rotation: same path, new inode, and a LARGER file (so a size check alone
  // would miss it). Write-new-then-rename is the real rotation shape and
  // guarantees a distinct inode on every filesystem.
  fs.writeFileSync(f + '.new', usageLine(0, 'claude-sonnet-4-8', { i: 1, o: 1 }) + usageLine(1, 'claude-sonnet-4-8', { i: 1, o: 1 }) + usageLine(2, 'claude-sonnet-4-8', { i: 1, o: 1 }));
  fs.renameSync(f + '.new', f);
  assert.strictEqual(readClaudeUsage(f, { chunkBytes: 128 }).tokens.total, 6, 'a new inode discards the old sums');
});

check('usage: a mid-file model switch prices each model at its own rate', () => {
  const f = tmpFile();
  const opus: Toks = { i: 10000, o: 2000, cr: 500, cc: 100 };
  const haiku: Toks = { i: 3000, o: 400 };
  // A line with no `model` inherits the model in effect, which is the shape
  // Claude writes for continuation turns.
  fs.writeFileSync(f,
    usageLine(0, 'claude-opus-4-8', opus)
    + toolResult(1, 300)
    + usageLine(2, 'claude-haiku-4-5', haiku));
  const u = readClaudeUsage(f, { chunkBytes: 512 });

  const correct = costOf('claude-opus-4-8', opus) + costOf('claude-haiku-4-5', haiku);
  const allHaiku = costOf('claude-haiku-4-5', { i: opus.i + haiku.i, o: opus.o + haiku.o, cr: opus.cr, cc: opus.cc });
  const allOpus = costOf('claude-opus-4-8', { i: opus.i + haiku.i, o: opus.o + haiku.o, cr: opus.cr, cc: opus.cc });
  near(u.costUSD as number, correct, 'per-model pricing');
  assert.ok(Math.abs(correct - allHaiku) > 1e-6, 'the fixture must actually distinguish the two rates');
  assert.ok(Math.abs((u.costUSD as number) - allHaiku) > 1e-6, 'the session is not priced entirely at the LAST model (the old bug)');
  assert.ok(Math.abs((u.costUSD as number) - allOpus) > 1e-6, 'nor entirely at the first');
  assert.strictEqual(u.tokens.total, 10000 + 2000 + 500 + 100 + 3000 + 400, 'tokens still sum across models');
  assert.strictEqual(u.model, 'claude-haiku-4-5', 'the displayed model is the one in effect at the tail');
});

check('usage: totals are chunk-size invariant (lines split across read boundaries)', () => {
  const f = tmpFile();
  let all = '';
  for (let i = 0; i < 25; i++) all += usageLine(i, 'claude-sonnet-4-8', { i: 100, o: 10, cr: 5, cc: 1 }) + toolResult(i, 700);
  fs.writeFileSync(f, all);
  const want = 25 * (100 + 10 + 5 + 1);
  for (const chunkBytes of [64, 137, 1024, 1 << 20]) {
    const g = tmpFile();
    fs.copyFileSync(f, g); // a fresh path means a fresh cursor
    assert.strictEqual(readClaudeUsage(g, { chunkBytes }).tokens.total, want, `chunkBytes=${chunkBytes}`);
  }
});

// ---- HOME is re-resolved per call, never frozen at import time ----
check('readNotes and listRecent follow a HOME swap made after import', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    fs.mkdirSync(path.join(home, '.humanctl'), { recursive: true });
    fs.writeFileSync(path.join(home, '.humanctl', 'notes.jsonl'),
      JSON.stringify({ id: 'n1', ts: iso(0), level: 'review', message: 'isolated note' }) + '\n');
    const notes = readNotes();
    assert.strictEqual(notes.length, 1, 'readNotes reads the swapped home, not the real one');
    assert.strictEqual(notes[0].message, 'isolated note');
    const proj = path.join(home, '.claude', 'projects', 'fixture-proj');
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, 'sess-1.jsonl'), uLine(0, 'fixture ask') + aLine(1, 'fixture answer'));
    const rows = listRecent({ maxAgeH: 72, limit: 10, includeAutomation: true });
    assert.ok(rows.length >= 1, 'the scan sees the fixture session under the swapped home');
    assert.ok(rows.every((r) => r.path.startsWith(home)), 'the scan never leaks sessions from the real home');
  } finally {
    process.env.HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
if (process.exitCode) {
  console.error(`reader selftest: FAILURES (passed ${passed})`);
} else {
  console.log(`reader selftest: ${passed} checks passed`);
}
