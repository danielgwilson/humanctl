import type { HumanctlAdapter } from './adapter';
import { FIXTURE_BRAIN_VARIANTS, type FixtureBrainVariant } from './brain-fixture';
import { createFixtureAdapter, type FixtureAdapterOptions } from './fixture-adapter';

type DesktopBridge = Omit<HumanctlAdapter, 'mode'>;
type DesktopWindow = Window & { humanctl?: DesktopBridge };

/** The only renderer module allowed to read the preload global. */
export function createEnvironmentAdapter(): HumanctlAdapter {
  if (typeof window === 'undefined') return createFixtureAdapter();
  const bridge = (window as DesktopWindow).humanctl;
  return bridge ? createDesktopAdapter(bridge) : createFixtureAdapter(fixtureOptionsFromLocation());
}

// Browser fixture mode only: `?brain=<variant>` (for example `?brain=stale`)
// serves that Brain fixture snapshot so each freshness path is reviewable in
// the dev loop and in screenshots. The desktop build always has the bridge and
// never reaches this.
function fixtureOptionsFromLocation(): FixtureAdapterOptions {
  try {
    const brain = new URLSearchParams(window.location.search).get('brain') as FixtureBrainVariant | null;
    return brain && FIXTURE_BRAIN_VARIANTS.includes(brain) ? { brain } : {};
  } catch {
    return {};
  }
}

export function createDesktopAdapter(bridge: DesktopBridge): HumanctlAdapter {
  return {
    mode: 'desktop',
    getStatus: (opts) => bridge.getStatus(opts),
    listSessions: (opts) => bridge.listSessions(opts),
    getNotes: (opts) => bridge.getNotes(opts),
    getInboxThreads: (opts) => bridge.getInboxThreads(opts),
    getClaudeQuota: () => bridge.getClaudeQuota(),
    getState: () => bridge.getState(),
    setState: (patch) => bridge.setState(patch),
    markThreadRead: (arg) => bridge.markThreadRead(arg),
    markAllThreadsRead: () => bridge.markAllThreadsRead(),
    aggregateSkills: (opts) => bridge.aggregateSkills(opts),
    getBrain: (arg) => bridge.getBrain(arg),
    getSummaryBudget: (opts) => bridge.getSummaryBudget(opts),
    askAtlas: (arg) => bridge.askAtlas(arg),
    askSession: (arg) => bridge.askSession(arg),
    answerAsk: (arg) => bridge.answerAsk(arg),
    summarize: (arg) => bridge.summarize(arg),
    resumeSession: (arg) => bridge.resumeSession(arg),
    openInApp: (arg) => bridge.openInApp(arg),
    revealSession: (path) => bridge.revealSession(path),
    openExternal: (url) => bridge.openExternal(url),
    openPath: (path) => bridge.openPath(path),
    readTimeline: (arg) => bridge.readTimeline(arg),
    setHotSession: (arg) => bridge.setHotSession(arg),
    onSessionsChanged: (cb) => bridge.onSessionsChanged(cb),
    onInboxFast: (cb) => bridge.onInboxFast(cb),
    onStateChanged: (cb) => bridge.onStateChanged(cb),
    onSessionAppend: (cb) => bridge.onSessionAppend(cb),
  };
}
