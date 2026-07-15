# Desktop app

`humanctl` desktop is a local-first control room for agent sessions. It reads
recent Codex and Claude Code transcripts on this machine and routes one scarce
human to the next bounded decision across many running sessions: which harness,
which repo, who the turn is waiting on, and how long ago it moved.

It is read-only and offline by default. It never writes to your transcripts and
never sends anything off the machine, with explicit, opt-in exceptions, all
running through your own local CLI auth when you ask for them: the AI-summary
action sends a session's recent messages to a model through your local `claude`
or `codex` CLI (you pick the engine in Settings); the ask-the-session action
injects a one-turn question into a session through that session's own harness
CLI (Claude asks leave no trace in the session; Codex asks write the marked
question into the thread itself and are disclosed and acknowledged before the
first one runs, see [ask-session.md](./ask-session.md)); and the chief-of-staff
chat (below) sends a fleet-level prompt through the same local CLI, advisory
only, never executing anything.

## Renderer architecture and shell

The renderer is a thin adapter over the Humanctl UI package:

- `packages/ui` owns all markup, primitives, product blocks, tokens, icons,
  responsive layout, loading states, motion, and accessibility.
- `electron/renderer-vite/src/runtime` is the only code that reads
  `window.humanctl`. It owns resources, subscriptions, persisted-state
  hydration, fixture selection, and intent dispatch. It renders no DOM.
- `electron/renderer-vite/src/viewport` connects the runtime model to package
  exports. It contains no visual implementation, bridge calls, or polling.
- `main.tsx` mounts the viewport and imports the package stylesheet.

The normative contracts are [DESIGN.md](../DESIGN.md),
[ui-foundation-contract.md](./ui-foundation-contract.md), and the
[frontend reset behavior ledger](./frontend-reset-behavior-ledger.md). The
ledger is the acceptance checklist for behavior that survives renderer
replacement.

The package shell uses Geist Variable, neutral structure, and blue for focus,
links, and the primary action. Controls are 28px or 32px high, top chrome is
48px, the navigation rail is 275px, and the chief-of-staff rail is 360px.
Repeated content is a continuous field
of rows separated by hairline rules. There are no cards or in-flow shadows.
Only floating overlays may cast a shadow.

The compiled application version is available on the first real-app paint.
The shell, active route frame, and correctly sized skeletons render before
fleet data. Sessions, Inbox, status, quota, skills, budget, and timeline load
independently. A real app never shows fixture labeling while status loads.

Routes keep one visible owner per signal:

- Inbox is route 1 and owns ranked work that needs the human.
- Metrics is route 2 and owns spend, token, context, skill, and quota detail.
- Fleet is route 3 and owns distribution by state, harness, and tier.
- Sessions is route 4 and owns the complete recent session inventory.
- Settings is routable from the settings entry and command palette.
- Session detail owns one session's conversation, pending asks, and actions.
- The bottom status band owns the compact fleet and quota digest.
- The chief-of-staff right rail owns its advisory conversation. It becomes a
  Sheet only at compact widths.

## Inbox and Sessions

Inbox is message-centric. It shows one thread per session assembled by the
backend from notes, asks, answers, and session state. Search matches title,
repository, and message. State and harness filters plus recent, needs-first,
and alphabetic sorts are shared derivations, not separate screen logic.
Each thread carries the authoritative row from the Inbox's 30-day scan, so a
pending decision does not disappear or become idle merely because it is older
than the 72-hour Sessions inventory.

Sessions uses the same package row and filter blocks for the complete recent
inventory. Pinned sessions group first without changing the selected sort.
Both lists remain keyboard-operable and virtualize at real fleet size. Opening
a thread marks it read through the registered command. Empty and no-match
states explain the next action without inventing data.

## Session detail

Inbox and Sessions open the same package-owned detail block. Back returns to
the originating route. Split and full-width contexts do not fork the component.

Detail exposes the session title, harness, state and reason, repository, model,
context fill, notes and asks, cached summary, live conversation, touched
references, resume actions, and ask-session behavior. It has one vertical body
scroll owner. Notes, summary, timeline, pending ask, and composer do not create
nested scroll traps.

The conversation reads a bounded tail page first. Loading older content
preserves the reader's viewport. Live appends follow the selected session and
stick to the bottom only when the human was already near the bottom. Rotation,
truncation, and oversized gaps trigger an honest reset and reread.

