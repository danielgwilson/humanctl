# Perf gates: the local/CI split

humanctl's perf story has two separate gates, deliberately split because
today's CI runner (a plain ubuntu box) has no display server and cannot run a
real Electron/Chromium renderer. Faking that with xvfb was considered and
rejected for this repo's size: the honest split below is simpler, faster, and
just as effective at catching the regression class this whole story exists
for (see the 2026-07-03 perf-profile investigation this section codifies).

## LOCAL: `npm run perf:selftest` (required pre-release gate)

    npm run perf:selftest

Drives a REAL Electron window over the Chrome DevTools Protocol (adapted from
the original lab investigation's throwaway harness), against an isolated,
empty `HOME` and `--user-data-dir` scratch directory -- no real session data
or real `~/.humanctl` is ever read or written, so results are reproducible on
any machine, not dependent on whatever happens to be in the operator's real
session history that day.

Checks, against the DESIGN.md perf SLOs:

- **Cold open to interactive**: under 1500ms, measured from process spawn to
  the renderer reaching a booted shell (`.hdr` + `.stage` present).
- **Click to paint**: under 100ms x10, measured across view switches
  (`setView`) via a double-`requestAnimationFrame` settle.
- **60s idle self-refresh**: zero DOM mutation batches in a 60-second window
  that starts AFTER one full 20-second poll cycle has already settled (the
  poll's own first tick legitimately repaints once; the SLO is "only the
  declared poll cadence may cause work," not "zero work ever"). Any mutation
  in the post-settle window is the events.jsonl-inside-watched-dir feedback
  loop signature (the original investigation measured ~2.6 refreshes/SECOND
  from that bug, not one repaint per 20-second cycle) or an unrelated new
  self-triggered refresh.
- **Signature-gate check**: three back-to-back `scheduleRefresh()` calls
  against unchanged data must produce zero repaints (unchanged data must not
  rebuild).
- **Heap after 20 cycles**: forced refresh + view-switch cycles must not
  balloon `performance.memory.usedJSHeapSize` (a coarse, Chromium-limited
  signal, but sufficient to catch an order-of-magnitude per-cycle leak like
  the pre-hotfix full-pane-rebuild-with-no-diff bug).

This is wired into `npm run app:install` as a required step before install:
a failing perf:selftest blocks the local install, the same way a failing
test should block a release. It is intentionally NOT part of `npm test` or
any CI workflow.

Numbers from a representative local run (fixture/empty-fleet data, this
machine, this PR):

| Check | Budget | Measured |
|---|---|---|
| Cold open | < 1500ms | 365ms |
| Click-to-paint (x10 max) | < 100ms | 21.1ms |
| 60s idle mutation batches | 0 | 0 |
| Signature-gate mutation batches | 0 | 0 |
| Heap growth over 20 cycles | non-monotonic | 0.0% |
| Renderer bundle JS (`bundle:check`, runs in CI) | < 600.00 kB | 532.86 kB |
| Renderer bundle CSS (`bundle:check`, runs in CI) | < 72.00 kB | 62.85 kB |

Re-run this locally before every release; numbers drift with the machine and
the current codebase, the table above is a point-in-time proof, not a promise.

## LOCAL: `npm run perf:eventloop` (main-process stalls, required pre-release gate)

    npm run perf:eventloop            # measure
    npm run perf:eventloop:selfcheck  # prove the gate can still fail

`perf:selftest` above is structurally blind to main-process blocking: it runs on
an empty scratch home, and an empty fleet reads instantly. This gate launches the
real app against a synthetic corpus of 410 transcripts (~173MB) under live write
pressure, and instruments the main process with `perf_hooks.monitorEventLoopDelay`.

It asserts on **`max`, the worst single stall**, never on a percentile. Window
drag jank IS the individual long stall, and a percentile cannot see one: with the
transcript reader blocking main, this app measured `max = 582.5ms` (roughly 35
dropped frames) while `p99` read `3.2ms`, indistinguishable from idle.

| Budget | Value |
| --- | --- |
| Worst steady-state main-process stall | < 16.7ms (one 60fps frame) |
| Hard ceiling, any single window | 50ms (three dropped frames) |

Steady state means after `did-finish-load`: main resets the delay histogram once
the UI is up, so window creation is excluded and everything a user could feel is
included. It resets again after each 2s sample, so every reported window is that
window's own worst stall rather than a running high-water mark.

**Verdict policy.** `max` is the statistic most sensitive to OS preemption, so a
lone over-budget window on a loaded machine can mean nothing. The gate resolves
that by reproducibility, never by a looser budget:

- two or more over-budget windows: recurring main-process blocking, FAIL at once
- any single window over the 50ms ceiling: a multi-frame freeze, FAIL, no retry
- exactly one over-budget window under the ceiling: ambiguous, re-measure once.
  Real one-time work reproduces (the harness-icon cold path is cold in every
  fresh scratch userData, so its stall shows up in both runs and still fails);
  machine noise does not.

The gate prints `os.loadavg()` beside every number. Before reading a red as a
regression, check it, and A/B against the previous release with
`git diff --quiet <prev>..HEAD -- electron/ lib/`.

`judge()` is pure and its cases are locked down by `perf:logic-selftest` in CI.
`perf:eventloop:selfcheck` injects a 40ms main-thread stall and requires the gate
to catch it: a gate that has never been observed to FAIL is decoration.

## CI: `npm run perf:logic-selftest` (pure logic, runs in CI)

    npm run perf:logic-selftest

No Electron, no display server, no browser. Covers the PURE-LOGIC pieces a
real perf regression routinely breaks, checkable without a renderer:

- `isInboxRelevantChange` (the watcher filter that fixed and now guards
  against the events.jsonl feedback loop reopening, including the PR-2
  additions: `attachments/`, `pulse-cache.json`, `summary-budget.json`).
- The always-on summary budget math (`lib/summary-budget.ts`): estimate
  scaling, daily accumulation, daily reset, the honest pre-check, and the
  paused-at-cap boundary.
- Harness icon path resolution (`lib/harness-icons.ts`): pure filesystem
  logic (Info.plist read, `.icns` resolution with/without extension, honest
  failure shape for an unknown or uninstalled harness).
- The PR chip cache-only contract (`lib/commands.ts` `prChip`): honest
  cache-miss, stale-age labeling, degraded-entry handling, all with zero
  process spawns (there is no spawn in the function's call graph to mock).

This is the CI-safe subset; it is a complement to perf:selftest above, not a
substitute for it. A change that only passes perf:logic-selftest has not
proven anything about actual render performance, cold-open time, or the DOM
mutation cadence -- only that the supporting pure logic is still correct.

## CI: `npm run bundle:check` (renderer bundle budget, runs in CI)

    npm run bundle:check

The one perf-adjacent budget that CAN run in CI without a display server,
because it needs only a browser build (`vite build`) and a `stat()`. It builds
`electron/renderer-vite/` and fails if the emitted renderer JS or CSS exceeds
its budget, printing actual vs budget for both.

Budgets (`scripts/bundle-size-check.js`, restated in the SLO table above):
**600.00 kB JS**, **72.00 kB CSS**, roughly 12 percent above the real
2026-07-07 measurement (532.86 kB JS, 62.85 kB CSS). That is enough headroom
for ordinary feature work and tight enough that one heavy new dependency trips
it. This gate exists because nothing in the repo watched renderer bundle
growth: a single careless import can add hundreds of KB with no symptom in
review, and every KB of JS is parse + compile time sitting directly on the
cold-open SLO's critical path.

It is wired into CI (`.github/workflows/ci.yml`, the `verify` job) rather than
only into `app:install`, because it is cheap (one `vite build`, under a second
of check time after it) and because bundle growth is exactly the kind of drift
that should be caught on the PR that causes it, not at release time. Raising a
budget means editing `scripts/bundle-size-check.js` AND the SLO table above in
the same commit, and saying why in the PR body.
