import type {
  BridgeResult,
  HumanctlAdapter,
  InboxResult,
  NotesResult,
  QuotaResult,
  SessionsResult,
  StateResult,
  StatusResult,
  TimelineResult,
} from './adapter';
import type {
  AppState,
  SessionAppendPayload,
  SessionRow,
  TimelineEvent,
} from './contracts';
import { createFixtureAdapter } from './fixture-adapter';
import { createHumanctlRuntime, FLEET_POLL_MS, type RuntimeClock } from './runtime';
import {
  readShellStateCache,
  SHELL_STATE_CACHE_KEY,
  writeShellStateCache,
  type ShellStateStorage,
} from './shell-state-cache';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function timelineText(event: TimelineEvent | undefined): string | undefined {
  return event && 't' in event ? event.t : undefined;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

class FakeClock implements RuntimeClock {
  nowMs = 1_750_000_000_000;
  nextId = 1;
  intervals = new Map<number, { callback: () => void; ms: number }>();
  cleared: number[] = [];

  now(): number { return this.nowMs; }
  setInterval(callback: () => void, ms: number): number {
    const id = this.nextId++;
    this.intervals.set(id, { callback, ms });
    return id;
  }
  clearInterval(handle: unknown): void {
    const id = handle as number;
    this.cleared.push(id);
    this.intervals.delete(id);
  }
}

class MemoryStorage implements ShellStateStorage {
  values = new Map<string, string>();
  failReads = false;
  failWrites = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('storage read blocked');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('storage write blocked');
    this.values.set(key, value);
  }
}

const ROW: SessionRow = {
  id: 'runtime-fixture-session',
  harness: 'codex',
  repo: '~/fixtures/runtime',
  cwd: '~/fixtures/runtime',
  path: '~/fixtures/runtime/session.jsonl',
  title: 'Runtime fixture',
  state: 'work',
  tier: 'hot',
  ageMs: 1_749_999_000_000,
};

const DEFAULT_STATE: AppState = {
  pins: [],
  theme: 'dark',
  view: 'metrics',
  navPinned: true,
  rightRailOpen: false,
  lastReadTs: {},
  summarizer: 'claude',
};

class FakeAdapter implements HumanctlAdapter {
  readonly mode = 'desktop' as const;
  calls = { status: 0, sessions: 0, notes: 0, inbox: 0, quota: 0, state: 0 };
  stateWrites: Partial<AppState>[] = [];
  summaryArgs: Array<Parameters<HumanctlAdapter['summarize']>[0]> = [];
  hotArgs: Array<{ path: string; harness?: string; from?: number } | null> = [];
  statusDeferred = deferred<StatusResult>();
  sessionsDeferred = deferred<SessionsResult>();
  notesDeferred = deferred<NotesResult>();
  inboxDeferred = deferred<InboxResult>();
  quotaDeferred = deferred<QuotaResult>();
  stateDeferred = deferred<StateResult>();
  initial = { status: true, sessions: true, notes: true, inbox: true, quota: true, state: true };
  sessionListeners = new Set<() => void>();
  inboxListeners = new Set<() => void>();
  stateListeners = new Set<(state: AppState) => void>();
  appendListeners = new Set<(payload: SessionAppendPayload) => void>();

  readonly statusResult: StatusResult = {
    ok: true,
    status: {
      per: { codex: { sessions: 1, generated: 10, totalTokens: 20 } },
      needsYou: 0,
      working: 1,
      nearCompaction: 0,
      sessions: 1,
      generatedAt: '2026-07-14T00:00:00.000Z',
      version: 'test',
    },
  };
  readonly sessionsResult: SessionsResult = { ok: true, rows: [ROW] };
  readonly notesResult: NotesResult = { ok: true, notes: [] };
  readonly inboxResult: InboxResult = {
    ok: true,
    threads: [{
      sessionId: ROW.id,
      harness: ROW.harness,
      path: ROW.path || '',
      title: ROW.title,
      items: [{ kind: 'ask', reason: 'Choose the bounded path.', ts: '2026-07-14T00:00:00.000Z' }],
      lastTs: '2026-07-14T00:00:00.000Z',
    }],
  };
  quotaResult: QuotaResult = {
    ok: true,
    quota: { at: 1_750_000_000_000, windows: [{ label: 'Current session', used_percent: 25 }] },
  };

