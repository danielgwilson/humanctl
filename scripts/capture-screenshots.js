'use strict';

// Headless full-app screenshot capture over CDP (AGENTS.md "UI PRs" gate).
//
// Why headless Chrome and not Electron: the renderer's fixture fallback
// (electron/renderer-vite/src/lib/use-humanctl.ts) means the whole app --
// every view, both themes, session detail -- renders and is fully driveable
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
// What it produces: the five views (inbox, metrics, fleet, sessions,
// settings) x both themes, plus session detail x both themes, one PNG each,
// via window.__humanctlPerf (electron/renderer-vite/src/App.tsx) -- the same
// renderer-only test hook the perf gate uses, extended here with setTheme and
// openDetail. 12 PNGs total, written to --out (default output/screenshots,
// gitignored by the repo's top-level `output` entry). To produce the
// COMMITTED gate set under screenshots/<stage>/, pass that path explicitly:
// `npm run screenshots -- --out screenshots/<stage>`.
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
const VIEWS = ['inbox', 'metrics', 'fleet', 'sessions', 'settings'];
const THEMES = ['dark', 'light'];
const VIEWPORT = { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false };
// Extra settle time past rAF x2 + document.fonts.ready, covering the
// slowest CSS transition in the renderer (duration-500 utility classes --
// theme swap, sidebar, drawer) so a capture never lands mid-animation.
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

// Ensures a server is answering at http://localhost:<port>/. If one is
// already up (e.g. an operator already ran `npm run renderer:serve`),
// reuses it and does not touch its lifecycle. Otherwise builds the browser
// bundle (electron/renderer-vite's own `npm ci` guard is reproduced here
// since `renderer:build` itself does not carry it) and spawns
// scripts/serve-static.ts, the repo's zero-dependency static file server,
// against the fresh build.
async function ensureServer(port) {
  const url = `http://localhost:${port}/`;
  if (await pingServer(url)) {
    log(`reusing an already-running server at ${url}`);
    return { url, ownServer: false, child: null };
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
      const ready = await evalJS(cdp, `!!(window.__humanctlPerf && window.__humanctlPerf.setTheme && window.__humanctlPerf.openDetail)`);
      if (ready) { booted = true; break; }
      await new Promise((r) => setTimeout(r, BOOT_POLL_INTERVAL_MS));
    }
    if (!booted) throw new Error('renderer never exposed window.__humanctlPerf.setTheme/openDetail -- did the App.tsx perf hook change shape?');

    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT);

    for (const theme of THEMES) {
      await evalJS(cdp, `window.__humanctlPerf.setTheme(${JSON.stringify(theme)}); true`);
      await settle(cdp);

      for (const view of VIEWS) {
        await evalJS(cdp, `window.__humanctlPerf.setView(${JSON.stringify(view)}); true`);
        await settle(cdp);
        await capture(cdp, outDir, `${view}-${theme}.png`);
      }

      // Session detail: no id given, so the hook opens the first known
      // fixture session (App.tsx's openDetail default).
      await evalJS(cdp, `window.__humanctlPerf.openDetail(); true`);
      await settle(cdp);
      await capture(cdp, outDir, `session-detail-${theme}.png`);
    }

    log(`done: 12 PNGs in ${path.relative(REPO_ROOT, outDir)}`);
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
