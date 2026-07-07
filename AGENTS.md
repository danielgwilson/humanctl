# AGENTS.md

Operator notes for agents working in this repo. Start with `README.md` for what
`humanctl` is; this file covers how to move around and how to test.

## Layout

- `electron/` is the desktop app. `main.ts` is the Electron main process
  (window, IPC, the session-dir watcher, runtime harness-icon extraction),
  compiled by tsup to `dist/electron/main.js` (see `tsup.config.ts`).
  `renderer-vite/` is the UI: React 19 + TypeScript, built with Vite 7 /
  electron-vite, styled with Tailwind v4 (CSS-first) and shadcn/ui (Radix
  underneath) on the humanctl design tokens (see `DESIGN.md`). It is the only
  renderer; there is no separate build-less renderer and no flag to switch
  between renderers. `src/App.tsx` wires the shell (full-height sidebar,
  inset header, inset context bar, chief-of-staff drawer) around the Inbox
  view and the full-width session-detail view; see
  `electron/renderer-vite/README.md` for its own layout and commands.
- `lib/` holds TypeScript modules (strict, `tsconfig.backend.json`) shared by
  the desktop app and the CLI, compiled by tsup to `dist/lib/*.js`:
  `sessions.ts` is the read-only cross-harness session reader (Codex +
  Claude Code logs), `pricing.ts` its pricing table, `pulse.ts` the
  read-only reconciliation engine behind `humanctl pulse` (see `docs/pulse.md`),
  `span.ts` the span-of-control counter behind `humanctl span` (see
  `docs/span.md`), `commands.ts` the command registry (see below and
  `docs/commands.md`), `harness-icons.ts` the pure (Electron-free) half of
  runtime harness-icon resolution, and `summary-budget.ts` the always-on
  AI-summary dollar-budget tracker. `*.selftest.ts` files run directly via
  `tsx` (no build step needed for the fast dev loop; CI also builds and
  `node --check`s the compiled output).
- `bin/humanctl.ts` is the CLI, compiled to `dist/bin/humanctl.js` (the
  package's `bin` entry: `npm i -g humanctl` ships compiled JS, never runtime
  TypeScript). `docs/` holds the deeper design and desktop docs
  (`docs/desktop.md` is the desktop reference, `docs/perf.md` the perf-gate
  local/CI split).
- `npm run typecheck` (`tsc -p tsconfig.backend.json --noEmit`) is the strict
  type gate over `lib/`, `bin/`, and `electron/main.ts` + `electron/preload.ts`;
  `npm run build:lib` (tsup) is the compile step. Both are CI-required (see
  `.github/workflows/ci.yml`).

## Command registry (hardline)

Every mutation of durable state, every process spawn, and every cross-session
observation is a registered command: declared once in `lib/commands.ts`,
invocable from the UI (IPC routed through `registry.invoke`, the single choke
point), from the CLI against the running app (`humanctl app <name>`, see
`docs/commands.md`), and logged as one event line in
`~/.humanctl/events.jsonl`. Renderer-only ephemera (hover, selection, scroll
position) are exempt; nothing that touches disk, a process, or another
session is.

**Register the command in `lib/commands.ts` before wiring any UI to it.** A
declared command with no handler fails loudly ("only available through the
running desktop app"); an unregistered mutation wired straight into the
renderer or main process is the failure mode this rule exists to prevent. See
`docs/commands.md` for the full table, the event format, and the local-trust
model of the control socket.

## Perf: SLOs, timers, and write/watch separation (hardline)

The 2026-07-03 perf investigation found a self-sustaining refresh loop caused
by the app's own event log living inside the directory it watched. These
rules exist to keep that class of bug from recurring as the app grows.

- **Perf SLOs** (DESIGN.md, enforced by `npm run perf:selftest`, the required
  LOCAL pre-release gate; see `docs/perf.md` for the full local/CI split):
  cold open to interactive under 1500ms, click-to-paint under 100ms, zero
  self-triggered refresh at idle beyond the declared poll cadence, DOM
  rebuilds signature-gated (unchanged data must not rebuild), heap steady
  after 20 refresh cycles.
- **Declare every timer.** Every `setInterval`/`setTimeout` that recurs or
  drives a refresh must be named, commented with its cadence and lifecycle,
  and called out explicitly in the PR body ("new timer: X, fires every Yms,
  lives for Z"). A new poller piggybacking an EXISTING declared timer (e.g.
  the always-on summary engine reusing the renderer's 20-second poll instead
  of adding its own) is strongly preferred over a new timer; if you find
  yourself adding a new `setInterval`, ask first whether an existing one can
  carry the work.
- **Write/watch separation, generalized.** Any file or directory the app
  writes to as part of its own normal operation (an event log, a cache, a
  budget tracker, a copied attachment) must never live inside a directory the
  app also watches for externally-meaningful changes, UNLESS it is one of the
  specific inputs that directory's consumer actually reads (e.g.
  `notes.jsonl` and `asks/*.jsonl` under the watched `~/.humanctl`, which the
  Inbox genuinely needs to react to). `lib/commands.ts`'s
  `isInboxRelevantChange` is the current enforcement point for the
  `~/.humanctl` watcher: it is an ALLOWLIST of genuine inbox inputs, not a
  blocklist of known-bad files, specifically so a new registry-owned output
  (an event log rotation, a PR-chip cache, a summary-budget file, a note's
  image attachments) is excluded by construction rather than by someone
  remembering to blocklist it later. Extend `isInboxRelevantChange` (and its
  selftest coverage) every time a new system-written file or directory is
  introduced under a watched path.

