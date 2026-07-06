// Synthetic fixture data, ported from electron/renderer/renderer.js's
// FIXTURE_ROWS/FIXTURE_NOTES and inbox.js's fixtureThreads(). Used ONLY when
// window.humanctl is absent (plain browser / vite dev with no Electron
// preload attached), same fallback contract as the existing static renderer.
// OSS-safe: no real ids, generic demo repo names, matches AGENTS.md's
// born-clean rule.
import type { InboxThread, NoteItem, SessionRow, Status } from './types';

export const FIXTURE_ROWS: SessionRow[] = [
  { harness: 'claude-code', id: 'fixture-a1a1a1a1', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Wire the multi-source update spine', customTitle: 'Multi-source spine, renderer wiring pass', lastRole: 'assistant', state: 'need', stateReason: 'asks you a question', tier: 'hot', age: '2m', ageMs: Date.now() - 2 * 6e4, createdMs: Date.now() - 90 * 6e4, contextPct: 63, costUSD: 2.14, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: true, lastUser: 'wire the update spine into the renderer', prevAgent: 'Spine is wired. Should the watcher debounce at 2s or 5s?' },
  { harness: 'codex', id: 'rollout-fixture-b2b2', repo: '~/demo/core', cwd: '~/demo/core', title: 'Choose the rename-persistence path', lastRole: 'assistant', state: 'need', stateReason: 'awaiting your go-ahead', tier: 'hot', age: '6m', ageMs: Date.now() - 6 * 6e4, createdMs: Date.now() - 120 * 6e4, contextPct: 22, apiEquivUSD: 0.88, model: 'gpt-5.5', reasoningEffort: 'xhigh', ultracode: false, lastUser: 'which rename-persistence path should we trust?', prevAgent: 'Both paths verified; say the word and I take path B.' },
  { harness: 'claude-code', id: 'fixture-h8h8h8h8', repo: '~/demo/exports', cwd: '~/demo/exports', title: 'Backfill the export manifest', lastRole: 'user', state: 'need', stateReason: 'you interrupted; only you can resume', tier: 'hot', age: '18m', ageMs: Date.now() - 18 * 6e4, createdMs: Date.now() - 60 * 6e4, contextPct: 31, costUSD: 0.66, model: 'claude-sonnet-4-5', reasoningEffort: null, ultracode: false, lastUser: 'wait, hold off on the manifest rewrite', prevAgent: 'Starting the manifest rewrite now.' },
  { harness: 'codex', id: 'rollout-fixture-c9c9', repo: '~/demo/ledger', cwd: '~/demo/ledger', title: 'Reconcile the ledger deltas', lastRole: 'user', state: 'need', stateReason: 'your reply was never picked up', tier: 'hot', age: '3h', ageMs: Date.now() - 3 * 3.6e6, createdMs: Date.now() - 5 * 3.6e6, contextPct: 44, apiEquivUSD: 1.12, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'yes please, run the reconcile pass', prevAgent: 'Deltas mapped; ready to reconcile on your word.' },
  { harness: 'claude-code', id: 'fixture-c3c3c3c3', repo: '~/demo/renderer', cwd: '~/demo/renderer', title: 'Pull the activity feed', customTitle: 'Activity feed adapter', lastRole: 'assistant', state: 'work', stateReason: 'progress report, still fresh', tier: 'hot', age: '11m', ageMs: Date.now() - 11 * 6e4, createdMs: Date.now() - 40 * 6e4, contextPct: 38, costUSD: 1.02, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: 'retry the activity pull', prevAgent: 'The activity adapter is built; PR is up.' },
  { harness: 'codex', id: 'rollout-fixture-d4d4', repo: '~/demo/tokens', cwd: '~/demo/tokens', title: 'Rotate the activity token', lastRole: 'user', state: 'work', stateReason: 'your turn was picked up', tier: 'hot', age: '9m', ageMs: Date.now() - 9 * 6e4, createdMs: Date.now() - 30 * 6e4, contextPct: 55, apiEquivUSD: 0.63, model: 'gpt-5.5', reasoningEffort: 'high', ultracode: false, lastUser: 'rotate it and rerun the smoke test', prevAgent: 'Token rotation staged.' },
  { harness: 'claude-code', id: 'fixture-f6f6f6f6', repo: '~/demo/hygiene', cwd: '~/demo/hygiene', title: 'OSS hygiene sweep', lastRole: 'assistant', state: 'done', stateReason: 'reports completion, no ask', tier: 'hot', age: '24m', ageMs: Date.now() - 24 * 6e4, createdMs: Date.now() - 80 * 6e4, contextPct: 12, costUSD: 3.40, model: 'claude-opus-4-8', reasoningEffort: null, ultracode: false, lastUser: '', prevAgent: 'Swept history; merged and shipped, checks are green.' },
  { harness: 'codex', id: 'rollout-fixture-g7g7', repo: '~/demo/icons', cwd: '~/demo/icons', title: 'Draft the squircle icons', lastRole: 'assistant', state: 'idle', stateReason: 'ended without an ask', tier: 'hot', age: '5h', ageMs: Date.now() - 5 * 3.6e6, createdMs: Date.now() - 8 * 3.6e6, contextPct: 8, apiEquivUSD: 0.20, model: 'gpt-5.5', reasoningEffort: 'low', ultracode: false, lastUser: '', prevAgent: 'Drafted the squircle variants.' },
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
    { sessionId: 'fixture-a1a1a1a1', repo: '~/demo/renderer', harness: 'claude-code', cwd: '~/demo/renderer', path: '', title: 'Multi-source spine, renderer wiring pass',
      items: [{ kind: 'qa', question: 'status?', answer: 'Spine is wired end to end; the last open question is the watcher debounce window.', engine: 'claude', ts: new Date(now - 15 * 6e4).toISOString() }], lastTs: new Date(now - 15 * 6e4).toISOString() },
    { sessionId: 'fixture-h8h8h8h8', repo: '~/demo/exports', harness: 'claude-code', cwd: '~/demo/exports', path: '', title: 'Backfill the export manifest',
      items: [{ kind: 'ask-interrupted', question: 'what does the manifest schema look like now?', ts: new Date(now - 20 * 6e4).toISOString() }], lastTs: new Date(now - 20 * 6e4).toISOString() },
  ];
}

export function fixtureStatus(): Status {
  const now = Math.floor(Date.now() / 1000);
  return {
    per: {
      codex: { sessions: 5, generated: 240000, totalTokens: 5e6, apiEquivUSD: 1.71 },
      'claude-code': { sessions: 7, generated: 180000, totalTokens: 3.2e6, costUSD: 7.30 },
    },
    codexQuota: { plan_type: 'pro', primary: { used_percent: 46, window_minutes: 300, resets_at: now + 36 * 60 }, secondary: { used_percent: 71, window_minutes: 10080, resets_at: now + 5 * 86400 } },
    needsYou: 5, working: 4, nearCompaction: 1, sessions: 12, pricingAsOf: '2026-06',
    generatedAt: new Date().toISOString(),
  };
}
