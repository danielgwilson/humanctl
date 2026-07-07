// Live session timeline (stage 3): a bounded backward page on open, upward
// paging on scroll/click, and event-driven live appends for the ONE hot
// session -- ported from electron/renderer/renderer.js's tlState /
// ensureTimeline / loadOlderTimeline / onSessionAppend (deleted in the React
// cutover, recovered via `git show b7fc208~1:electron/renderer/renderer.js`
// for this port). Two deliberate departures from that reference, per the
// stage-3 brief: events render oldest-at-top/newest-at-bottom (sticky
// bottom) rather than the old newest-at-top list, and there is no 1s
// "updated Xs ago" ticker (a recurring timer that fires forever at idle is
// exactly what DESIGN.md's perf SLO -- "zero self-triggered refresh at
// idle" -- forbids; each row's own relative timestamp is computed at render
// time instead, the same static-agoTxt pattern session-detail.tsx already
// uses for notes/asks/answers).
//
// This hook owns ALL of its state and subscribes to onSessionAppend itself.
// It is never lifted into App or session-detail's own state: a live append
// must re-render only whatever consumes this hook (SessionTimeline), never
// the header, the composer, or the rest of the app.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionRow, SessionAppendPayload, TimelineEvent, TimelinePage } from '@/lib/types';
import { fixtureAppendEvents, fixtureOlderTimelinePage, fixtureTimelinePage } from '@/lib/fixtures';

// Client-side display cap (mirrors the reference's TL_EVENTS_CAP): bounds
// the array/DOM for a long-lived hot session. Trimmed from the front
// (oldest) only, and only ever on a live append.
const TL_EVENTS_CAP = 600;

// Fixture-only, ONE-SHOT demo appends -- two setTimeouts, never an interval,
// never scheduled when window.humanctl exists (i.e. never in the real app).
// Exists purely so the sticky-bottom behavior is drivable in a plain
// browser with no Electron bridge attached. Both timers are cleared on
// unmount / session change and neither re-arms itself.
const FIXTURE_APPEND_DELAYS_MS = [1600, 3400];

export interface KeyedTimelineEvent {
  key: number;
  event: TimelineEvent;
}

export type TimelineChangeKind = 'initial' | 'append' | 'prepend' | 'reset';

interface TimelineState {
  items: KeyedTimelineEvent[];
  start: number | null;
  atStart: boolean;
  capped: boolean;
  estEarlier: number | null;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  live: boolean;
  changeKind: TimelineChangeKind;
  changeSeq: number;
}

function initialTimelineState(): TimelineState {
  return {
    items: [], start: null, atStart: false, capped: false, estEarlier: null,
    loading: true, loadingOlder: false, error: null, live: false,
    changeKind: 'initial', changeSeq: 0,
  };
}

// Collapse a run of 'tools' events that straddles a page/append boundary,
// exactly mirroring lib/sessions.ts's tlFinalize (which only collapses
// WITHIN one parse batch, never across the boundary between two separately
// read batches). Appending at the tail: keep the existing node's key,
// add the incoming count, adopt the incoming (newer) ts.
function mergeAppendEvents(items: KeyedTimelineEvent[], incoming: TimelineEvent[], nextKey: () => number): KeyedTimelineEvent[] {
  const out = items.slice();
  for (const e of incoming) {
    const last = out[out.length - 1];
    if (e.k === 'tools' && last && last.event.k === 'tools') {
      out[out.length - 1] = { key: last.key, event: { k: 'tools', n: last.event.n + e.n, ts: e.ts != null ? e.ts : last.event.ts } };
    } else {
      out.push({ key: nextKey(), event: e });
    }
  }
  return out;
}

