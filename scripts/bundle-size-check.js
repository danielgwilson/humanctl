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
//
// Stage 3 (#69, fixes #64) adds a `fonts` budget: four self-hosted latin-subset
// woff2 files (Space Grotesk 500/600, JetBrains Mono 500/600), measured
// ~70.3 kB combined. docs/design-system.md section 10.4 pins this budget at
// roughly 90kB "give or take" -- 120kB leaves headroom for a future weight
// without inviting a full family-index import (which would pull latin-ext,
// cyrillic, greek, and vietnamese subsets, five @font-face blocks per family
// instead of one).
const BUDGETS = {
  js: 600 * KB,
  css: 72 * KB,
  fonts: 120 * KB,
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
  const fonts = entries.filter((f) => f.endsWith('.woff2'));

  // Zero emitted files of ANY of the three kinds must FAIL, never pass with a
  // 0.00 kB reading. Otherwise any build change that relocates or inlines an
  // artifact silently retires that budget forever and the gate reports a
  // green it did not earn. A gate that cannot fail is decoration (see
  // AGENTS.md). The fonts check is the one most likely to go quietly missing:
  // a font-loading regression (a bad @font-face src path, a build config that
  // stops emitting woff2 as a separate asset) produces a working-looking app
  // that silently fell back to the system face -- exactly issue #64's original
  // bug -- with no other signal anywhere in this script.
  if (js.length === 0) {
    console.error(`[bundle:check] FAIL: no .js emitted into ${ASSETS_DIR}; the build did not produce a renderer bundle.`);
    process.exit(1);
  }
  if (css.length === 0) {
    console.error(`[bundle:check] FAIL: no .css emitted into ${ASSETS_DIR}; the build did not produce a renderer stylesheet, so the CSS budget below would be vacuously satisfied.`);
    process.exit(1);
  }
  if (fonts.length === 0) {
    console.error(`[bundle:check] FAIL: no .woff2 emitted into ${ASSETS_DIR}; the build did not self-host the four latin-subset font files (docs/design-system.md 2.2), so the app would silently fall back to the system face (issue #64).`);
    process.exit(1);
  }

  const jsBytes = totalBytes(js);
  const cssBytes = totalBytes(css);
  const fontsBytes = totalBytes(fonts);

  const rows = [
    ['JS   ', jsBytes, BUDGETS.js, js.length],
    ['CSS  ', cssBytes, BUDGETS.css, css.length],
    ['FONTS', fontsBytes, BUDGETS.fonts, fonts.length],
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