  resolveSessions(): void {
    this.initial.sessions = false;
    this.sessionsDeferred.resolve(clone(this.sessionsResult));
  }
  resolveCore(): void {
    this.initial.status = false;
    this.initial.notes = false;
    this.initial.inbox = false;
    this.statusDeferred.resolve(clone(this.statusResult));
    this.notesDeferred.resolve(clone(this.notesResult));
    this.inboxDeferred.resolve(clone(this.inboxResult));
  }
  resolveQuota(result: QuotaResult = this.quotaResult): void {
    this.initial.quota = false;
    this.quotaDeferred.resolve(clone(result));
  }
  resolveState(state = DEFAULT_STATE): void {
    this.resolveStateResult({ ok: true, state: clone(state) });
  }
  resolveStateResult(result: StateResult): void {
    this.initial.state = false;
    this.stateDeferred.resolve(clone(result));
  }

  getStatus(): Promise<StatusResult> {
    this.calls.status += 1;
    return this.initial.status ? this.statusDeferred.promise : Promise.resolve(clone(this.statusResult));
  }
  listSessions(): Promise<SessionsResult> {
    this.calls.sessions += 1;
    return this.initial.sessions ? this.sessionsDeferred.promise : Promise.resolve(clone(this.sessionsResult));
  }
  getNotes(): Promise<NotesResult> {
    this.calls.notes += 1;
    return this.initial.notes ? this.notesDeferred.promise : Promise.resolve(clone(this.notesResult));
  }
  getInboxThreads(): Promise<InboxResult> {
    this.calls.inbox += 1;
    return this.initial.inbox ? this.inboxDeferred.promise : Promise.resolve(clone(this.inboxResult));
  }
  getClaudeQuota(): Promise<QuotaResult> {
    this.calls.quota += 1;
    return this.initial.quota ? this.quotaDeferred.promise : Promise.resolve(clone(this.quotaResult));
  }
  getState(): Promise<StateResult> {
    this.calls.state += 1;
    return this.initial.state ? this.stateDeferred.promise : Promise.resolve({ ok: true, state: clone(DEFAULT_STATE) });
  }
  async setState(patch: Partial<AppState>): Promise<BridgeResult> {
    this.stateWrites.push(clone(patch));
    return { ok: true };
  }
  async markThreadRead(): Promise<BridgeResult> { return { ok: true }; }
  async markAllThreadsRead(): Promise<BridgeResult> { return { ok: true }; }
  async aggregateSkills() { return { ok: true, agg: { skills: { test: 2 }, sessionsWithSkills: 1, totalInvocations: 2 } }; }
  async getSummaryBudget(opts?: unknown) {
    const dailyBudgetUSD = (opts as { dailyBudgetUSD?: number } | undefined)?.dailyBudgetUSD || 1;
    return { ok: true, budget: { day: '2026-07-14', spentUSD: 0.2, dailyBudgetUSD, paused: false, remainingUSD: dailyBudgetUSD - 0.2 } };
  }
  async askAtlas(arg: { question: string; engine?: string }) { return { ok: true, answer: `answer:${arg.question}`, engine: arg.engine }; }
  async askSession(arg: { question: string }) { return { ok: true, answer: `session:${arg.question}` }; }
  async answerAsk(arg: { id: string }) { return { ok: true, delivery: 'codex-rollout' as const, delivered: true, sessionId: arg.id }; }
  async summarize(arg: Parameters<HumanctlAdapter['summarize']>[0]) {
    this.summaryArgs.push(clone(arg));
    return { ok: true, summary: 'summary', engine: arg.engine };
  }
  async resumeSession(): Promise<BridgeResult> { return { ok: true }; }
  async openInApp(): Promise<BridgeResult> { return { ok: true }; }
  async revealSession(): Promise<BridgeResult> { return { ok: true }; }
  async openExternal(): Promise<BridgeResult> { return { ok: true }; }
  async openPath(): Promise<BridgeResult> { return { ok: true }; }
  async readTimeline(arg: { before?: number }): Promise<TimelineResult> {
    if (typeof arg.before === 'number') {
      return {
        ok: true,
        page: {
          harness: 'codex', events: [{ k: 'user' as const, t: 'older', ts: 1 }],
          start: 0, end: 10, size: 100, mtimeMs: 1, atStart: true,
          scannedBytes: 10, estEarlier: 0, meta: null,
        },
      };
    }
    return {
      ok: true,
      page: {
        harness: 'codex', events: [{ k: 'assistant' as const, t: 'current', ts: 2 }],
        start: 10, end: 100, size: 100, mtimeMs: 2, atStart: false,
        scannedBytes: 90, estEarlier: 1, meta: { model: 'test' },
      },
    };
  }
  async setHotSession(arg: { path: string; harness?: string; from?: number } | null): Promise<BridgeResult> {
    this.hotArgs.push(arg ? { ...arg } : null);
    return { ok: true };
  }
  onSessionsChanged(cb: () => void): () => void { this.sessionListeners.add(cb); return () => this.sessionListeners.delete(cb); }
  onInboxFast(cb: () => void): () => void { this.inboxListeners.add(cb); return () => this.inboxListeners.delete(cb); }
  onStateChanged(cb: (state: AppState) => void): () => void { this.stateListeners.add(cb); return () => this.stateListeners.delete(cb); }
  onSessionAppend(cb: (payload: SessionAppendPayload) => void): () => void { this.appendListeners.add(cb); return () => this.appendListeners.delete(cb); }

