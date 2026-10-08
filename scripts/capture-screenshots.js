'use strict';

// Headless full-app screenshot capture over CDP (AGENTS.md "UI PRs" gate).
//
// Why headless Chrome and not Electron: the renderer's fixture adapter
// (electron/renderer-vite/src/runtime/fixture-adapter.ts) means the whole app,
// including every view, both themes, and session detail, is fully driveable
// in a plain browser tab with window.humanctl absent, no Electron preload
// bridge and no real session data required (see AGENTS.md's "Local
// development and testing" section). Electron itself has no headless mode,
// so it cannot run unattended on a CI box or a machine with no display; a
// stock, already-installed browser can. This script drives that same
// fixture-mode app with system Chrome in `--headless=new`, over the same
// minimal CDP client the LOCAL perf gate uses (scripts/perf-selftest/cdp.js),
// and the same ephemeral-debugging-port + stderr-announced-endpoint pattern
// as scripts/perf-selftest/run.js (see that file's header for the port/
// process-hygiene rationale this reuses verbatim).
//
// What it produces: the six views (inbox, metrics, fleet, brain, sessions,
// settings) x both themes, plus session detail x both themes, plus the
// chief-of-staff conversation x both themes, plus sidebar and chief-of-staff
// collapsed and sheet states x both themes, plus a rich Brain person detail
// in both themes, plus the Brain freshness paths in both themes: the stale
// fixture snapshot (`?brain=stale`: list, list with the source detail open,
// person page), a background source partial (`?brain=partial-other`: list,
// detail open), an ingest source partial while ingest reads ok
// (`?brain=partial-ingest`: list, detail open), and a snapshot past its
// staleAfter (`?brain=expired`: list, person page), one PNG each, via
// window.__humanctlPerf, the same renderer-only test hook the perf gate uses.
// Its compatibility surface is setTheme, setView, openDetail, and
// setChiefOfStaff. 42 PNGs
// total, written to --out (default output/screenshots, gitignored by the
// repo's top-level `output` entry). To produce the committed gate set under
// screenshots/<stage>/, pass that path explicitly:
// `npm run screenshots -- --out screenshots/<stage>`.
// The component catalog is not bundled in the app; review it standalone with
// `cd packages/ui && npm run catalog`.
//
// Usage: node scripts/capture-screenshots.js [--out <dir>] [--port <n>]
// Env: CHROME_BIN overrides the Chrome/Chromium binary path.
//
// One-shot only: every timeout in this file bounds a single launch/build/
// settle step of one script run, none of them recur or persist once the
// script exits. No new setInterval/setTimeout-driven poller is added to the
// app itself.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CDP, getPageTarget } = require('./perf-selftest/cdp');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_PORT = 4188;
const DEFAULT_OUT = path.join('output', 'screenshots');
const VIEWS = ['inbox', 'metrics', 'fleet', 'brain', 'sessions', 'settings'];
const THEMES = ['dark', 'light'];
const VIEWPORT = { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false };
// Extra settle time past rAF x2 + document.fonts.ready, covering the longest
// token-declared overlay transition plus process scheduling variance.
const SETTLE_EXTRA_MS = 400;
const LAUNCH_TIMEOUT_MS = 15000;
const BOOT_POLL_ATTEMPTS = 30;
const BOOT_POLL_INTERVAL_MS = 200;
const DEVTOOLS_LISTENING_RE = /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\S*)/;

function log(msg) { console.log(`[capture-screenshots] ${msg}`); }

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ---- Chrome discovery -------------------------------------------------

function resolveChromeBin() {
  if (process.env.CHROME_BIN) {
    const p = process.env.CHROME_BIN;
    if (fs.existsSync(p)) return p;
    throw new Error(
      `CHROME_BIN is set to "${p}" but no file exists there. Point CHROME_BIN at a real Chrome/Chromium executable, or unset it to use the default macOS Chrome path.`,
    );
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'No Chrome/Chromium binary found. Install Google Chrome at the default macOS location (/Applications/Google Chrome.app), or set CHROME_BIN to a Chrome/Chromium executable path. This script does not use Electron for capture -- Electron has no headless mode.',
  );
}