## Metrics, Fleet, Settings, and chief-of-staff

Metrics distinguishes estimated API-equivalent spend from actual subscription
quota. Missing quota is unavailable, never zero or fabricated. Fleet shows the
shape of the fleet and never becomes a second session list. Settings persists
theme, summary engine, daily budget, and other declared application state.

The chief-of-staff is a summonable overlay and remains advisory. Its backend
command and local persistence contracts do not change. Metrics-only skills and
Settings-only budget reads run only while their route is active.

## Global interaction

Command or Control plus K opens the command palette. Command or Control plus
backslash toggles navigation. Bare keys 1 through 4 change routes, and A
toggles chief-of-staff, only when focus is outside an input, textarea, or
editable region.

Menus, popovers, sheets, dialogs, and the command palette use Base UI behavior
for focus entry, keyboard navigation, Escape, outside interaction, and focus
return. Hover-only disclosure is forbidden. Context menus expose only
registered commands that apply to their target.

## State model (who the ball is with)

A session's state is derived from real signals, never fabricated. Since v3 the
state axis reads the CONTENT of the transcript tail, not just who spoke last: a
2026-07 ground-truth audit of 60 real sessions graded the old
lastRole-plus-decay heuristic at 36% precision, and the failure modes it found
drive the rules below. The reader (`lib/sessions.ts`) classifies every row and
attaches `state`, `stateReason`, and `tier`; the renderer overlays notes on top
and owns no classification logic or time constants of its own.

- blocked: the session has a `blocked` note.
- needs input, when the tail actually asks for you:
  - the final substantive assistant message is question-shaped (ends on a
    question aimed at you) or decision-shaped (handoff phrases like "say the
    word", "your call", "only you can", "ready for your review",
    "reviewDecision REVIEW_REQUIRED"), with a future-tense guard so "I'll report
    when it's ready for your merge" does not count;
  - or you interrupted the turn (`[Request interrupted by user]`, Codex
    `turn_aborted`) and no assistant turn followed: only you can resume;
  - or your last reply was a question or directive the agent never picked up;
  - or the session has a `review` note.
- finished: the session has a `done` note that is its newest signal (a done note
  clears needs-you immediately; activity after the note reopens it), or the
  final assistant message is completion-shaped ("merged", "shipped", "killed",
  "complete") with no trailing ask.
- running: tool activity is in flight, or the tail is a fresh progress report,
  or your own turn was just picked up (fresh means within the last 30 minutes).
- stalled: everything else, including progress-shaped tails that went stale
  without asking anything.

Every state carries an honest reason ("asks you a question", "awaiting your
go-ahead", "note: blocked"), surfaced in the row line 2, the detail header, the
Inbox queue, and tooltips.

Substantive events only: trailing local commands (`/model`, `/effort`) and
metadata appends (pr-link, mode, custom-title, last-prompt lines) neither change
the state nor refresh the session's age. A dead thread whose file was touched by
a footer rewrite stays dead; a pending ask behind a stray `/model` stays a
pending ask. Headless one-shot sessions (humanctl's own summarizer probes, other
`claude -p` runs) are filtered from the interactive list entirely, mirroring the
Codex-side automation filter.

## Attention tiers (how long a session stays on your desk)

The old single 18h needs-you cliff is replaced by three tiers, aged by the last
substantive event's own timestamp (never file mtime) and validated by
resume-pattern mining over the full local session history:

- hot (under 24h idle): full-strength display.
- drifting (24h to 7 days): still listed, needs-input shape retained, rendered
  visually secondary. About 1 in 3 day-old sessions is eventually picked back
  up, but few within the next day; drifting keeps them reachable without
  stealing attention.
- archived (over 7 days): drops from Inbox and from all counts; the Sessions
  view keeps it, dimmed. Past 7 idle days only ~6% of sessions ever resume.

Within tiers the reader sorts needs-you first, then session depth (message
count), then recency, following the mining's odds ratios (depth 2.23, age 1.82,
question-tail 1.46). `TIER_HOT_MS` and `TIER_DRIFT_MS` live in `lib/sessions.ts`
and are the single source; `NEED_DECAY_MS` remains as an alias equal to the hot
tier for `lib/pulse.ts` consumers. Explicit notes (`blocked`, `review`) do not
decay.

