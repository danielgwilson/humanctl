# Desktop App

`humanctl` desktop is a local-first control room for agent sessions. It reads
recent Codex and Claude Code transcripts on this machine and shows them in one
list: which harness, which repo, the opening prompt, who the turn is waiting on,
and how long ago it moved.

It is read-only and offline by default. It never writes to your transcripts and
never sends anything off the machine, with one explicit, opt-in exception: the
AI-summary action sends a session's recent messages to a model through your
local `claude` or `codex` CLI (you pick the engine in settings) when you ask
for it.

The surface is exception-first: sessions that need you (the agent's turn is done,
the ball is with you) lead; everything healthy recedes. Three modes (Focus /
Triage / Wall, keys 1/2/3) sit under one persistent conductor header.

## State model (who the ball is with)

A session's state is derived from real signals, never fabricated:

- blocked: the session has a `blocked` note.
- needs you: the last transcript message is from the assistant (the agent
  finished its turn and is waiting on you), or the session has a `review` note.
- done: the session has a `done` note that is its newest signal. A done note
  clears needs-you immediately; activity after the note reopens the session.
- working: the last message is yours and the session moved in the last 30
  minutes.
- idle: everything else.

Needs-you decay: an assistant-last session with no activity for 18 hours
(`NEED_DECAY_MS`, one constant shared by the renderer and the session reader)
demotes to idle instead of piling up in the queue forever. 18 hours clears
yesterday's abandoned sessions by the next morning while never decaying
anything from the current working day. This is pure time decay on a real
signal; nothing is invented. Explicit notes (`blocked`, `review`) do not decay.

In Focus mode the right-rail queue owns needs-you and blocked: it is the
priority queue you work down. The left roster is the full inventory; its
needs-you and blocked groups render as slim count lines that jump to the
queue rather than repeating the same sessions as full rows. Fleet totals
(claude spend, codex API-equivalent, tokens, codex quota) live once, in the
header, for every mode.

## Run it

From source (live, for development):

```bash
npm install
npm run desktop
```

## Install it (/Applications)

Build a real `.app` and drop it in your Applications folder:

```bash
npm install
npm run app:install     # builds with electron-builder, installs to /Applications/humanctl.app
open /Applications/humanctl.app
```

The installer (`scripts/install-app.sh`) targets `/Applications`; if that is
not writable it falls back to `~/Applications` and says so. It removes any
existing copy at both locations first, so there is never a duplicate for
Spotlight to get confused by.

`npm run app:build` alone produces `dist/mac-arm64/humanctl.app`; `npm run
app:dmg` produces a shareable `.dmg`. These are unsigned (no Apple Developer
cert needed); a locally built app opens without a Gatekeeper prompt. If you ever
move a downloaded copy and macOS blocks it, right-click the app and choose Open
once, or run `xattr -dr com.apple.quarantine /Applications/humanctl.app`.

## Signed + notarized release (to share with other Macs)

The build is signing-ready (hardened runtime + entitlements); it just needs your
own Apple credentials, which the build never sees:

1. One-time: create a **Developer ID Application** certificate under your Apple
   Developer account and install it in your login keychain (Xcode > Settings >
   Accounts > your team > Manage Certificates > + Developer ID Application).
   Verify: `security find-identity -v -p codesigning` lists it.
2. Provide notarization credentials via env (an app-specific password from
   appleid.apple.com), exported in your shell, not committed:

   ```bash
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="YOURTEAMID"
   ```
3. Build the signed, notarized, stapled `.dmg`:

   ```bash
   npm run app:release
   ```

electron-builder auto-discovers the Developer ID cert, signs with the hardened
runtime, and notarizes via Apple's notary service. Without a cert installed,
`app:release` will stop with a clear error; the unsigned `app:build` /
`app:install` path keeps working regardless.

Quick checks without the GUI:

```bash
npm run desktop:sessions          # print the recent-session table to stdout
HUMANCTL_SMOKE=1 npm run desktop  # boot the window, print a marker, quit (CI-safe)
```

## How it is built

No build step, no bundler. The renderer is plain HTML and JS.

