'use strict';
// Event-loop-delay gate: the ONE check that sees main-process blocking.
//
// The existing perf:selftest DOM checks (cold open, click-to-paint, idle,
// signature, heap) run against an EMPTY scratch fleet, so they are blind to
// the real "laggy, can't drag the window" failure: on a real fleet the
// synchronous transcript reader runs on the Electron MAIN process and blocks
// its event loop for tens-to-hundreds of ms. This gate launches the app
// against a realistic-scale synthetic corpus with HUMANCTL_PERF_EVENTLOOP=1
// (main.ts then logs its own event-loop-delay percentiles to stderr), lets it
// boot + run one poll cycle so the reader actually reads the corpus, then
// asserts main's p99 stays under budget. It needs no CDP: it only reads the
// main process's own stderr.
//
// Expected today (sync reader on main): FAIL, p99 well over budget. After the
// reader moves into a utilityProcess, main stops doing the fs/parse work and
// p99 collapses back under budget -- that transition is the acceptance test.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeCorpus } = require('./make-corpus');

// Budget is the 60fps FRAME budget (16.7ms), not the coarser "app feels laggy"
// threshold: the reported failure is dropped frames while DRAGGING THE WINDOW,
// a compositor op the main process must service every frame. Any main-process
// event-loop stall over one frame drops a frame mid-drag. The reader caps its
// per-scan cost, so today it is a fixed ~22ms stall every scan (poll + every
// watcher fire) regardless of fleet size -> a dropped frame on every scan.
// Moving the reader into a utilityProcess removes that work from main, which
// should collapse p99 well under a frame.
const FRAME_BUDGET_MS = 16.7; // one 60fps frame: any longer stall drops a frame mid-drag
const RUN_MS = 36000; // boot + >20s of steady state, so a full 20s poll cycle lands after the UI-loaded reset
const ELD_RE = /eventloop p50=([\d.]+)ms p99=([\d.]+)ms max=([\d.]+)ms/g;
// main.ts prints this once, at did-finish-load, right after resetting the
// histogram. Everything before it is boot; everything after it is felt.
const RESET_MARKER = 'eventloop reset (UI loaded';

// `--selfcheck` proves the gate can still FAIL: it makes main block for
// SELFCHECK_STALL_MS on a timer and then INVERTS the verdict, so a clean
// "PASS" from the injected-stall run is itself the failure. This exists
// because this gate previously asserted on p99, which cannot see a single
// long stall (a deliberate 40ms block leaves p99 at ~2.5ms and moves only
// `max`), and so it passed a main process that was visibly janking.
const SELFCHECK = process.argv.includes('--selfcheck');
const SELFCHECK_STALL_MS = 40;

function log(m) { console.log(`[perf:eventloop] ${m}`); }

function killGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

function loadavg1() { return os.loadavg()[0]; }

// A single 36s launch is one sample of a noisy system. `max` is by construction
// the statistic most sensitive to OS preemption, so on a loaded machine ONE
// window can exceed the frame budget with nothing wrong in the app. The answer
// is NOT a looser budget (that blinds the gate to the 31.9ms class of one-time
// stall it exists to catch). The answer is REPRODUCIBILITY:
//
//   >= 2 over-budget windows   -> recurring main-process blocking. FAIL now.
//   worst window > HARD_CEILING -> a multi-frame freeze. FAIL now, never retry.
//   exactly 1 over-budget window -> ambiguous. Re-measure ONCE.
//        reproduces (any over-budget window)  -> real one-time work. FAIL.
//        does not reproduce (0 windows)       -> machine noise. PASS.
//
// Checked against every case this gate has actually seen:
//   reader on main   17/17 windows over, 582ms  -> recurring, FAIL immediately
//   injected 40ms/3s most windows over          -> recurring, FAIL immediately
//   execFileSync(plutil) 31.9ms, ONE window     -> reproduces every run (the
//                                                  icon cache is cold in every
//                                                  fresh scratch userData), FAIL
//   loadavg 26 blip, ONE window, 19-48ms        -> does not reproduce, PASS
const HARD_CEILING_MS = 50; // three dropped frames: never a blip, never retried
async function main() {
  const first = await measure();
  reportRun(first, 'run');
  const verdict = judge(first);
  if (verdict === 'retry') {
    log(`one over-budget window (${first.worstMax.toFixed(1)}ms) and 1-min loadavg ${loadavg1().toFixed(1)}: ambiguous. Re-measuring once -- real one-time work reproduces, machine noise does not.`);
    const second = await measure();
    reportRun(second, 're-run');
    if (second.overBudget.length > 0) {
      finish(false, `REPRODUCED: a stall over the ${FRAME_BUDGET_MS}ms frame budget appeared in both runs (${first.worstMax.toFixed(1)}ms, then ${second.worstMax.toFixed(1)}ms). That is real one-time main-process work, not machine noise. Keep heavy/synchronous work off main (AGENTS.md).`);
    }
    finish(true, `worst steady-state stall ${first.worstMax.toFixed(1)}ms did not reproduce (re-run: ${second.worstMax.toFixed(1)}ms, 0/${second.steady.length} windows over budget). Machine noise, not main-process blocking.`);
  }
  finish(verdict === 'pass', verdict === 'pass'
    ? `worst steady-state main-process stall ${first.worstMax.toFixed(1)}ms is within one 60fps frame on a realistic fleet.`
    : `main-process event loop stalled ${first.worstMax.toFixed(1)}ms in steady state (${first.overBudget.length}/${first.steady.length} windows over the ${FRAME_BUDGET_MS}ms frame budget). Any stall longer than one frame drops a frame while the window is being dragged. Keep heavy/synchronous work off main (AGENTS.md: "Never block the Electron main process").`);
}