## Live dossier timeline (honest truncation + sub-2s appends)

The watched-agent conversation timeline is built from real substantive events
(your messages, the agent's messages, interrupts, tool activity collapsed into
counted runs) read TAIL-FIRST from the transcript, so it always matches the
latest messages. Two rules keep it honest and live:

- Explicit truncation, never a silent splice. Transcripts routinely exceed the
  bounded read cap, and tool_result lines are 56-80% of tail bytes in the wild,
  so timeline pages are budgeted by substantive events, not raw bytes. Every cut
  is a visible element: "~N earlier events not shown · load older" (the count is
  a density estimate, marked ~) loads the next bounded chunk backward on demand
  (also driven by upward infinite scroll), and a timeline that verifiably
  reaches the beginning ends with "start of session".
- Incremental appends for the watched session only. Transcripts are append-only,
  so the main process keeps a per-file cursor (inode, size, line-aligned byte
  offset) for the ONE session open in the detail and, on its fs events, reads
  only the bytes appended since the last read, pushing parsed events straight to
  the renderer. Measured end to end (fs append to renderer push): 125-160ms. The
  detail shows "live · updated Ns ago", driven by real event times. Claude
  custom-title lines and Codex turn markers are picked up from appended bytes;
  the session's state is re-derived through the same needs-you v3 classifier the
  list uses. Rotation or truncation (inode change, size shrink) is never papered
  over: the cursor resets and the timeline re-reads a full page. Background
  sessions keep the debounced list refresh; only the selected session gets the
  hot path.

The incremental parser and cursor math (rotation, partial-line flushes,
multibyte alignment, probe filtering) are covered by `npm run reader:selftest`.

## Actions (resume destinations)

Every session offers two resume destinations; a per-harness preference in
Settings picks which one is the primary button, and the other stays one click
away in the detail header's split-button dropdown. The preference persists in
local `state.json`.

- Terminal: writes a temp `.command` file that opens a Terminal window in the
  session's working directory running `claude --resume <id>` or
  `codex resume <id>`. This is the original path and works with the CLIs alone.
- Desktop app: opens the harness's own app through its registered deep link.
  What each link actually does differs, and the labels say so:
  - Claude Code: `claude://resume?session=<uuid>`. The Claude desktop app
    imports the CLI session's transcript and opens it as a resumable desktop
    session. Labeled "Resume in Claude app".
  - Codex: `codex://threads/<thread-uuid>`. The Codex desktop app opens that
    thread; you can continue it there. Labeled "Open in Codex app".

Honest signals: the desktop-app option only appears when the OS reports a real
handler for that harness's scheme (`app.getApplicationNameForProtocol`), so the
button never exists on a machine where it could not work. If the link fails at
click time, the error is surfaced in the toast. Both deep links were verified
end to end on macOS with the current Claude and Codex desktop apps; the schemes
are read from each app's `Info.plist` (`CFBundleURLTypes`) and are not a public
documented API, so a future app release could change them.

## Ask the session

The session detail carries an "Ask the session" block under the AI summary:
three quick prompts (Status? / What do you need from me? / Summarize this
thread) plus a freeform input. The answer comes from the session itself, resumed
headlessly through its own harness CLI, so it is grounded in the session's full
context rather than the transcript tail. Question and answer pairs render as a
compact thread with engine and age, persist across restarts like summaries
(capped), and every question carries the `[humanctl btw]` sentinel prefix. The
same block is the Inbox reply (one composer, not a fork).

The footprint differs per harness and the block says which one applies:

- Claude Code sessions: `claude -p --resume <id> --no-session-persistence`,
  which writes nothing to disk (verified byte-identical). Available by default,
  safe even while the session is open in a terminal.
- Codex sessions: `codex exec resume <id>` always appends the question and
  answer into the real thread (there is no headless fork), pinned to
  `sandbox_mode=read-only` because resume otherwise runs full-access regardless
  of the thread's original sandbox. The first Codex ask shows a one-line
  disclosure with a confirm, the acknowledgement persists, and asks are refused
  while the session is actively working. The reader treats persisted probe turns
  as non-substantive so they can never flip a session's state, refresh its age,
  or mask a real ask.

