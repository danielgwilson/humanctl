import type { HumanctlAdapter } from './adapter';
import { FIXTURE_VAULT_SNAPSHOT } from './brain-fixture';
import {
  DEFAULT_APP_STATE,
  type AppState,
  type InboxThread,
  type NoteItem,
  type SessionAppendPayload,
  type SessionRow,
  type TimelineEvent,
  type TimelinePage,
} from './contracts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(value: string): number {
  let result = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619) >>> 0;
  }
  return result;
}

function makeTimeline(session: SessionRow, older = false): TimelinePage {
  const seed = hash(session.id);
  const count = older ? 7 : 12 + (seed % 5);
  const events: TimelineEvent[] = [];
  let ts = Date.now() - (older ? 4 * 3.6e6 : count * 4 * 6e4);
  for (let i = 0; i < count; i += 1) {
    const pick = (seed + i) % 4;
    if (pick === 0) events.push({ k: 'user', t: `${older ? 'earlier ' : ''}fixture instruction ${i + 1}`, ts });
    else if (pick === 3) events.push({ k: 'assistant', t: `${older ? 'earlier ' : ''}fixture progress ${i + 1}: the step completed.`, ts });
    else events.push({ k: 'tools', n: 2 + ((seed + i) % 6), ts });
    ts += older ? 6e4 : 4 * 6e4;
  }
  return {
    harness: session.harness,
    events,
    start: older ? 0 : 4096,
    end: older ? 4096 : 262144,
    size: 262144,
    mtimeMs: Date.now() - 90000,
    atStart: older,
    scannedBytes: 4096,
    estEarlier: older ? 0 : 18 + (seed % 20),
    meta: {
      customTitle: session.customTitle,
      model: session.model,
      effort: session.reasoningEffort || undefined,
    },
  };
}

/**
 * Public-safe synthetic transport for browser development and screenshots.
 * The staggered one-shot delays make independent loading states observable.
 */