  emitSessionsChanged(): void { this.sessionListeners.forEach((listener) => listener()); }
  emitState(state: AppState): void { this.stateListeners.forEach((listener) => listener(clone(state))); }
  emitAppend(payload: SessionAppendPayload): void { this.appendListeners.forEach((listener) => listener(payload)); }
}

async function run(): Promise<void> {
  testShellStateCache();
  await testShellStateFirstPaint();

  const adapter = new FakeAdapter();
  const clock = new FakeClock();
  const runtime = createHumanctlRuntime(adapter, { clock });

  const cold = runtime.getSnapshot().resources;
  equal(cold.appState.status, 'loading', 'cold app state starts loading');
  equal(cold.status.status, 'loading', 'cold status starts loading');
  equal(cold.sessions.status, 'loading', 'cold sessions start loading');
  equal(cold.notes.status, 'loading', 'cold notes start loading');
  equal(cold.inbox.status, 'loading', 'cold inbox starts loading');
  equal(cold.quota.status, 'loading', 'cold quota starts loading');
  equal(cold.skills.status, 'idle', 'route-only skills stay idle on cold paint');
  equal(cold.budget.status, 'idle', 'route-only budget stays idle on cold paint');

  const releaseA = runtime.start();
  const releaseB = runtime.start();
  equal(clock.intervals.size, 1, 'runtime owns exactly one recurring interval');
  equal([...clock.intervals.values()][0]?.ms, FLEET_POLL_MS, 'fleet interval cadence');
  equal(adapter.sessionListeners.size, 1, 'one session watcher subscription');
  equal(adapter.inboxListeners.size, 1, 'one inbox watcher subscription');

  adapter.resolveSessions();
  await settle();
  equal(runtime.getSnapshot().resources.sessions.status, 'ready', 'sessions settle independently');
  equal(runtime.getSnapshot().resources.sessions.data.length, 1, 'session payload available');
  equal(runtime.getSnapshot().resources.status.status, 'loading', 'status remains independently pending');
  equal(runtime.getSnapshot().resources.quota.status, 'loading', 'quota remains independently pending');

  const patch = runtime.dispatch({ type: 'app.patch', patch: { theme: 'light' } });
  await patch;
  adapter.resolveState();
  adapter.resolveCore();
  await settle();
  equal(runtime.getSnapshot().resources.appState.data.theme, 'light', 'pre-hydration patch survives state hydration');
  equal(runtime.getSnapshot().resources.appState.data.view, 'metrics', 'persisted state hydrates alongside local patch');
  equal(adapter.stateWrites.length, 1, 'app patch persists once');
  equal(runtime.getSnapshot().resources.status.status, 'ready', 'status settled');
  equal(runtime.getSnapshot().resources.inbox.status, 'ready', 'inbox settled');

  const enginePatch = await runtime.dispatch({ type: 'app.patch', patch: { summarizer: 'codex' } });
  assert(enginePatch.ok, 'summary engine patch succeeds');
  const summarized = await runtime.dispatch({ type: 'session.summarize', session: ROW });
  assert(summarized.ok, 'manual summary succeeds');
  equal(adapter.summaryArgs[0]?.engine, 'codex', 'configured summary engine reaches the adapter');
  equal(summarized.value.engine, 'codex', 'summary result reports the configured engine');

  const fixture = createFixtureAdapter();
  const fixtureSummary = await fixture.summarize({
    id: ROW.id,
    path: ROW.path,
    harness: ROW.harness,
    engine: 'codex',
  });
  equal(fixtureSummary.engine, 'codex', 'fixture summary preserves the configured engine');
  await fixture.setState({ selectedId: ROW.id });
  equal((await fixture.getState()).state?.selectedId, ROW.id, 'fixture state records a selected session');
  await fixture.setState({ selectedId: undefined });
  equal((await fixture.getState()).state?.selectedId, undefined, 'fixture state clears optional keys like desktop persistence');

  // Core reads completed while quota was still unresolved: quota is not on
  // the first-paint critical path.
  equal(runtime.getSnapshot().resources.quota.status, 'loading', 'cold quota does not block core resources');
  adapter.resolveQuota();
  await settle();
  equal(runtime.getSnapshot().resources.quota.status, 'ready', 'quota settles independently');

  const stableModel = runtime.getSnapshot();
  const stableSessions = stableModel.resources.sessions;
  const refresh = await runtime.dispatch({ type: 'fleet.refresh' });
  assert(refresh.ok, 'explicit refresh succeeds');
  equal(runtime.getSnapshot(), stableModel, 'unchanged refresh preserves top-level model identity');
  equal(runtime.getSnapshot().resources.sessions, stableSessions, 'unchanged sessions preserve resource identity');

  const callsBeforeEvent = adapter.calls.sessions;
  adapter.emitSessionsChanged();
  await settle();
  equal(adapter.calls.sessions, callsBeforeEvent + 1, 'watch event drives a fleet refresh');

  const opened = await runtime.dispatch({ type: 'timeline.open', session: ROW });
  assert(opened.ok, 'timeline opens');
  equal(runtime.getSnapshot().resources.timeline.data?.items.length, 1, 'initial timeline page applied');
  equal(runtime.getSnapshot().resources.timeline.data?.live, true, 'hot append stream enabled');
  adapter.emitAppend({ path: ROW.path || '', events: [{ k: 'tools', n: 2, ts: 3 }], end: 110, size: 110, at: 3 });
  equal(runtime.getSnapshot().resources.timeline.data?.items.length, 2, 'live append applied');
  equal(runtime.getSnapshot().resources.timeline.data?.end, 110, 'append cursor advances');
  const older = await runtime.dispatch({ type: 'timeline.loadOlder' });
  assert(older.ok, 'older timeline page loads');
  equal(runtime.getSnapshot().resources.timeline.data?.items[0]?.event.k, 'user', 'older page prepends');
  equal(runtime.getSnapshot().resources.timeline.data?.atStart, true, 'older page reaches transcript start');

  releaseA();
  equal(clock.intervals.size, 1, 'one remaining consumer keeps runtime active');
  releaseB();
  equal(clock.intervals.size, 0, 'last consumer clears recurring interval');
  equal(adapter.sessionListeners.size, 0, 'session watcher removed on stop');
  equal(adapter.inboxListeners.size, 0, 'inbox watcher removed on stop');
  equal(adapter.stateListeners.size, 0, 'state watcher removed on stop');
  equal(adapter.appendListeners.size, 0, 'append watcher removed on stop');
  equal(adapter.hotArgs[adapter.hotArgs.length - 1], null, 'stop clears hot session and fixture append timers');

  await testQuotaCoalescing();
  await testTimelineCap();

  console.log('runtime.selftest: ok');
}

