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
const P99_BUDGET_MS = 16.7; // one 60fps frame
const RUN_MS = 30000; // boot + one 20s poll cycle + margin, so the reader reads
const ELD_RE = /eventloop p50=([\d.]+)ms p99=([\d.]+)ms max=([\d.]+)ms/g;

function log(m) { console.log(`[perf:eventloop] ${m}`); }

function killGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); }
  catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
}

async function main() {
  const electronBin = require('electron');
  const repoRoot = path.join(__dirname, '..', '..');
  const mainEntry = path.join(repoRoot, 'dist', 'electron', 'main.js');
  if (!fs.existsSync(mainEntry)) { console.error(`[perf:eventloop] FAIL: ${mainEntry} missing (run build:lib first)`); process.exit(1); }

  const scratchHome = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-eld-home-'));
  const scratchUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-perf-eld-ud-'));
  const corpus = makeCorpus(scratchHome);
  log(`corpus: ${corpus.totalFiles} transcripts (${corpus.claudeFiles} claude + ${corpus.codexFiles} codex), ${corpus.lines} lines each, ~${corpus.mb}MB`);

  const child = spawn(electronBin, [mainEntry, `--user-data-dir=${scratchUserData}`], {
    env: Object.assign({}, process.env, { HOME: scratchHome, HUMANCTL_PERF_EVENTLOOP: '1', ELECTRON_ENABLE_LOGGING: '1' }),
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

  // Take the WORST p99 the main process reported across the run.
  let worstP99 = 0, worstMax = 0, samples = 0;
  for (const m of stderr.matchAll(ELD_RE)) { samples++; worstP99 = Math.max(worstP99, +m[2]); worstMax = Math.max(worstMax, +m[3]); }
  killGroup(child);
  await new Promise((r) => setTimeout(r, 300));

  if (samples === 0) {
    console.error('[perf:eventloop] FAIL: no event-loop samples from main (did it boot? is HUMANCTL_PERF_EVENTLOOP wired?)');
    console.error(stderr.slice(-1500));
    cleanup();
    process.exit(1);
  }

  log(`samples: ${samples} | worst main-process event-loop delay p99=${worstP99.toFixed(1)}ms max=${worstMax.toFixed(1)}ms (budget p99 < ${P99_BUDGET_MS}ms)`);
  cleanup();
  process.removeListener('exit', cleanup);

  if (worstP99 > P99_BUDGET_MS) {
    console.error(`[perf:eventloop] FAIL: main-process event-loop p99 ${worstP99.toFixed(1)}ms exceeds the ${P99_BUDGET_MS}ms frame budget on a realistic fleet -- main stalls past a frame on every scan, dropping frames while the window is dragged. Move the transcript reader off the main process (utilityProcess).`);
    process.exit(1);
  }
  log(`PASS: main-process event-loop p99 ${worstP99.toFixed(1)}ms within one 60fps frame on a realistic fleet.`);
}

main().catch((e) => { console.error('[perf:eventloop] unexpected error:', e); process.exit(1); });
