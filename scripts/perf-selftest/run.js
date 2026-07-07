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
//
// Port/process hygiene (fixed-CDP-port antipattern, root-caused and fixed
// here): earlier versions launched Electron with a FIXED
// `--remote-debugging-port=9222` and discovered the endpoint by HTTP-polling
// `http://localhost:9222/json/list`. That has three failure modes: (a) any
// OTHER Electron/Chromium instance already on 9222 collides, or worse, the
// harness silently attaches to THAT ghost process and measures the wrong
// app; (b) readiness was a race -- polling a guessed port instead of reading
// the child's own announcement; (c) cleanup was `child.kill()` on a single
// pid, which leaves Electron's helper/GPU/renderer processes running and
// still holding the port, poisoning the next run. Fixed by: an ephemeral
// port (`--remote-debugging-port=0`, kernel-assigned, collisions
// impossible) whose ACTUAL bound port is read out of the child's own stderr
// ("DevTools listening on ws://127.0.0.1:PORT/devtools/browser/..."). That
// stderr line is the browser-level target, not the renderer page target
// Runtime.evaluate needs, so getPageTarget() is then queried against that
// SAME discovered port to fetch the page's ws:// URL -- discovery is always
// keyed off a port this exact child just reported, never a fixed/guessed
// one, so the harness can never attach to an unrelated ghost Electron
// instance. Cleanup: a detached child so the whole process GROUP can be
// killed on teardown, plus a bounded retry so a single transient
// launch/discovery miss self-heals instead of failing the gate outright.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CDP, getPageTarget } = require('./cdp');
const injectInstrumentation = require('./inject-instrumentation');

const REPO_ROOT = path.join(__dirname, '..', '..');
// Default to 0 (kernel-assigned ephemeral port): collisions with any other
// Electron/Chromium instance on the machine are structurally impossible.
// HUMANCTL_PERF_PORT remains available as an explicit override (e.g. a human
// wants a fixed port to attach a devtools window mid-run), but it is opt-in,
// never the default.
const CDP_PORT = Number(process.env.HUMANCTL_PERF_PORT) || 0;
const LAUNCH_ATTEMPTS = 3;
const LAUNCH_TIMEOUT_MS = 15000;
const DEVTOOLS_LISTENING_RE = /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\S*)/;
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

// Kill the whole process GROUP a detached child heads, not just its own pid,
// so Electron's helper processes (GPU, renderer, utility) never survive
// teardown and poison the next run by continuing to hold the debugging port
// open. Detached spawn on darwin/linux makes the child its own process-group
// leader (pid === pgid), so `-pid` addresses the group. Windows has no
// POSIX process-group signal semantics, so it falls back to killing the pid
// directly there (best-effort; this harness's supported platforms are
// macOS/linux, matching the rest of the desktop build).
function killGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

// Awaits the child's actual 'exit' event (not a fixed sleep) so teardown
// never returns before Electron and its helpers have actually been reaped --
// the next attempt (on retry) or the next invocation of this script must
// never inherit a survivor still bound to a port.
function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs); // don't hang teardown forever
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function killAndWait(child) {
  killGroup(child);
  await waitForExit(child);
}

// Resolves the renderer's page target on the port THIS child just announced
// via stderr (never a fixed/guessed port). A short bounded poll covers the
// small startup window where the process has printed its DevTools line but
// the HTTP /json/list endpoint is not yet accepting connections.
function waitForPageTarget(port, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      getPageTarget(port).then(resolve).catch((err) => {
        if (Date.now() - start > timeoutMs) return reject(new Error(`page target on the announced port :${port} never came up: ${err.message}`));
        setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}

// Launches Electron on an ephemeral debugging port and resolves once the
// exact ws:// endpoint THIS child announced has been parsed out of its own
// stderr -- never a guess, never a poll against a fixed port some other
// process might already own. Rejects (carrying the child, so the caller can
// tear it down) on early exit or on discovery timeout, so the caller can
// retry cleanly on a fresh ephemeral port.
function launchElectron({ electronBin, mainEntry, scratchHome, scratchUserData, timeoutMs = LAUNCH_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronBin, [
      mainEntry,
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${scratchUserData}`,
    ], {
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, { HOME: scratchHome }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // own process group -> killable as a unit
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(
        new Error(`Electron never printed a DevTools ws:// endpoint within ${timeoutMs}ms`),
        { child, stdout, stderr },
      ));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (settled) return;
      const m = stderr.match(DEVTOOLS_LISTENING_RE);
      if (m) {
        settled = true;
        clearTimeout(timer);
        resolve({
          child,
          browserWsUrl: m[1],
          port: Number(m[2]),
          getStdout: () => stdout,
          getStderr: () => stderr,
        });
      }
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(err, { child, stdout, stderr }));
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(
        new Error(`Electron exited early (code ${code}, signal ${signal}) before printing a DevTools endpoint`),
        { child, stdout, stderr },
      ));
    });
  });
}

