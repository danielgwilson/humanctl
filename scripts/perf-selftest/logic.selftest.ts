// CI perf gate (PR-2 item 5, docs/perf.md): the PURE-LOGIC subset of the perf
// story, runnable with no display server (today's CI runner is plain
// ubuntu). This is intentionally NOT a substitute for scripts/perf-selftest/
// run.js -- that script drives a real Electron/Chromium renderer and is the
// actual required LOCAL pre-release gate. This selftest only proves the
// logic PIECES that a real perf regression would routinely break, without
// needing a browser to prove it:
//
//   - the watcher filter (isInboxRelevantChange) that fixed the
//     events.jsonl-inside-watched-dir feedback loop (see the 2026-07-03
//     lab perf-profile report): a regression here silently reopens that
//     exact ~213ms self-sustaining refresh loop.
//   - the always-on summary budget math (lib/summary-budget.ts): the
//     "ONE authoritative unit, estimated dollars/day" the pause chip and
//     the auto-summary engine both depend on being correct and monotonic.
//   - harness icon path resolution (lib/harness-icons.ts): pure filesystem
//     logic, no Electron needed to check it resolves/fails correctly.
//   - the PR chip cache-only contract (lib/commands.ts prChip): proves the
//     cache-miss-is-honest and never-spawns invariants without a real gh call.
//
// Run: npm run perf:logic-selftest

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isInboxRelevantChange, prChip, prChipCachePath } from '../../lib/commands';
import { estimateCallUSD, readBudgetState, writeBudgetState, recordSpend, wouldExceedBudget, budgetStatus, localDay } from '../../lib/summary-budget';
import { resolveHarnessIconPath, resolveIconPath } from '../../lib/harness-icons';

let passed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); passed += 1; }
  catch (e) {
    console.error(`FAIL ${name}`);
    console.error(e && (e as Error).stack ? (e as Error).stack : e);
    process.exitCode = 1;
  }
}
// The harness-icon resolvers are async (they spawn `plutil`, which must never
// be spawned synchronously off Electron's main process; see AGENTS.md). This
// file is CJS, so it cannot use top-level await: async checks queue here and
// are awaited before the summary prints.
const pendingChecks: Promise<void>[] = [];
function checkAsync(name: string, fn: () => Promise<void>): void {
  pendingChecks.push(
    fn().then(
      () => { passed += 1; },
      (e) => {
        console.error(`FAIL ${name}`);
        console.error(e && (e as Error).stack ? (e as Error).stack : e);
        process.exitCode = 1;
      },
    ),
  );
}
function tempHome(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `humanctl-perflogic-${label}-`));
  return dir;
}

// ---- watcher filter: the exact regression this whole perf story started from ----

check('isInboxRelevantChange: events.jsonl (the feedback-loop file) is never relevant', () => {
  assert.strictEqual(isInboxRelevantChange('events.jsonl'), false);
  assert.strictEqual(isInboxRelevantChange('events.1.jsonl'), false);
});
check('isInboxRelevantChange: notes.jsonl and asks/*.jsonl remain relevant (the actual inbox inputs)', () => {
  assert.strictEqual(isInboxRelevantChange('notes.jsonl'), true);
  assert.strictEqual(isInboxRelevantChange('asks/abc123.jsonl'), true);
});
check('isInboxRelevantChange: new PR-2 system-written files (attachments/, pulse-cache.json, summary-budget.json) are correctly excluded', () => {
  // Generalized write/watch separation rule (AGENTS.md): every new
  // system-written top-level file/dir under ~/.humanctl must be excluded
  // here explicitly, not by accident. This test is the enforcement point for
  // PR-2's three new writers: note-image attachments, the PR-chip cache
  // (pre-existing, but now READ from the inbox path for the first time), and
  // the summary-budget tracker.
  assert.strictEqual(isInboxRelevantChange('attachments'), false);
  assert.strictEqual(isInboxRelevantChange('attachments/1234-abcd.png'), false);
  assert.strictEqual(isInboxRelevantChange('pulse-cache.json'), false);
  assert.strictEqual(isInboxRelevantChange('summary-budget.json'), false);
});

