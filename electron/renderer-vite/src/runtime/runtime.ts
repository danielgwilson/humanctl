import type { BridgeResult, HumanctlAdapter } from './adapter';
import {
  DEFAULT_APP_STATE,
  type AppState,
  type AtlasExchange,
  type DispatchOutcome,
  type InboxThread,
  type IntentResult,
  type KeyedTimelineEvent,
  type Resource,
  type RuntimeDispatch,
  type RuntimeIntent,
  type RuntimeModel,
  type RuntimeResources,
  type SessionAppendPayload,
  type SessionRow,
  type TimelineEvent,
  type TimelineModel,
} from './contracts';

export const FLEET_POLL_MS = 20_000;
const TIMELINE_EVENT_CAP = 600;

export interface RuntimeClock {
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const defaultClock: RuntimeClock = {
  now: () => Date.now(),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as number),
};

export interface RuntimeOptions {
  clock?: RuntimeClock;
}

type ResourceKey = keyof RuntimeResources;

function resource<T>(data: T, status: Resource<T>['status'] = 'idle'): Resource<T> {
  return { status, data, error: null, updatedAt: null };
}

function cloneDefaultState(): AppState {
  return {
    ...DEFAULT_APP_STATE,
    pins: [...DEFAULT_APP_STATE.pins],
    lastReadTs: { ...(DEFAULT_APP_STATE.lastReadTs || {}) },
  };
}

