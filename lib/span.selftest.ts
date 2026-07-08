// Selftest for lib/span.ts: computeSpanRecord (the daily span-of-control
// counter) and upsertSpanRecord (its ~/.humanctl/span.jsonl writer). Plain
// node, zero deps, no network: every fixture is a synthetic Codex rollout,
// Claude Code session, or notes.jsonl entry written to a throwaway temp dir
// pointed at by process.env.HOME (globalDir() in span.ts resolves HOME via
// os.homedir() per call, same pattern as lib/sessions.ts's home() and
// lib/commands.ts's controlDir(); see lib/reader.selftest.ts's HOME-swap
// check for the underlying contract).
//
// countPrsMergedByMe (lib/span.ts) shells out to `gh` unconditionally, on
// every single computeSpanRecord call, with no injection seam. Left alone,
// every call in this file would run a REAL `gh search prs --merged-at=...`
// against whatever GitHub account is signed in on the machine running this
// selftest: slow, network-dependent, and exactly the kind of real-account
// traffic a public-repo selftest must never trigger. This file empties PATH
// for its own process before any fixture is built, so `gh` can never be
// found by execFileSync's PATH lookup; that also happens to be the cleanest
// possible test of span.ts's own contract here (a missing source reports
// null, never a fabricated zero), which is asserted directly below.
// Run: npm run span:selftest

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  localDateString,
  parseLocalDate,
  computeSpanRecord,
  upsertSpanRecord,
  type SpanRecord,
} from './span';

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

const REAL_PATH = process.env.PATH;
process.env.PATH = '';

// ---- fixture helpers ----