// ---- process hygiene (mirrors scripts/perf-selftest/run.js) -----------

function killGroup(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

function waitForExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function killAndWait(child) {
  killGroup(child);
  await waitForExit(child);
}

// ---- static server (build once, serve the production bundle) ---------

async function pingServer(url, timeoutMs = 800) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingServer(url)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`static server never answered ${url} within ${timeoutMs}ms`);
}

// Ensures a server is answering at http://localhost:<port>/. By DEFAULT it
// always builds the current bundle and serves that, so the gate can never
// certify a stale build (a running `renderer:serve` on the port would otherwise
// be reused silently, and the images would not match HEAD). Reuse is opt-in via
// HUMANCTL_SCREENSHOTS_REUSE_SERVER=1 for the fast local iteration loop only.
// Otherwise builds the browser bundle (electron/renderer-vite's own `npm ci`
// guard is reproduced here since `renderer:build` itself does not carry it) and
// spawns scripts/serve-static.ts, the repo's zero-dependency static file server.
async function ensureServer(port) {
  const url = `http://localhost:${port}/`;
  if (process.env.HUMANCTL_SCREENSHOTS_REUSE_SERVER === '1' && await pingServer(url)) {
    log(`reusing an already-running server at ${url} (HUMANCTL_SCREENSHOTS_REUSE_SERVER=1)`);
    return { url, ownServer: false, child: null };
  }
  if (await pingServer(url)) {
    throw new Error(`a server is already listening on ${url}; refusing to reuse it (it may serve a stale build). Stop it, or set HUMANCTL_SCREENSHOTS_REUSE_SERVER=1 to opt in.`);
  }

  const rendererDir = path.join(REPO_ROOT, 'electron', 'renderer-vite');
  const rendererNodeModules = path.join(rendererDir, 'node_modules');
  if (!fs.existsSync(rendererNodeModules)) {
    log('electron/renderer-vite/node_modules missing; running npm ci there first...');
    execFileSync('npm', ['ci'], { cwd: rendererDir, stdio: 'inherit' });
  }
  log('building the renderer production bundle (npm run renderer:build)...');
  execFileSync('npm', ['run', 'renderer:build'], { cwd: REPO_ROOT, stdio: 'inherit' });

  const distDir = path.join(rendererDir, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error(`renderer:build did not produce ${distDir}`);
  }

  const tsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  log(`starting scripts/serve-static.ts on port ${port}...`);
  const child = spawn(tsxBin, ['scripts/serve-static.ts', '--dir', distDir, '--port', String(port)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForServer(url);
  log(`server up at ${url}`);
  return { url, ownServer: true, child };
}

// ---- headless Chrome + CDP ---------------------------------------------

// Launches Chrome headless, navigating straight to `url`, and resolves once
// the DevTools ws:// endpoint THIS child announced has been parsed out of
// its own stderr -- same discovery pattern as scripts/perf-selftest/run.js's
// launchElectron: never a fixed/guessed port, always the one this exact
// child just reported.
function launchChrome({ chromeBin, url, scratchUserData, timeoutMs = LAUNCH_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBin, [
      '--headless=new',
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${scratchUserData}`,
      '--window-size=1600,1000',
      '--force-color-profile=srgb',
      url,
    ], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error(`Chrome never printed a DevTools ws:// endpoint within ${timeoutMs}ms`), { child, stderr }));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (settled) return;
      const m = stderr.match(DEVTOOLS_LISTENING_RE);
      if (m) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, browserWsUrl: m[1], port: Number(m[2]) });
      }
    });
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(err, { child, stderr }));
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error(`Chrome exited early (code ${code}, signal ${signal}) before printing a DevTools endpoint`), { child, stderr }));
    });
  });
}

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

