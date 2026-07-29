import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { RuntimeDispatch, RuntimeModel, RuntimeResources } from './contracts';
import { createEnvironmentAdapter } from './desktop-adapter';
import { createHumanctlRuntime, type HumanctlRuntime } from './runtime';
import {
  getBrowserShellStateStorage,
  readShellStateCache,
  writeShellStateCache,
} from './shell-state-cache';

let defaultRuntime: HumanctlRuntime | null = null;

export function getDefaultRuntime(): HumanctlRuntime {
  if (!defaultRuntime) {
    const storage = getBrowserShellStateStorage();
    defaultRuntime = createHumanctlRuntime(createEnvironmentAdapter(), {
      initialShellState: readShellStateCache(storage),
      onShellStateChanged: (state) => writeShellStateCache(storage, state),
    });
  }
  return defaultRuntime;
}
export interface RuntimeBinding {
  model: RuntimeModel;
  dispatch: RuntimeDispatch;
  runtime: HumanctlRuntime;
}

/** Root viewport binding: one model in, typed intents out. */
export function useHumanctlRuntime(runtime = getDefaultRuntime()): RuntimeBinding {
  useEffect(() => runtime.start(), [runtime]);
  const model = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return useMemo(() => ({ model, dispatch: runtime.dispatch, runtime }), [model, runtime]);
}

/**
 * Narrow subscription for deep viewport sections. An unchanged resource keeps
 * object identity, so unrelated resource updates do not re-render the caller.
 */
export function useRuntimeResource<K extends keyof RuntimeResources>(
  key: K,
  runtime = getDefaultRuntime(),
): RuntimeResources[K] {
  useEffect(() => runtime.start(), [runtime]);
  return useSyncExternalStore(
    runtime.subscribe,
    () => runtime.getSnapshot().resources[key],
    () => runtime.getSnapshot().resources[key],
  );
}