## UI PRs: screenshots and one-owner audit (hardline)

Every UI-visible change, in every PR:

1. Attach full-app screenshots covering all views, in both themes, on fixture
   data (never real session data). Commit them under the top-level
   `screenshots/<stage>/` directory (NOT `docs/`, which is in the npm `files`
   allowlist and would ship the images inside the CLI tarball), and reference
   them in the PR body by their `raw.githubusercontent.com/<owner>/<repo>/<branch>/screenshots/...`
   URL.
2. For every NEW visible element, state in the PR body: what signal it shows,
   and why it owns that signal on that screen (DESIGN.md's one-owner-per-
   signal rule). If the element duplicates a signal already shown elsewhere
   on the same screen, the PR is wrong by definition; delete the duplicate.
3. Confirm `npm run perf:selftest` passes locally and paste its numbers into
   the PR body (see `docs/perf.md`); declare any new timer/watcher/poller
   per the rule above.
4. State explicit conformance to DESIGN.md: which section(s) the change
   follows, and any deliberate, called-out deviation.

The orchestrator reviews the screenshots and the one-owner audit before
merge; a UI PR without both is incomplete, not merely under-documented.

## Local development and testing

The renderer (`electron/renderer-vite/`) has a fixture fallback: when the
`window.humanctl` IPC bridge is absent (i.e. the page is opened in a plain
browser), it falls back to synthetic fixtures, so the whole UI renders and is
fully driveable without launching Electron.

Prefer the browser for UI work. It is the fast loop, needs no rebuild, and does
not read any real session data:

    npm run renderer   # Vite dev server, HMR, http://localhost:5183

Open that URL and verify layout, the Inbox / Sessions / Metrics / Fleet /
Settings views, the theme toggle, the nav rail, the chief-of-staff drawer, and
interactions against fixture data. Fixture mode always renders the built-in
harness glyphs (never runtime-extracted icons) and never shows PR chips (both
are real-app-only, see `docs/perf.md` and `docs/commands.md`). This is the
default way to iterate on the interface.

Toolchain is Node-ecosystem only, on the repo's Node (`.nvmrc`: 24). `npm run
renderer` runs Vite directly against `electron/renderer-vite/`. `npm run
renderer:build` builds it; `npm run renderer:serve` builds and serves the
production bundle via the zero-dependency `scripts/serve-static.ts` (node:http,
no build, no deps) on port 4188 (a Node-agnostic serve for any runner that
carries an older Node than Vite itself accepts).

To gate a UI change with screenshots, point the preview screenshot tool at the
running server. A working `.claude/launch.json` config (git-ignored, per
machine):

    { "name": "humanctl-renderer", "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "<abs path to this checkout>", "run", "renderer"],
      "port": 5183 }

Gate both themes: the app defaults to the dark theme, so toggle to light through
the user/settings picker at the foot of the nav (the theme is not driven by the
OS `prefers-color-scheme` unless the theme is set to `system`).

Use the real Electron app only for what the browser cannot show: real session
data, the `window.humanctl` IPC surface, native window chrome (frameless drag,
the macOS traffic lights), or real-session performance.

    npm run desktop      # live dev: Electron against your real local sessions
    npm run app:install  # rebuild and refresh the installed app

The session reader is non-visual, so it runs and is measured on its own:

    npm run desktop:sessions      # print the recent-session table to stdout (tsx lib/sessions.ts)

The pulse reconciler is pure over collected inputs and has a fixture-driven
selftest (no network, no real data):

    npm run pulse:selftest        # reconcile unit tests against synthetic fixtures

The live-timeline readers (backward pages + the incremental append cursor)
have their own fixture-driven selftest (synthetic transcripts in a temp dir):

    npm run reader:selftest       # timeline paging + cursor math incl. rotation

The command registry (param validation, the event log, the control socket,
and inbox thread assembly) has its own selftest, no network and no durable
real-data footprint (one case briefly appends then truncates one line of
`~/.humanctl/notes.jsonl` to prove `note.post` -> `inbox.threads` end to
end; see `docs/commands.md`'s Selftest section):

    npm run commands:selftest     # registry, event log, and socket round-trip

Perf has its own two-gate split (see `docs/perf.md` for the full rationale):
a LOCAL gate that drives a real Electron window and is required before
release, and a CI-safe pure-logic subset:

    npm run perf:selftest         # LOCAL required pre-release gate (real Electron + CDP)
    npm run perf:logic-selftest   # CI-safe: watcher filter, budget math, icon resolution, PR-chip cache contract

## Hygiene

This repo is public. Keep it born-clean: no real session data, secrets, tokens,
or personal paths in tracked files or history. Screenshots and demos use the
synthetic fixtures in `electron/renderer-vite/src/lib/fixtures.ts`, never real
transcripts. Do not use em dashes in any file. See `docs/repo-hygiene.md`.
