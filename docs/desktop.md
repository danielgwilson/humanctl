# Desktop App

`humanctl` desktop is a local-first control room for agent sessions. It reads
recent Codex and Claude Code transcripts on this machine and shows them in one
list: which harness, which repo, the opening prompt, who the turn is waiting on,
and how long ago it moved.

It is read-only and offline by default. It never writes to your transcripts and
never sends anything off the machine, with explicit, opt-in exceptions, all
running through your own local CLI auth when you ask for them: the AI-summary
action sends a session's recent messages to a model through your local
`claude` or `codex` CLI (you pick the engine in settings); the ask-the-session
action injects a one-turn question into a session through that session's own
harness CLI (Claude asks leave no trace in the session; Codex asks write the
marked question into the thread itself and are disclosed and acknowledged
before the first one runs, see [ask-session.md](./ask-session.md)); and Atlas
(below) sends a fleet-level prompt (pulse summary, recent notes, top session
states) through the same local CLI, advisory only, never executing anything.

The surface is exception-first: sessions that need you (the agent's turn is done,
the ball is with you) lead; everything healthy recedes. Three modes (Inbox /
Focus / Wall, keys 1/2/3) sit under one persistent conductor header, alongside
a persistent left roster and right Atlas panel that stay on screen in every
mode (both collapsible, both persisted). Inbox is message-centric and is the
default on launch; Focus and Wall stay session-centric for deep work and
ambient overview.

## Inbox (default mode)

