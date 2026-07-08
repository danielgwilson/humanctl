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