function judge(r) {
  if (SELFCHECK) return r.overBudget.length > 0 ? 'fail' : 'pass'; // inverted by finish()
  if (r.worstMax > HARD_CEILING_MS) return 'fail';
  if (r.overBudget.length >= 2) return 'fail';
  if (r.overBudget.length === 1) return 'retry';
  return 'pass';
}

function reportRun(r, label) {
  log(`${label}: samples ${r.all.length} (${r.steady.length} after the UI-loaded reset) | worst STEADY-STATE stall max=${r.worstMax.toFixed(1)}ms (budget < ${FRAME_BUDGET_MS}ms) | p99=${r.worstP99.toFixed(1)}ms (informational) | over-budget windows ${r.overBudget.length}/${r.steady.length} | worst 5: ${r.windowMaxes.slice(0, 5).map((v) => v.toFixed(1)).join(', ')}ms | 1-min loadavg ${r.loadavg.toFixed(1)}`);
}

function finish(passed, message) {
  if (SELFCHECK) {
    // Inverted: a ~40ms stall was injected into main, so the gate MUST catch it.
    if (passed) {
      console.error(`[perf:eventloop] SELFCHECK FAIL: main was blocked for ${SELFCHECK_STALL_MS}ms every 3s and the gate still passed. The gate is blind; it cannot be trusted to catch real blocking.`);
      process.exit(1);
    }
    log(`SELFCHECK PASS: the gate caught the injected ${SELFCHECK_STALL_MS}ms stall. The gate can fail.`);
    process.exit(0);
  }
  if (!passed) { console.error(`[perf:eventloop] FAIL: ${message}`); process.exit(1); }
  log(`PASS: ${message}`);
  process.exit(0);
}

