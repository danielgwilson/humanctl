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

## The shell (one rule: one owner per signal)

The shell is deliberately subtracted, but shell v2's fully-hidden nav rail went
too far (it was undiscoverable). Shell v3's chrome pass (0.16.0a) restores a
VISIBLE left nav strip, adds a bottom context bar as the sole home for the
fleet digest and quota, moves resources into Metrics, and narrows the former
Atlas drawer to chat only. Every piece of information has exactly one home per
screen; the design contract is [DESIGN.md](../DESIGN.md) at the repo root, and
its signal-ownership table is the acceptance checklist for any UI change.

- **Header** (always present, the frameless window's drag region). Slim: the
  wordmark, the version tag, and the right-drawer sidebar-toggle icon button.
  It owns nothing else -- no digest, no quota chip, no theme control, no
  settings entry point. Those all moved to the bottom context bar and the
  user/settings picker (below), each becoming that signal's one owner.
- **Nav strip** (a VISIBLE icon strip by default, not hidden -- shell v2's
  fully-hidden rail was undiscoverable and is the mistake this pass corrects).
  Icons top to bottom: Inbox (unread badge), Metrics, Fleet, Sessions. Hovering
  the strip itself for at least 150ms expands it to show labels as an overlay
  (does not push content); mouse-out collapses it back to icons. `Cmd+\` pins
  the widened rail as a fixed column that pushes content over. Keys
  `1`/`2`/`3`/`4` switch Inbox / Metrics / Fleet / Sessions. Every switch is the
  registered `app.set-view` command; pinning is `app.set-nav`. A user/settings
  picker anchors the foot of the strip (see below).
- **User / settings picker** (bottom-left, foot of the nav strip; styled like
  the Codex/Claude-Code sidebar footer). A bespoke popover with quick theme
  (light/dark/system), the always-on summary budget, and "All settings," which
  routes to the existing `app.set-view('settings')` destination -- Settings
  stays a first-class routable view; the picker is its entry point, not a
  second home. Theme persists via the existing `app.set-theme`.
- **Views**: Inbox (default), Metrics, Fleet, Sessions, Settings (reached via
  the picker, not a nav-strip icon).
- **Session detail**: opening any session from any view shows the full-width
  detail with a back breadcrumb; `Esc` returns to the calling view.
- **Chief-of-staff drawer**: a summonable right-side overlay (key `a`, or the
  header's sidebar-toggle icon button), chat only -- the digest block and the
  resources block that used to live here are gone, each with exactly one home
  elsewhere now. Default closed; state persists via `app.set-cos-drawer`.
  `Esc` or a scrim click closes it (and persists the closed state the same as
  the header toggle).
- **Bottom context bar** (always present, one line, mono). The sole home for
  the fleet digest ("N need you, M moving, ..."), Codex quota (absolute reset
  clock, e.g. "resets 9:41pm," never "resets now"; hover shows the cadence and
  windows remaining), Claude quota (shown honestly as "n/a" with a tooltip --
  Claude Code transcripts expose no rate-limit data, only token counts, so
  nothing is fabricated), and, when a session's full-width detail is open,
  that session's context-fill percent. Quota color: neutral under 50 percent,
  amber over 50, red over 80.

Vocabulary is fixed (DESIGN.md): session states are `running`, `needs input`,
`needs approval`, `blocked`, `stalled`, `stale`, `finished`, `archived`. Note
levels (`fyi`, `review`, `blocked`, `done`) appear only as chips on note items,
never as session states. Colors are semantic per axis; harness identity is
conveyed by a neutral built-in glyph shape, never by color.

## Inbox (default view)

Inbox is message-centric: one thread per session, assembled from `humanctl
note` posts, detected needs-you asks (the v3 reader's state transitions with
their `stateReason`), and persisted ask-the-session Q&A. Two panes only: the
thread list and the thread detail. Selecting a thread renders the FULL
session-detail component into the second pane (the same component family as
the full-width detail below, never a fork): the notes stream prominent at the
top, then the AI summary block, the conversation tail, the quick responses +
composer, the touched chips, and the session-details disclosure.

Row anatomy is exactly three lines (DESIGN.md "Row anatomy"):

- Line 1: the neutral harness glyph, the custom session title, and the relative
  time ladder (`now`, `Nm`, `Nh`, weekday for this week, `M/D` beyond). An
  unread dot sits on the left edge. Unread means any thread item newer than that
  thread's last-read watermark (`inbox.mark-read` / `inbox.mark-all-read`,
  persisted in `state.json` as `lastReadTs`); opening a thread marks it read.
- Line 2: the state chip plus the message to the human, first sentence only, in
  priority order: the newest unresolved detected-ask excerpt, else the newest
  note message, else the newest completion line.
- Line 3: the working-directory basename.

A compact toolbar sits above the list: a fuzzy search over title + dir +
preview, a state filter, a harness filter, and a sort (recent | needs-first |
alpha). This search/filter/sort state is renderer ephemera, exempt from the
command registry by the AGENTS.md invariant's exemption clause (it is transient
UI state like scroll position, and touches no disk, process, or other session).

`Enter` (or the context menu's open) promotes the selected thread to the
full-width session detail, entered from Inbox; `Esc` returns. A thread whose
session has aged out of the recent scan cannot offer resume or reply (those need
the live row); its pane shows the stream with an honest note instead.

The empty state is honest: "No agent updates yet. Agents post here via
`humanctl note`," with the CLI one-liner shown, never a fake zero-state graphic.

## Session detail (full width)

The session detail is one component family, reused (not forked) by both Inbox
and Sessions. Top to bottom:

- Header: the harness glyph, the title, the state chip with its reason, and the
  time. A back breadcrumb returns to the calling view; `Esc` does the same. A
  pin/unpin control lives here (and in the context menu). Top-right is a
  split-button "Resume in <Harness>" using the per-harness destination
  preference already stored in state; its dropdown offers the other destination,
  Reveal transcript, and Copy session id.
- Notes stream: the humanctl-updates timeline (notes with level chips, detected
  asks, and btw Q&A) as calm entries.
- Cached AI summary block: a manual-trigger summary (unchanged mechanics),
  labeled with its engine and age.
- Conversation: the live dossier timeline, built from real substantive events
  read tail-first, wired to upward infinite scroll. Every truncation is an
  explicit element ("~N earlier events not shown · load older"); a timeline that
  verifiably reaches the beginning ends with "start of session"; a live
  indicator ("live · updated Ns ago") tracks real event times while the watched
  session updates.
- Ask the session: the persisted quick-response + composer block (the same
  component the Inbox reply uses, not a fork).
- Touched chips: repos and issue keys, sourced only from the session reader's
  own extracted refs (`extractIssueKeys` and the transcript-mentioned
  repo/working-directory paths, via `readDetail`'s `linearRefs`), never from
  `lib/pulse.ts`. They fill in asynchronously after the first paint.
- Session details disclosure: cwd, ids, context %, tokens, engine.

## Sessions view (the complete fleet)

Sessions replaces the old Wall: the complete-fleet list, denser rows than Inbox
but the same three-line anatomy. Sort by recent | state | created | title; the
same search / state / harness filters as the Inbox toolbar (also renderer
ephemera). Pinned sessions float to the top. Pin/unpin from the context menu or
the detail header. There is no kanban and no peek overlay in 0.15.x (both were
deliberately cut).

## Metrics (basic) and Fleet (placeholder)

Metrics is basic as of 0.16.0a: it is now the one owner of the Resources block
(claude spend est, codex api-equiv est, fleet tokens, both codex quota windows
with absolute reset clocks, and an honest claude-quota n/a row), moved here
from the former Atlas/chief-of-staff drawer, which no longer renders it. The
richer Metrics tiles (arbitrary time range, number+bar usage tiles, an anomaly
line, skills/productivity breakdowns) are a fast-follow, called out honestly in
the view's own subhead rather than pretended to already exist. Fleet (0.17)
remains a quiet placeholder: the complete list already lives in Sessions; Fleet
will add the shape of the fleet (a graph), not a second session list.

## Chief-of-staff drawer (summonable, chat only)

The chief-of-staff drawer is a summonable right-side overlay (key `a`, or the
header's sidebar-toggle icon button), narrowed to chat only in shell v3's
chrome pass -- the digest block and the resources block that used to live here
are deleted (`atlas.js`'s old `digestHtml()` reuse and `resourcesHtml()`),
since both had exactly one other home already (the bottom context bar and
Metrics, respectively) and a second home for either was a one-owner-rule
violation. Its only contents now:

- Ask the chief of staff: an advisory-only chat grounded in `pulse --json`'s
  lane summary, recent notes, and the top-N session states with their reasons.
  The prompt requires citing which sessions or lanes an answer refers to and
  saying "I don't see that" rather than guessing. It never invokes a registry
  command itself. Every exchange is logged as an `atlas.ask` observation and
  persisted to `~/.humanctl/atlas.jsonl`, restored on launch so the thread
  survives a restart. (The underlying command name and log file stay `atlas.*`
  for continuity with existing data; only the UI surface and copy changed.)

Default closed; open/close state persists via `app.set-cos-drawer` (a
distinctly-named command from the retired shell-v2 `app.set-right-rail`, so
this newer concept does not resurrect a deleted name for something else).

## Custom right-click context menu

Every session row, inbox thread, and the empty background has a custom HTML
context menu (not the native OS menu, so it matches the app's design language
and shows reasons and shortcuts consistently). Menu entries are exactly the
applicable REGISTERED commands for that target: a session row offers resume /
open-in-app, reveal, copy id, summarize, and pin/unpin; a thread offers open,
mark-read, resume, and pin; the background offers the view switches, the
chief-of-staff drawer toggle, the nav-pin toggle, the theme toggle, and
Settings. No entry bypasses the registry. Keyboard navigable (arrows, Enter,
Escape); dismisses on Escape or a click outside.

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
Atlas queue, and tooltips.

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

Spend, tokens, and Codex quota detail surface in the Metrics view (their one
owner as of 0.16.0a). The bottom context bar always shows both quotas (Codex
with its real percent and absolute reset clock; Claude honestly as "n/a") plus
the fleet digest, regardless of percentage -- there is no header quota chip
anymore (the header owns nothing but brand and the drawer toggle).

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

The shell honors the DESIGN.md SLOs as constraints: DOM rebuilds are
signature-gated so unchanged data does not rebuild; touched chips fill
asynchronously after the first paint; there are no timers beyond the existing
20s list poll, the one hover-intent timer for the nav rail, and a 1s cosmetic
live-indicator ticker that fetches nothing; and at idle the app does zero
self-triggered refresh (the poll returns early on an unchanged signature, and
the `~/.humanctl` watcher ignores its own event-log writes via
`isInboxRelevantChange`).

## Privacy posture (born clean)

This repo is public. The rules that keep it safe:

- The code reads transcripts but never copies them into the repo.
- Screenshots and demos use the synthetic fixture in
  `electron/renderer-vite/src/lib/fixtures.ts`, never real sessions. See
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

The renderer (`electron/renderer-vite/`, React + Vite + Tailwind + shadcn) has
a fixture fallback. When the `window.humanctl` IPC bridge is absent (the page
opened in a plain browser), it falls back to synthetic fixtures, so the whole
UI renders and is driveable without launching Electron:

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

The renderer is React + TypeScript, built with Vite / electron-vite.

- `lib/sessions.ts` is the reader. It scans `~/.codex/sessions` and
  `~/.claude/projects`, reads each transcript by bounded slices, and returns
  metadata, a per-session context map (`readBlocks`), and real token usage
  (`readUsage`, cached by mtime). Bounded reads past the 12MB cap are
  tail-anchored (the newest bytes, never the head) and say what they skipped
  (`truncated`, `skippedHeadBytes`). `readTimelinePage` serves the detail
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
- `electron/renderer-vite/` is the UI: React 19 + Vite 7 + Tailwind v4 +
  shadcn/ui (Radix underneath) on the humanctl design tokens. `src/App.tsx`
  wires the shell (sidebar, header, context bar, chief-of-staff drawer) around
  the Inbox view (`src/components/inbox/`) and the session-detail view
  (`src/components/session/`); `src/hooks/use-humanctl.ts` is the typed client
  for the `window.humanctl` bridge. With no bridge (a plain browser, for a
  screenshot) it falls back to the synthetic fixtures in
  `src/lib/fixtures.ts`, so demos never contain real session content.

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