// Bounded retry: a launch/discovery timeout is treated as transient (a slow
// CI box, a one-off OS scheduling hiccup) and self-heals via a fresh attempt
// on a fresh ephemeral port, rather than failing the whole gate on the first
// miss. Each failed attempt is fully torn down (process group killed, exit
// awaited) before the next attempt starts, so a failed attempt can never
// leak a survivor into the next one.
async function launchElectronWithRetry(opts, attempts = LAUNCH_ATTEMPTS) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await launchElectron(opts);
    } catch (err) {
      lastErr = err;
      log(`launch attempt ${i}/${attempts} failed: ${err.message}`);
      if (err.child) await killAndWait(err.child);
    }
  }
  throw lastErr;
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
  const mainEntry = path.join(REPO_ROOT, 'dist', 'electron', 'main.js');
  if (!fs.existsSync(mainEntry)) {
    console.error('[perf:selftest] dist/electron/main.js not found. Run `npm run build:lib` first (the perf:selftest npm script does this for you).');
    process.exit(1);
  }

  // Register teardown against process exit/SIGINT/SIGTERM up front, BEFORE
  // the warmup launch begins, so a thrown error anywhere below, or an
  // operator Ctrl-C during either the warmup or the measured run, still
  // reaps whichever child is currently live (and its whole process group)
  // instead of leaving an orphan holding an ephemeral port. `activeChild`
  // is repointed as each launch happens; the handlers always kill the
  // current one.
  let activeChild = null;
  let torndown = false;
  const teardownSync = () => {
    if (torndown) return;
    torndown = true;
    killGroup(activeChild);
  };
  process.on('exit', teardownSync);
  const onSignal = (sig) => { teardownSync(); process.exit(sig === 'SIGINT' ? 130 : 143); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  // ---- WARMUP: one throwaway launch whose timings are DISCARDED ----------
  // On the FIRST launch of a freshly-unpacked electron binary (right after
  // `npm ci`/`npm install` reinstalls it, or on a cold machine), macOS pays
  // a one-time Gatekeeper/dyld verification tax that the OS then caches: an
  // observed ~15.7s on a cold binary vs ~0.4-0.7s once warm. That tax is
  // machine/OS state, NOT the app's cold start, so measuring through it
  // false-fails the 1500ms cold-open budget on exactly the first run after
  // install -- which is when `npm run app:install` (build then perf:selftest)
  // runs it. So we launch once, confirm the window is actually up, then
  // cleanly kill+await-exit and throw the timings away. Reuses the same
  // ephemeral-port + process-group machinery as the measured run, so the
  // warmup is itself collision-immune and leaves no survivor. It runs in its
  // own scratch userData dir so the measured run below is still a true cold
  // open (fresh profile, no warm renderer cache carried over).
  const warmupUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-warmup-'));
  try {
    log('warmup launch (timings discarded; absorbs the one-time OS binary-verification tax on a cold electron binary)...');
    const warm = await launchElectronWithRetry({
      electronBin, mainEntry, scratchHome, scratchUserData: warmupUserData,
    });
    activeChild = warm.child;
    try {
      const warmPage = await waitForPageTarget(warm.port);
      const warmCdp = new CDP(warmPage.webSocketDebuggerUrl);
      await warmCdp.connect();
      await warmCdp.send('Runtime.enable');
      // Confirm the window actually reached a booted shell before we discard
      // it, so the warmup genuinely exercised the full first-launch path.
      let warmBooted = false;
      for (let i = 0; i < 30; i++) {
        const ready = await evalJS(warmCdp, `!!window.__humanctlPerf`);
        if (ready) { warmBooted = true; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      warmCdp.close();
      log(`warmup ${warmBooted ? 'booted' : 'connected (shell not confirmed; proceeding anyway)'} -- discarding timings`);
    } finally {
      await killAndWait(warm.child);
      activeChild = null;
    }
  } catch (err) {
    // A warmup failure is not fatal: the measured run has its own retry and
    // will surface any real launch problem. Warn and continue.
    log(`warmup launch failed (non-fatal, measured run has its own retry): ${err.message}`);
    if (err.child) await killAndWait(err.child);
    activeChild = null;
  } finally {
    try { fs.rmSync(warmupUserData, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  }

  // ---- MEASURED run: representative cold open (binary now verified+cached) --
  const t0Spawn = Date.now();
  const { child, browserWsUrl, port, getStdout } = await launchElectronWithRetry({
    electronBin, mainEntry, scratchHome, scratchUserData,
  });
  // The already-registered exit/SIGINT/SIGTERM handlers now cover this child.
  activeChild = child;
  log(`Electron DevTools endpoint: ${browserWsUrl} (ephemeral port ${port}, read from child stderr -- no fixed-port guess)`);

  const results = {};
  try {
    // The stderr-announced endpoint is the BROWSER target; Runtime.evaluate
    // and friends need the renderer's PAGE target, which only /json/list
    // exposes. Query it against the port THIS child just announced (never a
    // fixed guess), with a short bounded poll since the HTTP endpoint can
    // trail the stderr print by a few ms during startup.
    const page = await waitForPageTarget(port);
    const cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Input.setIgnoreInputEvents', { ignore: false });
    // Force the page to be treated as focused for the whole measured run.
    // requestAnimationFrame (which the click-to-paint settle relies on) is
    // throttled to a crawl by Chromium when the window is occluded or
    // backgrounded, which on a busy desktop makes a single sample spike to an
    // absurd value (observed a ~2.2e6 ms outlier) even though every other
    // sample is ~10-27ms. This keeps the paint measurement about the app, not
    // about window stacking on the test machine.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

    // Give the renderer a moment past CDP-reachable to finish its own boot
    // (load() -> fetchData() -> first render); poll for the app shell.
    let booted = false;
    for (let i = 0; i < 30; i++) {
      const ready = await evalJS(cdp, `!!window.__humanctlPerf`);
      if (ready) { booted = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!booted) throw new Error('renderer never reached a booted state (window.__humanctlPerf not exposed)');
    const coldOpenTotalMs = Date.now() - t0Spawn;
    results.coldOpenMs = coldOpenTotalMs;
    if (coldOpenTotalMs < BUDGETS.coldOpenMs) log(`cold open: ${coldOpenTotalMs}ms (budget ${BUDGETS.coldOpenMs}ms) -- PASS`);
    else fail(`cold open: ${coldOpenTotalMs}ms exceeds budget ${BUDGETS.coldOpenMs}ms`);

    await cdp.send('Runtime.evaluate', { expression: injectInstrumentation });

    // ---- click-to-paint: switch views via the app's own view-switch path, x10 ----
    await evalJS(cdp, `window.__humanctlPerf && window.__humanctlPerf.setView('sessions'); true`);
    await new Promise((r) => setTimeout(r, 300));
    const clickTimes = [];
    for (let i = 0; i < BUDGETS.clickSamples; i++) {
      const target = i % 2 === 0 ? 'inbox' : 'sessions';
      const t0 = await evalJS(cdp, `performance.now()`);
      await evalJS(cdp, `window.__humanctlPerf && window.__humanctlPerf.setView(${JSON.stringify(target)}); true`);
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
    await evalJS(cdp, `window.__humanctlPerf && window.__humanctlPerf.setView('inbox'); true`);
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
    await evalJS(cdp, `if (window.__humanctlPerf) { window.__humanctlPerf.refresh(); window.__humanctlPerf.refresh(); window.__humanctlPerf.refresh(); } true`);
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
      await evalJS(cdp, `if (window.__humanctlPerf) { window.__humanctlPerf.refresh(); window.__humanctlPerf.setView('sessions'); window.__humanctlPerf.setView('inbox'); } true`);
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
    const stdout = getStdout();
    if (stdout) console.error(`--- electron stdout ---\n${stdout.slice(-2000)}`);
  } finally {
    // Guaranteed cleanup: kill the whole process GROUP (not just this one
    // pid) and AWAIT the child's actual exit before resolving, so the next
    // run (in this process or the next `npm run perf:selftest` invocation)
    // never inherits a survivor still holding the ephemeral port or running
    // as an orphaned Electron helper.
    await killAndWait(child);
    torndown = true;
    process.removeListener('exit', teardownSync);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
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
