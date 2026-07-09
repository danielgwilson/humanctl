// Synthetic fixture data. Used ONLY when window.humanctl is absent (plain
// browser / vite dev with no Electron preload attached). OSS-safe: no real
// ids, generic demo repo names, matches AGENTS.md's born-clean rule.
import type { BudgetStatus, ClaudeQuota, InboxThread, NoteItem, SessionRow, SkillAggregate, Status, TimelineEvent, TimelinePage } from './types';

// FNV-1a, deterministic per-id seed so a given fixture session always shows
// the same synthetic timeline across renders (no real randomness, so
// screenshots are reproducible).
function hashU(str: string): number {
  let h = 2166136261 >>> 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

export const FIXTURE_ROWS: SessionRow[] = [
  { harness: 'claude-code', id: 'fixture-a1a1a1a1', repo: '~/demo/renderer', cwd: '~/demo/renderer', path: '~/demo/renderer/fixture-a1a1a1a1.jsonl', title: 'Wire the multi-source update spine', customTitle: 'Multi-source spine, renderer wiring pass', lastRole: 'assistant', state: 'need', stateReason: 'asks you a question', tier: 'hot', age: '2m', ageMs: Date.now() - 2 * 6e4, createdMs: Date.now() - 90 * 6e4, contextPct: 63, costUSD: 2.14, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: true, lastUser: 'wire the update spine into the renderer', prevAgent: 'Spine is wired. Should the watcher debounce at 2s or 5s?', summary: { text: 'The renderer now consumes the shared update spine end to end. One open question remains on the watcher debounce window.', engine: 'claude', at: Date.now() - 3 * 6e4 } },
  { harness: 'codex', id: 'rollout-fixture-b2b2', repo: '~/demo/core', cwd: '~/demo/core', path: '~/demo/core/rollout-fixture-b2b2.jsonl', title: 'Choose the rename-persistence path', lastRole: 'assistant', state: 'need', stateReason: 'awaiting your go-ahead', tier: 'hot', age: '6m', ageMs: Date.now() - 6 * 6e4, createdMs: Date.now() - 120 * 6e4, contextPct: 22, apiEquivUSD: 0.88, model: 'gpt-5.5', reasoningEffort: 'xhigh', ultracode: false, lastUser: 'which rename-persistence path should we trust?', prevAgent: 'Both paths verified; say the word and I take path B.' },
  { harness: 'claude-code', id: 'fixture-h8h8h8h8', repo: '~/demo/exports', cwd: '~/demo/exports', path: '~/demo/exports/fixture-h8h8h8h8.jsonl', title: 'Backfill the export manifest', lastRole: 'user', state: 'need', stateReason: 'you interrupted; only you can resume', tier: 'hot', age: '18m', ageMs: Date.now() - 18 * 6e4, createdMs: Date.now() - 60 * 6e4, contextPct: 31, costUSD: 0.66, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'wait, hold off on the manifest rewrite', prevAgent: 'Starting the manifest rewrite now.' },
  { harness: 'codex', id: 'rollout-fixture-c9c9', repo: '~/demo/ledger', cwd: '~/demo/ledger', path: '~/demo/ledger/rollout-fixture-c9c9.jsonl', title: 'Reconcile the ledger deltas', lastRole: 'user', state: 'need', stateReason: 'your reply was never picked up', tier: 'hot', age: '3h', ageMs: Date.now() - 3 * 3.6e6, createdMs: Date.now() - 5 * 3.6e6, contextPct: 44, apiEquivUSD: 1.12, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'yes please, run the reconcile pass', prevAgent: 'Deltas mapped; ready to reconcile on your word.' },
  { harness: 'claude-code', id: 'fixture-c3c3c3c3', repo: '~/demo/renderer', cwd: '~/demo/renderer', path: '~/demo/renderer/fixture-c3c3c3c3.jsonl', title: 'Pull the activity feed', customTitle: 'Activity feed adapter', lastRole: 'assistant', state: 'work', stateReason: 'progress report, still fresh', tier: 'hot', age: '11m', ageMs: Date.now() - 11 * 6e4, createdMs: Date.now() - 40 * 6e4, contextPct: 38, costUSD: 1.02, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: 'retry the activity pull', prevAgent: 'The activity adapter is built; PR is up.' },
  { harness: 'codex', id: 'rollout-fixture-d4d4', repo: '~/demo/tokens', cwd: '~/demo/tokens', path: '~/demo/tokens/rollout-fixture-d4d4.jsonl', title: 'Rotate the activity token', lastRole: 'user', state: 'work', stateReason: 'your turn was picked up', tier: 'hot', age: '9m', ageMs: Date.now() - 9 * 6e4, createdMs: Date.now() - 30 * 6e4, contextPct: 55, apiEquivUSD: 0.63, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'rotate it and rerun the smoke test', prevAgent: 'Token rotation staged.' },
  { harness: 'claude-code', id: 'fixture-f6f6f6f6', repo: '~/demo/hygiene', cwd: '~/demo/hygiene', path: '~/demo/hygiene/fixture-f6f6f6f6.jsonl', title: 'OSS hygiene sweep', lastRole: 'assistant', state: 'done', stateReason: 'reports completion, no ask', tier: 'hot', age: '24m', ageMs: Date.now() - 24 * 6e4, createdMs: Date.now() - 80 * 6e4, contextPct: 12, costUSD: 3.40, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: '', prevAgent: 'Swept history; merged and shipped, checks are green.' },
  { harness: 'codex', id: 'rollout-fixture-g7g7', repo: '~/demo/icons', cwd: '~/demo/icons', path: '~/demo/icons/rollout-fixture-g7g7.jsonl', title: 'Draft the squircle icons', lastRole: 'assistant', state: 'idle', stateReason: 'ended without an ask', tier: 'hot', age: '5h', ageMs: Date.now() - 5 * 3.6e6, createdMs: Date.now() - 8 * 3.6e6, contextPct: 8, apiEquivUSD: 0.20, model: 'gpt-5.5', reasoningEffort: 'low', ultracode: false, lastUser: '', prevAgent: 'Drafted the squircle variants.' },
];

export const FIXTURE_NOTES: NoteItem[] = [
  { id: 'fn1', ts: new Date(Date.now() - 4 * 6e4).toISOString(), level: 'review', message: 'PR is up for the activity feed; needs a review + merge.', repo: 'renderer', session: 'fixture-c3c3c3c3' },
  { id: 'fn2', ts: new Date(Date.now() - 7 * 6e4).toISOString(), level: 'blocked', message: 'Blocked: the activity token is missing from the environment.', repo: 'tokens', session: 'rollout-fixture-d4d4' },
  { id: 'fn3', ts: new Date(Date.now() - 22 * 6e4).toISOString(), level: 'fyi', message: 'Ledger backfill is on track; no action needed.', repo: 'ledger', session: 'rollout-fixture-e5e5' },
  { id: 'fn4', ts: new Date(Date.now() - 26 * 6e4).toISOString(), level: 'done', message: 'Hygiene sweep landed; checks are green.', repo: 'hygiene', session: 'fixture-f6f6f6f6' },
];

export function fixtureThreads(): InboxThread[] {
  const now = Date.now();
  return [
    { sessionId: 'fixture-c3c3c3c3', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Activity feed adapter',
      items: [{ kind: 'note', level: 'review', message: 'PR is up for the activity feed; needs a review + merge.', ts: new Date(now - 4 * 6e4).toISOString(), id: 'fn1' }], lastTs: new Date(now - 4 * 6e4).toISOString() },
    { sessionId: 'rollout-fixture-b2b2', repo: '~/demo/core', harness: 'codex', cwd: '~/demo/core', path: '', title: 'Choose the rename-persistence path',
      items: [{ kind: 'ask', level: 'review', reason: 'Both paths verified; say the word and I take path B.', ts: new Date(now - 6 * 6e4).toISOString() }], lastTs: new Date(now - 6 * 6e4).toISOString() },
    { sessionId: 'rollout-fixture-d4d4', repo: '~/demo/tokens', harness: 'codex', cwd: '~/demo/tokens', path: '', title: 'Rotate the activity token',
      items: [{ kind: 'note', level: 'blocked', message: 'Blocked: the activity token is missing from the environment.', ts: new Date(now - 7 * 6e4).toISOString(), id: 'fn2' }], lastTs: new Date(now - 7 * 6e4).toISOString() },
    // Also carries a live 'ask' item (not just the 'qa' probe below) so the
    // reply-composer affordance (docs/ask-session.md's "Replying to an ask")
    // has a claude-code fixture to render against, alongside
    // rollout-fixture-b2b2's codex one -- the two harnesses take different
    // delivery paths (staged vs. delivered), and both need to be
    // screenshotable on fixtures.
    { sessionId: 'fixture-a1a1a1a1', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Multi-source spine, renderer wiring pass',
      items: [
        { kind: 'qa', question: 'status?', answer: 'Spine is wired end to end; the last open question is the watcher debounce window.', engine: 'claude', ts: new Date(now - 15 * 6e4).toISOString() },
        { kind: 'ask', level: 'review', reason: 'Spine is wired. Should the watcher debounce at 2s or 5s?', ts: new Date(now - 2 * 6e4).toISOString() },
      ], lastTs: new Date(now - 2 * 6e4).toISOString() },
    { sessionId: 'fixture-h8h8h8h8', repo: '~/demo/exports', harness: 'claude-code', cwd: '~/demo/exports', path: '', title: 'Backfill the export manifest',
      items: [{ kind: 'ask-interrupted', question: 'what does the manifest schema look like now?', ts: new Date(now - 20 * 6e4).toISOString() }], lastTs: new Date(now - 20 * 6e4).toISOString() },
  ];
}

// Derived from FIXTURE_ROWS (not hand-duplicated constants) so the fleet
// digest, Metrics, and Fleet views always agree on one screen: previously
// this hardcoded a 12-session/5-codex/7-claude fleet while FIXTURE_ROWS only
// ever had 8 rows (4 codex/4 claude), a fixture-only drift that read as a
// bug once Metrics and Fleet put both figures on screen together. Matches
// lib/sessions.ts's own nearCompaction threshold (contextPct >= 80) exactly.
export function fixtureStatus(): Status {
  const now = Math.floor(Date.now() / 1000);
  const codexRows = FIXTURE_ROWS.filter((r) => r.harness === 'codex');
  const claudeRows = FIXTURE_ROWS.filter((r) => r.harness === 'claude-code');
  const needsYou = FIXTURE_ROWS.filter((r) => r.state === 'need' || r.state === 'block').length;
  const working = FIXTURE_ROWS.filter((r) => r.state === 'work').length;
  const nearCompaction = FIXTURE_ROWS.filter((r) => (r.contextPct ?? 0) >= 80).length;
  return {
    per: {
      codex: { sessions: codexRows.length, generated: 240000, totalTokens: 5e6, apiEquivUSD: codexRows.reduce((s, r) => s + (r.apiEquivUSD || 0), 0) },
      'claude-code': { sessions: claudeRows.length, generated: 180000, totalTokens: 3.2e6, costUSD: claudeRows.reduce((s, r) => s + (r.costUSD || 0), 0) },
    },
    codexQuota: { plan_type: 'pro', primary: { used_percent: 46, window_minutes: 300, resets_at: now + 36 * 60 }, secondary: { used_percent: 71, window_minutes: 10080, resets_at: now + 5 * 86400 } },
    needsYou, working, nearCompaction, sessions: FIXTURE_ROWS.length, pricingAsOf: '2026-06',
    generatedAt: new Date().toISOString(),
  };
}

// Synthetic Claude quota. Fixture mode MUST NOT shell out: the browser dev loop
// and every screenshot render this instead of spawning the `claude` CLI, so the
// numbers below are invented and no real account is ever read (AGENTS.md's
// born-clean rule). The shape deliberately exercises the dynamic-label path --
// a session window plus two weekly windows, one of them per-model -- and the
// verbatim `resets_at_text` string, which carries no epoch.
export function fixtureClaudeQuota(): ClaudeQuota {
  return {
    at: Date.now(),
    windows: [
      { label: 'Current session', used_percent: 18, resets_at_text: 'today at 9pm (UTC)' },
      { label: 'Current week (all models)', used_percent: 52, resets_at_text: 'Mon at 2am (UTC)' },
      { label: 'Current week (Opus)', used_percent: 74, resets_at_text: 'Mon at 2am (UTC)' },
    ],
  };
}

// Generic demo skill names (born-clean; never the agent's real installed
// skill catalog) for the Metrics view's top-skills list.
export const FIXTURE_SKILL_AGGREGATE: SkillAggregate = {
  skills: { 'code-review': 6, 'test-runner': 4, 'doc-gardener': 2, 'deploy-check': 1 },
  sessionsWithSkills: 5,
  totalInvocations: 13,
};

export function fixtureBudgetStatus(dailyBudgetUSD: number): BudgetStatus {
  const spentUSD = Math.min(dailyBudgetUSD, 0.34);
  return {
    day: new Date().toISOString().slice(0, 10),
    spentUSD,
    dailyBudgetUSD,
    paused: spentUSD >= dailyBudgetUSD,
    remainingUSD: Math.max(0, dailyBudgetUSD - spentUSD),
  };
}

// ---- live timeline fixtures (stage 3) --------------------------------------
// Synthetic pages mirroring lib/sessions.ts's readTimelinePage shape, seeded
// per session id so the same fixture session always shows the same synthetic
// history (reproducible screenshots, no real transcript ever touched).
export function fixtureTimelinePage(row: SessionRow): TimelinePage {
  const seed = hashU(row.id);
  const n = 12 + (seed % 5);
  const events: TimelineEvent[] = [];
  let ts = Date.now() - n * 4 * 6e4;
  for (let i = 0; i < n; i++) {
    const pick = (seed + i) % 4;
    if (pick === 0) events.push({ k: 'user', t: `demo instruction ${i + 1} for ${row.repo || 'the demo repo'}`, ts });
    else if (pick === 3) events.push({ k: 'assistant', t: `demo progress report ${i + 1}: the step landed cleanly, moving on.`, ts });
    else events.push({ k: 'tools', n: 2 + ((seed + i) % 6), ts });
    ts += 4 * 6e4;
  }
  return {
    harness: row.harness, events, start: 4096, end: 262144, size: 262144,
    mtimeMs: Date.now() - 90000, atStart: false, scannedBytes: 4096,
    estEarlier: 18 + (seed % 20), meta: null,
  };
}

export function fixtureOlderTimelinePage(row: SessionRow): TimelinePage {
  const seed = hashU(row.id);
  const events: TimelineEvent[] = [];
  let ts = Date.now() - 4 * 3.6e6;
  for (let i = 0; i < 7; i++) {
    const pick = (seed + i) % 3;
    if (pick === 0) events.push({ k: 'user', t: `earlier demo instruction ${i + 1}`, ts });
    else if (pick === 1) events.push({ k: 'assistant', t: `earlier demo report ${i + 1}`, ts });
    else events.push({ k: 'tools', n: 1 + ((seed + i) % 4), ts });
    ts += 6e4;
  }
  // Always reaches the (synthetic) start of the file: one older page is
  // enough to demonstrate the "load older" -> "start of session" transition
  // without an unbounded synthetic backfill.
  return { harness: row.harness, events, start: 0, end: 4096, size: 262144, mtimeMs: Date.now() - 90000, atStart: true, scannedBytes: 4096, estEarlier: 0, meta: null };
}

// A couple of simulated live appends, fired once (never recurring) after the
// initial fixture page loads, purely so the sticky-bottom behavior is
// driveable in a plain browser without Electron. See useTimeline's
// FIXTURE_APPEND_DELAYS_MS for the one-shot timer that calls this.
export function fixtureAppendEvents(row: SessionRow, batch: number): TimelineEvent[] {
  const seed = hashU(row.id) + batch * 7;
  const ts = Date.now();
  if (batch % 2 === 0) return [{ k: 'assistant', t: `demo progress report: live update ${batch + 1} just landed.`, ts }];
  return [{ k: 'tools', n: 1 + (seed % 3), ts }];
}