function testShellStateCache(): void {
  const storage = new MemoryStorage();
  writeShellStateCache(storage, {
    theme: 'light',
    view: 'sessions',
    navPinned: false,
    rightRailOpen: true,
  });
  const serialized = storage.values.get(SHELL_STATE_CACHE_KEY);
  assert(serialized, 'shell cache writes the versioned entry synchronously');
  const parsed = JSON.parse(serialized) as { version?: number; state?: Record<string, unknown> };
  equal(parsed.version, 1, 'shell cache schema version');
  equal(
    Object.keys(parsed.state || {}).sort().join(','),
    'navPinned,rightRailOpen,theme,view',
    'shell cache contains only first-paint shell fields',
  );

  const cached = readShellStateCache(storage);
  equal(cached?.theme, 'light', 'valid cached theme restores');
  equal(cached?.view, 'sessions', 'valid cached view restores');
  equal(cached?.navPinned, false, 'valid cached left rail state restores');
  equal(cached?.rightRailOpen, true, 'valid cached right rail state restores');

  storage.values.set(SHELL_STATE_CACHE_KEY, '{malformed');
  equal(readShellStateCache(storage), undefined, 'malformed shell cache is ignored');
  storage.values.set(SHELL_STATE_CACHE_KEY, JSON.stringify({
    version: 0,
    state: { theme: 'light', view: 'sessions', navPinned: false, rightRailOpen: true },
  }));
  equal(readShellStateCache(storage), undefined, 'stale shell cache version is ignored');
  storage.values.set(SHELL_STATE_CACHE_KEY, JSON.stringify({
    version: 1,
    state: {
      theme: 'blue',
      view: 'fleet',
      navPinned: 'yes',
      rightRailOpen: true,
      pins: ['must-not-restore'],
    },
  }));
  const sanitized = readShellStateCache(storage);
  equal(sanitized?.theme, undefined, 'invalid cached theme is ignored');
  equal(sanitized?.view, 'fleet', 'valid fields survive a partially malformed cache');
  equal(sanitized?.navPinned, undefined, 'invalid cached rail state is ignored');
  equal(sanitized?.rightRailOpen, true, 'valid cached right rail state survives');
  assert(!('pins' in (sanitized || {})), 'non-shell cached fields never restore');

  storage.failReads = true;
  equal(readShellStateCache(storage), undefined, 'blocked storage read is ignored');
  storage.failReads = false;
  storage.failWrites = true;
  writeShellStateCache(storage, {
    theme: 'dark', view: 'inbox', navPinned: true, rightRailOpen: false,
  });
}