Mechanics, verification, and the cost notes live in
[ask-session.md](./ask-session.md).

## Token and quota data (real)

Both harnesses record real token usage, so the fleet numbers are real, not
estimated:

- Claude logs `message.usage` (input / output / cache) plus the model per
  assistant turn, so spend is computed from `pricing.ts` and shown as an
  API-equivalent value (both harnesses are usually plan-billed, so it is framed
  as "what this would cost at API rates", not a literal bill). Claude exposes
  no rate-limit/window field anywhere in its transcripts, confirmed absent (not
  merely unimplemented), so Claude quota renders "n/a" with an explanatory
  tooltip everywhere it appears rather than a fabricated number.
- Codex logs `token_count` events carrying cumulative usage and live rate
  limits (`rate_limits.primary`/`secondary`, each a real `used_percent`,
  `window_minutes`, and an absolute `resets_at` unix timestamp), so the app
  shows the real Codex quota: 5h and weekly windows with used-percent and an
  absolute local reset clock, plus plan type.

Metrics owns spend, tokens, context, skills, and detailed quota windows. The
bottom status band owns only the compact fleet and quota digest. Its missing
Claude quota remains unavailable rather than zero, and Codex reset clocks use
the supplied absolute time.

## Command registry

Everything the app can do that mutates durable state, spawns a process, or
observes another session is a registered command (`lib/commands.ts`), invocable
from the UI (IPC), from the CLI against the running app (a control socket), and
logged as one event line in `~/.humanctl/events.jsonl`. The view switch
(`app.set-view`), the nav pin (`app.set-nav`), the chief-of-staff drawer toggle
(`app.set-cos-drawer`), theme, engine, pins, mark-read, resume, reveal,
summarize, ask, and the chief-of-staff ask all route through it. Renderer
ephemera (hover, selection, scroll position, and the Inbox/Sessions search /
filter / sort) are exempt. See [commands.md](./commands.md).

## Performance posture

The shell, active route frame, compiled application version, and package-owned
skeletons render before fleet data. Status, sessions, Inbox, quota, skills,
budget, and timeline resolve independently. Unchanged resource identities do
not replace state or rebuild their subtree. Quota and route-specific reads do
not block fleet first paint.

The runtime owns one 20-second fleet poll. Session and Inbox events share its
coalesced refresh path. At idle the app performs no self-triggered refresh: an
unchanged poll returns early, and the `~/.humanctl` watcher ignores its own
event-log writes through `isInboxRelevantChange`. See [perf.md](./perf.md) for
the measured release gates.

## Privacy posture (public-safe)

This repo is public. The rules that keep it safe:

- The code reads transcripts but never copies them into the repo.
- Screenshots and demos use the synthetic adapter in
  `electron/renderer-vite/src/runtime/fixture-adapter.ts`, never real sessions. See
  [repo-hygiene.md](./repo-hygiene.md).
- Harness identity uses neutral built-in glyphs; no vendor brand asset is ever
  committed (runtime icon extraction with a glyph fallback arrives in a later
  release and still commits nothing).
- `scripts/secret-scan.sh` fails the build if anything that looks like a
  credential is tracked.

## Run it

From source (live, for development):

```bash
npm install
npm run desktop
```

The renderer mounts `packages/ui` through the runtime and viewport seams. When
the `window.humanctl` IPC bridge is absent, the runtime selects the synthetic
fixture adapter, so the whole UI is driveable without launching Electron:

```bash
npm run renderer     # Vite dev server, HMR, http://localhost:5183
```

This is the default fast loop for interface work. Use the real Electron app only
for what the browser cannot show: real session data, the `window.humanctl` IPC
surface, native window chrome (frameless drag, the macOS traffic lights), or
real-session performance.

Quick checks without the GUI:

```bash
npm run desktop:sessions          # print the recent-session table to stdout
HUMANCTL_SMOKE=1 npm run desktop  # boot the window, print a marker, quit (CI-safe)
```

## Install it (/Applications)

Build a real `.app` and drop it in your Applications folder:

```bash
npm install
npm run app:install     # builds with electron-builder, installs to /Applications/humanctl.app
open /Applications/humanctl.app
```

