import type { AppState, Theme, ViewName } from './contracts';

export const SHELL_STATE_CACHE_KEY = 'humanctl:shell-state:v1';
const SHELL_STATE_CACHE_VERSION = 1;

export type ShellAppState = Pick<
  AppState,
  'theme' | 'view' | 'navPinned' | 'rightRailOpen'
>;

export interface ShellStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ShellStateCacheEnvelope {
  version: typeof SHELL_STATE_CACHE_VERSION;
  state: ShellAppState;
}

const THEMES = new Set<Theme>(['system', 'light', 'dark']);
const VIEWS = new Set<ViewName>(['inbox', 'metrics', 'fleet', 'sessions', 'settings']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getBrowserShellStateStorage(): ShellStateStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readShellStateCache(
  storage: ShellStateStorage | null,
): Partial<ShellAppState> | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(SHELL_STATE_CACHE_KEY);
    if (!raw) return undefined;
    const envelope: unknown = JSON.parse(raw);
    if (
      !isRecord(envelope)
      || envelope.version !== SHELL_STATE_CACHE_VERSION
      || !isRecord(envelope.state)
    ) return undefined;

    const state: Partial<ShellAppState> = {};
    if (typeof envelope.state.theme === 'string' && THEMES.has(envelope.state.theme as Theme)) {
      state.theme = envelope.state.theme as Theme;
    }
    if (typeof envelope.state.view === 'string' && VIEWS.has(envelope.state.view as ViewName)) {
      state.view = envelope.state.view as ViewName;
    }
    if (typeof envelope.state.navPinned === 'boolean') state.navPinned = envelope.state.navPinned;
    if (typeof envelope.state.rightRailOpen === 'boolean') {
      state.rightRailOpen = envelope.state.rightRailOpen;
    }
    return Object.keys(state).length ? state : undefined;
  } catch {
    return undefined;
  }
}

export function pickShellState(state: AppState): ShellAppState {
  return {
    theme: state.theme,
    view: state.view,
    navPinned: state.navPinned,
    rightRailOpen: state.rightRailOpen,
  };
}

export function writeShellStateCache(
  storage: ShellStateStorage | null,
  state: ShellAppState,
): void {
  if (!storage) return;
  const envelope: ShellStateCacheEnvelope = {
    version: SHELL_STATE_CACHE_VERSION,
    state,
  };
  try {
    storage.setItem(SHELL_STATE_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // The mirror is best-effort. Durable app.state remains authoritative.
  }
}
