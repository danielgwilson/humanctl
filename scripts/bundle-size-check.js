#!/usr/bin/env node
'use strict';

// Renderer bundle-size guard. It runs in CI from a browser build and needs no
// display server. The initial-JS budget covers module scripts and modulepreload
// links referenced by index.html. Lazy chunks have a separate total-JS ceiling,
// so a development-only catalog does not consume cold-open budget but still
// cannot grow without a bound.

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const KB = 1000;

// Measured 2026-07-15 after restoring the full Registry Sidebar and Typeset:
// 543.40 kB initial JS, 689.80 kB total JS, 80.95 kB initial CSS, 99.90 kB
// total CSS, and 76.42 kB of Geist Variable WOFF2 files. Typeset is isolated
// to the lazy conversation chunk, so rich prose does not consume the shell's
// cold-open CSS budget. Initial and total CSS have distinct ceilings.
const BUDGETS = {
  initialJs: 600 * KB,
  totalJs: 700 * KB,
  initialCss: 84 * KB,
  totalCss: 104 * KB,
  fonts: 120 * KB,
};

const DIST_DIR = path.join(__dirname, '..', 'electron', 'renderer-vite', 'dist');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');
const INDEX_PATH = path.join(DIST_DIR, 'index.html');

function walkFiles(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

function totalBytes(files) {
  return files.reduce((sum, file) => sum + fs.statSync(path.join(ASSETS_DIR, file)).size, 0);
}

function kb(bytes) {
  return `${(bytes / KB).toFixed(2)} kB`;
}

function attributeValue(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] ?? null : null;
}

function assetJavaScriptPath(url) {
  if (!url || /^(?:[a-z]+:)?\/\//i.test(url)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(url.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  } catch {
    return null;
  }
  decoded = decoded.replace(/^\.?\//, '');
  if (!decoded.startsWith('assets/') || !decoded.endsWith('.js')) return null;
  const relative = path.posix.normalize(decoded.slice('assets/'.length));
  if (!relative || relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) return null;
  return relative.split('/').join(path.sep);
}

function assetCssPath(url) {
  if (!url || /^(?:[a-z]+:)?\/\//i.test(url)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(url.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  } catch {
    return null;
  }
  decoded = decoded.replace(/^\.?\//, '');
  if (!decoded.startsWith('assets/') || !decoded.endsWith('.css')) return null;
  const relative = path.posix.normalize(decoded.slice('assets/'.length));
  if (!relative || relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) return null;
  return relative.split('/').join(path.sep);
}

function initialJavaScriptFiles(html) {
  const files = new Set();
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if ((attributeValue(tag, 'type') || '').toLowerCase() !== 'module') continue;
    const file = assetJavaScriptPath(attributeValue(tag, 'src'));
    if (file) files.add(file);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('modulepreload')) continue;
    const file = assetJavaScriptPath(attributeValue(tag, 'href'));
    if (file) files.add(file);
  }
  return [...files].sort();
}

function initialCssFiles(html) {
  const files = new Set();
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attributeValue(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet')) continue;
    const file = assetCssPath(attributeValue(tag, 'href'));
    if (file) files.add(file);
  }
  return [...files].sort();
}

function runSelftest() {
  const html = `<!doctype html>
    <link href="/assets/vendor.js?build=1" crossorigin rel="stylesheet modulepreload">
    <script crossorigin src='/assets/index.js#entry' type=module></script>
    <script type="module" src="https://example.com/external.js"></script>
    <script type="application/json" src="/assets/not-entry.js"></script>`;
  assert.deepEqual(initialJavaScriptFiles(html), ['index.js', 'vendor.js']);
  assert.deepEqual(initialCssFiles(html), []);
  assert.equal(assetJavaScriptPath('/assets/../escape.js'), null);
  assert.equal(assetCssPath('/assets/../escape.css'), null);
  assert.equal(assetJavaScriptPath('/assets/product-catalog.js'), 'product-catalog.js');
  assert.equal(assetCssPath('/assets/index.css?build=1'), 'index.css');
  assert.deepEqual(initialJavaScriptFiles('<script type="module" src="/assets/index.js"></script>'), ['index.js']);
  assert.deepEqual(initialCssFiles('<link rel="stylesheet" href="/assets/index.css">'), ['index.css']);
  console.log('[bundle:check] entry parser selftest passed');
}