- `lib/sessions.js` is the reader. It scans `~/.codex/sessions` and
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
  `skills:aggregate`, `*:reveal/open`), persists local UI state (mode, theme,
  temperature, pins, summary engine, selection, cached AI summaries) under
  userData, and runs the opt-in `session:summarize` (local `claude` or `codex`
  CLI, cached by engine and file mtime). It also sets the app icon from
  `electron/assets/`.
- `electron/preload.js` is the locked bridge: a small, explicit set of calls,
  no direct fs, no network.
- `electron/renderer/` is the UI: the conductor home with Focus / Triage / Wall
  modes, a per-session timeline and context map, light/dark themes. With no
  bridge (a plain browser, for a screenshot) it falls back to synthetic
  fixtures, so demos never contain real session content.

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

## Token and quota data (real)

Both harnesses record real token usage, so the fleet numbers are real, not
estimated:

- Claude logs `message.usage` (input / output / cache) plus the model per
  assistant turn, so spend is computed from `pricing.js` and shown as an
  API-equivalent value (both harnesses are usually plan-billed, so it is framed
  as "what this would cost at API rates", not a literal bill).
- Codex logs `token_count` events carrying cumulative usage and live rate
  limits, so the app shows the real Codex quota: 5h and weekly windows with
  used-percent and reset time, plus plan type.

## Actions (resume destinations)

Every session offers two resume destinations; a per-harness preference in the
settings popover picks which one is the primary button, and the other stays one
click away. The preference persists in local `state.json`.

- Terminal: writes a temp `.command` file that opens a Terminal window in the
  session's working directory running `claude --resume <id>` or
  `codex resume <id>`. This is the original path and works with the CLIs alone.
- Desktop app: opens the harness's own app through its registered deep link.
  What each link actually does differs, and the labels say so:
  - Claude Code: `claude://resume?session=<uuid>`. The Claude desktop app
    imports the CLI session's transcript and opens it as a resumable desktop
    session. Labeled "Resume in Claude app".
  - Codex: `codex://threads/<thread-uuid>`. The Codex desktop app opens that
    thread (the same link the app itself uses for "Open in app"); you can
    continue it there. Labeled "Open in Codex app".

Honest signals: the desktop-app option only appears when the OS reports a real
handler for that harness's scheme (`app.getApplicationNameForProtocol`), so the
button never exists on a machine where it could not work. If the link fails at
click time, the error is surfaced in the toast. Both deep links were verified
end to end on macOS with the current Claude and Codex desktop apps; the schemes
are read from each app's `Info.plist` (`CFBundleURLTypes`) and are not a public
documented API, so a future app release could change them.

## Status

- Shipped (the 0.6.x conductor home): Atlas chief-of-staff header (a digest
  sentence naming who is waiting on you, plus a needs-you hero count); three
  modes on keys 1/2/3. Focus is the roster (the full inventory: pinned /
  working / idle / done rows, with needs-you and blocked as count lines that
  jump to the queue) plus a watched-agent panel with timeline and context-map
  facets, a cumulative-token sparkline, and the needs-you queue in the right
  rail. Fleet totals sit in the header. Triage is a keyboard-first grouped
  list (j/k move, enter opens an inline drawer, r resumes). Wall is a tile
  grid of the whole fleet with a peek overlay. Agents get deterministic
  nicknames and faces from the session id; a session renamed in Claude Code
  shows its real title instead. Pins persist. Rows show real signals only:
  last prompt (or the AI summary when one was made, marked "ai"), context %,
  cost or API-equivalent, model, reasoning effort, ultracode, Linear refs,
  generated HTML files, skills. Codex 5h + weekly quota and fleet spend
  totals; resume in the harness desktop app or in a Terminal window (see
  Actions below), reveal transcript, open in Linear; opt-in AI summaries with
  a summary engine picker (Claude Code or Codex CLI) that land in a labeled
  block in the watched-agent dossier, with engine + age, and persist across
  restarts; light/dark themes and a considered/loud temperature toggle; live
  fs.watch updates. The pre-0.6 tabs, back/forward nav, filter chips, search,
  and spot-check were replaced by the three modes.
- Next: per-repo grouping, and optional wake/ping actions (these cross from
  read-only into control, so they ship behind an explicit opt-in).

## Notch

The native macOS notch shell is parked under `attic/notch/` while the desktop
surface is the focus. Its build scripts are the `notch:*` npm scripts. It is
kept, not deleted.
