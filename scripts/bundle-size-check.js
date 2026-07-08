#!/usr/bin/env node
'use strict';

// Renderer bundle-size guard. Cheap, dependency-free, and -- unlike
// perf:selftest -- it runs in CI, because it needs only a browser build (`vite
// build`, no Electron window, no display server). Wired into `npm run
// bundle:check`, which does the build first, and into .github/workflows/ci.yml's
// verify job. See docs/perf.md.
//
// Why a guard at all: nothing anywhere in this repo watched renderer bundle
// growth. A single careless `import` of a heavy library (a charting lib, a date
// lib, an icon set imported as a namespace) can add hundreds of KB to the
// renderer with no visible symptom in review, and every KB of JS is parse +
// compile time on the DESIGN.md cold-open SLO's critical path.
//
// The budget is a ceiling with deliberate headroom, not a target. When a change
// genuinely needs more, raise it here AND in docs/perf.md's SLO table in the
// same commit, and say why in the PR body.

const fs = require('fs');
const path = require('path');

// Sizes are stated in kB (1000 bytes), matching what `vite build` prints, so
// the number here and the number in the build log are directly comparable.
const KB = 1000;

// Measured 2026-07-07 on the browser build (`npm run renderer:build`):
// JS 532.86 kB, CSS 62.85 kB. Budgets are set ~12% above that: enough headroom
// for ordinary feature work, tight enough that a heavy new dependency trips it.
const BUDGETS = {
  js: 600 * KB,
  css: 72 * KB,
};

const ASSETS_DIR = path.join(__dirname, '..', 'electron', 'renderer-vite', 'dist', 'assets');

function totalBytes(files) {
  return files.reduce((sum, f) => sum + fs.statSync(path.join(ASSETS_DIR, f)).size, 0);
}

function kb(bytes) {
  return `${(bytes / KB).toFixed(2)} kB`;
}

function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    console.error(`[bundle:check] FAIL: no build output at ${ASSETS_DIR}`);
    console.error('[bundle:check] run `npm run renderer:build` first, or use `npm run bundle:check` which builds for you.');
    process.exit(1);
  }

  const entries = fs.readdirSync(ASSETS_DIR);
  const js = entries.filter((f) => f.endsWith('.js'));
  const css = entries.filter((f) => f.endsWith('.css'));

  if (js.length === 0) {
    console.error(`[bundle:check] FAIL: no .js emitted into ${ASSETS_DIR}; the build did not produce a renderer bundle.`);
    process.exit(1);
  }

  const jsBytes = totalBytes(js);
  const cssBytes = totalBytes(css);

  const rows = [
    ['JS ', jsBytes, BUDGETS.js, js.length],
    ['CSS', cssBytes, BUDGETS.css, css.length],
  ];

  let failed = false;
  for (const [label, actual, budget, count] of rows) {
    const pct = ((actual / budget) * 100).toFixed(1);
    const verdict = actual > budget ? 'OVER BUDGET' : 'ok';
    if (actual > budget) failed = true;
    console.log(
      `[bundle:check] ${label}  ${kb(actual).padStart(10)} / ${kb(budget).padStart(10)} budget  (${pct.padStart(5)}% of budget, ${count} file${count === 1 ? '' : 's'})  ${verdict}`,
    );
  }

  if (failed) {
    console.error('[bundle:check] FAIL -- the renderer bundle exceeded its budget.');
    console.error('[bundle:check] Either cut the growth, or raise the budget in scripts/bundle-size-check.js AND docs/perf.md, and justify it in the PR body.');
    process.exit(1);
  }

  console.log('[bundle:check] PASS -- renderer bundle within budget.');
}

main();