function main() {
  if (process.argv.includes('--selftest')) {
    runSelftest();
    return;
  }
  if (!fs.existsSync(ASSETS_DIR) || !fs.existsSync(INDEX_PATH)) {
    console.error(`[bundle:check] FAIL: expected build output at ${INDEX_PATH} and ${ASSETS_DIR}`);
    console.error('[bundle:check] run `npm run renderer:build` first, or use `npm run bundle:check`.');
    process.exit(1);
  }

  const entries = walkFiles(ASSETS_DIR);
  const javascript = entries.filter((file) => file.endsWith('.js'));
  const css = entries.filter((file) => file.endsWith('.css'));
  const fonts = entries.filter((file) => file.endsWith('.woff2'));
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const initialJavascript = initialJavaScriptFiles(html);
  const initialCss = initialCssFiles(html);

  if (javascript.length === 0 || css.length === 0 || fonts.length === 0 || initialJavascript.length === 0 || initialCss.length === 0) {
    if (javascript.length === 0) console.error(`[bundle:check] FAIL: no .js files emitted into ${ASSETS_DIR}`);
    if (css.length === 0) console.error(`[bundle:check] FAIL: no .css files emitted into ${ASSETS_DIR}`);
    if (fonts.length === 0) console.error('[bundle:check] FAIL: no .woff2 files emitted; Geist Variable would fall back to a system font.');
    if (initialJavascript.length === 0) console.error(`[bundle:check] FAIL: ${INDEX_PATH} references no local module entry or modulepreload JavaScript.`);
    if (initialCss.length === 0) console.error(`[bundle:check] FAIL: ${INDEX_PATH} references no local stylesheet.`);
    process.exit(1);
  }

  const javascriptSet = new Set(javascript);
  const missingInitialFiles = initialJavascript.filter((file) => !javascriptSet.has(file));
  if (missingInitialFiles.length > 0) {
    console.error(`[bundle:check] FAIL: index.html references missing JavaScript: ${missingInitialFiles.join(', ')}`);
    process.exit(1);
  }

  const initialJsBytes = totalBytes(initialJavascript);
  const totalJsBytes = totalBytes(javascript);
  const initialCssBytes = totalBytes(initialCss);
  const totalCssBytes = totalBytes(css);
  const fontBytes = totalBytes(fonts);
  const rows = [
    ['INITIAL JS', initialJsBytes, BUDGETS.initialJs, initialJavascript.length],
    ['TOTAL JS  ', totalJsBytes, BUDGETS.totalJs, javascript.length],
    ['INITIAL CSS', initialCssBytes, BUDGETS.initialCss, initialCss.length],
    ['TOTAL CSS  ', totalCssBytes, BUDGETS.totalCss, css.length],
    ['FONTS     ', fontBytes, BUDGETS.fonts, fonts.length],
  ];

  let failed = false;
  for (const [label, actual, budget, count] of rows) {
    const percent = ((actual / budget) * 100).toFixed(1);
    const verdict = actual > budget ? 'OVER BUDGET' : 'ok';
    if (actual > budget) failed = true;
    console.log(
      `[bundle:check] ${label}  ${kb(actual).padStart(10)} / ${kb(budget).padStart(10)} budget  (${percent.padStart(5)}% of budget, ${count} file${count === 1 ? '' : 's'})  ${verdict}`,
    );
  }
  console.log(`[bundle:check] initial JS files: ${initialJavascript.join(', ')}`);
  console.log(`[bundle:check] initial CSS files: ${initialCss.join(', ')}`);

  if (failed) {
    console.error('[bundle:check] FAIL: renderer output exceeded a hard bundle budget.');
    console.error('[bundle:check] Cut critical or total growth, or update this script and docs/perf.md with a measured justification.');
    process.exit(1);
  }
  console.log('[bundle:check] PASS: initial and total renderer output are within budget.');
}

main();
