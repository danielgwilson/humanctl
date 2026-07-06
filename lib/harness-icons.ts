// Runtime harness-icon extraction (PR-2 item 1, DESIGN.md "born clean"):
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

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

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
export function readIconFileKey(appPath: string): string | null {
  const plist = plistPath(appPath);
  if (!fs.existsSync(plist)) return null;
  let out: string;
  try {
    out = execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { timeout: 4000, encoding: 'utf8' });
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
export function resolveIconPath(appPath: string, iconFile: string): string | null {
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const candidates = [
    path.join(resourcesDir, iconFile),
    path.join(resourcesDir, iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile() && fs.statSync(c).size > 0) return c; } catch { /* try next */ }
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
export function resolveHarnessIconPath(harness: string): ResolveHarnessIconResult {
  const appPath = APP_PATHS[harness as Harness];
  if (!appPath) return { ok: false, reason: `unknown harness "${harness}"` };
  if (!fs.existsSync(appPath)) return { ok: false, reason: `${appPath} not installed` };
  const iconFile = readIconFileKey(appPath);
  if (!iconFile) return { ok: false, reason: 'no CFBundleIconFile in Info.plist' };
  const icnsPath = resolveIconPath(appPath, iconFile);
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
