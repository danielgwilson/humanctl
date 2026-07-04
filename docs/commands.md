# The command registry

Every mutation of durable state, every process spawn, and every cross-session
observation `humanctl` performs is a registered command: declared once in
`lib/commands.js`, invocable from the desktop UI (IPC routed through the
registry), from the CLI against the running app (a control socket), and
logged as one event line. Renderer-only ephemera (hover, selection, scroll
position) are exempt; nothing that touches disk, a process, or another
session is.

`CommandRegistry >= control API >= CLI >= UI`: the registry is the only
choke point. The IPC channels in `electron/main.js` are thin adapters onto
`registry.invoke(name, params, { source: 'ipc' })`; the control socket calls
the same `invoke`; the CLI bridge (`humanctl app ...`) calls it too, either
over the socket or, for commands marked `direct`, in-process.

## Command table

Run `humanctl app list-commands` for the live table (it asks the running app
first, so it reflects exactly what that build registers). As of this
writing:

| command | kind | direct | params |
|---|---|---|---|
| `sessions.list` | observation | yes | `maxAgeH, limit, withUsage, includeAutomation` |
| `session.detail` | observation | yes | `id, path, harness` |
| `session.timeline` | observation | yes | `id, path, harness, before` |
| `skills.aggregate` | observation | yes | `maxAgeH, limit` |
| `notes.list` | observation | yes | `limit` |
| `inbox.threads` | observation | yes | `limit` |
| `note.post` | action | yes | `message*, level, repo, session, agent, cwd, images` (up to 4 image paths) |
| `span.run` | observation | yes | `date, record` |
| `pulse.run` | observation | yes | `repo, lane, fresh` |
| `pulse.pr-chip` | observation | yes | `repo*` (cache-only: reads `~/.humanctl/pulse-cache.json`, zero spawns) |
| `summary.budget` | observation | yes | `dailyBudgetUSD` (today's always-on-summary spend vs. budget) |
| `app.commands` | observation | yes | (none) |
| `app.harness-icons` | observation | no | (none) (runtime-extracted icons; app-only, needs `nativeImage`) |
| `app.status` | observation | no | `maxAgeH, limit` |
| `app.state` | observation | no | (none) |
| `app.set-state` | action | no | `patch*` |
| `app.set-view` | action | no | `view*` (`inbox\|metrics\|fleet\|sessions\|settings`) |
| `app.set-nav` | action | no | `pinned*` |
| `app.set-theme` | action | no | `theme*` (`light\|dark\|system`) |
| `app.set-engine` | action | no | `engine*` (`claude\|codex`) |
| `inbox.mark-read` | action | no | `threadId*, at` |
| `inbox.mark-all-read` | action | no | (none) |
| `session.pin` | action | no | `id*` |
| `session.unpin` | action | no | `id*` |
| `session.resume` | action | no | `id*, harness, cwd` |
| `session.open-app` | action | no | `id*, harness` |
| `session.reveal` | action | no | `id, path` |
| `session.summarize` | action | no | `id, path, harness, engine, auto` (`auto: true` marks a call from the always-on background engine, budget-gated, silent 401-skip) |
| `session.ask` | action | no | `id, path, harness, cwd, question*` |
| `atlas.ask` | action | no | `question*, engine` |
| `app.open-external` | action | no | `url*` |
| `app.open-path` | action | no | `path*` |

`*` marks a required param. `kind: action` mutates durable state or spawns a
process; `kind: observation` only reads. `direct: yes` means the command is
implemented purely over `lib/` (no Electron), so the CLI can still answer it
from disk when the desktop app is not running.

Adding a command means adding one entry to `COMMANDS` in `lib/commands.js`
(name, kind, desc, params) before wiring any UI or CLI surface to it. A
command with no handler fails honestly (`"only available through the running
desktop app"`) rather than silently doing nothing, so an incomplete wire-up is
loud, not silent.

## Param validation

`lib/commands.js` carries a minimal plain-JS schema per command:
`{ key: { type, required?, enum?, max? } }`. Types are `string`, `number`,
`boolean`, `object`, `array`. Unknown params are rejected (a typo'd flag never
silently no-ops). Free-text params (`message`, `question`) declare a `max`
and are hard-truncated, never rejected, so a long paste degrades instead of
failing outright. Array params (`note.post`'s `images`) declare a `max` too,
which caps the array length rather than truncating a string.

## Note images

`humanctl note --image <path>` (repeatable, max 4, png/jpg/gif/webp, <=10MB
each) copies each valid image into `~/.humanctl/attachments/` under a fresh
generated filename (never the caller's own path or filename, so a `/tmp`
screenshot that later gets deleted does not silently break a note that
already referenced it) and appends the generated filenames to the note's
`attachments` array in `notes.jsonl`. A bad individual path (missing, wrong
extension, oversized, unreadable) is skipped with a reason and reported back
to the caller (`humanctl note` prints one line per skipped image to stderr);
one bad `--image` never loses an otherwise-good note.

`attachments/` is NOT on the `~/.humanctl` inbox watcher's allowlist
(`isInboxRelevantChange`): the `notes.jsonl` write that references the new
filenames already triggers the Inbox refresh, so watching the attachment
files themselves would just be a second, redundant trigger for the same
event, and per AGENTS.md's write/watch separation rule, every new
system-written path must be an explicit, deliberate exclusion.

The desktop app renders inline thumbnails in the notes stream (both the
Inbox thread detail and the full session detail); clicking one opens the
full image via the OS default viewer, routed through the already-registered
`app.open-path` command after a small `note:resolve-attachment` IPC call
resolves a bare filename to its real path within `attachments/` (the
renderer never holds or can forge a raw filesystem path).

## Harness icons

`app.harness-icons` extracts each installed harness app's own icon at
runtime: `lib/harness-icons.js` (pure, Electron-free, selftested without a
display) reads the app bundle's `Info.plist` `CFBundleIconFile` key -- never
a hardcoded `.icns` filename, since Claude ships `electron.icns` and Codex
ships `icon.icns` -- and resolves it to a real, non-empty file under
`Contents/Resources`. `electron/main.js` then does the one Electron-only
step (`nativeImage.createFromPath` + downscale + `toPNG()`), caches the
result under Electron `userData` (never the repo, never a `~/.humanctl`
watched path), and returns a data URL. ANY failure at any step -- app not
installed, unreadable plist, missing icon file, decode failure, empty image
-- resolves to `null`, and the renderer falls back to the built-in neutral
glyph silently. Fixture mode (`window.humanctl` absent) never calls this at
all, so screenshots and the browser dev loop always show the built-in glyphs.

## PR chips (cache-only contract)

`pulse.pr-chip` reads ONLY the existing `~/.humanctl/pulse-cache.json` (the
cache `lib/pulse.js` itself writes whenever a `humanctl pulse` run
completes): zero network calls, zero `git`/`gh` process spawns, ever, from
this command's call graph. A cache miss (no cache file, wrong config
signature, the requested repo not present in the cached data, a degraded
entry) returns `{ok: true, chip: null}`, never an error and never a trigger
to go fetch fresh data -- refreshing the underlying cache happens only when
`pulse.run` itself runs (manual `humanctl pulse`, a future Atlas-drawer
refresh action, or a future scheduled run). When the cache entry is older
than 10 minutes the chip still renders, with an honest age label ("2/3 PRs ·
as of 14m") rather than silently implying live data.

## Always-on AI summary + budget

Unread threads in a needs-input/needs-approval state get a background
summary automatically, reusing the exact same summarizer path as the manual
"Generate/Refresh AI summary" button (`session.summarize`, haiku, the same
anchored one-retry-then-give-up 401 handling documented in
`docs/ask-session.md`), marked with `auto: true`. The refresh check
piggybacks the renderer's EXISTING 20-second poll (no new timer): a thread
qualifies for a fresh summary when it has none yet, or when at least 12 new
substantive items have landed since its cached summary's timestamp.

Budget is ONE authoritative unit: estimated dollars/day, computed live from
the actual prompt and output text of each call, priced via `lib/pricing.js`'s
real haiku rate table (`lib/summary-budget.js`). Default $1.00/day,
configurable in Settings, persisted per calendar day in
`~/.humanctl/summary-budget.json` (not inbox-watcher-relevant, same rule as
attachments above) and reset at local midnight. At the cap, the engine pauses
for the rest of the day and the header shows an honest "summary budget
reached today" chip; a persistent 401 (after the one anchored retry) is a
silent SKIP, never counted against the budget (nothing was spent) and never
clobbering a still-valid stale summary.

## The event log

Every `registry.invoke` appends one line to `~/.humanctl/events.jsonl`,
whether it came from the UI, the socket, or a direct CLI call:

```json
{"ts":"2026-07-03T21:28:39.214Z","name":"note.post","kind":"action","source":"cli-direct","paramsDigest":{"message":"sugar-flag smoke test","level":"fyi"},"ok":true,"ms":2}
```

Fields: `ts` (invoke start, ISO), `name`, `kind` (`action` / `observation` /
`unknown`), `source` (`ipc` / `socket` / `cli-direct`), `paramsDigest`, `ok`,
`ms` (wall time). `source` distinguishes an app-driven invoke from a CLI call
that answered from disk because the app was not running.

`paramsDigest` records shapes, never raw content: session ids and enum values
pass through as-is, free-text strings are hard-truncated to 80 characters,
arrays collapse to their length (`[3]`), and nested objects collapse to their
sorted key names (`{mode,theme}`), since a state patch can carry an AI
summary of real session content. `undefined` params are omitted, not logged
as the literal string `"undefined"`.

Logging never breaks the command it records: a failure to write the event
(missing dir, full disk, permissions) is swallowed. The log is best-effort
observability, not a queue.

The file rotates to `events.1.jsonl` at 5MB, keeping one prior generation.
Two writers (the app and a concurrent `cli-direct` invoke) can race the
rotation rename; worst case is one early rotation, accepted for a local
personal tool.

## The control socket

The desktop app listens on `~/.humanctl/app.sock`, a unix domain socket,
while it is running:

- Created with mode `0600` (owner read/write only).
- Any stale socket file at that path is unlinked before listening (a crashed
  previous instance cannot wedge the next one).
- Cleaned up (`unlink`) on app quit (`will-quit`).
- Protocol: one JSON request per connection, `{"name": "...", "params": {...}}`
  terminated by a newline (or the connection's half-close), answered with one
  JSON response (`{"ok": true, ...}` or `{"ok": false, "error": "..."}`),
  also newline-terminated, then the server closes its end.
- The socket exposes exactly `registry.invoke`, nothing more: there is no
  other command surface to reach through it.
- Requests are capped at 256KB; oversized input destroys the connection.

Skipped entirely when `HUMANCTL_SMOKE` is set, so an automated boot-and-quit
smoke test cannot steal (and then delete) a real running app's socket.

### Local-trust model

The socket is a personal-machine control surface, not a service boundary.
Any process running as your uid can connect and invoke any registered
command, the same way any process running as your uid can already read and
write your files. That is an accepted tradeoff for a personal tool used by
one person on one machine: it is never a TCP port, never bound to a network
interface, and never intended to be reachable from another machine or user.
If `humanctl` ever grows multi-user or networked ambitions, this socket is
not the mechanism to extend for that; it would need real authentication
first.

## The CLI bridge

    humanctl app list-commands [--json]

Lists every registered command. Asks the running app first (its answer is
the live truth for that build); falls back to the local `lib/commands.js`
declarations, which are the same table by construction, when the app is not
running.

    humanctl app invoke <name> [--json '{"...": "..."}']

Invokes a command with raw JSON params. This is the general form; use it for
params the flag-sugar form below cannot express cleanly (nested objects,
booleans that need to be explicit).

    humanctl app <name> [--param value ...]

Sugar: CLI flags become params, coerced to the command's declared type
(`number`, `boolean`, `object` via `JSON.parse`, otherwise `string`).
Examples:

    humanctl app sessions.list --limit 10
    humanctl app session.detail --id 553653c8
    humanctl app session.pin --id 553653c8
    humanctl app app.set-view --view sessions
    humanctl app app.set-view --view inbox

Dispatch order: `humanctl app` predates the registry and still launches a
legacy source-checkout workspace UI when its first argument is not
`list-commands`, `invoke`, or a registered command name (see `launchApp` in
`bin/humanctl.js`); this keeps `humanctl app [dir]` behaving exactly as
before for anyone still using it.

All three forms try the control socket first. If nothing is listening:

- Commands marked `direct` in the table above (pure `lib/` observations, plus
  `note.post`) still answer, executed in-process against the same files the
  app would read, with `source: "cli-direct"` in the event log. `humanctl
  span`, `humanctl note`, and `humanctl pulse` are themselves thin wrappers
  over this same path, so they, `humanctl app span.run`, and the app's own UI
  share one implementation and one event-log trail.
- Anything else (an app-only action, like `session.pin` or `app.set-view`)
  returns an honest error: `"humanctl desktop app is not running (start it
  with \`npm run desktop\` or open the installed app)"`. It never pretends to
  have mutated state it could not reach.

## Selftest

    npm run commands:selftest

Plain node, zero network. Almost every case uses a temp `HOME` or a temp
socket path; the one exception (`inbox.threads` proving the `note.post` ->
thread-assembly join end to end) writes through the real `note.post` path
and truncates its own appended line back off `~/.humanctl/notes.jsonl` in a
`finally` block, verified byte-identical before/after (a pre-existing quirk
in `lib/sessions.js`, tracked separately, means `readNotes()` cannot be
sandboxed by swapping `process.env.HOME` after the module's first
`require()`, unlike the `controlDir()`-based writers). Covers: the
`COMMANDS` table shape, param validation (required / unknown / enum / type /
truncation), `digestParams` shaping, registry dispatch (unknown command,
missing handler, validation short-circuit, a throwing handler turned into
`ok: false`, a real `note.post` write), inbox thread assembly (notes,
detected asks, and persisted btw Q&A each producing the right thread shape),
the ask-log round-trip (`appendAskLog`/`readAskLog`), the shell-v2 command
declarations (`app.set-mode` deleted; `app.set-view`/`app.set-nav` added;
the persistent-rail commands removed; `inbox.mark-read`, `atlas.ask`),
the event log (entry shape, rotation at the byte boundary, a
broken log directory degrading to a no-op), a real control-socket
round-trip (including the 0600 mode and stale-socket unlink), and the PR-2
surface: `app.harness-icons` registered app-only with an honest
not-running error, `pulse.pr-chip`'s cache-only contract (a missing cache,
a fresh hit matched case-insensitively by repo alias, a stale-but-present
hit with an honest age, a degraded entry yielding no chip), `note.post`'s
image handling (`storeNoteImages` copying a real file / skipping a missing
one / skipping a non-image extension / capping at 4, and a full CLI-shaped
round-trip through the registered command), the `attachments/` directory
being excluded from `isInboxRelevantChange`, and `summary.budget` reflecting
real recorded spend from `lib/summary-budget.js`.

`npm run perf:logic-selftest` (see `docs/perf.md`) is a separate, CI-safe
pure-logic selftest covering the watcher filter, the summary-budget math, and
harness-icon path resolution in more depth than the checks above; it is not a
substitute for the required LOCAL `npm run perf:selftest` gate, which drives
a real Electron window and is not part of either selftest above.