// Prepending an older page at the head: the older batch's LAST event and the
// current array's FIRST event are the boundary pair. If both are 'tools',
// fold the older count into the current head (keeping the current head's
// key + ts, matching the reference) and drop the older batch's boundary
// entry before prefixing the rest.
function mergePrependEvents(older: TimelineEvent[], items: KeyedTimelineEvent[], nextKey: () => number): KeyedTimelineEvent[] {
  const olderRest = older.slice();
  const head = items[0];
  let nextItems = items;
  if (olderRest.length && head && head.event.k === 'tools') {
    const boundary = olderRest[olderRest.length - 1];
    if (boundary.k === 'tools') {
      olderRest.pop();
      nextItems = items.slice();
      nextItems[0] = { key: head.key, event: { k: 'tools', n: head.event.n + boundary.n, ts: head.event.ts } };
    }
  }
  const prefix = olderRest.map((e) => ({ key: nextKey(), event: e }));
  return prefix.concat(nextItems);
}

export interface TimelineHook {
  items: KeyedTimelineEvent[];
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  atStart: boolean;
  capped: boolean;
  estEarlier: number | null;
  live: boolean;
  /** Bumps (kind + seq) on every state transition that changes `items`, so the
   * component can pick the right scroll strategy without diffing arrays. */
  changeKind: TimelineChangeKind;
  changeSeq: number;
  loadOlder: () => void;
}