Inbox groups agent communication into one thread per session, sorted by
newest item first: `humanctl note` posts, detected needs-you asks (the v3
reader's state transitions, with their `stateReason`), and persisted
ask-the-session Q&A. The thread list row shows the agent, a one-line preview
of the newest item, a level chip (blocked / review / done / fyi, the same
semantic colors as everywhere else), relative time, and an unread dot. Unread
means any item newer than that thread's last-read watermark
(`inbox.mark-read` / `inbox.mark-all-read`, persisted in `state.json` as
`lastReadTs`); opening a thread marks it read.

The detail pane renders the humanctl-updates stream by default (notes,
detected asks, and Q&A as calm timeline entries); "Show full conversation"
expands the same dossier timeline component Focus uses (not a fork) inline,
for when the stream alone is not enough context. The thread header offers
Reply (the same ask-the-session composer as Focus, against that session),
Resume, and Open in Linear when a ref exists.

The empty state is honest: "No agent updates yet. Agents post here via
`humanctl note`," with the CLI one-liner shown, never a fake zero-state
graphic.

## Atlas panel (right rail, all modes)

The right rail is Atlas in every mode: a digest line, the needs-you queue
(unchanged behavior from the old Focus-only right rail, now shared), and an
advisory chat. Atlas answers are grounded in `pulse --json`'s lane summary,
recent notes, and the top-N session states with their reasons; the prompt
requires citing which sessions or lanes an answer refers to and saying "I
don't see that" rather than guessing. Atlas is advisory only: it answers and
recommends, it never invokes a registry command itself. Every exchange is
logged as an `atlas.ask` observation and persisted to `~/.humanctl/atlas.jsonl`,
restored on launch so the thread survives a restart.

## Custom right-click context menu

Every session row, inbox thread, and the empty background area has a custom
HTML context menu (not the native OS menu, so it can match the app's design
language and show consistent entries). Menu entries are exactly the
applicable REGISTERED commands for that target (a session row offers resume,
open-in-app, reveal, summarize, ask, pin/unpin, and mark-read when it has an
inbox thread; a thread offers open, mark-read, reply, resume; the background
offers mode and rail/theme toggles). No entry bypasses the registry. Keyboard
navigable (arrow keys, Enter, Escape); dismisses on Escape or a click outside
the menu.

## State model (who the ball is with)

A session's state is derived from real signals, never fabricated. Since v3 the
state axis reads the CONTENT of the transcript tail, not just who spoke last:
a 2026-07 ground-truth audit of 60 real sessions graded the old
lastRole-plus-decay heuristic at 36% precision, and the failure modes it found
drive the rules below. The reader (`lib/sessions.js`) classifies every row and
attaches `state`, `stateReason`, and `tier`; the renderer overlays notes on
top and owns no classification logic or time constants of its own.

- blocked: the session has a `blocked` note.
- needs you, when the tail actually asks for you:
  - the final substantive assistant message is question-shaped (ends on a
    question aimed at you) or decision-shaped (handoff phrases like "say the
    word", "your call", "only you can", "ready for your review",
    "reviewDecision REVIEW_REQUIRED"), with a future-tense guard so "I'll
    report when it's ready for your merge" does not count;
  - or you interrupted the turn (`[Request interrupted by user]`, Codex
    `turn_aborted`) and no assistant turn followed: only you can resume;
  - or your last reply was a question or directive the agent never picked up;
  - or the session has a `review` note.
- done: the session has a `done` note that is its newest signal (a done note
  clears needs-you immediately; activity after the note reopens it), or the
  final assistant message is completion-shaped ("merged", "shipped",
  "killed", "complete") with no trailing ask.
- working: tool activity is in flight, or the tail is a fresh progress report,
  or your own turn was just picked up (fresh means within the last 30 minutes).
- idle: everything else, including progress-shaped tails that went stale
  without asking anything.

Every state carries an honest reason ("asks you a question", "awaiting your
go-ahead", "note: blocked"), surfaced in the queue rows, the dossier subline,
tooltips, and the Inbox thread stream.

Substantive events only: trailing local commands (`/model`, `/effort`) and
metadata appends (pr-link, mode, custom-title, last-prompt lines) neither
change the state nor refresh the session's age. A dead thread whose file was
touched by a footer rewrite stays dead; a pending ask behind a stray `/model`
stays a pending ask. Headless one-shot sessions (humanctl's own summarizer
probes, other `claude -p` runs) are filtered from the interactive list
entirely, mirroring the Codex-side automation filter.

## Attention tiers (how long a session stays on your desk)

The old single 18h needs-you cliff is replaced by three tiers, aged by the
last substantive event's own timestamp (never file mtime) and validated by
resume-pattern mining over the full local session history:

- hot (under 24h idle): full-strength display.
- drifting (24h to 7 days): still listed, needs-you shape retained, rendered
  visually secondary. About 1 in 3 day-old sessions is eventually picked back
  up, but few within the next day; drifting keeps them reachable without
  stealing attention.
- archived (over 7 days): drops from Focus and Inbox and from all counts; the
  Wall keeps it, dimmed. Past 7 idle days only ~6% of sessions ever resume.

Within tiers the reader sorts needs-you first, then session depth (message
count), then recency, following the mining's odds ratios (depth 2.23, age
1.82, question-tail 1.46). `TIER_HOT_MS` and `TIER_DRIFT_MS` live in
`lib/sessions.js` and are the single source; `NEED_DECAY_MS` remains as an
alias equal to the hot tier for `lib/pulse.js` consumers. Explicit notes
(`blocked`, `review`) do not decay.

The persistent right rail's needs-you queue (part of the Atlas panel, above)
owns needs-you and blocked in every mode: it is the priority queue you work
down. The left roster is the full inventory, every state as full rows (rail
v2: title, one-line summary, cwd basename + harness + time; no context bar).
Fleet totals (claude spend, codex API-equivalent, tokens, codex quota) live in
the Atlas panel and the header, for every mode.

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

## Live dossier timeline (honest truncation + sub-2s appends)

The watched-agent timeline is built from real substantive events (your
messages, the agent's messages, interrupts, tool activity collapsed into
counted runs) read TAIL-FIRST from the transcript, so it always matches the
latest messages. Two rules keep it honest and live:

- Explicit truncation, never a silent splice. Transcripts routinely exceed the
  bounded read cap, and tool_result lines are 56-80% of tail bytes in the wild,
  so timeline pages are budgeted by substantive events, not raw bytes. Every
  cut is a visible element: "~N earlier events not shown · load older" (the
  count is a density estimate, marked ~) loads the next bounded chunk backward
  on demand, and a timeline that verifiably reaches the beginning ends with
  "start of session".
- Incremental appends for the watched session only. Transcripts are
  append-only, so the main process keeps a per-file cursor (inode, size,
  line-aligned byte offset) for the ONE session open in the dossier and, on its
  fs events, reads only the bytes appended since the last read, pushing parsed
  events straight to the renderer. Measured end to end (fs append to renderer
  push): 125-160ms. The dossier header shows "live · updated Ns ago", driven by
  real event times. Claude custom-title lines and Codex turn markers are picked
  up from appended bytes; the session's state is re-derived through the same
  needs-you v3 classifier the list uses. Rotation or truncation (inode change,
  size shrink) is never papered over: the cursor resets and the timeline
  re-reads a full page. Background sessions keep the debounced list refresh;
  only the selected session gets the hot path.

The incremental parser and cursor math (rotation, partial-line flushes,
multibyte alignment, probe filtering) are covered by `npm run reader:selftest`.

## How it is built

No build step, no bundler. The renderer is plain HTML and JS.

- `lib/sessions.js` is the reader. It scans `~/.codex/sessions` and
  `~/.claude/projects`, reads each transcript by bounded slices, and returns
  metadata, a per-session context map (`readBlocks`), and real token usage
  (`readUsage`, cached by mtime). Bounded reads past the 12MB cap are
  tail-anchored (the newest bytes, never the head) and say what they skipped
  (`truncated`, `skippedHeadBytes`). `readTimelinePage` serves the dossier
  timeline in substantive-event-budgeted backward pages; `readAppended` reads
  only appended bytes through a line-aligned per-file cursor
  (`primeTailCursor`). It never writes and never makes a network call. It is a
  plain Node module, so it runs and tests on its own.
- `electron/pricing.js` holds approximate public token prices, used only for a
  local spend estimate (always labeled "est"). Update it as vendor pricing
  changes; it is the single place to do so.
  `readDetail` adds the per-session last-exchange, Linear refs, generated HTML
  files, skills used, reasoning effort, and ultracode flag (Claude logs these;
  Codex exposes effort/quota, not skills, and we never fake the gap).
- `electron/main.js` owns the window, watches the session dirs (fs.watch) to push
  live updates (debounced for the list, immediate cursor-fed appends for the
  hot session), exposes read-only IPC (`sessions:list/read/timeline`,
  `status:get`, `session:hot`, `skills:aggregate`, `*:reveal/open`), persists
  local UI state (mode, theme, temperature, pins, summary engine, selection,
  cached AI summaries) under userData, and runs the opt-in `session:summarize`
  (local `claude` or `codex` CLI, cached by engine and file mtime). It also
  sets the app icon from `electron/assets/`.
- `electron/preload.js` is the locked bridge: a small, explicit set of calls,
  no direct fs, no network.
- `electron/renderer/` is the UI: the conductor home with Inbox / Focus / Wall
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

## Ask the session

The watched-agent dossier carries an "Ask the session" block under the AI
summary: three quick prompts (Status? / What do you need from me? / Summarize
this thread) plus a freeform input. The answer comes from the session itself,
resumed headlessly through its own harness CLI, so it is grounded in the
session's full context rather than the transcript tail. Question and answer
pairs render as a compact thread with engine and age, persist across restarts
like summaries (capped), and every question carries the `[humanctl btw]`
sentinel prefix.

The footprint differs per harness and the block says which one applies:

- Claude Code sessions: `claude -p --resume <id> --no-session-persistence`,
  which writes nothing to disk (verified byte-identical). Available by
  default, safe even while the session is open in a terminal.
- Codex sessions: `codex exec resume <id>` always appends the question and
  answer into the real thread (there is no headless fork), pinned to
  `sandbox_mode=read-only` because resume otherwise runs full-access
  regardless of the thread's original sandbox. The first Codex ask shows a
  one-line disclosure with a confirm, the acknowledgement persists, and asks
  are refused while the session is actively working. The reader treats
  persisted probe turns as non-substantive so they can never flip a session's
  state, refresh its age, or mask a real ask.

Mechanics, verification, and the cost notes live in
[ask-session.md](./ask-session.md).

## Status

- Shipped (0.14.0, the inbox + shell redesign): Inbox replaces Triage as the
  keys-1 default, message-centric rather than session-centric (see "Inbox
  (default mode)" above). The left roster and the Atlas right rail (digest,
  needs-you queue, advisory chat) are now persistent across every mode,
  collapsible and persisted (`app.set-left-rail`, `app.set-right-rail`). Rail
  v2 rows drop the per-row context bar (context % moved to the Focus dossier
  only) in favor of title + status, a one-line summary (cached AI summary or
  last-exchange snippet), and cwd basename + harness + time. A custom
  registry-driven right-click context menu replaces any native menu. btw
  (ask-the-session) threads now persist to `~/.humanctl/asks/<sessionId>.jsonl`
  and survive a restart; a probe still in flight when the window closes is
  recorded as interrupted, never silently lost.
- Shipped (the 0.6.x conductor home): Atlas chief-of-staff header (a digest
  sentence naming who is waiting on you, plus a needs-you hero count). Focus
  is the roster (the full inventory: pinned / working / idle / done rows)
  plus a watched-agent panel with timeline and context-map facets and a
  cumulative-token sparkline. Wall is a tile grid of the whole fleet with a
  peek overlay. Agents get deterministic nicknames and faces from the session
  id; a session renamed in Claude Code shows its real title instead. Pins
  persist. Rows show real signals only: last prompt (or the AI summary when
  one was made, marked "ai"), context %, cost or API-equivalent, model,
  reasoning effort, ultracode, Linear refs, generated HTML files, skills.
  Codex 5h + weekly quota and fleet spend totals; resume in the harness
  desktop app or in a Terminal window (see Actions below), reveal transcript,
  open in Linear; opt-in AI summaries with a summary engine picker (Claude
  Code or Codex CLI) that land in a labeled block in the watched-agent
  dossier, with engine + age, and persist across restarts; light/dark themes
  and a considered/loud temperature toggle; live fs.watch updates. The
  pre-0.6 tabs, back/forward nav, filter chips, search, and spot-check were
  replaced by the three (then Focus/Triage/Wall, now Inbox/Focus/Wall) modes.
- Next: per-repo grouping, and optional wake/ping actions (these cross from
  read-only into control, so they ship behind an explicit opt-in).

## Notch

The native macOS notch shell is parked under `attic/notch/` while the desktop
surface is the focus. Its build scripts are the `notch:*` npm scripts. It is
kept, not deleted.