The installer (`scripts/install-app.sh`) targets `/Applications`; if that is not
writable it falls back to `~/Applications` and says so. It removes any existing
copy at both locations first, so there is never a duplicate for Spotlight to get
confused by. `npm run app:build` alone produces `dist/mac-arm64/humanctl.app`;
`npm run app:dmg` produces a shareable `.dmg`. These are unsigned; a locally
built app opens without a Gatekeeper prompt. If macOS blocks a moved copy,
right-click the app and choose Open once, or run
`xattr -dr com.apple.quarantine /Applications/humanctl.app`.

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

## How it is built

The renderer is React + TypeScript, built with Vite and electron-vite. Visible
implementation lives in `packages/ui`; renderer source owns only runtime and
viewport adaptation.

- `lib/sessions.ts` is the reader. It scans `~/.codex/sessions` and
  `~/.claude/projects` (both resolved from `$HOME` per call, never frozen at
  import), reads each transcript by bounded slices, and returns metadata, a
  per-session context map (`readBlocks`), and real token usage (`readUsage`,
  cached by mtime). Bounded reads past the 12MB cap are tail-anchored (the
  newest bytes, never the head) and say what they skipped (`truncated`,
  `skippedHeadBytes`). Token usage is the one reader that is NOT bounded: a
  bounded slice silently undercounts any transcript past the cap, so Claude
  totals are accumulated whole-file through a line-aligned per-file byte cursor
  and extended by exactly the appended bytes on later reads. Cost is summed over
  per-model buckets, so a session that switches model mid-run is priced at each
  model's own rate rather than entirely at the last one seen. The cursor map
  lives in the reader-service process, so it survives the renderer's 20s poll;
  a reader respawn just re-scans from zero. `readTimelinePage` serves the detail
  timeline in substantive-event-budgeted backward pages; `readAppended` reads
  only appended bytes through a line-aligned per-file cursor
  (`primeTailCursor`). `readDetail` adds the per-session last-exchange, Linear /
  issue refs, generated HTML files, skills used, reasoning effort, and ultracode
  flag (Claude logs these; Codex exposes effort/quota, not skills, and we never
  fake the gap). It never writes and never makes a network call.
- `lib/pricing.ts` holds approximate public token prices, used only for a local
  spend estimate (always labeled "est"). It is the single place to update.
- `electron/main.ts` owns the window, watches the session dirs (fs.watch) to
  push live updates (debounced for the list, immediate cursor-fed appends for
  the hot session), exposes read-only IPC, persists local UI state (view, nav
  pin, theme, pins, summary engine, selection, cached AI summaries, lastReadTs)
  under userData, migrates any legacy `mode` key forward to the new `view` key
  on read, and runs the opt-in `session:summarize` and `session:ask` through the
  user's own CLIs.
- `electron/preload.ts` is the locked bridge: a small, explicit set of calls, no
  direct fs, no network.
- `packages/ui/` is the visual and interaction owner. It starts from the
  Registry `base-nova` foundation with Base UI behavior and owns all primitives,
  blocks, tokens, layout, loading, and accessibility.
- `electron/renderer-vite/src/runtime/` owns the typed bridge and fixture
  adapters, resource loading, subscriptions, state hydration, and intent
  dispatch. It renders no DOM.
- `electron/renderer-vite/src/viewport/` connects the runtime model to explicit
  UI package exports. It contains no styling, intrinsic DOM, polling, or bridge
  access. With no preload bridge, the runtime selects
  `src/runtime/fixture-adapter.ts`, so demos contain only synthetic data.

## Agent inbox (the point of humanctl)

Agents post short aside / BTW messages to you with the CLI; the desktop surfaces
them in the Inbox:

```bash
humanctl note --level review "PRs are up, need a review + merge in ~5m"
humanctl note --level blocked "Blocked on a product call: Redis or Postgres?"
humanctl note "FYI refactor is going well, no action needed"
```

`--level` is one of `fyi | review | blocked | done`. Notes append to
`~/.humanctl/notes.jsonl` (one global inbox across every repo; the cwd and repo
are captured automatically). Pass `--session <id>` to link a note to a session
so the Inbox can open it. This is the core loop: agents avoid silently blocking
on you by leaving a small, durable note instead.

## Notch

The native macOS notch shell is parked under `attic/notch/` while the desktop
surface is the focus. Its build scripts are the `notch:*` npm scripts. It is
kept, not deleted.
