'use strict';

// LOCAL perf gate (PR-2 item 5, docs/perf.md): the real pre-release check,
// wired into `npm run app:install`. Adapts the lab investigation's live-app
// CDP harness (humanctl-lab reports/2026-07-03-perf-profile/harness/) into a
// repeatable, scriptable check against the DESIGN.md perf SLOs, on FIXTURE
// data (an isolated, empty HOME so no real session data or real ~/.humanctl
// is ever touched) so results are reproducible on any machine, not dependent
// on whatever happens to be in the operator's real session history that day.
//
// This is deliberately NOT part of `npm test`/CI (see docs/perf.md): it needs
// a real Chromium renderer (an Electron window), and today's CI runner has no
// display server. CI instead runs scripts/perf-selftest/logic.selftest.js,
// the pure-logic subset (signature functions, watcher filter, budget math,
// time-ladder) that needs no display. Running a full Electron instance in a
// throwaway --user-data-dir + isolated HOME was judged not worth the xvfb
// complexity for this repo's size; see docs/perf.md for the explicit split.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CDP, getPageTarget } = require('./cdp');
const injectInstrumentation = require('./inject-instrumentation');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CDP_PORT = Number(process.env.HUMANCTL_PERF_PORT) || 9222;
const BUDGETS = {
  coldOpenMs: 1500,
  clickToPaintMs: 100,
  clickSamples: 10,
  idleWindowMs: 60000,
  idleSelfRefreshMax: 0, // beyond the declared 20s poll's own signature-gated ticks
  heapCycles: 20,
};

function log(msg) { console.log(`[perf:selftest] ${msg}`); }
function fail(msg) { console.error(`[perf:selftest] FAIL: ${msg}`); process.exitCode = 1; }