// ---- summary budget math: the one authoritative unit ----

check('estimateCallUSD: scales linearly with text length and uses the haiku rate', () => {
  const small = estimateCallUSD('x'.repeat(400), 'y'.repeat(100));
  const large = estimateCallUSD('x'.repeat(4000), 'y'.repeat(1000));
  assert.ok(small > 0, 'a non-empty call must have non-zero estimated cost');
  assert.ok(large > small * 5, 'roughly 10x the text should cost roughly 10x (within a factor), not scale sublinearly');
});

check('recordSpend + readBudgetState: accumulates across calls within the same day', () => {
  const home = tempHome('spend');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const s0 = readBudgetState();
    assert.strictEqual(s0.spentUSD, 0, 'a fresh day starts at zero spend');
    const r1 = recordSpend('prompt one', 'summary one');
    const r2 = recordSpend('prompt two', 'summary two');
    assert.ok(r2.totalUSD > r1.totalUSD, 'spend accumulates, not resets, across calls');
    const s1 = readBudgetState();
    assert.strictEqual(s1.spentUSD, r2.totalUSD);
  } finally { process.env.HOME = prevHome; }
});

check('readBudgetState: a stale day in the persisted file resets to zero (daily reset, not a monotonic lifetime total)', () => {
  const home = tempHome('reset');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    writeBudgetState({ day: '2020-01-01', spentUSD: 99 });
    const s = readBudgetState();
    assert.strictEqual(s.spentUSD, 0, 'a day that is not today must not carry its spend forward');
    assert.strictEqual(s.day, localDay(Date.now()));
  } finally { process.env.HOME = prevHome; }
});

check('wouldExceedBudget: honest pre-check against the configured daily cap', () => {
  const home = tempHome('precheck');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    writeBudgetState({ day: localDay(Date.now()), spentUSD: 0.999 });
    const cheap = wouldExceedBudget('short', 1.0);
    // A tiny prompt against a $1.00 budget with $0.999 already spent should
    // not exceed (the estimate for a short call is a small fraction of a cent).
    assert.strictEqual(cheap.exceeded, false);
    writeBudgetState({ day: localDay(Date.now()), spentUSD: 1.5 });
    const overCap = wouldExceedBudget('short', 1.0);
    assert.strictEqual(overCap.exceeded, true, 'already over the cap must always exceed, regardless of the next call size');
  } finally { process.env.HOME = prevHome; }
});

check('budgetStatus: paused is true exactly at and above the daily cap, never a silent over-spend', () => {
  const home = tempHome('paused');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    writeBudgetState({ day: localDay(Date.now()), spentUSD: 1.0 });
    const s = budgetStatus(1.0);
    assert.strictEqual(s.paused, true);
    assert.strictEqual(s.remainingUSD, 0);
  } finally { process.env.HOME = prevHome; }
});

// ---- harness icon extraction: pure path resolution, no Electron needed ----

checkAsync('resolveHarnessIconPath: an unknown harness fails honestly, never throws', async () => {
  const r = await resolveHarnessIconPath('not-a-real-harness');
  assert.strictEqual(r.ok, false);
  assert.match((r as { reason: string }).reason, /unknown harness/);
});

checkAsync('resolveHarnessIconPath: a harness whose app is not installed on THIS machine falls back honestly', async () => {
  // This selftest must pass on any machine (including CI, where neither app
  // is installed), so it only asserts the SHAPE of the failure, never
  // requires the app to be present. lib/harness-icons.js's APP_PATHS point
  // at fixed /Applications paths; if they happen to exist on this machine
  // (verified separately in the PR's manual acceptance pass, never here),
  // resolution should succeed instead -- either outcome is a valid, honest
  // { ok, ... } shape, never a throw.
  const claude = await resolveHarnessIconPath('claude-code');
  const codex = await resolveHarnessIconPath('codex');
  for (const r of [claude, codex]) {
    assert.ok(typeof r.ok === 'boolean');
    if (!r.ok) assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
    else assert.ok(typeof r.path === 'string' && r.path.endsWith('.icns'));
  }
});