async function evalJS(cdp, expression, awaitPromise = false) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(`renderer eval threw: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
  return r.result.value;
}

// rAF x2 (one frame to apply the state change, one to paint it) plus
// document.fonts.ready, then a fixed extra delay past the app's slowest
// declared CSS transition (see SETTLE_EXTRA_MS above).
async function settle(cdp) {
  await evalJS(cdp, `
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => resolve(true));
        else resolve(true);
      }));
    })
  `, true);
  await new Promise((r) => setTimeout(r, SETTLE_EXTRA_MS));
}

function assert(condition, message) {
  if (!condition) throw new Error(`foundation assertion failed: ${message}`);
}

async function dispatchKeyChord(cdp, { code, key, modifiers }) {
  const keyCode = { Tab: 9, Enter: 13, Escape: 27 }[key] || key.toUpperCase().charCodeAt(0);
  const base = {
    code,
    key,
    modifiers,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function shellGeometry(cdp) {
  return evalJS(cdp, `(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    return {
      activeTag: document.activeElement?.tagName || null,
      focusVisible: document.querySelector(':focus-visible')?.tagName || null,
      bodyFont: getComputedStyle(document.body).fontFamily,
      geistLoaded: document.fonts.check('400 14px "Geist Variable"'),
      leftGap: rect('[data-slot="sidebar-gap"]'),
      rightRail: rect('[data-slot="app-assistant"]'),
      row: rect('[data-slot="list-row"]'),
      mobileSidebar: rect('[data-sidebar="sidebar"][data-mobile="true"]'),
      chief: rect('section[aria-label="Chief of staff"]'),
      fit: {
        width: innerWidth,
        height: innerHeight,
        scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      },
    };
  })()`);
}

async function assertFoundationBehavior(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('inbox'); window.__humanctlPerf.setChiefOfStaff(false); true`);
  await settle(cdp);
  const initial = await shellGeometry(cdp);
  assert(initial.activeTag === 'BODY', `launch focus owner should be BODY, received ${initial.activeTag}`);
  assert(initial.focusVisible === null, `launch should have no :focus-visible artifact, received ${initial.focusVisible}`);
  assert(initial.bodyFont.includes('Geist Variable'), `body should use Geist Variable, received ${initial.bodyFont}`);
  assert(initial.geistLoaded, 'Geist Variable should be loaded before capture');
  assert(Math.abs((initial.leftGap?.width || 0) - 275) < 1, `left rail should be 275px, received ${initial.leftGap?.width}`);
  assert(Math.abs((initial.row?.height || 0) - 46) < 1, `task rows should be 46px, received ${initial.row?.height}`);
  assert(!initial.fit.scrollX && !initial.fit.scrollY, 'desktop shell should not scroll at the document root');

  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
  await settle(cdp);
  const leftClosed = await shellGeometry(cdp);
  assert((leftClosed.leftGap?.width || 0) < 1, `Command+B should close only the left rail, received ${leftClosed.leftGap?.width}`);
  assert(leftClosed.rightRail === null, 'Command+B must not open the right rail');

  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
  await settle(cdp);
  const leftReopened = await shellGeometry(cdp);
  assert(Math.abs((leftReopened.leftGap?.width || 0) - 275) < 1, 'second Command+B should restore the left rail');

  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 5 });
  await settle(cdp);
  const rightOpen = await shellGeometry(cdp);
  assert(Math.abs((rightOpen.rightRail?.width || 0) - 360) < 1, `Command+Option+B should open a 360px right rail, received ${rightOpen.rightRail?.width}`);
  assert(Math.abs((rightOpen.leftGap?.width || 0) - 275) < 1, 'Command+Option+B must not toggle the left rail');

  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 5 });
  await settle(cdp);
  assert((await shellGeometry(cdp)).rightRail === null, 'second Command+Option+B should close the right rail');

  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 760, height: 500 });
  await settle(cdp);
  const compact = await shellGeometry(cdp);
  assert(!compact.fit.scrollX && !compact.fit.scrollY, 'minimum desktop viewport should not scroll at the document root');
  assert((compact.leftGap?.width || 0) < 1, 'left rail should use compact Sheet behavior at 760px');

  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
  await settle(cdp);
  const compactLeftOpen = await shellGeometry(cdp);
  assert(
    Math.abs((compactLeftOpen.mobileSidebar?.width || 0) - 275) < 1,
    `Command+B should open a 275px left Sheet at compact width, received ${compactLeftOpen.mobileSidebar?.width}`,
  );
  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
  await settle(cdp);

  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 5 });
  await settle(cdp);
  const compactRightOpen = await shellGeometry(cdp);
  assert(
    Math.abs((compactRightOpen.chief?.width || 0) - 360) < 1,
    `Command+Option+B should open a 360px right Sheet at compact width, received ${compactRightOpen.chief?.width}`,
  );
  await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 5 });
  await settle(cdp);

  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await settle(cdp);
  log('foundation assertions passed: font, focus, 46px rows, rail geometry, exact shortcuts, compact Sheets, viewport fit');
}