async function testShellStateFirstPaint(): Promise<void> {
  const adapter = new FakeAdapter();
  const changes: Array<Pick<AppState, 'theme' | 'view' | 'navPinned' | 'rightRailOpen'>> = [];
  const runtime = createHumanctlRuntime(adapter, {
    clock: new FakeClock(),
    initialShellState: {
      theme: 'light',
      view: 'settings',
      navPinned: false,
      rightRailOpen: true,
    },
    onShellStateChanged: (state) => changes.push(clone(state)),
  });
  const cold = runtime.getSnapshot().resources.appState;
  equal(cold.status, 'loading', 'cached first-paint state still awaits durable hydration');
  equal(cold.data.theme, 'light', 'cached theme is present before runtime start');
  equal(cold.data.view, 'settings', 'cached view is present before runtime start');
  equal(cold.data.navPinned, false, 'cached left rail is present before runtime start');
  equal(cold.data.rightRailOpen, true, 'cached right rail is present before runtime start');
  equal(cold.data.pins.length, 0, 'cache cannot populate durable non-shell state');

  const release = runtime.start();
  const patch = runtime.dispatch({ type: 'app.patch', patch: { rightRailOpen: false } });
  equal(changes.at(-1)?.rightRailOpen, false, 'app.patch mirrors shell state before persistence settles');

  adapter.resolveState(DEFAULT_STATE);
  adapter.resolveSessions();
  adapter.resolveCore();
  adapter.resolveQuota();
  await patch;
  await settle();
  const hydrated = runtime.getSnapshot().resources.appState;
  equal(hydrated.status, 'ready', 'durable state hydration settles');
  equal(hydrated.data.theme, 'dark', 'durable theme replaces cached first-paint theme');
  equal(hydrated.data.view, 'metrics', 'durable view replaces cached first-paint view');
  equal(hydrated.data.navPinned, true, 'durable left rail replaces cached first-paint state');
  equal(hydrated.data.rightRailOpen, false, 'pre-hydration user patch survives reconciliation');
  equal(changes.at(-1)?.theme, 'dark', 'durable reconciliation refreshes the shell mirror');

  adapter.emitState({
    ...DEFAULT_STATE,
    theme: 'system',
    view: 'sessions',
    navPinned: false,
    rightRailOpen: true,
  });
  equal(runtime.getSnapshot().resources.appState.data.theme, 'system', 'external durable state applies');
  equal(changes.at(-1)?.view, 'sessions', 'external durable state refreshes the shell mirror');
  equal(changes.at(-1)?.navPinned, false, 'external left rail state mirrors synchronously');
  equal(changes.at(-1)?.rightRailOpen, true, 'external right rail state mirrors synchronously');
  release();

  const failedAdapter = new FakeAdapter();
  const failedRuntime = createHumanctlRuntime(failedAdapter, {
    clock: new FakeClock(),
    initialShellState: {
      theme: 'light',
      view: 'settings',
      navPinned: false,
      rightRailOpen: true,
    },
  });
  const releaseFailed = failedRuntime.start();
  await settle();
  equal(failedAdapter.calls.state, 1, 'failed durable hydration test has a pending state read');
  failedAdapter.resolveStateResult({ ok: false, error: 'durable state unavailable' });
  failedAdapter.resolveSessions();
  failedAdapter.resolveCore();
  failedAdapter.resolveQuota();
  await settle();
  const failedHydration = failedRuntime.getSnapshot().resources.appState;
  equal(failedHydration.status, 'error', 'failed durable hydration reports an error');
  equal(failedHydration.data.theme, 'light', 'failed durable hydration preserves cached theme');
  equal(failedHydration.data.view, 'settings', 'failed durable hydration preserves cached view');
  equal(failedHydration.data.navPinned, false, 'failed durable hydration preserves cached left rail');
  equal(failedHydration.data.rightRailOpen, true, 'failed durable hydration preserves cached right rail');
  releaseFailed();

  const throwingCallbackRuntime = createHumanctlRuntime(new FakeAdapter(), {
    onShellStateChanged: () => { throw new Error('cache unavailable'); },
  });
  const outcome = await throwingCallbackRuntime.dispatch({
    type: 'app.patch',
    patch: { navPinned: false },
  });
  assert(outcome.ok, 'a failed shell mirror cannot fail durable runtime dispatch');
}