function initialModel(mode: HumanctlAdapter['mode']): RuntimeModel {
  return {
    mode,
    resources: {
      appState: resource(cloneDefaultState(), 'loading'),
      status: resource(null, 'loading'),
      sessions: resource<ReadonlyArray<SessionRow>>([], 'loading'),
      notes: resource([], 'loading'),
      inbox: resource<ReadonlyArray<InboxThread>>([], 'loading'),
      quota: resource(null, 'loading'),
      skills: resource(null),
      budget: resource(null),
      timeline: resource(null),
      atlas: resource<ReadonlyArray<AtlasExchange>>([], 'ready'),
    },
    operations: {},
  };
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

function success<T>(value: T): DispatchOutcome<T> {
  return { ok: true, value };
}

function failure<T>(error: string): DispatchOutcome<T> {
  return { ok: false, error };
}

function mergeAppend(
  current: ReadonlyArray<KeyedTimelineEvent>,
  incoming: ReadonlyArray<TimelineEvent>,
  nextKey: () => number,
): KeyedTimelineEvent[] {
  const items = current.slice();
  for (const event of incoming) {
    const last = items[items.length - 1];
    if (event.k === 'tools' && last?.event.k === 'tools') {
      items[items.length - 1] = {
        key: last.key,
        event: {
          k: 'tools',
          n: last.event.n + event.n,
          ts: event.ts ?? last.event.ts,
        },
      };
    } else {
      items.push({ key: nextKey(), event });
    }
  }
  return items;
}

function mergePrepend(
  older: ReadonlyArray<TimelineEvent>,
  current: ReadonlyArray<KeyedTimelineEvent>,
  nextKey: () => number,
): KeyedTimelineEvent[] {
  const prefixEvents = older.slice();
  const currentItems = current.slice();
  const head = currentItems[0];
  const boundary = prefixEvents[prefixEvents.length - 1];
  if (head?.event.k === 'tools' && boundary?.k === 'tools') {
    prefixEvents.pop();
    currentItems[0] = {
      key: head.key,
      event: { k: 'tools', n: boundary.n + head.event.n, ts: head.event.ts },
    };
  }
  return prefixEvents.map((event) => ({ key: nextKey(), event })).concat(currentItems);
}

function capTimelineItems(items: ReadonlyArray<KeyedTimelineEvent>): {
  items: KeyedTimelineEvent[];
  didCap: boolean;
} {
  if (items.length <= TIMELINE_EVENT_CAP) return { items: items.slice(), didCap: false };
  return {
    items: items.slice(items.length - TIMELINE_EVENT_CAP),
    didCap: true,
  };
}

/**
 * Framework-neutral renderer runtime. It is the sole owner of transport,
 * polling, persistence, progressive resource state, and live timeline state.
 */
export class HumanctlRuntime {
  private readonly adapter: HumanctlAdapter;
  private readonly clock: RuntimeClock;
  private snapshot: RuntimeModel;
  private readonly listeners = new Set<() => void>();
  private readonly signatures = new Map<ResourceKey, string>();
  private intervalHandle: unknown = null;
  private unsubs: Array<() => void> = [];
  private started = false;
  private startReferences = 0;
  private epoch = 0;
  private fleetInFlight: Promise<void> | null = null;
  private fleetQueued = false;
  private quotaInFlight: Promise<void> | null = null;
  private quotaQueued = false;
  private quotaGeneration = 0;
  private stateHydrated = false;
  private preHydrationPatch: Partial<AppState> = {};
  private timelineGeneration = 0;
  private timelineKey = 0;
  private changeSequence = 0;
  private atlasSequence = 0;

  constructor(adapter: HumanctlAdapter, options: RuntimeOptions = {}) {
    this.adapter = adapter;
    this.clock = options.clock || defaultClock;
    this.snapshot = initialModel(adapter.mode);
  }

  getSnapshot = (): RuntimeModel => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    this.startReferences += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.startReferences = Math.max(0, this.startReferences - 1);
      if (this.startReferences === 0) this.deactivate();
    };
    if (this.started) return release;
    this.started = true;
    this.epoch += 1;
    const epoch = this.epoch;

    this.unsubs = [
      this.adapter.onSessionsChanged(() => { void this.requestFleetRefresh(); }),
      this.adapter.onInboxFast(() => { void this.requestFleetRefresh(); }),
      this.adapter.onStateChanged((state) => this.applyExternalState(state)),
      this.adapter.onSessionAppend((payload) => this.applyTimelineAppend(payload)),
    ];

    void this.hydrateState(epoch);
    void this.requestFleetRefresh();

    // Declared timer: the runtime's only recurring renderer poll. It refreshes
    // fleet resources every 20 seconds and is cleared by stop(). Quota rides
    // this cadence but settles independently from the core fleet reads.
    this.intervalHandle = this.clock.setInterval(() => {
      void this.requestFleetRefresh();
    }, FLEET_POLL_MS);

    const timeline = this.snapshot.resources.timeline.data;
    if (timeline?.session.path && timeline.end != null) {
      void this.adapter.setHotSession({
        path: timeline.session.path,
        harness: timeline.session.harness,
        from: timeline.end,
      });
    }

    return release;
  }

  stop(): void {
    this.startReferences = 0;
    this.deactivate();
  }

  private deactivate(): void {
    if (!this.started) return;
    this.started = false;
    this.epoch += 1;
    if (this.intervalHandle !== null) {
      this.clock.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.unsubs.forEach((unsubscribe) => unsubscribe());
    this.unsubs = [];
    // An OS-level quota command cannot be cancelled, so invalidate its result
    // and detach it from the next lifecycle. A restarted runtime may begin a
    // fresh read immediately without the old promise clearing the new guard.
    this.quotaGeneration += 1;
    this.quotaQueued = false;
    this.quotaInFlight = null;
    this.timelineGeneration += 1;
    void this.adapter.setHotSession(null);
  }

  readonly dispatch: RuntimeDispatch = (intent) => (
    this.dispatchInternal(intent) as Promise<DispatchOutcome<IntentResult<typeof intent>>>
  );

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private replaceResource<T>(key: ResourceKey, next: Resource<T>): void {
    const current = this.snapshot.resources[key] as Resource<T>;
    if (current === next) return;
    this.snapshot = {
      ...this.snapshot,
      resources: { ...this.snapshot.resources, [key]: next } as RuntimeResources,
    };
    this.emit();
  }

  private beginResource<T>(key: ResourceKey): void {
    const current = this.snapshot.resources[key] as Resource<T>;
    if (current.status === 'ready' || current.status === 'loading') return;
    this.replaceResource(key, { ...current, status: 'loading', error: null });
  }

  /**
   * A successful refresh with identical data is a true no-op: the data,
   * resource, resources object, and top-level model all retain identity.
   */
  private commitResource<T>(key: ResourceKey, data: T): Resource<T> {
    const current = this.snapshot.resources[key] as Resource<T>;
    const signature = stableSerialize(data);
    const sameData = this.signatures.get(key) === signature;
    if (sameData && current.status === 'ready' && current.error === null) return current;
    this.signatures.set(key, signature);
    const next: Resource<T> = {
      status: 'ready',
      data: sameData ? current.data : data,
      error: null,
      updatedAt: sameData ? current.updatedAt : this.clock.now(),
    };
    this.replaceResource(key, next);
    return next;
  }

  private failResource<T>(key: ResourceKey, error: string, data?: T): void {
    const current = this.snapshot.resources[key] as Resource<T>;
    const nextData = data === undefined ? current.data : data;
    if (data !== undefined) this.signatures.set(key, stableSerialize(nextData));
    if (current.error === error && current.data === nextData && current.status !== 'loading') return;
    this.replaceResource(key, {
      status: current.updatedAt !== null || current.status === 'ready' ? 'ready' : 'error',
      data: nextData,
      error,
      updatedAt: current.updatedAt,
    });
  }

  private isCurrent(epoch: number): boolean {
    return this.epoch === epoch;
  }

  private requestFleetRefresh(): Promise<void> {
    if (this.fleetInFlight) {
      this.fleetQueued = true;
      return this.fleetInFlight;
    }
    const run = async () => {
      do {
        this.fleetQueued = false;
        await this.refreshFleetPass(this.epoch);
      } while (this.fleetQueued && this.started);
    };
    this.fleetInFlight = run().finally(() => {
      this.fleetInFlight = null;
    });
    return this.fleetInFlight;
  }

  private async refreshFleetPass(epoch: number): Promise<void> {
    // Quota is intentionally launched but not awaited. A cold account read can
    // take seconds and must never delay sessions, inbox, status, or first paint.
    void this.requestQuotaRefresh();
    await Promise.allSettled([
      this.loadStatus(epoch),
      this.loadSessions(epoch),
      this.loadNotes(epoch),
      this.loadInbox(epoch),
    ]);
  }

  private async loadStatus(epoch: number): Promise<void> {
    this.beginResource('status');
    try {
      const result = await this.adapter.getStatus({ maxAgeH: 72, limit: 40 });
      if (!this.isCurrent(epoch)) return;
      if (result.ok && result.status) this.commitResource('status', result.status);
      else this.failResource('status', result.error || 'status read failed');
    } catch (error) {
      if (this.isCurrent(epoch)) this.failResource('status', errorText(error, 'status read failed'));
    }
  }

  private async loadSessions(epoch: number): Promise<void> {
    this.beginResource('sessions');
    try {
      const result = await this.adapter.listSessions({ maxAgeH: 72, limit: 40, withUsage: true });
      if (!this.isCurrent(epoch)) return;
      if (result.ok && result.rows) this.commitResource<ReadonlyArray<SessionRow>>('sessions', result.rows);
      else this.failResource('sessions', result.error || 'sessions read failed');
    } catch (error) {
      if (this.isCurrent(epoch)) this.failResource('sessions', errorText(error, 'sessions read failed'));
    }
  }

  private async loadNotes(epoch: number): Promise<void> {
    this.beginResource('notes');
    try {
      const result = await this.adapter.getNotes({ limit: 100 });
      if (!this.isCurrent(epoch)) return;
      if (result.ok && result.notes) this.commitResource('notes', result.notes);
      else this.failResource('notes', result.error || 'notes read failed');
    } catch (error) {
      if (this.isCurrent(epoch)) this.failResource('notes', errorText(error, 'notes read failed'));
    }
  }

  private async loadInbox(epoch: number): Promise<void> {
    this.beginResource('inbox');
    try {
      const result = await this.adapter.getInboxThreads({ limit: 200 });
      if (!this.isCurrent(epoch)) return;
      if (result.ok && result.threads) this.commitResource<ReadonlyArray<InboxThread>>('inbox', result.threads);
      else this.failResource('inbox', result.error || 'inbox read failed');
    } catch (error) {
      if (this.isCurrent(epoch)) this.failResource('inbox', errorText(error, 'inbox read failed'));
    }
  }

  private requestQuotaRefresh(): Promise<void> {
    this.quotaGeneration += 1;
    if (this.quotaInFlight) {
      this.quotaQueued = true;
      return this.quotaInFlight;
    }
    const epoch = this.epoch;
    const run = async () => {
      do {
        this.quotaQueued = false;
        const generation = this.quotaGeneration;
        await this.loadQuota(epoch, generation);
      } while (this.quotaQueued && this.started && this.isCurrent(epoch));
    };
    const promise = run();
    this.quotaInFlight = promise;
    const clearIfCurrent = () => {
      if (this.quotaInFlight === promise) this.quotaInFlight = null;
    };
    void promise.then(clearIfCurrent, clearIfCurrent);
    return promise;
  }

  private quotaResultIsCurrent(epoch: number, generation: number): boolean {
    return this.isCurrent(epoch) && this.quotaGeneration === generation;
  }

  private async loadQuota(epoch: number, generation: number): Promise<void> {
    this.beginResource('quota');
    try {
      const result = await this.adapter.getClaudeQuota();
      if (!this.quotaResultIsCurrent(epoch, generation)) return;
      if (result.ok) this.commitResource('quota', result.quota ?? null);
      else this.failResource('quota', result.error || 'quota read failed');
    } catch (error) {
      if (this.quotaResultIsCurrent(epoch, generation)) {
        this.failResource('quota', errorText(error, 'quota read failed'));
      }
    }
  }

  private async hydrateState(epoch: number): Promise<void> {
    try {
      const result = await this.adapter.getState();
      if (!this.isCurrent(epoch)) return;
      const persisted: Partial<AppState> = result.ok && result.state ? result.state : {};
      const state: AppState = {
        ...cloneDefaultState(),
        ...persisted,
        ...this.preHydrationPatch,
        pins: [...(this.preHydrationPatch.pins || persisted.pins || DEFAULT_APP_STATE.pins)],
        lastReadTs: {
          ...(persisted.lastReadTs || {}),
          ...(this.preHydrationPatch.lastReadTs || {}),
        },
      };
      this.stateHydrated = true;
      this.preHydrationPatch = {};
      this.commitResource('appState', state);
      if (!result.ok) this.failResource('appState', result.error || 'app state read failed');
    } catch (error) {
      if (!this.isCurrent(epoch)) return;
      this.stateHydrated = true;
      this.commitResource('appState', this.snapshot.resources.appState.data);
      this.failResource('appState', errorText(error, 'app state read failed'));
    }
  }

  private applyExternalState(state: AppState): void {
    const current = this.snapshot.resources.appState.data;
    this.commitResource('appState', {
      ...current,
      ...state,
      pins: [...(state.pins || current.pins)],
      lastReadTs: { ...(current.lastReadTs || {}), ...(state.lastReadTs || {}) },
    });
  }

  private async patchAppState(patch: Partial<AppState>): Promise<DispatchOutcome<AppState>> {
    if (!this.stateHydrated) this.preHydrationPatch = { ...this.preHydrationPatch, ...patch };
    const current = this.snapshot.resources.appState.data;
    const next: AppState = {
      ...current,
      ...patch,
      pins: patch.pins ? [...patch.pins] : current.pins,
      lastReadTs: patch.lastReadTs ? { ...patch.lastReadTs } : current.lastReadTs,
    };
    this.commitResource('appState', next);
    try {
      const result = await this.adapter.setState(patch);
      return result.ok ? success(next) : failure(result.error || 'app state write failed');
    } catch (error) {
      return failure(errorText(error, 'app state write failed'));
    }
  }

  private setOperation(key: string, status: 'pending' | 'succeeded' | 'failed', error: string | null): void {
    const next = {
      ...this.snapshot.operations,
      [key]: { status, error, updatedAt: this.clock.now() },
    };
    this.snapshot = { ...this.snapshot, operations: next };
    this.emit();
  }

  private async execute<R extends BridgeResult, T>(
    key: string,
    action: () => Promise<R>,
    value: (result: R) => T,
  ): Promise<DispatchOutcome<T>> {
    this.setOperation(key, 'pending', null);
    try {
      const result = await action();
      if (!result.ok) {
        const error = result.error || `${key} failed`;
        this.setOperation(key, 'failed', error);
        return failure(error);
      }
      this.setOperation(key, 'succeeded', null);
      return success(value(result));
    } catch (error) {
      const message = errorText(error, `${key} failed`);
      this.setOperation(key, 'failed', message);
      return failure(message);
    }
  }

  private async loadSkills(): Promise<DispatchOutcome<RuntimeResources['skills']['data']>> {
    this.beginResource('skills');
    return this.execute('metrics.loadSkills', () => this.adapter.aggregateSkills({ maxAgeH: 72, limit: 40 }), (result) => {
      const data = 'agg' in result ? result.agg || null : null;
      this.commitResource('skills', data);
      return data;
    }).then((outcome) => {
      if (!outcome.ok) this.failResource('skills', outcome.error);
      return outcome;
    });
  }

  private async loadBudget(dailyBudgetUSD: number): Promise<DispatchOutcome<RuntimeResources['budget']['data']>> {
    this.beginResource('budget');
    return this.execute('settings.loadBudget', () => this.adapter.getSummaryBudget({ dailyBudgetUSD }), (result) => {
      const data = 'budget' in result ? result.budget || null : null;
      this.commitResource('budget', data);
      return data;
    }).then((outcome) => {
      if (!outcome.ok) this.failResource('budget', outcome.error);
      return outcome;
    });
  }

  private nextTimelineKey = (): number => this.timelineKey++;

  private emptyTimeline(session: SessionRow, kind: TimelineModel['changeKind']): TimelineModel {
    return {
      session: { id: session.id, path: session.path, harness: session.harness },
      items: [], start: null, end: null, size: null, atStart: false, capped: false,
      estEarlier: null, loadingOlder: false, live: false, meta: null,
      changeKind: kind, changeSeq: ++this.changeSequence,
    };
  }

  private async openTimeline(
    session: SessionRow,
    kind: TimelineModel['changeKind'] = 'initial',
  ): Promise<DispatchOutcome<TimelineModel | null>> {
    if (!session.path) return failure('session has no transcript path');
    this.timelineGeneration += 1;
    const generation = this.timelineGeneration;
    this.timelineKey = 0;
    void this.adapter.setHotSession(null);
    const shell = this.emptyTimeline(session, kind);
    this.signatures.set('timeline', stableSerialize(shell));
    this.replaceResource('timeline', { status: 'loading', data: shell, error: null, updatedAt: null });
    try {
      const result = await this.adapter.readTimeline({ id: session.id, path: session.path, harness: session.harness });
      if (generation !== this.timelineGeneration) return failure('timeline load superseded');
      if (!result.ok || !result.page) {
        const error = result.error || 'timeline read failed';
        this.failResource('timeline', error, shell);
        return failure(error);
      }
      const page = result.page;
      const cappedPage = capTimelineItems(
        page.events.map((event) => ({ key: this.nextTimelineKey(), event })),
      );
      let model: TimelineModel = {
        ...shell,
        items: cappedPage.items,
        start: page.start,
        end: page.end,
        size: page.size,
        atStart: cappedPage.didCap ? false : page.atStart,
        capped: cappedPage.didCap,
        estEarlier: cappedPage.didCap ? null : page.estEarlier,
        meta: page.meta,
        changeSeq: ++this.changeSequence,
      };
      this.commitResource('timeline', model);
      const hot = await this.adapter.setHotSession({ path: session.path, harness: session.harness, from: page.end });
      if (generation !== this.timelineGeneration) return failure('timeline load superseded');
      model = { ...model, live: hot.ok };
      this.commitResource('timeline', model);
      if (!hot.ok) this.failResource('timeline', hot.error || 'live timeline unavailable', model);
      return success(model);
    } catch (error) {
      const message = errorText(error, 'timeline read failed');
      if (generation === this.timelineGeneration) this.failResource('timeline', message, shell);
      return failure(message);
    }
  }

  private closeTimeline(): void {
    this.timelineGeneration += 1;
    void this.adapter.setHotSession(null);
    this.signatures.delete('timeline');
    this.replaceResource('timeline', resource(null));
  }

  private applyTimelineAppend(payload: SessionAppendPayload): void {
    const currentResource = this.snapshot.resources.timeline;
    const current = currentResource.data;
    if (!current?.session.path || payload.path !== current.session.path) return;
    if ('reset' in payload && payload.reset) {
      const row = this.snapshot.resources.sessions.data.find((session) => session.id === current.session.id) || {
        id: current.session.id,
        path: current.session.path,
        harness: current.session.harness,
        state: 'idle' as const,
        tier: 'hot' as const,
        ageMs: this.clock.now(),
      };
      void this.openTimeline(row, 'reset');
      return;
    }
    if (!('events' in payload)) return;
    const merged = capTimelineItems(mergeAppend(current.items, payload.events, this.nextTimelineKey));
    const capped = current.capped || merged.didCap;
    this.commitResource('timeline', {
      ...current,
      items: merged.items,
      capped,
      atStart: capped ? false : current.atStart,
      estEarlier: capped ? null : current.estEarlier,
      end: payload.end ?? current.end,
      size: payload.size ?? current.size,
      meta: payload.meta === undefined ? current.meta : payload.meta,
      live: true,
      changeKind: 'append',
      changeSeq: ++this.changeSequence,
    });
    if (payload.need) this.applySessionNeed(payload.path, payload.need);
  }

  private applySessionNeed(
    path: string,
    need: NonNullable<Exclude<SessionAppendPayload, { reset: true }>['need']>,
  ): void {
    const current = this.snapshot.resources.sessions.data;
    let changed = false;
    const next = current.map((session) => {
      if (session.path !== path) return session;
      const updated = {
        ...session,
        state: need.state ?? session.state,
        stateReason: need.reason ?? session.stateReason,
        tier: need.tier ?? session.tier,
      };
      changed = stableSerialize(updated) !== stableSerialize(session);
      return changed ? updated : session;
    });
    if (changed) this.commitResource<ReadonlyArray<SessionRow>>('sessions', next);
  }

  private async loadOlderTimeline(): Promise<DispatchOutcome<TimelineModel | null>> {
    const current = this.snapshot.resources.timeline.data;
    if (!current?.session.path) return failure('no timeline is open');
    if (current.loadingOlder) return success(current);
    if (current.atStart) return success(current);
    if (current.capped || current.start === null) {
      const row = this.snapshot.resources.sessions.data.find((session) => session.id === current.session.id);
      if (!row) return failure('open session is no longer in the fleet');
      return this.openTimeline(row, 'reset');
    }
    const generation = this.timelineGeneration;
    this.commitResource('timeline', { ...current, loadingOlder: true });
    try {
      const result = await this.adapter.readTimeline({
        id: current.session.id,
        path: current.session.path,
        harness: current.session.harness,
        before: current.start,
      });
      if (generation !== this.timelineGeneration) return failure('timeline page superseded');
      if (!result.ok || !result.page) {
        const error = result.error || 'older timeline read failed';
        const settled = { ...current, loadingOlder: false };
        this.failResource('timeline', error, settled);
        return failure(error);
      }
      const page = result.page;
      const latest = this.snapshot.resources.timeline.data || current;
      const merged = capTimelineItems(mergePrepend(page.events, latest.items, this.nextTimelineKey));
      const capped = latest.capped || merged.didCap;
      const next: TimelineModel = {
        ...latest,
        items: merged.items,
        start: page.start,
        atStart: capped ? false : page.atStart,
        capped,
        estEarlier: capped ? null : page.estEarlier,
        loadingOlder: false,
        changeKind: 'prepend',
        changeSeq: ++this.changeSequence,
      };
      this.commitResource('timeline', next);
      return success(next);
    } catch (error) {
      const message = errorText(error, 'older timeline read failed');
      const latest = this.snapshot.resources.timeline.data;
      if (generation === this.timelineGeneration && latest) {
        this.failResource('timeline', message, { ...latest, loadingOlder: false });
      }
      return failure(message);
    }
  }

  private async dispatchInternal(intent: RuntimeIntent): Promise<DispatchOutcome<unknown>> {
    switch (intent.type) {
      case 'fleet.refresh':
        await this.requestFleetRefresh();
        return success(undefined);
      case 'app.patch':
        return this.patchAppState(intent.patch);
      case 'session.togglePin': {
        const pins = new Set(this.snapshot.resources.appState.data.pins);
        if (pins.has(intent.id)) pins.delete(intent.id); else pins.add(intent.id);
        return this.patchAppState({ pins: [...pins] });
      }
      case 'thread.markRead': {
        const thread = this.snapshot.resources.inbox.data.find((item) => item.sessionId === intent.threadId);
        const newest = thread?.items[thread.items.length - 1];
        const at = intent.at ?? ((newest ? Date.parse(newest.ts) : 0) || this.clock.now());
        const lastReadTs = { ...(this.snapshot.resources.appState.data.lastReadTs || {}), [intent.threadId]: at };
        const [stateResult, readResult] = await Promise.all([
          this.patchAppState({ lastReadTs }),
          this.adapter.markThreadRead({ threadId: intent.threadId, at }),
        ]);
        if (!stateResult.ok) return stateResult;
        return readResult.ok ? stateResult : failure(readResult.error || 'mark read failed');
      }
      case 'threads.markAllRead': {
        const at = intent.at ?? this.clock.now();
        const lastReadTs = { ...(this.snapshot.resources.appState.data.lastReadTs || {}) };
        this.snapshot.resources.inbox.data.forEach((thread) => { lastReadTs[thread.sessionId] = at; });
        const [stateResult, readResult] = await Promise.all([
          this.patchAppState({ lastReadTs }),
          this.adapter.markAllThreadsRead(),
        ]);
        if (!stateResult.ok) return stateResult;
        return readResult.ok ? stateResult : failure(readResult.error || 'mark all read failed');
      }
      case 'metrics.loadSkills':
        return this.loadSkills();
      case 'settings.loadBudget':
        return this.loadBudget(intent.dailyBudgetUSD);
      case 'atlas.ask': {
        const question = intent.question.trim();
        if (!question) return failure('question is required');
        return this.execute('atlas.ask', () => this.adapter.askAtlas({ question, engine: intent.engine }), (result) => {
          const answer = 'answer' in result && result.answer ? result.answer : '';
          const engine = 'engine' in result ? result.engine : undefined;
          const exchange: AtlasExchange = {
            id: ++this.atlasSequence,
            question,
            answer,
            engine,
            at: this.clock.now(),
          };
          this.commitResource<ReadonlyArray<AtlasExchange>>('atlas', [...this.snapshot.resources.atlas.data, exchange]);
          return { answer, engine };
        });
      }
      case 'session.ask': {
        const question = intent.question.trim();
        if (!question) return failure('question is required');
        const session = intent.session;
        return this.execute(`session.ask:${session.id}`, () => this.adapter.askSession({
          id: session.id,
          path: session.path,
          harness: session.harness,
          cwd: session.cwd,
          question,
        }), (result) => ({
          answer: 'answer' in result && result.answer ? result.answer : '',
          engine: 'engine' in result ? result.engine : undefined,
        }));
      }
      case 'ask.answer': {
        const text = intent.text.trim();
        if (!text) return failure('answer is required');
        const session = intent.session;
        return this.execute(`ask.answer:${session.id}`, () => this.adapter.answerAsk({
          id: session.id,
          harness: session.harness,
          path: session.path,
          cwd: session.cwd,
          text,
          askId: intent.askId,
        }), (result) => result);
      }
      case 'session.summarize': {
        const session = intent.session;
        const engine = this.snapshot.resources.appState.data.summarizer;
        return this.execute(`session.summarize:${session.id}`, () => this.adapter.summarize({
          id: session.id,
          path: session.path,
          harness: session.harness,
          engine,
        }), (result) => ({
          summary: 'summary' in result && result.summary ? result.summary : '',
          engine: 'engine' in result ? result.engine : undefined,
        }));
      }
      case 'session.resume': {
        const session = intent.session;
        const action = session.harness === 'codex'
          ? () => this.adapter.openInApp({ id: session.id, path: session.path, harness: session.harness })
          : () => this.adapter.resumeSession({ id: session.id, path: session.path, harness: session.harness, cwd: session.cwd });
        return this.execute(`session.resume:${session.id}`, action, () => undefined);
      }
      case 'session.reveal':
        return this.execute('session.reveal', () => this.adapter.revealSession(intent.path), () => undefined);
      case 'app.openExternal':
        return this.execute('app.openExternal', () => this.adapter.openExternal(intent.url), () => undefined);
      case 'app.openPath':
        return this.execute('app.openPath', () => this.adapter.openPath(intent.path), () => undefined);
      case 'timeline.open':
        return this.openTimeline(intent.session);
      case 'timeline.close':
        this.closeTimeline();
        return success(undefined);
      case 'timeline.loadOlder':
        return this.loadOlderTimeline();
      default: {
        const unreachable: never = intent;
        return failure(`unknown runtime intent: ${String(unreachable)}`);
      }
    }
  }
}

export function createHumanctlRuntime(adapter: HumanctlAdapter, options?: RuntimeOptions): HumanctlRuntime {
  return new HumanctlRuntime(adapter, options);
}