async function assertBrainSearchBehavior(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  await dispatchKeyChord(cdp, { code: 'Slash', key: '/', modifiers: 0 });
  await settle(cdp);
  const focused = await evalJS(cdp, `document.activeElement?.getAttribute('aria-label')`);
  assert(focused === 'Search people', `Slash should focus Brain people search, received ${focused}`);
  await cdp.send('Input.insertText', { text: 'mara sensor' });
  await settle(cdp);
  const filtered = await evalJS(cdp, `(() => {
    const input = document.querySelector('input[aria-label="Search people"]');
    const rows = [...document.querySelectorAll('table tbody tr')].map((row) => row.textContent || '');
    return { value: input?.value || '', rows };
  })()`);
  assert(filtered.value === 'mara sensor', `Brain search input should retain the query, received ${filtered.value}`);
  assert(filtered.rows.length === 1, `Brain search should rerender to one row, received ${filtered.rows.length}`);
  assert(filtered.rows[0].includes('Mara Voss'), `Brain search should retain the matching synthetic person, received ${filtered.rows[0]}`);
  const countText = await evalJS(cdp, `document.querySelector('[data-slot="filter-toolbar"] [aria-live="polite"]')?.textContent?.trim()`);
  assert(countText === '1 person', `Brain search should use the correct singular count, received ${countText}`);
  await evalJS(cdp, `(() => {
    const input = document.querySelector('input[aria-label="Search people"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (input && setter) { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  })()`);
  await settle(cdp);
  log('Brain assertions passed: Slash focus and live multi-term person filtering');
}

async function assertBrainDossierBehavior(cdp) {
  const input = await evalJS(cdp, `document.querySelector('input[aria-label="Search people"]')?.focus(); true`);
  assert(input === true, 'Brain person search should be focusable before keyboard navigation');
  await dispatchKeyChord(cdp, { code: 'Tab', key: 'Tab', modifiers: 0 });
  await settle(cdp);
  const focusedId = await evalJS(cdp, `document.activeElement?.getAttribute('data-brain-person-id')`);
  assert(focusedId === 'person:mara-voss', `Tab should land on the first person row, received ${focusedId}`);
  await dispatchKeyChord(cdp, { code: 'Enter', key: 'Enter', modifiers: 0 });
  await settle(cdp);
  const dossier = await evalJS(cdp, `(() => ({
    text: document.querySelector('[data-slot="page-frame"]')?.textContent || '',
    h2: [...document.querySelectorAll('[data-slot="page-frame"] h2')].map((node) => node.textContent || ''),
    h3: [...document.querySelectorAll('[data-slot="page-frame"] h3')].map((node) => node.textContent || ''),
    items: [...document.querySelectorAll('[data-slot="page-frame"] li')].map((node) => node.textContent || ''),
    evidence: document.querySelectorAll('[data-slot="page-frame"] blockquote').length,
  }))()`);
  assert(dossier.text.includes('TL;DR') && dossier.text.includes('Next'), `person detail should render the brief and next action, received ${dossier.text.slice(0, 500)}`);
  assert(dossier.h2.includes('Current state') && dossier.h3.includes('Open decisions'), 'person detail should preserve H2/H3 hierarchy');
  assert(dossier.items.includes('She owns sensor constraints and pilot acceptance.'), 'person detail should render structured list items');
  assert(dossier.text.includes('Desmond Ilori'), 'person detail should render a resolved relationship');
  assert(dossier.text.includes('Aurora Pilot'), 'person detail should resolve a non-person relationship without adding it to People');
  assert(dossier.evidence === 2, `person detail should render two evidence rows, received ${dossier.evidence}`);
  await evalJS(cdp, `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('All people'))?.click(); true`);
  await settle(cdp);
  const restoredId = await evalJS(cdp, `document.activeElement?.getAttribute('data-brain-person-id')`);
  assert(restoredId === 'person:mara-voss', `Back should restore focus to the originating person, received ${restoredId}`);
  log('Brain dossier assertions passed: keyboard open, hierarchy, list, relation, evidence, and focus restore');
}