export function createFixtureAdapter(): HumanctlAdapter {
  const epoch = Date.now();
  let appState: AppState = clone(DEFAULT_APP_STATE as AppState);

  const rows: SessionRow[] = [
    {
      id: 'fixture-a1a1a1a1', harness: 'claude-code', repo: '~/fixtures/console',
      cwd: '~/fixtures/console', path: '~/fixtures/console/fixture-a1a1a1a1.jsonl',
      title: 'Wire the multi-source update spine', customTitle: 'Multi-source update spine',
      state: 'need', stateReason: 'asks you a question', tier: 'hot', age: '2m',
      ageMs: epoch - 2 * 6e4, createdMs: epoch - 90 * 6e4, contextPct: 63,
      costUSD: 2.14, model: 'claude-opus-4-8', ultracode: true,
      lastRole: 'assistant', lastUser: 'wire the update spine into the renderer',
      prevAgent: 'The spine is wired. Which debounce window should I use?',
      summary: { text: 'The update spine is connected. One timing decision remains.', engine: 'claude', at: epoch - 3 * 6e4 },
    },
    {
      id: 'rollout-fixture-b2b2', harness: 'codex', repo: '~/fixtures/core',
      cwd: '~/fixtures/core', path: '~/fixtures/core/rollout-fixture-b2b2.jsonl',
      title: 'Choose the persistence path', state: 'need', stateReason: 'awaiting your go-ahead',
      tier: 'hot', age: '6m', ageMs: epoch - 6 * 6e4, createdMs: epoch - 120 * 6e4,
      contextPct: 22, apiEquivUSD: 0.88, model: 'gpt-5.5', reasoningEffort: 'xhigh',
      lastRole: 'assistant', lastUser: 'which persistence path should we trust?',
      prevAgent: 'Both paths are verified; path B has the smaller failure surface.',
    },
    {
      id: 'fixture-c3c3c3c3', harness: 'claude-code', repo: '~/fixtures/activity',
      cwd: '~/fixtures/activity', path: '~/fixtures/activity/fixture-c3c3c3c3.jsonl',
      title: 'Pull the activity feed', state: 'work', stateReason: 'progress report, still fresh',
      tier: 'hot', age: '11m', ageMs: epoch - 11 * 6e4, createdMs: epoch - 40 * 6e4,
      contextPct: 38, costUSD: 1.02, model: 'claude-opus-4-8', lastRole: 'assistant',
      prevAgent: 'The activity adapter is built; verification is running.',
    },
    {
      id: 'rollout-fixture-d4d4', harness: 'codex', repo: '~/fixtures/tokens',
      cwd: '~/fixtures/tokens', path: '~/fixtures/tokens/rollout-fixture-d4d4.jsonl',
      title: 'Rotate the activity token', state: 'block', stateReason: 'missing credential',
      tier: 'hot', age: '18m', ageMs: epoch - 18 * 6e4, createdMs: epoch - 70 * 6e4,
      contextPct: 55, apiEquivUSD: 0.63, model: 'gpt-5.5', reasoningEffort: 'high',
      lastRole: 'assistant', prevAgent: 'The smoke test is waiting on a replacement token.',
    },
    {
      id: 'fixture-e5e5e5e5', harness: 'claude-code', repo: '~/fixtures/export',
      cwd: '~/fixtures/export', path: '~/fixtures/export/fixture-e5e5e5e5.jsonl',
      title: 'Backfill the export manifest', state: 'idle', stateReason: 'ended without an ask',
      tier: 'drifting', age: '3h', ageMs: epoch - 3 * 3.6e6, createdMs: epoch - 5 * 3.6e6,
      contextPct: 31, costUSD: 0.66, model: 'claude-sonnet-4-5', lastRole: 'assistant',
      prevAgent: 'The manifest backfill is staged.',
    },
    {
      id: 'rollout-fixture-f6f6', harness: 'codex', repo: '~/fixtures/hygiene',
      cwd: '~/fixtures/hygiene', path: '~/fixtures/hygiene/rollout-fixture-f6f6.jsonl',
      title: 'Run the hygiene sweep', state: 'done', stateReason: 'reports completion, no ask',
      tier: 'hot', age: '24m', ageMs: epoch - 24 * 6e4, createdMs: epoch - 80 * 6e4,
      contextPct: 12, apiEquivUSD: 0.20, model: 'gpt-5.5', reasoningEffort: 'low',
      lastRole: 'assistant', prevAgent: 'The sweep completed and every gate passed.',
    },
  ];

  const notes: NoteItem[] = [
    { id: 'fixture-note-1', ts: new Date(epoch - 4 * 6e4).toISOString(), level: 'review', message: 'The activity update is ready for review.', repo: 'activity', session: 'fixture-c3c3c3c3' },
    { id: 'fixture-note-2', ts: new Date(epoch - 7 * 6e4).toISOString(), level: 'blocked', message: 'The smoke test needs a replacement credential.', repo: 'tokens', session: 'rollout-fixture-d4d4' },
    { id: 'fixture-note-3', ts: new Date(epoch - 26 * 6e4).toISOString(), level: 'done', message: 'The hygiene sweep completed.', repo: 'hygiene', session: 'rollout-fixture-f6f6' },
  ];

  const threads: InboxThread[] = [
    {
      sessionId: 'fixture-a1a1a1a1', repo: '~/fixtures/console', harness: 'claude-code',
      cwd: '~/fixtures/console', path: rows[0].path || '', title: rows[0].title,
      session: rows[0],
      items: [{ kind: 'ask', level: 'review', reason: 'Which debounce window should I use?', ts: new Date(epoch - 2 * 6e4).toISOString() }],
      lastTs: new Date(epoch - 2 * 6e4).toISOString(),
    },
    {
      sessionId: 'rollout-fixture-b2b2', repo: '~/fixtures/core', harness: 'codex',
      cwd: '~/fixtures/core', path: rows[1].path || '', title: rows[1].title,
      session: rows[1],
      items: [{ kind: 'ask', level: 'review', reason: 'Both paths are verified. Should I take path B?', ts: new Date(epoch - 6 * 6e4).toISOString() }],
      lastTs: new Date(epoch - 6 * 6e4).toISOString(),
    },
    {
      sessionId: 'rollout-fixture-d4d4', repo: '~/fixtures/tokens', harness: 'codex',
      cwd: '~/fixtures/tokens', path: rows[3].path || '', title: rows[3].title,
      session: rows[3],
      items: [{ kind: 'note', level: 'blocked', message: notes[1].message, ts: notes[1].ts, id: notes[1].id }],
      lastTs: notes[1].ts,
    },
    {
      sessionId: 'fixture-c3c3c3c3', repo: '~/fixtures/activity', harness: 'claude-code',
      cwd: '~/fixtures/activity', path: rows[2].path || '', title: rows[2].title,
      session: rows[2],
      items: [{ kind: 'note', level: 'review', message: notes[0].message, ts: notes[0].ts, id: notes[0].id }],
      lastTs: notes[0].ts,
    },
  ];

  const sessionListeners = new Set<() => void>();
  const inboxListeners = new Set<() => void>();
  const stateListeners = new Set<(state: AppState) => void>();
  const appendListeners = new Set<(payload: SessionAppendPayload) => void>();
  let appendTimers: Array<ReturnType<typeof setTimeout>> = [];

  function subscribe<T>(set: Set<T>, cb: T): () => void {
    set.add(cb);
    return () => set.delete(cb);
  }

  function stopFixtureAppends(): void {
    appendTimers.forEach(clearTimeout);
    appendTimers = [];
  }

  return {
    mode: 'fixture',
    async getStatus() {
      await wait(25);
      const codex = rows.filter((row) => row.harness === 'codex');
      const claude = rows.filter((row) => row.harness === 'claude-code');
      return {
        ok: true,
        status: {
          per: {
            codex: { sessions: codex.length, generated: 240000, totalTokens: 5e6, apiEquivUSD: 1.71 },
            'claude-code': { sessions: claude.length, generated: 180000, totalTokens: 3.2e6, costUSD: 3.82 },
          },
          codexQuota: {
            plan_type: 'pro',
            primary: { used_percent: 46, window_minutes: 300, resets_at: Math.floor(epoch / 1000) + 36 * 60 },
            secondary: { used_percent: 71, window_minutes: 10080, resets_at: Math.floor(epoch / 1000) + 5 * 86400 },
          },
          // Must match isNeedsYou / isWorking in lib/sessions.ts (need-state,
          // non-archived): blocked is the blocked-on-agent lane, not needs-you,
          // so dev and screenshots read the same count production does. Guarded
          // by runtime.selftest.ts. Fixture rows are never archived.
          needsYou: rows.filter((row) => row.state === 'need').length,
          working: rows.filter((row) => row.state === 'work').length,
          nearCompaction: rows.filter((row) => (row.contextPct || 0) >= 80).length,
          sessions: rows.length,
          pricingAsOf: '2026-06',
          generatedAt: new Date(epoch).toISOString(),
          version: 'fixture',
        },
      };
    },
    async listSessions() { await wait(45); return { ok: true, rows: clone(rows) }; },
    async getNotes() { await wait(60); return { ok: true, notes: clone(notes) }; },
    async getInboxThreads() { await wait(75); return { ok: true, threads: clone(threads) }; },
    async getClaudeQuota() {
      await wait(140);
      return {
        ok: true,
        quota: {
          at: epoch,
          windows: [
            { label: 'Current session', used_percent: 18, resets_at_text: 'today at 9pm (UTC)' },
            { label: 'Current week (all models)', used_percent: 52, resets_at_text: 'Mon at 2am (UTC)' },
            { label: 'Current week (Opus)', used_percent: 74, resets_at_text: 'Mon at 2am (UTC)' },
          ],
        },
      };
    },
    async getState() { await wait(15); return { ok: true, state: clone(appState) }; },
    async setState(patch) {
      appState = { ...appState, ...clone(patch) };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete (appState as unknown as Record<string, unknown>)[key];
      }
      stateListeners.forEach((listener) => listener(clone(appState)));
      return { ok: true };
    },
    async markThreadRead() { return { ok: true }; },
    async markAllThreadsRead() { return { ok: true }; },
    async aggregateSkills() {
      await wait(90);
      return { ok: true, agg: { skills: { 'code-review': 6, 'test-runner': 4, 'doc-gardener': 2 }, sessionsWithSkills: 5, totalInvocations: 12 } };
    },
    async getBrain() {
      // Fixture mode always resolves the synthetic snapshot, so the browser
      // build and screenshots render a fully populated Brain view. The path
      // argument is ignored here; only the desktop adapter reads a real file.
      await wait(70);
      return { ok: true, snapshot: clone(FIXTURE_VAULT_SNAPSHOT) };
    },
    async getSummaryBudget(opts) {
      await wait(30);
      const requested = (opts as { dailyBudgetUSD?: number } | undefined)?.dailyBudgetUSD;
      const dailyBudgetUSD = typeof requested === 'number' ? requested : 1;
      const spentUSD = Math.min(dailyBudgetUSD, 0.34);
      return { ok: true, budget: { day: new Date(epoch).toISOString().slice(0, 10), spentUSD, dailyBudgetUSD, paused: spentUSD >= dailyBudgetUSD, remainingUSD: Math.max(0, dailyBudgetUSD - spentUSD) } };
    },
    async askAtlas(arg) { await wait(120); return { ok: true, answer: `Fixture response for: ${arg.question}`, engine: arg.engine || 'claude', at: Date.now() }; },
    async askSession(arg) { await wait(120); return { ok: true, answer: `Fixture session response for: ${arg.question}`, engine: arg.harness }; },
    async answerAsk(arg) {
      await wait(80);
      if (arg.harness === 'claude-code') return { ok: true, delivery: 'staged', clipped: true, resumed: true, sessionId: arg.id, at: Date.now() };
      return { ok: true, delivery: 'codex-rollout', delivered: true, sessionId: arg.id, at: Date.now() };
    },
    async summarize(arg) {
      await wait(100);
      return { ok: true, summary: `Fixture summary for ${arg.id}.`, engine: arg.engine || 'claude' };
    },
    async resumeSession() { return { ok: true }; },
    async openInApp() { return { ok: true }; },
    async revealSession() { return { ok: true }; },
    async openExternal() { return { ok: true }; },
    async openPath() { return { ok: true }; },
    async readTimeline(arg) {
      await wait(55);
      const session = rows.find((row) => row.path === arg.path || row.id === arg.id);
      if (!session) return { ok: false, error: 'fixture session not found' };
      return { ok: true, page: makeTimeline(session, typeof arg.before === 'number') };
    },
    async setHotSession(arg) {
      stopFixtureAppends();
      if (!arg?.path) return { ok: true };
      // Declared fixture timers: two one-shot append events at 900ms and
      // 1800ms. They exist only to exercise live timeline behavior in the
      // browser and are cancelled on session change or runtime shutdown.
      [900, 1800].forEach((delay, index) => {
        appendTimers.push(setTimeout(() => {
          const payload: SessionAppendPayload = index === 0
            ? { path: arg.path, events: [{ k: 'assistant', t: 'Fixture live update completed.', ts: Date.now() }], at: Date.now() }
            : { path: arg.path, events: [{ k: 'tools', n: 2, ts: Date.now() }], at: Date.now() };
          appendListeners.forEach((listener) => listener(payload));
        }, delay));
      });
      return { ok: true };
    },
    onSessionsChanged: (cb) => subscribe(sessionListeners, cb),
    onInboxFast: (cb) => subscribe(inboxListeners, cb),
    onStateChanged: (cb) => subscribe(stateListeners, cb),
    onSessionAppend: (cb) => subscribe(appendListeners, cb),
  };
}