export function useTimeline(row: SessionRow | null): TimelineHook {
  const [state, setState] = useState<TimelineState>(initialTimelineState);
  const keyRef = useRef(0);
  const nextKey = useCallback(() => keyRef.current++, []);
  // Bumped on every session switch / explicit reload so a stale in-flight
  // response (from a session we've since navigated away from) never lands.
  const genRef = useRef(0);
  // Always-fresh row, read from async callbacks without churning effect deps
  // on every 20s fleet-poll re-fetch (useFleetData hands back a brand new
  // SessionRow object each poll even when nothing about this session changed).
  const rowRef = useRef(row);
  rowRef.current = row;

  const path = row?.path || null;
  const harness = row?.harness;

  const loadInitial = useCallback((myGen: number, targetPath: string, targetHarness?: string) => {
    const finish = (page: TimelinePage | null, err?: string) => {
      if (genRef.current !== myGen) return; // superseded by a newer load
      if (!page) {
        setState((s) => ({ ...s, loading: false, error: err || 'could not read this session.' }));
        return;
      }
      const items = page.events.map((event) => ({ key: nextKey(), event }));
      setState({
        items, start: page.start, atStart: page.atStart, capped: false,
        estEarlier: page.estEarlier, loading: false, loadingOlder: false,
        error: null, live: false, changeKind: 'initial', changeSeq: Date.now(),
      });
    };
    if (!window.humanctl) {
      setTimeout(() => {
        if (genRef.current !== myGen || !rowRef.current) return;
        finish(fixtureTimelinePage(rowRef.current));
        setState((s) => (genRef.current === myGen ? { ...s, live: true } : s));
      }, 0);
      return;
    }
    window.humanctl.readTimeline({ path: targetPath, harness: targetHarness })
      .then((r) => {
        if (genRef.current !== myGen) return;
        finish(r && r.ok ? r.page || null : null, r && !r.ok ? r.error : undefined);
        if (r && r.ok && r.page) {
          window.humanctl!.setHotSession({ path: targetPath, harness: targetHarness, from: r.page.end });
          setState((s) => (genRef.current === myGen ? { ...s, live: true } : s));
        }
      })
      .catch((e) => finish(null, String((e && e.message) || e)));
  }, [nextKey]);

  // (Re)load whenever the session identity changes. Keyed on path/harness
  // (primitives) rather than the `row` object, so the 20s fleet poll never
  // retriggers a reload of an already-open, unchanged timeline.
  useEffect(() => {
    genRef.current += 1;
    const myGen = genRef.current;
    keyRef.current = 0;
    if (!path) {
      setState({ ...initialTimelineState(), loading: false });
      return;
    }
    setState(initialTimelineState());
    loadInitial(myGen, path, harness);
    return () => {
      genRef.current += 1; // invalidate anything still in flight for this session
      window.humanctl?.setHotSession(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, harness]);

  // Fixture-only simulated live appends -- see FIXTURE_APPEND_DELAYS_MS.
  useEffect(() => {
    if (window.humanctl || !path) return;
    const myGen = genRef.current;
    const timers = FIXTURE_APPEND_DELAYS_MS.map((delay, i) => setTimeout(() => {
      if (genRef.current !== myGen || !rowRef.current) return;
      const incoming = fixtureAppendEvents(rowRef.current, i);
      setState((s) => {
        if (s.loading) return s;
        const items = mergeAppendEvents(s.items, incoming, nextKey);
        return { ...s, items, live: true, changeKind: 'append', changeSeq: Date.now() };
      });
    }, delay));
    return () => { timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Live appends from the real bridge, subscribed once per session identity.
  useEffect(() => {
    if (!window.humanctl || !path) return;
    const myGen = genRef.current;
    const off = window.humanctl.onSessionAppend((payload: SessionAppendPayload) => {
      if (genRef.current !== myGen || payload.path !== path) return;
      if ('reset' in payload && payload.reset) {
        // Rotation / truncation / oversized gap: never splice across a
        // rewrite, re-read a full page instead (same path a fresh open takes).
        genRef.current += 1;
        const nextGen = genRef.current;
        keyRef.current = 0;
        setState(initialTimelineState());
        loadInitial(nextGen, path, harness);
        return;
      }
      if (!('events' in payload)) return;
      setState((s) => {
        if (s.loading) return s;
        let items = mergeAppendEvents(s.items, payload.events, nextKey);
        let capped = s.capped;
        let atStart = s.atStart;
        let estEarlier = s.estEarlier;
        if (items.length > TL_EVENTS_CAP) {
          items = items.slice(items.length - TL_EVENTS_CAP);
          capped = true; atStart = false; estEarlier = null;
        }
        return { ...s, items, capped, atStart, estEarlier, live: true, changeKind: 'append', changeSeq: payload.at || Date.now() };
      });
    });
    return off;
  }, [path, harness, loadInitial, nextKey]);

  const loadOlder = useCallback(() => {
    if (!path || state.loadingOlder || state.atStart || state.loading) return;
    if (state.capped || state.start == null) {
      // The display cap already discarded events between the true file
      // start and what's shown; paging further back from a stale `start`
      // would silently open a gap. Reload from the live end instead (same
      // as the reference renderer's capped -> full reset).
      genRef.current += 1;
      const nextGen = genRef.current;
      keyRef.current = 0;
      setState(initialTimelineState());
      loadInitial(nextGen, path, harness);
      return;
    }
    const myGen = genRef.current;
    const before = state.start;
    setState((s) => ({ ...s, loadingOlder: true }));
    const apply = (page: TimelinePage) => {
      if (genRef.current !== myGen) return;
      setState((cur) => {
        const items = mergePrependEvents(page.events, cur.items, nextKey);
        return { ...cur, items, start: page.start, atStart: page.atStart, estEarlier: page.estEarlier, loadingOlder: false, changeKind: 'prepend', changeSeq: Date.now() };
      });
    };
    const fail = (err?: string) => {
      if (genRef.current !== myGen) return;
      setState((cur) => ({ ...cur, loadingOlder: false, error: err || cur.error }));
    };
    if (!window.humanctl) {
      if (!rowRef.current) return;
      setTimeout(() => apply(fixtureOlderTimelinePage(rowRef.current!)), 350);
      return;
    }
    window.humanctl.readTimeline({ path, harness, before })
      .then((r) => { if (r && r.ok && r.page) apply(r.page); else fail(r && r.error); })
      .catch((e) => fail(String((e && e.message) || e)));
  }, [path, harness, state.loadingOlder, state.atStart, state.loading, state.capped, state.start, nextKey, loadInitial]);

  return {
    items: state.items,
    loading: state.loading,
    loadingOlder: state.loadingOlder,
    error: state.error,
    atStart: state.atStart,
    capped: state.capped,
    estEarlier: state.estEarlier,
    live: state.live,
    changeKind: state.changeKind,
    changeSeq: state.changeSeq,
    loadOlder,
  };
}