function tempHome(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `humanctl-span-${label}-`));
}
function inHome<T>(home: string, fn: () => T): T {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try { return fn(); } finally { process.env.HOME = prev; }
}
function setMtime(file: string, ms: number): void {
  const d = new Date(ms);
  fs.utimesSync(file, d, d);
}
function writeCodexRollout(home: string, dateDir: string, name: string, meta: Record<string, unknown>, mtimeMs: number): void {
  const dir = path.join(home, '.codex', 'sessions', dateDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: meta }) + '\n');
  setMtime(file, mtimeMs);
}
function writeClaudeSession(home: string, project: string, name: string, content: string, mtimeMs: number): void {
  const dir = path.join(home, '.claude', 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  setMtime(file, mtimeMs);
}
function writeNotes(home: string, lines: Array<Record<string, unknown>>): void {
  const dir = path.join(home, '.humanctl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
function spanJsonlLines(home: string): string[] {
  return fs.readFileSync(path.join(home, '.humanctl', 'span.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
}

const uLine = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';
const aLine = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n';
// The exact marker lib/span.ts's isHumanctlSummaryOneShot filters out of the
// interactive count (HUMANCTL_SUMMARY_PROMPT_RE).
const ONE_SHOT_LINE = uLine('Summarize the recent tail of an autonomous coding-agent session for a busy human, in two sentences.');

const DAY = parseLocalDate('2026-06-01') as Date;
const DATE_DIR = path.join('2026', '06', '01');
const dayStartMs = DAY.getTime();
const dayEndMs = new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + 1).getTime();
const MID_DAY_MS = dayStartMs + 10 * 3600 * 1000; // 10am local, safely inside the window
const PREV_DAY_MS = dayStartMs - 3600 * 1000; // 11pm the day before, outside the window

// ---- Home A: one mixed day, every source populated ----

const homeA = tempHome('mixed');
writeCodexRollout(homeA, DATE_DIR, 'rollout-interactive.jsonl', { cli_version: '0.140.0', originator: 'cli' }, MID_DAY_MS);
writeCodexRollout(homeA, DATE_DIR, 'rollout-automation-subagent.jsonl', { cli_version: '0.140.0', parent_thread_id: 'parent-abc' }, MID_DAY_MS);
writeCodexRollout(homeA, DATE_DIR, 'rollout-automation-scheduled.jsonl', { cli_version: '0.140.0', thread_source: 'automation' }, MID_DAY_MS);
writeCodexRollout(homeA, DATE_DIR, 'rollout-unknown.jsonl', {}, MID_DAY_MS);
writeCodexRollout(homeA, DATE_DIR, 'rollout-yesterday.jsonl', { cli_version: '0.140.0', originator: 'cli' }, PREV_DAY_MS);

writeClaudeSession(homeA, 'proj1', 'sess-real.jsonl', uLine('what should I work on next') + aLine('start with the flaky test'), MID_DAY_MS);
writeClaudeSession(homeA, 'proj1', 'sess-oneshot.jsonl', ONE_SHOT_LINE, MID_DAY_MS);
writeClaudeSession(homeA, 'proj1', 'sess-yesterday.jsonl', uLine('old ask') + aLine('old answer'), PREV_DAY_MS);

writeNotes(homeA, [
  { id: 'n1', ts: new Date(MID_DAY_MS).toISOString(), level: 'fyi', message: 'a' },
  { id: 'n2', ts: new Date(MID_DAY_MS + 1000).toISOString(), level: 'fyi', message: 'b' },
  { id: 'n3', ts: new Date(MID_DAY_MS + 2000).toISOString(), level: 'review', message: 'c' },
  { id: 'n4', ts: new Date(MID_DAY_MS + 3000).toISOString(), level: 'blocked', message: 'd' },
  { id: 'n5', ts: new Date(MID_DAY_MS + 4000).toISOString(), level: 'done', message: 'e' },
  { id: 'n6', ts: new Date(MID_DAY_MS + 5000).toISOString(), level: 'urgent', message: 'unrecognized level, must be skipped entirely' },
  { id: 'n7', ts: new Date(PREV_DAY_MS).toISOString(), level: 'fyi', message: 'yesterday, out of window' },
]);

const recordA: SpanRecord = inHome(homeA, () => computeSpanRecord(DAY));

check('codex: interactive/automation/unknown are classified and sum to the total (the day-old file is excluded)', () => {
  assert.strictEqual(recordA.codexSessionsTouched, 4, 'only the 4 files touched on the target day count; rollout-yesterday.jsonl must not');
  assert.strictEqual(recordA.codexInteractiveTouched, 1);
  assert.strictEqual(recordA.codexAutomationTouched, 2, 'parent_thread_id and thread_source:"automation" both classify as automation');
  assert.strictEqual(recordA.codexUnknown, 1, 'a session_meta with no recognizable marker field lands in unknown, never guessed');
  assert.strictEqual(
    (recordA.codexInteractiveTouched || 0) + (recordA.codexAutomationTouched || 0) + (recordA.codexUnknown || 0),
    recordA.codexSessionsTouched,
    'the three buckets always sum to the total'
  );
});

check('codex: an unparseable session_meta first line also lands in unknown, never guessed', () => {
  const home = tempHome('codex-garbage');
  const dir = path.join(home, '.codex', 'sessions', DATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rollout-garbage.jsonl');
  fs.writeFileSync(file, 'not json at all\n{"more": "garbage"}\n');
  setMtime(file, MID_DAY_MS);
  const record = inHome(home, () => computeSpanRecord(DAY));
  assert.strictEqual(record.codexSessionsTouched, 1);
  assert.strictEqual(record.codexUnknown, 1);
});

check('codex day window: dayStart is inclusive, dayEnd is exclusive', () => {
  const home = tempHome('boundary');
  writeCodexRollout(home, DATE_DIR, 'rollout-at-start.jsonl', { cli_version: '1', originator: 'cli' }, dayStartMs);
  writeCodexRollout(home, DATE_DIR, 'rollout-at-end.jsonl', { cli_version: '1', originator: 'cli' }, dayEndMs);
  const record = inHome(home, () => computeSpanRecord(DAY));
  assert.strictEqual(record.codexSessionsTouched, 1, 'only the file exactly at dayStart is in [dayStart, dayEnd)');
  assert.strictEqual(record.codexInteractiveTouched, 1);
});

check('claude: the interactive count excludes humanctl\'s own summarize one-shot, but the total still counts it', () => {
  assert.strictEqual(recordA.claudeSessionsTouched, 2, 'sess-real + sess-oneshot; sess-yesterday is outside the day window');
  assert.strictEqual(recordA.claudeInteractiveTouched, 1, 'only sess-real is a human-driven session');
});

check('claude: a session touched on a different day is not counted at all', () => {
  const home = tempHome('claude-window');
  writeClaudeSession(home, 'proj1', 'sess-today.jsonl', uLine('ask') + aLine('answer'), MID_DAY_MS);
  writeClaudeSession(home, 'proj1', 'sess-tomorrow.jsonl', uLine('ask') + aLine('answer'), dayEndMs + 3600 * 1000);
  const record = inHome(home, () => computeSpanRecord(DAY));
  assert.strictEqual(record.claudeSessionsTouched, 1);
});

check('notes: counted by level, an out-of-window note and an unrecognized level are both skipped', () => {
  assert.deepStrictEqual(recordA.notes, { fyi: 2, review: 1, blocked: 1, done: 1 });
});

check('computeSpanRecord: date matches the requested day and generatedAt is a fresh ISO timestamp', () => {
  assert.strictEqual(recordA.date, '2026-06-01');
  const genMs = Date.parse(recordA.generatedAt);
  assert.ok(Number.isFinite(genMs), 'generatedAt must parse as a real timestamp');
  assert.ok(Date.now() - genMs < 60000, 'generatedAt must be close to when the record was computed');
});

check('prsMergedByMe is null when gh cannot be found on PATH, never a fabricated zero', () => {
  assert.strictEqual(recordA.prsMergedByMe, null);
});

check('missing ~/.codex/sessions, ~/.claude/projects, and notes.jsonl all report null, never a fabricated zero', () => {
  const home = tempHome('empty');
  const record = inHome(home, () => computeSpanRecord(DAY));
  assert.strictEqual(record.codexSessionsTouched, null);
  assert.strictEqual(record.codexInteractiveTouched, null);
  assert.strictEqual(record.codexAutomationTouched, null);
  assert.strictEqual(record.codexUnknown, null);
  assert.strictEqual(record.claudeSessionsTouched, null);
  assert.strictEqual(record.claudeInteractiveTouched, null);
  assert.strictEqual(record.notes, null);
});

check('localDateString/parseLocalDate: a valid date round-trips', () => {
  const d = parseLocalDate('2026-03-07');
  assert.ok(d);
  assert.strictEqual(localDateString(d as Date), '2026-03-07');
});

check('parseLocalDate: rejects a calendar date that does not exist', () => {
  assert.strictEqual(parseLocalDate('2026-02-30'), null, 'February never has a 30th; Date rolls it into March, which parseLocalDate must catch and reject');
});

check('parseLocalDate: rejects non-date input', () => {
  assert.strictEqual(parseLocalDate('not-a-date'), null);
  assert.strictEqual(parseLocalDate(''), null);
});

// ---- upsertSpanRecord ----

const homeUpsert = tempHome('upsert');

check('upsertSpanRecord: writes one line for a new date', () => {
  const rec = Object.assign({}, recordA, { date: '2026-06-01' });
  const written = inHome(homeUpsert, () => upsertSpanRecord(rec));
  assert.strictEqual(written, path.join(homeUpsert, '.humanctl', 'span.jsonl'));
  const lines = spanJsonlLines(homeUpsert);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).date, '2026-06-01');
});

check('upsertSpanRecord: a second upsert for the same date replaces, does not append', () => {
  const rec2 = Object.assign({}, recordA, { date: '2026-06-01', notes: { fyi: 99, review: 0, blocked: 0, done: 0 } });
  inHome(homeUpsert, () => upsertSpanRecord(rec2));
  const lines = spanJsonlLines(homeUpsert);
  assert.strictEqual(lines.length, 1, 'still exactly one line for 2026-06-01');
  assert.strictEqual(JSON.parse(lines[0]).notes.fyi, 99, 'the replacement record\'s data won, not the original');
});

check('upsertSpanRecord: a different date appends as a second line', () => {
  const rec3 = Object.assign({}, recordA, { date: '2026-06-02' });
  inHome(homeUpsert, () => upsertSpanRecord(rec3));
  const lines = spanJsonlLines(homeUpsert);
  assert.strictEqual(lines.length, 2);
  const dates = lines.map((l) => JSON.parse(l).date).sort();
  assert.deepStrictEqual(dates, ['2026-06-01', '2026-06-02']);
});

check('upsertSpanRecord: a malformed pre-existing line is preserved verbatim, not dropped or crashed on', () => {
  const p = path.join(homeUpsert, '.humanctl', 'span.jsonl');
  fs.appendFileSync(p, 'not valid json at all\n');
  const rec4 = Object.assign({}, recordA, { date: '2026-06-03' });
  inHome(homeUpsert, () => upsertSpanRecord(rec4));
  const raw = fs.readFileSync(p, 'utf8');
  assert.ok(raw.includes('not valid json at all'), 'the unparseable line must survive the rewrite');
  const lines = spanJsonlLines(homeUpsert);
  assert.strictEqual(lines.length, 4, '2026-06-01, 2026-06-02, the malformed line, and the new 2026-06-03');
});

process.env.PATH = REAL_PATH;
if (process.exitCode) {
  console.error(`span selftest: FAILURES (passed ${passed})`);
} else {
  console.log(`span selftest: ${passed} checks passed`);
}
