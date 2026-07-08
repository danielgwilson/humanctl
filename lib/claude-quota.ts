// Real Claude subscription quota, read from the Claude Code CLI itself.
//
// WHAT THIS DEPENDS ON, HONESTLY. Claude Code registers `/usage` twice: a TUI
// variant, and a `type: "local"` variant with `supportsNonInteractive: true`
// that is enabled only under `-p`. That second variant is what this module
// drives:
//
//     claude -p "/usage" --safe-mode --output-format json --no-session-persistence < /dev/null
//
// It never reaches a model (verified on a real account: `num_turns: 0`,
// `duration_api_ms: 0`, `total_cost_usd: 0`); underneath, the CLI does a
// `GET https://api.anthropic.com/api/oauth/usage` with its OWN OAuth token. We
// never read, hold, or forward that token, and never touch the Keychain -- the
// CLI does all of it. Both the non-interactive `/usage` variant (CLI >= 2.1.x)
// and the endpoint under it are UNDOCUMENTED. That is the same risk class as
// this repo's existing `claude://` / `codex://` deep links: an upstream change
// breaks the read, and the read then degrades to `n/a`. It never fabricates a
// number, and it is never load-bearing for anything else in the app.
//
// The four flags are each load-bearing, all verified:
//   --safe-mode                 without it, every poll spawns the user's MCP servers
//   --no-session-persistence    a fleet viewer must not appear in its own fleet
//                               (verified: zero new files under ~/.claude/projects)
//   --output-format json        gives us `is_error` alongside the text
//   -p                          the only mode where the non-interactive variant exists
// And NEVER `--bare`: it strips OAuth and returns a cost summary with no quota
// in it at all. stdin is closed immediately (the `< /dev/null` above), else the
// CLI waits several seconds on it and warns.
//
// TWO THINGS THIS MODULE REFUSES TO DO:
//  1. Trust an exit code. A transient OAuth 401 exits 0 with the error on
//     stdout. Every decision here is made from `is_error` plus the parsed
//     content, never from the process's status.
//  2. Invent an epoch. The reset text ("Jul 13 at 2am (America/Los_Angeles)")
//     is a locale-formatted DISPLAY string with no year and no timestamp in it.
//     It is carried verbatim as `resets_at_text` and rendered verbatim. Codex
//     supplies a real epoch and keeps its own `resets_at` path; Claude does not
//     get a guessed one.
//
// The window labels are DYNAMIC ("Current session", "Current week (all
// models)", "Current week (<model>)", and others behind upstream feature
// flags), so nothing here hardcodes three rows: whatever comes back is what
// renders.
//
// Everything below is pure except `defaultRun` and `findClaudeBin`. The parser
// is exported separately and never throws, and `readClaudeQuota` takes an
// injectable runner so lib/claude-quota.selftest.ts exercises the whole
// orchestration on captured stdout without spawning anything.

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/** One quota window as the CLI reported it. `label` is whatever upstream called it. */
export interface ClaudeQuotaWindow {
  label: string;
  used_percent: number;
  /** Locale display string, verbatim. Never parsed to an epoch (see header). */
  resets_at_text?: string;
}

export interface ClaudeQuota {
  windows: ClaudeQuotaWindow[];
  /** epoch ms at which this read completed */
  at: number;
}

export const AUTH_ARGS: readonly string[] = ['auth', 'status'];
export const USAGE_ARGS: readonly string[] = [
  '-p', '/usage', '--safe-mode', '--output-format', 'json', '--no-session-persistence',
];

// Worst case is AUTH + USAGE = 20s, which is exactly preload.ts's PORT_TIMEOUT_MS.
// A read that slow loses one poll to an honest {ok:false} while the reader-service
// still finishes and caches it, so the very next poll is served from memory.
export const AUTH_TIMEOUT_MS = 8_000;
export const USAGE_TIMEOUT_MS = 12_000;

/** Guard against a pathological `result` string; the real one carries 3-5. */
const MAX_WINDOWS = 16;

// "Current week (all models): NN% used · resets Jul 13 at 2am (America/Los_Angeles)"
// The `% used` literal is the discriminator. It is what keeps the surrounding
// usage-breakdown prose ("91% of your usage came from ...", "Top skills:
// /foo 2%, ...") out of the result: those carry a percent but never `% used`
// immediately after a colon.
const WINDOW_LINE = /^(.+?):\s+(\d+)% used(?:\s+·\s+resets\s+(.+))?$/;

/** Resolves stdout. Rejects only when there is no stdout to judge at all. */
export type RunClaude = (args: readonly string[], timeoutMs: number) => Promise<string>;

export interface ClaudeQuotaDeps {
  run?: RunClaude;
  resolveBin?: () => string | null;
  now?: () => number;
}

// ---- binary resolution ----
// The `claude` binary is nvm/shim-resolved at a path a packaged Electron app's
// PATH will not contain. Resolve it with plain fs checks over PATH plus the
// common install locations: no spawn, and above all no interactive login shell
// (`$SHELL -lc 'which claude'` is a process spawn, and this must never be one
// on the main process). Sync fs here is a handful of stats, run once per
// process, and only ever from the reader utilityProcess or the CLI -- never
// from Electron's main process (AGENTS.md: "Never block the Electron main
// process").

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