async function brainFreshnessState(cdp) {
  return evalJS(cdp, `(() => {
    const banner = document.querySelector('[data-brain-freshness]');
    const tile = document.querySelector('[data-brain-vital="Last ingest"]');
    const age = document.querySelector('[data-brain-snapshot-age]');
    const detail = document.querySelector('[data-brain-source-detail]');
    const rows = banner ? [...banner.querySelectorAll('[data-brain-banner-source]')] : [];
    return {
      banner: banner ? banner.textContent || '' : null,
      bannerHeight: banner ? Math.round(banner.getBoundingClientRect().height) : 0,
      sources: rows.length,
      sourceRowsOneLine: rows.every((row) => row.getBoundingClientRect().height <= 24 && row.scrollHeight <= 24),
      more: banner ? (banner.querySelector('[data-brain-banner-more]')?.textContent || null) : null,
      tile: tile ? tile.textContent || '' : null,
      tileTone: tile ? tile.getAttribute('data-brain-vital-tone') : null,
      age: age ? { state: age.getAttribute('data-brain-snapshot-age'), text: age.textContent || '' } : null,
      detail: detail ? { open: detail.open, summary: detail.querySelector('summary')?.textContent || '', text: detail.textContent || '' } : null,
    };
  })()`);
}

// Open (true) or close (false) the collapsed source detail through its
// summary, the way a keyboard or pointer user would.
async function setSourceDetail(cdp, open) {
  await evalJS(cdp, `(() => { const d = document.querySelector('[data-brain-source-detail]'); if (d && d.open !== ${open}) d.querySelector('summary').click(); return true })()`);
  await settle(cdp);
}

// Healthy fixture: no banner, an ISO last-ingest rendered as date plus age,
// a fresh snapshot age in the header, and no source detail.
async function assertBrainHealthyFreshness(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  const state = await brainFreshnessState(cdp);
  assert(state.banner === null, `healthy Brain snapshot should show no stale banner, received ${state.banner}`);
  assert(state.tile && /ago · clean/.test(state.tile) && state.tileTone === null, `healthy Last ingest tile should read "<age> ago · clean" in the neutral tone, received ${state.tile} (${state.tileTone})`);
  assert(state.age && state.age.state === 'fresh' && / ago$/.test(state.age.text.trim()), `header should show a fresh snapshot age, received ${JSON.stringify(state.age)}`);
  assert(state.detail === null, 'healthy Brain snapshot should show no source detail');
  log('Brain freshness assertions passed: healthy snapshot shows no banner, a dated ingest, a fresh age, and no source detail');
}