async function evalJS(cdp, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(`renderer eval threw: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
  return r.result.value;
}

function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      getPageTarget(port).then(resolve).catch((err) => {
        if (Date.now() - start > timeoutMs) return reject(new Error(`CDP endpoint on :${port} never came up: ${err.message}`));
        setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function main() {
  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-home-'));
  const scratchUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-userdata-'));
  log(`isolated HOME: ${scratchHome} (empty; no real session data or ~/.humanctl is read or written)`);
  log(`isolated userData: ${scratchUserData}`);

  const electronBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(electronBin)) {
    console.error('[perf:selftest] electron is not installed (run `npm install` first). This is a LOCAL pre-release gate, not a CI check -- see docs/perf.md.');
    process.exit(1);
  }

  const t0Spawn = Date.now();
  const child = spawn(electronBin, [
    path.join(REPO_ROOT, 'electron', 'main.js'),
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${scratchUserData}`,
  ], {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { HOME: scratchHome }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', () => {});

  const results = {};
  try {
    const page = await waitForCdp(CDP_PORT);
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Input.setIgnoreInputEvents', { ignore: false });

    // Give the renderer a moment past CDP-reachable to finish its own boot
    // (load() -> fetchData() -> first render); poll for the app shell.
    let booted = false;
    for (let i = 0; i < 30; i++) {
      const ready = await evalJS(cdp, `!!document.querySelector('.hdr') && !!document.querySelector('.stage')`);
      if (ready) { booted = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!booted) throw new Error('renderer never reached a booted state (.hdr/.stage not found)');
    const coldOpenTotalMs = Date.now() - t0Spawn;
    results.coldOpenMs = coldOpenTotalMs;
    if (coldOpenTotalMs < BUDGETS.coldOpenMs) log(`cold open: ${coldOpenTotalMs}ms (budget ${BUDGETS.coldOpenMs}ms) -- PASS`);
    else fail(`cold open: ${coldOpenTotalMs}ms exceeds budget ${BUDGETS.coldOpenMs}ms`);

    await cdp.send('Runtime.evaluate', { expression: injectInstrumentation });

    // ---- click-to-paint: switch views via the nav rail's own click handlers, x10 ----
    await evalJS(cdp, `window.setView && window.setView('sessions'); true`);
    await new Promise((r) => setTimeout(r, 300));
    const clickTimes = [];
    for (let i = 0; i < BUDGETS.clickSamples; i++) {
      const target = i % 2 === 0 ? 'inbox' : 'sessions';
      const t0 = await evalJS(cdp, `performance.now()`);
      await evalJS(cdp, `window.setView && window.setView(${JSON.stringify(target)}); true`);
      const settle = await evalJS(cdp, `
        new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))); })
      `, true);
      clickTimes.push(settle - t0);
      await new Promise((r) => setTimeout(r, 120));
    }
    const maxClick = Math.max(...clickTimes);
    const overBudget = clickTimes.filter((t) => t > BUDGETS.clickToPaintMs).length;
    results.clickToPaintMs = clickTimes;
    if (overBudget === 0) log(`click-to-paint (view switch x${BUDGETS.clickSamples}): max ${maxClick.toFixed(1)}ms (budget ${BUDGETS.clickToPaintMs}ms) -- PASS`);
    else fail(`click-to-paint: ${overBudget}/${BUDGETS.clickSamples} samples exceeded ${BUDGETS.clickToPaintMs}ms (max ${maxClick.toFixed(1)}ms)`);

    // ---- 60s idle: zero self-triggered refresh BEYOND the declared poll ----
    // The declared 20s poll's very first tick legitimately repaints once (an
    // empty-to-populated or otherwise first-ever signature comparison always
    // differs from the initial ''), which is correct behavior, not a
    // regression -- DESIGN.md's SLO is "only the declared poll cadence may
    // cause work," not "zero work ever." So the capture window starts AFTER
    // one full poll cycle has already elapsed and settled, isolating exactly
    // the steady-state behavior the original lab investigation measured (the
    // events.jsonl feedback loop produced hundreds of extra repaints per
    // minute on top of, not instead of, that first legitimate one).
    await evalJS(cdp, `window.setView && window.setView('inbox'); true`);
    log('letting one full 20s poll cycle settle before starting the idle capture...');
    await new Promise((r) => setTimeout(r, 21000));
    await evalJS(cdp, `window.__perf.mutations = []; window.__perfIdleStart = Date.now(); true`);
    log(`capturing ${BUDGETS.idleWindowMs / 1000}s idle window post-settle (fixture data, empty fleet)...`);
    await new Promise((r) => setTimeout(r, BUDGETS.idleWindowMs));
    const idleDump = await evalJS(cdp, `JSON.stringify({ mutations: window.__perf.mutations, elapsedMs: Date.now() - window.__perfIdleStart })`);
    const idle = JSON.parse(idleDump);
    // Within this post-settle window, each subsequent 20s poll tick is
    // signature-gated (renderer.js's lastSig check in _refresh) against
    // UNCHANGED fixture-empty data, so it should produce zero DOM mutation
    // batches. Any mutation batch here is either the events.jsonl-inside-
    // watched-dir feedback loop this perf profile was built to catch (it
    // produced ~2.6 refreshes/SECOND, not per-poll-cycle) or an unrelated new
    // self-triggered refresh.
    results.idleMutationBatches = idle.mutations.length;
    if (idle.mutations.length <= BUDGETS.idleSelfRefreshMax) {
      log(`idle ${(idle.elapsedMs / 1000).toFixed(0)}s post-settle: ${idle.mutations.length} DOM mutation batches (budget <=${BUDGETS.idleSelfRefreshMax}) -- PASS`);
    } else {
      fail(`idle ${(idle.elapsedMs / 1000).toFixed(0)}s post-settle: ${idle.mutations.length} DOM mutation batches at total idle (budget <=${BUDGETS.idleSelfRefreshMax}) -- this is the events.jsonl feedback-loop regression signature if it recurs`);
    }

    // ---- signature-gate check: re-running the SAME refresh call must not repaint ----
    await evalJS(cdp, `window.__perf.mutations = []; true`);
    await evalJS(cdp, `if (window.scheduleRefresh) { window.scheduleRefresh(); window.scheduleRefresh(); window.scheduleRefresh(); } true`);
    await new Promise((r) => setTimeout(r, 3000));
    const sigDump = await evalJS(cdp, `JSON.stringify(window.__perf.mutations.length)`);
    const sigMutations = JSON.parse(sigDump);
    results.signatureGateMutations = sigMutations;
    // Three back-to-back calls against unchanged fixture data collapse (the
    // in-flight refreshQueued coalescing plus the lastSig check) to at most
    // one real repaint attempt, which itself should mutate nothing on
    // unchanged data.
    if (sigMutations <= BUDGETS.idleSelfRefreshMax) log(`signature gate: ${sigMutations} mutation batches from 3 back-to-back refresh calls on unchanged data -- PASS`);
    else fail(`signature gate: ${sigMutations} mutation batches from repeated refresh calls on UNCHANGED data (expected 0; unchanged data must not rebuild)`);

    // ---- heap: steady state after 20 forced cycles must not grow monotonically ----
    await cdp.send('HeapProfiler.enable');
    const heapUsed = async () => {
      const r = await cdp.send('Runtime.evaluate', { expression: 'performance.memory ? performance.memory.usedJSHeapSize : null', returnByValue: true });
      return r.result.value;
    };
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const heapBefore = await heapUsed();
    for (let i = 0; i < BUDGETS.heapCycles; i++) {
      await evalJS(cdp, `if (window.scheduleRefresh) window.scheduleRefresh(); if (window.setView) { window.setView('sessions'); window.setView('inbox'); } true`);
      await new Promise((r) => setTimeout(r, 100));
    }
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    const heapAfter = await heapUsed();
    results.heapBeforeBytes = heapBefore;
    results.heapAfterBytes = heapAfter;
    if (heapBefore == null || heapAfter == null) {
      log('heap: performance.memory unavailable in this Chromium build; skipped (not a failure, Chromium deliberately coarsens this API)');
    } else {
      const growthPct = ((heapAfter - heapBefore) / Math.max(1, heapBefore)) * 100;
      results.heapGrowthPct = growthPct;
      // "Must not grow monotonically" in one run cannot be proven by a single
      // before/after pair (that needs repeated runs over time); this gate
      // checks the weaker, still-useful invariant that one round of 20
      // forced cycles does not balloon heap by an order of magnitude, which
      // is what a per-cycle retained-DOM leak (offender #2 in the original
      // profile, before its fix) would look like.
      if (growthPct < 100) log(`heap: ${(heapBefore / 1048576).toFixed(1)}MB -> ${(heapAfter / 1048576).toFixed(1)}MB (${growthPct.toFixed(1)}% over ${BUDGETS.heapCycles} cycles) -- PASS`);
      else fail(`heap: grew ${growthPct.toFixed(1)}% over ${BUDGETS.heapCycles} forced refresh/view-switch cycles (${(heapBefore / 1048576).toFixed(1)}MB -> ${(heapAfter / 1048576).toFixed(1)}MB)`);
    }

    cdp.close();
  } catch (err) {
    fail(`perf:selftest harness error: ${err.message}`);
    if (stdout) console.error(`--- electron stdout ---\n${stdout.slice(-2000)}`);
  } finally {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 500));
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(scratchHome, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
    try { fs.rmSync(scratchUserData, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  }

  console.log('\n[perf:selftest] summary:');
  console.log(JSON.stringify(results, null, 2));
  if (process.exitCode) {
    console.error('\n[perf:selftest] FAILED -- see above. This is the required LOCAL pre-release gate (docs/perf.md); it does not run in CI.');
  } else {
    console.log('\n[perf:selftest] all budgets met.');
  }
}

main().catch((e) => { console.error('[perf:selftest] unexpected error:', e); process.exit(1); });
