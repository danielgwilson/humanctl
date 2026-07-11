// Runtime harness-icon extraction (PR-2 item 1, DESIGN.md public-repo hygiene):
// read the LOCALLY INSTALLED harness app's own icon from its bundle, at
// runtime, on this machine, never committed to the repo. This module is
// plain Node (no Electron import) so it selftests without a display; the
// actual pixel decode (nativeImage) happens in electron/main.ts, which is
// the only place Electron is available.
//
// Contract (spec item 1): read the app bundle's Info.plist CFBundleIconFile
// (never assume a fixed icns filename -- Claude ships electron.icns, Codex
// ships icon.icns, both under Contents/Resources), resolve to the real
// .icns file on disk, and let the caller downscale + cache it under Electron
// userData (never the repo, never a ~/.humanctl watched path). ANY failure
// (missing app, missing/unreadable plist, missing icon file) must resolve to
// null so the caller falls back silently to the built-in glyph. Fixture mode
// never calls this at all (it always uses glyphs).

// Every step here is async on purpose. This module is reached from Electron's
// MAIN process (electron/main.ts's icon handler), and AGENTS.md's rule is
// absolute: never block the main process. `plutil` is a process SPAWN, and
// spawning it synchronously stalls the main thread well past one 60fps frame,
// i.e. a visibly dropped frame while the window is being dragged. The old
// `execFileSync` form measured 31.9ms of steady-state main-process stall in
// `npm run perf:eventloop`. That cost is real and user-facing, not a test
// artifact: the icon cache lives in Electron userData, so it is cold on the
// first launch of every install (and after any userData reset).
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try { await fs.promises.access(p); return true; } catch { return false; }
}

export type Harness = 'claude-code' | 'codex';

// One well-known install location per harness, matched against the harness
// key used everywhere else in the codebase ('claude-code' | 'codex'). Only
// the two harnesses humanctl already knows about; unrecognized values fall
// back to null (glyph) by construction.
export const APP_PATHS: Record<Harness, string> = {
  'claude-code': '/Applications/Claude.app',
  codex: '/Applications/Codex.app',
};

function plistPath(appPath: string): string {
  return path.join(appPath, 'Contents', 'Info.plist');
}

// Read CFBundleIconFile via `plutil -convert json -o -`, a macOS system tool
// (same category as the `git`/`gh` shellouts already used elsewhere in this
// repo), so no new runtime dependency is introduced to parse a binary or XML
// plist. Returns the raw string value (extension may or may not be present;
// Apple allows either) or null on any failure.
export async function readIconFileKey(appPath: string): Promise<string | null> {
  const plist = plistPath(appPath);
  if (!(await exists(plist))) return null;
  let out: string;
  try {
    const r = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', plist], { timeout: 4000, encoding: 'utf8' });
    out = r.stdout;
  } catch {
    return null;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(out); } catch { return null; }
  const val = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).CFBundleIconFile : null;
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

// Resolve the icon filename to a real, readable .icns path under
// Contents/Resources. CFBundleIconFile is sometimes recorded without its
// extension (documented Apple behavior), so try both forms.
export async function resolveIconPath(appPath: string, iconFile: string): Promise<string | null> {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const candidates = [
    path.join(resourcesDir, iconFile),
    path.join(resourcesDir, iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`),
  ];
  for (const c of candidates) {
    try { const st = await fs.promises.stat(c); if (st.isFile() && st.size > 0) return c; } catch { /* try next */ }
  }
  return null;
}

export type ResolveHarnessIconResult =
  | { ok: true; path: string; appPath: string }
  | { ok: false; reason: string };

// Full resolution for one harness: app installed? plist readable? icon file
// present and non-empty? Returns { ok: true, path } or { ok: false, reason }
// -- callers use the reason for logging/debugging only; the UI-facing
// behavior for ANY failure is identical (silent fallback to the glyph).
export async function resolveHarnessIconPath(harness: string): Promise<ResolveHarnessIconResult> {
  const appPath = APP_PATHS[harness as Harness];
  if (!appPath) return { ok: false, reason: `unknown harness "${harness}"` };
  if (!(await exists(appPath))) return { ok: false, reason: `${appPath} not installed` };
  const iconFile = await readIconFileKey(appPath);
  if (!iconFile) return { ok: false, reason: 'no CFBundleIconFile in Info.plist' };
  const icnsPath = await resolveIconPath(appPath, iconFile);
  if (!icnsPath) return { ok: false, reason: `icon file "${iconFile}" not found under Resources` };
  return { ok: true, path: icnsPath, appPath };
}

// Where a downscaled, cached PNG lives: Electron userData, never the repo and
// never a ~/.humanctl watched path (DESIGN.md perf SLO: "files the system
// writes must never live under directories the system watches"). Takes
// userDataDir as a param so this stays Electron-free for selftest.
export function cachedIconPath(userDataDir: string, harness: string): string {
  return path.join(userDataDir, 'harness-icons', `${harness}.png`);
}