// Stale fixture (?brain=stale): the banner carries the producer notice and at
// most three ingest sources, one line each, on both the list and the person
// page; the background source and the overflow live in the collapsed detail.
async function assertBrainStaleFreshness(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  const list = await brainFreshnessState(cdp);
  assert(list.banner && list.banner.includes('16 days behind'), `stale Brain snapshot should show the producer notice, received ${list.banner}`);
  assert(list.sources === 3, `stale banner should cap its source list at three, received ${list.sources}`);
  assert(list.sourceRowsOneLine, 'every banner source row should be one line');
  assert(list.more && list.more.includes('+1 more'), `stale banner should count the ingest source it left out, received ${list.more}`);
  assert(!list.banner.includes('Message archive'), 'a source that does not affect ingest must stay out of the banner');
  assert(list.banner.includes('data through') && list.banner.includes('16d ago'), `stale banner should show the data-through age, received ${list.banner}`);
  assert(list.tile && /16d ago · stale/.test(list.tile) && list.tileTone === 'warn', `stale Last ingest tile should read "16d ago · stale" in the warning tone, received ${list.tile} (${list.tileTone})`);
  assert(list.detail && !list.detail.open && list.detail.summary.includes('5 sources not current'), `stale list should show a collapsed source detail for all five sources, received ${JSON.stringify(list.detail)}`);
  await setSourceDetail(cdp, true);
  const opened = await brainFreshnessState(cdp);
  assert(opened.detail.open && opened.detail.text.includes('Message archive') && opened.detail.text.includes('export paused by its owner'), 'the opened source detail should list the background source with its full note');
  await setSourceDetail(cdp, false);
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 1280, height: 720 });
  await settle(cdp);
  const small = await brainFreshnessState(cdp);
  assert(small.bannerHeight <= 160 && small.sourceRowsOneLine, `at 1280x720 the stale banner should stay compact with one-line rows, received ${small.bannerHeight}px`);
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await settle(cdp);
  await openFixtureBrainDossier(cdp);
  const person = await brainFreshnessState(cdp);
  assert(person.banner && person.banner.includes('16 days behind') && person.sources === 3, `person page should repeat the capped stale banner, received ${person.banner}`);
  await evalJS(cdp, `[...document.querySelectorAll('button')].find((button) => button.textContent?.includes('All people'))?.click(); true`);
  await settle(cdp);
  log(`Brain freshness assertions passed: stale banner capped at 3 one-line sources (${small.bannerHeight}px at 1280x720), overflow count, collapsed detail, stale tile, and person-page banner`);
}

// A background source partial (?brain=partial-other): no banner, a clean tile,
// and the source only in the collapsed detail.
async function assertBrainPartialOtherFreshness(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  const state = await brainFreshnessState(cdp);
  assert(state.banner === null, `a background source should not raise the banner, received ${state.banner}`);
  assert(state.tile && /ago · clean/.test(state.tile) && state.tileTone === null, `a background source should leave the tile clean, received ${state.tile} (${state.tileTone})`);
  assert(state.detail && !state.detail.open && state.detail.summary.includes('1 other source not current'), `a background source should sit in a collapsed detail, received ${JSON.stringify(state.detail)}`);
  await setSourceDetail(cdp, true);
  const opened = await brainFreshnessState(cdp);
  assert(opened.detail.text.includes('2 of 3 mailboxes read'), 'the opened detail should show the background source note');
  await setSourceDetail(cdp, false);
  log('Brain freshness assertions passed: a background source stays out of the banner and the tile');
}

// An ingest source partial while ingestOk is true (?brain=partial-ingest): no
// banner, but the tile names it in the notice tone instead of reading clean.
async function assertBrainPartialIngestFreshness(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  const state = await brainFreshnessState(cdp);
  assert(state.banner === null, `ingestOk true should not raise the banner, received ${state.banner}`);
  assert(state.tile && state.tile.includes('1 source partial') && state.tileTone === 'notice', `the tile should name the partial ingest source in the notice tone, received ${state.tile} (${state.tileTone})`);
  await setSourceDetail(cdp, true);
  const opened = await brainFreshnessState(cdp);
  assert(/Calendar · partial · data through \w+ \d+, today/.test(opened.detail.text), `a date-only dataThrough should age in calendar days, received ${opened.detail.text}`);
  await setSourceDetail(cdp, false);
  log('Brain freshness assertions passed: a partial ingest source shows in the tile hint, and a date-only value reads today');
}