/** Pure-ish (fs reads only, no spawn, no memo) so the selftest can drive it. */
export function findClaudeBin(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string | null {
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const p = path.join(dir, name);
      if (isExecutableFile(p)) return p;
    }
  }
  const fallbacks = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const p of fallbacks) if (isExecutableFile(p)) return p;
  return null;
}

// Memoized across the process: a missing binary stays missing, and a present
// one does not move. `undefined` = not yet looked up; `null` = looked up, absent.
let cachedBin: string | null | undefined;
export function resolveClaudeBin(): string | null {
  if (cachedBin === undefined) cachedBin = findClaudeBin();
  return cachedBin;
}
/** Test seam only: drop the memo. */
export function resetClaudeBinCache(): void { cachedBin = undefined; }

// ---- the spawn ----
function defaultRun(bin: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const child = execFile(
      bin,
      args as string[],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, signal: ac.signal, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        clearTimeout(timer);
        // NEVER decide on the exit code. A transient OAuth 401 exits 0 with the
        // error on stdout; conversely a nonzero exit can still carry a complete
        // JSON result. If there is any stdout at all, hand it to the parser and
        // let `is_error` + the parsed content decide.
        const out = String(stdout || '');
        if (out) { resolve(out); return; }
        reject(err || new Error('claude produced no output'));
      },
    );
    // The shell's `< /dev/null`. Without it the CLI waits on an open stdin.
    try { child.stdin?.end(); } catch { /* already closed / never opened */ }
  });
}

// ---- parsing (pure, never throws) ----

/** Tolerate a stray banner line around the JSON body. */
function extractJson(stdout: string): string {
  const s = String(stdout).trim();
  if (s.startsWith('{')) return s;
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

/**
 * The cheap precondition, no HTTP: `claude auth status` (JSON by default).
 * Only a signed-in first-party subscription has quota to report. API-key,
 * Bedrock, and Vertex users have none, and logged-out users have none.
 */
export function isSubscriptionAuth(stdout: string): boolean {
  try {
    const j = JSON.parse(extractJson(stdout)) as { loggedIn?: unknown; apiProvider?: unknown };
    return !!j && j.loggedIn === true && j.apiProvider === 'firstParty';
  } catch { return false; }
}

/** Iterates whatever windows came back. Unknown labels are kept, not dropped. */
export function parseUsageWindows(text: string): ClaudeQuotaWindow[] {
  const out: ClaudeQuotaWindow[] = [];
  for (const raw of String(text).split('\n')) {
    if (out.length >= MAX_WINDOWS) break;
    const m = WINDOW_LINE.exec(raw.trim());
    if (!m) continue;
    const label = String(m[1] || '').trim();
    const pct = Number(m[2]);
    // A percentage outside 0..100 is not a quota reading; drop it rather than
    // render nonsense. Never coerce, never clamp into a plausible-looking number.
    if (!label || !Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    const resets = String(m[3] || '').trim();
    out.push(resets ? { label, used_percent: pct, resets_at_text: resets } : { label, used_percent: pct });
  }
  return out;
}

/**
 * Captured stdout of the `/usage` invocation -> structured quota, or null.
 * Null (never a throw, never a fabricated number) for: malformed JSON, an
 * `is_error: true` envelope, a `--bare`-style cost-only summary, a logged-out
 * or API-key account, and anything else with no `% used` lines in it.
 */
export function parseClaudeUsage(stdout: string, at: number): ClaudeQuota | null {
  try {
    const payload = JSON.parse(extractJson(stdout)) as { is_error?: unknown; result?: unknown } | null;
    if (!payload || typeof payload !== 'object') return null;
    if (payload.is_error === true) return null;
    if (typeof payload.result !== 'string') return null;
    const windows = parseUsageWindows(payload.result);
    return windows.length ? { windows, at } : null;
  } catch { return null; }
}

// ---- orchestration ----

/**
 * Read the live quota, or null. Caller owns caching (see
 * electron/reader-service.ts, which holds the >= 60s TTL and dedupes in-flight
 * reads). Every failure mode -- no binary, not signed in, an API-key/Bedrock/
 * Vertex account, a spawn error, a timeout, an OAuth 401, unparseable output --
 * resolves to null. This function never throws and never rejects.
 */
export async function readClaudeQuota(deps: ClaudeQuotaDeps = {}): Promise<ClaudeQuota | null> {
  try {
    const now = deps.now || Date.now;
    const bin = (deps.resolveBin || resolveClaudeBin)();
    if (!bin) return null;
    const run: RunClaude = deps.run || ((args, ms) => defaultRun(bin, args, ms));

    let authOut: string;
    try { authOut = await run(AUTH_ARGS, AUTH_TIMEOUT_MS); } catch { return null; }
    if (!isSubscriptionAuth(authOut)) return null;

    let usageOut: string;
    try { usageOut = await run(USAGE_ARGS, USAGE_TIMEOUT_MS); } catch { return null; }
    return parseClaudeUsage(usageOut, now());
  } catch { return null; }
}