async function testQuotaCoalescing(): Promise<void> {
  const adapter = new FakeAdapter();
  adapter.resolveState();
  adapter.resolveSessions();
  adapter.resolveCore();
  const runtime = createHumanctlRuntime(adapter, { clock: new FakeClock() });
  const committedQuotaTimestamps: number[] = [];
  runtime.subscribe(() => {
    const at = runtime.getSnapshot().resources.quota.data?.at;
    if (at !== undefined) committedQuotaTimestamps.push(at);
  });
  const release = runtime.start();
  await settle();
  equal(adapter.calls.quota, 1, 'cold fleet pass starts one quota read');

  const refreshA = await runtime.dispatch({ type: 'fleet.refresh' });
  const refreshB = await runtime.dispatch({ type: 'fleet.refresh' });
  assert(refreshA.ok && refreshB.ok, 'overlapping quota refresh triggers complete their core passes');
  equal(adapter.calls.quota, 1, 'quota triggers coalesce behind the in-flight read');

  const stale: QuotaResult = {
    ok: true,
    quota: { at: 100, windows: [{ label: 'stale', used_percent: 90 }] },
  };
  const newest: QuotaResult = {
    ok: true,
    quota: { at: 200, windows: [{ label: 'newest', used_percent: 20 }] },
  };
  adapter.resolveQuota(stale);
  adapter.quotaResult = newest;
  await settle();

  equal(adapter.calls.quota, 2, 'coalesced triggers produce exactly one trailing quota read');
  equal(runtime.getSnapshot().resources.quota.data?.at, 200, 'newest quota generation wins');
  assert(!committedQuotaTimestamps.includes(100), 'superseded quota generation never commits stale data');
  release();
}