// Past staleAfter (?brain=expired): the banner fires although ingestOk is
// true, lists no sources, and the tile reads unverified, never clean.
async function assertBrainExpiredFreshness(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  const state = await brainFreshnessState(cdp);
  assert(state.banner && state.banner.includes('past its refresh time') && state.sources === 0, `a snapshot past staleAfter should raise a source-free banner, received ${state.banner}`);
  assert(state.tile && /unverified/.test(state.tile) && state.tileTone === 'warn', `a snapshot past staleAfter should read unverified on the tile, received ${state.tile} (${state.tileTone})`);
  assert(state.age && state.age.state === 'stale', `the header should flag a snapshot past staleAfter, received ${JSON.stringify(state.age)}`);
  log('Brain freshness assertions passed: past staleAfter raises the banner and the tile reads unverified');
}

async function bootBrainVariant(cdp, url, variant) {
  await cdp.send('Page.navigate', { url: `${url}?brain=${variant}` });
  for (let i = 0; i < BOOT_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, BOOT_POLL_INTERVAL_MS));
    const ready = await evalJS(cdp, `location.search === ${JSON.stringify(`?brain=${variant}`)} && !!(window.__humanctlPerf && window.__humanctlPerf.setTheme)`);
    if (ready) {
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
      return;
    }
  }
  throw new Error(`renderer never booted with ?brain=${variant}`);
}

async function openFixtureBrainDossier(cdp) {
  await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
  await settle(cdp);
  await evalJS(cdp, `document.querySelector('[data-brain-person-id="person:mara-voss"]')?.click(); true`);
  await settle(cdp);
}

async function capture(cdp, outDir, filename) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, Buffer.from(r.data, 'base64'));
  const size = fs.statSync(outPath).size;
  log(`wrote ${path.relative(REPO_ROOT, outPath)} (${size} bytes)`);
}