async function measure() {
  const electronBin = require('electron');
  const repoRoot = path.join(__dirname, '..', '..');
  const mainEntry = path.join(repoRoot, 'dist', 'electron', 'main.js');
  if (!fs.existsSync(mainEntry)) { console.error(`[perf:eventloop] FAIL: ${mainEntry} missing (run build:lib first)`); process.exit(1); }

  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-eld-home-'));
  const scratchUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-eld-ud-'));
  const corpus = makeCorpus(scratchHome);
  log(`corpus: ${corpus.totalFiles} transcripts (${corpus.claudeFiles} claude + ${corpus.codexFiles} codex), ${corpus.lines} lines each, ~${corpus.mb}MB`);

  const childEnv = Object.assign({}, process.env, { HOME: scratchHome, HUMANCTL_PERF_EVENTLOOP: '1', ELECTRON_ENABLE_LOGGING: '1' });
  if (SELFCHECK) childEnv.HUMANCTL_PERF_INJECT_STALL = String(SELFCHECK_STALL_MS);
  const child = spawn(electronBin, [mainEntry, `--user-data-dir=${scratchUserData}`], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => {});
  const cleanup = () => { killGroup(child); try { fs.rmSync(scratchHome, { recursive: true, force: true }); } catch {} try { fs.rmSync(scratchUserData, { recursive: true, force: true }); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  // Active-agent write pressure: append to a few hot transcripts every ~900ms
  // so the app's fs watcher keeps firing and main keeps re-reading the fleet
  // (the real "constantly-writing fleet" load, not a single quiescent read).
  const appendLine = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'live append ' + 'y'.repeat(200) }] }, timestamp: new Date(0).toISOString() }) + '\n';
  const writer = setInterval(() => {
    for (const f of corpus.hotFiles || []) { try { fs.appendFileSync(f, appendLine); } catch { /* file may be mid-read; skip */ } }
  }, 900);

  log(`launched; sampling main-process event-loop delay for ${RUN_MS / 1000}s under load (fleet read + poll + live writes to ${(corpus.hotFiles || []).length} hot files)...`);
  await new Promise((r) => setTimeout(r, RUN_MS));
  clearInterval(writer);

  // ASSERT ON MAX, NOT p99. Window-drag jank is caused by INDIVIDUAL long
  // stalls, and a percentile cannot see them: with resolution=2 a deliberate
  // 40ms stall leaves p99 at ~2.5ms (indistinguishable from idle) and shows up
  // only in max. Verified empirically with a bare Node process:
  //   idle  @ res=2  -> p50 2.29  p99 2.46  max 2.59
  //   +40ms @ res=2  -> p50 2.29  p99 2.49  max 42.34   <- only max moves
  // p99 stays as an informational sustained-blocking signal.
  //
  // `max` is CUMULATIVE, so boot stalls cannot be dropped by ignoring early
  // samples: the histogram never forgets its worst value. main.ts resets it
  // once, at did-finish-load, and prints RESET_MARKER. Only samples after that
  // marker are steady state, i.e. stalls that land while the UI is up and the
  // user could be dragging the window.
  const all = [...stderr.matchAll(ELD_RE)];
  const markerAt = stderr.indexOf(RESET_MARKER);
  const steady = markerAt >= 0 ? [...stderr.slice(markerAt).matchAll(ELD_RE)] : [];
  let worstP99 = 0, worstMax = 0;
  for (const m of steady) { worstP99 = Math.max(worstP99, +m[2]); worstMax = Math.max(worstMax, +m[3]); }
  killGroup(child);
  await new Promise((r) => setTimeout(r, 300));

  if (all.length === 0) {
    console.error('[perf:eventloop] FAIL: no event-loop samples from main (did it boot? is HUMANCTL_PERF_EVENTLOOP wired?)');
    console.error(stderr.slice(-1500));
    cleanup();
    process.exit(1);
  }
  if (markerAt < 0) {
    console.error(`[perf:eventloop] FAIL: main never printed "${RESET_MARKER}" -- the window never finished loading, or the histogram reset was dropped from main.ts. Refusing to report a number measured against boot noise.`);
    console.error(stderr.slice(-1500));
    cleanup();
    process.exit(1);
  }
  if (steady.length === 0) {
    console.error(`[perf:eventloop] FAIL: ${all.length} samples, none after the UI-loaded reset; lengthen RUN_MS.`);
    cleanup();
    process.exit(1);
  }

  // Each sample is the worst stall in its own 2s window (main resets the
  // histogram after every print), so the SHAPE of a failure is legible: many
  // over-budget windows means a recurring stall; exactly one means a one-off,
  // which judge() then resolves by re-measuring rather than by guessing.
  const windowMaxes = steady.map((m) => +m[3]).sort((a, b) => b - a);
  const overBudget = windowMaxes.filter((v) => v > FRAME_BUDGET_MS);
  const result = { all, steady, worstMax, worstP99, windowMaxes, overBudget, loadavg: loadavg1() };
  cleanup();
  process.removeListener('exit', cleanup);
  return result;
}

// Exported for `npm run perf:logic-selftest`: judge() is the whole verdict
// policy and it is pure, so it is testable without launching Electron. If this
// file is required rather than run, do not launch anything.
module.exports = { judge, FRAME_BUDGET_MS, HARD_CEILING_MS };

if (require.main === module) {
  main().catch((e) => { console.error('[perf:eventloop] unexpected error:', e); process.exit(1); });
}
