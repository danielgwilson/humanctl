# Desktop App

`humanctl` desktop is a local-first control room for agent sessions. It reads
recent Codex and Claude Code transcripts on this machine and shows them in one
list: which harness, which repo, the opening prompt, who the turn is waiting on,
and how long ago it moved.

It is read-only and offline by default. It never writes to your transcripts and
never sends anything off the machine, with one explicit, opt-in exception: the
AI-summary feature (off by default) sends a session's recent messages to a model
through your local `claude` CLI when you turn it on.

The surface is exception-first: sessions that need you (the agent's turn is done,
the ball is with you) lead; everything healthy recedes. Sessions open as tabs.

## Run it

From source (live, for development):

```bash
npm install
npm run desktop
```

## Install it (~/Applications)

Build a real `.app` and drop it in your Applications folder:

```bash
npm install
npm run app:install     # builds with electron-builder, copies to ~/Applications/humanctl.app
open ~/Applications/humanctl.app
```

`npm run app:build` alone produces `dist/mac-arm64/humanctl.app`; `npm run
app:dmg` produces a shareable `.dmg`. The build is unsigned (no Apple
Developer cert needed); a locally built app opens without a Gatekeeper prompt.
If you ever move a downloaded copy and macOS blocks it, right-click the app and
choose Open once, or run `xattr -dr com.apple.quarantine ~/Applications/humanctl.app`.

Quick checks without the GUI:

```bash
npm run desktop:sessions          # print the recent-session table to stdout
HUMANCTL_SMOKE=1 npm run desktop  # boot the window, print a marker, quit (CI-safe)
```

## How it is built

No build step, no bundler. The renderer is plain HTML and JS.

- `electron/sessions.js` is the reader. It scans `~/.codex/sessions` and
  `~/.claude/projects`, reads each transcript by bounded slices, and returns
  metadata, a per-session context map (`readBlocks`), and real token usage
  (`readUsage`, cached by mtime). It never writes and never makes a network
  call. It is a plain Node module, so it runs and tests on its own.
- `electron/pricing.js` holds approximate public token prices, used only for a
  local spend estimate (always labeled "est"). Update it as vendor pricing
  changes; it is the single place to do so.
  `readDetail` adds the per-session last-exchange, Linear refs, generated HTML
  files, skills used, reasoning effort, and ultracode flag (Claude logs these;
  Codex exposes effort/quota, not skills, and we never fake the gap).
- `electron/main.js` owns the window, watches the session dirs (fs.watch) to push
  live updates, exposes read-only IPC (`sessions:list/read`, `status:get`,
  `skills:aggregate`, `*:reveal/open`), persists local UI state (pins, theme,
  AI toggle) under userData, and runs the opt-in `session:summarize` (local
  `claude` CLI). It also sets the app icon from `electron/assets/`.
- `electron/preload.js` is the locked bridge: a small, explicit set of calls,
  no direct fs, no network.
- `electron/renderer/` is the UI: lean exception-first list, tabs, a per-session
  context map, light/dark themes. With no bridge (a plain browser, for a
  screenshot) it falls back to synthetic fixtures, so demos never contain real
  session content.

## Agent inbox (the point of humanctl)

Agents post short aside / BTW messages to you with the CLI; the desktop surfaces
them as an inbox at the top of the control room:

```bash
humanctl note --level review "PRs are up, need a review + merge in ~5m"
humanctl note --level blocked "Blocked on a product call: Redis or Postgres?"
humanctl note "FYI refactor is going well, no action needed"
```

`--level` is one of `fyi | review | blocked | done`. Notes append to
`~/.humanctl/notes.jsonl` (one global inbox across every repo; the cwd and repo
are captured automatically). Pass `--session <id>` to link a note to a session
so the inbox can open it. This is the core loop: agents avoid silently blocking
on you by leaving a small, durable note instead.

## Privacy posture (born clean)

This repo is public. The rules that keep it safe:

- The code reads transcripts but never copies them into the repo.
- Screenshots and demos use the synthetic fixture in `renderer.js`, never real
  sessions. See [repo-hygiene.md](./repo-hygiene.md).
- `scripts/secret-scan.sh` fails the build if anything that looks like a
  credential is tracked.

## Top bar (real data)

Both harnesses record real token usage, so the top bar is real, not estimated:

- Claude logs `message.usage` (input / output / cache) plus the model per
  assistant turn, so spend is computed from `pricing.js` and shown as an
  API-equivalent value (both harnesses are usually plan-billed, so it is framed
  as "what this would cost at API rates", not a literal bill).
- Codex logs `token_count` events carrying cumulative usage and live rate
  limits, so the bar shows the real Codex quota: 5h and weekly windows with
  used-percent and reset time, plus plan type.

## Status

- Shipped: exception-first list grouped into pinned / needs-you / working /
  tabled, with lean one-line rows (last user prompt, or the AI summary when
  enabled); tabs; back/forward nav; light/dark themes; per-session context map;
  account top bar (needs-you headline, Codex 5h + weekly quota, API-equivalent
  value, near-compaction count); per-session last-exchange, context-fill %,
  skills + counts (and aggregate), Linear links, generated HTML files, reasoning
  effort + ultracode; filter chips + search; pinning; spot-check (skip-level);
  live fs.watch updates; reveal-in-Finder; opt-in AI summaries.
- Next: per-repo grouping, and optional wake/ping actions (these cross from
  read-only into control, so they ship behind an explicit opt-in).

## Notch

The native macOS notch shell is parked under `attic/notch/` while the desktop
surface is the focus. Its build scripts are the `notch:*` npm scripts. It is
kept, not deleted.