async function main() {
  const outArg = arg('out', DEFAULT_OUT);
  const outDir = path.isAbsolute(outArg) ? outArg : path.join(REPO_ROOT, outArg);
  const port = Number(arg('port', String(DEFAULT_PORT)));

  // Resolve Chrome FIRST, before any build/serve work, so a missing browser
  // fails fast and loudly instead of burning a renderer build first.
  const chromeBin = resolveChromeBin();
  log(`using Chrome: ${chromeBin}`);

  fs.mkdirSync(outDir, { recursive: true });

  const { url, ownServer, child: serverChild } = await ensureServer(port);

  const scratchUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'humanctl-shots-'));
  let chromeChild = null;
  let cdp = null;
  try {
    const { child, port: cdpPort } = await launchChrome({ chromeBin, url, scratchUserData });
    chromeChild = child;
    log(`Chrome DevTools endpoint on ephemeral port ${cdpPort} (read from child stderr)`);

    const page = await waitForPageTarget(cdpPort);
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    let booted = false;
    for (let i = 0; i < BOOT_POLL_ATTEMPTS; i++) {
      const ready = await evalJS(cdp, `!!(window.__humanctlPerf && window.__humanctlPerf.setTheme && window.__humanctlPerf.openDetail && window.__humanctlPerf.setChiefOfStaff)`);
      if (ready) { booted = true; break; }
      await new Promise((r) => setTimeout(r, BOOT_POLL_INTERVAL_MS));
    }
    if (!booted) throw new Error('renderer never exposed the required screenshot hooks; did the product perf hook change shape?');

    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
    await assertFoundationBehavior(cdp);
    await assertBrainSearchBehavior(cdp);
    await assertBrainDossierBehavior(cdp);
    await assertBrainHealthyFreshness(cdp);

    for (const theme of THEMES) {
      await evalJS(cdp, `window.__humanctlPerf.setTheme(${JSON.stringify(theme)}); true`);
      await settle(cdp);

      for (const view of VIEWS) {
        await evalJS(cdp, `window.__humanctlPerf.setView(${JSON.stringify(view)}); true`);
        await settle(cdp);
        await capture(cdp, outDir, `${view}-${theme}.png`);
      }

      await openFixtureBrainDossier(cdp);
      await capture(cdp, outDir, `brain-person-detail-${theme}.png`);

      // Session detail: no id given, so the hook opens the first known
      // fixture session (the product hook's openDetail default).
      await evalJS(cdp, `window.__humanctlPerf.openDetail(); true`);
      await settle(cdp);
      await capture(cdp, outDir, `session-detail-${theme}.png`);

      await evalJS(cdp, `window.__humanctlPerf.setChiefOfStaff(true); true`);
      await settle(cdp);
      await capture(cdp, outDir, `chief-of-staff-${theme}.png`);
      await evalJS(cdp, `window.__humanctlPerf.setChiefOfStaff(false); true`);
      await settle(cdp);

      // Reset to the neutral list state before capturing shell geometry so the
      // proof images isolate the rail behavior from the prior detail fixture.
      await evalJS(cdp, `window.__humanctlPerf.setView('inbox'); true`);
      await settle(cdp);

      await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
      await settle(cdp);
      await capture(cdp, outDir, `sidebar-collapsed-${theme}.png`);
      await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
      await settle(cdp);

      await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 760, height: 840 });
      await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
      await settle(cdp);
      await capture(cdp, outDir, `sidebar-sheet-${theme}.png`);
      await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 4 });
      await settle(cdp);
      await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 5 });
      await settle(cdp);
      await capture(cdp, outDir, `chief-of-staff-sheet-${theme}.png`);
      await dispatchKeyChord(cdp, { code: 'KeyB', key: 'b', modifiers: 5 });
      await settle(cdp);
      await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
      await settle(cdp);
    }

    // Brain freshness passes: reload the same bundle with each fixture variant
    // so every warning path is captured and asserted, not just the healthy one.
    const brainPasses = [
      { variant: 'stale', check: assertBrainStaleFreshness, shots: ['list', 'open', 'person'] },
      { variant: 'partial-other', check: assertBrainPartialOtherFreshness, shots: ['list', 'open'] },
      { variant: 'partial-ingest', check: assertBrainPartialIngestFreshness, shots: ['list', 'open'] },
      { variant: 'expired', check: assertBrainExpiredFreshness, shots: ['list', 'person'] },
    ];
    let brainShots = 0;
    for (const pass of brainPasses) {
      await bootBrainVariant(cdp, url, pass.variant);
      await pass.check(cdp);
      for (const theme of THEMES) {
        await evalJS(cdp, `window.__humanctlPerf.setTheme(${JSON.stringify(theme)}); window.__humanctlPerf.setView('inbox'); true`);
        await settle(cdp);
        await evalJS(cdp, `window.__humanctlPerf.setView('brain'); true`);
        await settle(cdp);
        for (const shot of pass.shots) {
          if (shot === 'person') await openFixtureBrainDossier(cdp);
          if (shot === 'open') await setSourceDetail(cdp, true);
          await capture(cdp, outDir, shot === 'person' ? `brain-person-${pass.variant}-${theme}.png` : `brain-${pass.variant}${shot === 'open' ? '-open' : ''}-${theme}.png`);
          if (shot === 'open') await setSourceDetail(cdp, false);
          brainShots += 1;
        }
      }
    }

    log(`done: ${(VIEWS.length + 6) * THEMES.length + brainShots} PNGs in ${path.relative(REPO_ROOT, outDir)}`);
  } finally {
    if (cdp) cdp.close();
    if (chromeChild) await killAndWait(chromeChild);
    if (ownServer && serverChild) await killAndWait(serverChild);
    try { fs.rmSync(scratchUserData, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  }
}

main().catch((err) => {
  console.error(`[capture-screenshots] FAIL: ${err.message}`);
  process.exit(1);
});