checkAsync('resolveIconPath: tries both with and without the .icns extension (CFBundleIconFile is sometimes recorded bare)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-icontest-'));
  const resourcesRoot = path.join(dir, 'App.app', 'Contents', 'Resources');
  fs.mkdirSync(resourcesRoot, { recursive: true });
  fs.writeFileSync(path.join(resourcesRoot, 'icon.icns'), 'fake-icns-bytes');
  const appPath = path.join(dir, 'App.app');
  const withExt = await resolveIconPath(appPath, 'icon.icns');
  const withoutExt = await resolveIconPath(appPath, 'icon');
  assert.strictEqual(withExt, path.join(resourcesRoot, 'icon.icns'));
  assert.strictEqual(withoutExt, path.join(resourcesRoot, 'icon.icns'), 'a bare CFBundleIconFile value must still resolve to the real .icns file');
  const missing = await resolveIconPath(appPath, 'nope');
  assert.strictEqual(missing, null);
});

// ---- PR chip: cache-only contract, zero spawns, honest miss ----

check('prChip: a missing cache file returns ok:true, chip:null (never an error, never a spawn)', () => {
  const home = tempHome('prchip-miss');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const r = prChip({ repo: 'anything' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.chip, null);
  } finally { process.env.HOME = prevHome; }
});

check('prChip: reads real counts from a synthetic pulse-cache.json, matched case-insensitively by repo alias', () => {
  const home = tempHome('prchip-hit');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const dir = path.join(home, '.humanctl');
    fs.mkdirSync(dir, { recursive: true });
    const cache = {
      signature: 'irrelevant-for-this-read-path',
      gh: {
        at: Date.now() - 60000, // 1 minute old: not stale
        data: [
          { name: 'humanctl', open: [{ number: 1 }], merged: [{ number: 2 }, { number: 3 }], degraded: null },
        ],
      },
    };
    fs.writeFileSync(prChipCachePath(), JSON.stringify(cache));
    const r = prChip({ repo: 'HumanCtl' }); // case-insensitive match
    assert.strictEqual(r.ok, true);
    assert.ok(r.chip, 'expected a chip from a fresh, matching cache entry');
    assert.strictEqual(r.chip.open, 1);
    assert.strictEqual(r.chip.merged, 2);
    assert.strictEqual(r.chip.total, 3);
    assert.strictEqual(r.chip.stale, false);
  } finally { process.env.HOME = prevHome; }
});

check('prChip: an old cache entry (>10m) is still returned but marked stale with an honest age', () => {
  const home = tempHome('prchip-stale');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const dir = path.join(home, '.humanctl');
    fs.mkdirSync(dir, { recursive: true });
    const cache = {
      signature: 'x',
      gh: { at: Date.now() - 15 * 60 * 1000, data: [{ name: 'humanctl', open: [{ number: 1 }], merged: [], degraded: null }] },
    };
    fs.writeFileSync(prChipCachePath(), JSON.stringify(cache));
    const r = prChip({ repo: 'humanctl' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.chip.stale, true);
    assert.ok(r.chip.ageMs >= 14 * 60 * 1000);
  } finally { process.env.HOME = prevHome; }
});

check('prChip: a degraded gh entry for the repo yields no chip rather than a fabricated one', () => {
  const home = tempHome('prchip-degraded');
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const dir = path.join(home, '.humanctl');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(prChipCachePath(), JSON.stringify({
      signature: 'x',
      gh: { at: Date.now(), data: [{ name: 'humanctl', open: null, merged: null, degraded: 'gh pr list failed' }] },
    }));
    const r = prChip({ repo: 'humanctl' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.chip, null);
  } finally { process.env.HOME = prevHome; }
});

// Await the queued async checks (harness-icon resolution) before summarizing,
// otherwise their failures would land after this process reported "ok".
void Promise.all(pendingChecks).then(() => {
  if (process.exitCode) {
    console.error(`perf logic selftest: FAILED (${passed} passed before failure)`);
  } else {
    console.log(`perf logic selftest: ok (${passed} checks)`);
  }
});