async function testTimelineCap(): Promise<void> {
  const adapter = new FakeAdapter();
  adapter.resolveState();
  adapter.resolveSessions();
  adapter.resolveCore();
  adapter.resolveQuota();
  const currentEvents = Array.from({ length: 590 }, (_, index) => ({
    k: 'assistant' as const,
    t: `current-${index}`,
    ts: index,
  }));
  const olderEvents = Array.from({ length: 25 }, (_, index) => ({
    k: 'user' as const,
    t: `older-${index}`,
    ts: index - 25,
  }));
  const timelineReads: Array<number | undefined> = [];
  adapter.readTimeline = async (arg) => {
    timelineReads.push(arg.before);
    const older = typeof arg.before === 'number';
    return {
      ok: true,
      page: {
        harness: 'codex',
        events: clone(older ? olderEvents : currentEvents),
        start: older ? 0 : 10,
        end: older ? 10 : 100,
        size: 100,
        mtimeMs: 1,
        atStart: older,
        scannedBytes: 10,
        estEarlier: older ? 0 : 25,
        meta: null,
      },
    };
  };

  const runtime = createHumanctlRuntime(adapter, { clock: new FakeClock() });
  const release = runtime.start();
  await settle();
  const opened = await runtime.dispatch({ type: 'timeline.open', session: ROW });
  assert(opened.ok, 'large timeline fixture opens');
  equal(runtime.getSnapshot().resources.timeline.data?.items.length, 590, 'initial timeline stays below cap');

  const appended = Array.from({ length: 25 }, (_, index) => ({
    k: 'assistant' as const,
    t: `append-${index}`,
    ts: 600 + index,
  }));
  adapter.emitAppend({ path: ROW.path || '', events: appended, end: 125, size: 125 });
  let timeline = runtime.getSnapshot().resources.timeline.data;
  equal(timeline?.items.length, 600, 'append merge enforces the 600-event cap');
  equal(timelineText(timeline?.items[0]?.event), 'current-15', 'append cap drops the oldest mounted event');
  equal(timelineText(timeline?.items[599]?.event), 'append-24', 'append cap preserves the live tail');
  equal(timeline?.capped, true, 'append cap marks the timeline capped');
  equal(timeline?.atStart, false, 'capped append cannot claim transcript start');
  equal(timeline?.estEarlier, null, 'capped append clears the stale earlier estimate');

  const resetAfterAppend = await runtime.dispatch({ type: 'timeline.loadOlder' });
  assert(resetAfterAppend.ok, 'load older after append cap resets from live end');
  timeline = runtime.getSnapshot().resources.timeline.data;
  equal(timeline?.items.length, 590, 'cap reset restores the bounded live-end page');
  equal(timeline?.capped, false, 'cap reset clears capped state');
  equal(timeline?.changeKind, 'reset', 'cap reset announces reset change semantics');
  equal(timelineReads[1], undefined, 'cap reset rereads the live page instead of paging backward');

  const prepended = await runtime.dispatch({ type: 'timeline.loadOlder' });
  assert(prepended.ok, 'older timeline page loads after reset');
  timeline = runtime.getSnapshot().resources.timeline.data;
  equal(timeline?.items.length, 600, 'prepend merge enforces the 600-event cap');
  equal(timelineText(timeline?.items[0]?.event), 'older-15', 'prepend cap drops the oldest mounted event');
  equal(timelineText(timeline?.items[599]?.event), 'current-589', 'prepend cap preserves the live tail');
  equal(timeline?.capped, true, 'prepend cap marks the timeline capped');
  equal(timeline?.atStart, false, 'capped prepend cannot claim transcript start');
  equal(timeline?.estEarlier, null, 'capped prepend clears the stale earlier estimate');
  equal(timelineReads[2], 10, 'uncapped load older reads before the current start cursor');

  const resetAfterPrepend = await runtime.dispatch({ type: 'timeline.loadOlder' });
  assert(resetAfterPrepend.ok, 'load older after prepend cap resets from live end');
  equal(runtime.getSnapshot().resources.timeline.data?.changeKind, 'reset', 'prepend cap preserves reset semantics');
  equal(timelineReads[3], undefined, 'prepend cap reset rereads the live page');
  release();
}

await run();
