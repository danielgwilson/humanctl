# The command registry

Every mutation of durable state, every process spawn, and every cross-session
observation `humanctl` performs is a registered command: declared once in
`lib/commands.ts`, invocable from the desktop UI (IPC routed through the
registry), from the CLI against the running app (a control socket), and
logged as one event line. Renderer-only ephemera (hover, selection, scroll
position) are exempt; nothing that touches disk, a process, or another
session is.

`CommandRegistry >= control API >= CLI >= UI`: the registry is the only
choke point. The IPC channels in `electron/main.ts` are thin adapters onto
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
| `quota.claude` | observation | yes | (none) (spawns `claude` twice; see below) |
| `app.commands` | observation | yes | (none) |
| `app.harness-icons` | observation | no | (none) (runtime-extracted icons; app-only, needs `nativeImage`) |
| `app.status` | observation | no | `maxAgeH, limit` |
| `app.state` | observation | no | (none) |
| `app.set-state` | action | no | `patch*` |
| `app.set-view` | action | no | `view*` (`inbox\|metrics\|fleet\|sessions\|settings`) |
| `app.set-nav` | action | no | `pinned*` |
| `app.set-cos-drawer` | action | no | `open*` (chief-of-staff summonable drawer; persisted) |
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
| `ask.answer` | action | no | `id*, harness, path, cwd, text*, askId` |
| `atlas.ask` | action | no | `question*, engine` |
| `app.open-external` | action | no | `url*` |
| `app.open-path` | action | no | `path*` |

`*` marks a required param. `kind: action` mutates durable state or spawns a
process; `kind: observation` only reads. `direct: yes` means the command is
implemented purely over `lib/` (no Electron), so the CLI can still answer it
from disk when the desktop app is not running.

Adding a command means adding one entry to `COMMANDS` in `lib/commands.ts`
(name, kind, desc, params) before wiring any UI or CLI surface to it. A
command with no handler fails honestly (`"only available through the running
desktop app"`) rather than silently doing nothing, so an incomplete wire-up is
loud, not silent.

## Param validation

`lib/commands.ts` carries a minimal plain-JS schema per command:
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
runtime: `lib/harness-icons.ts` (pure, Electron-free, selftested without a
display) reads the app bundle's `Info.plist` `CFBundleIconFile` key -- never
a hardcoded `.icns` filename, since Claude ships `electron.icns` and Codex
ships `icon.icns` -- and resolves it to a real, non-empty file under
`Contents/Resources`. `electron/main.ts` then does the one Electron-only
step (`nativeImage.createFromPath` + downscale + `toPNG()`), caches the
result under Electron `userData` (never the repo, never a `~/.humanctl`
watched path), and returns a data URL. ANY failure at any step -- app not
installed, unreadable plist, missing icon file, decode failure, empty image
-- resolves to `null`, and the renderer falls back to the built-in neutral
glyph silently. Fixture mode (`window.humanctl` absent) never calls this at
all, so screenshots and the browser dev loop always show the built-in glyphs.

## PR chips (cache-only contract)

`pulse.pr-chip` reads ONLY the existing `~/.humanctl/pulse-cache.json` (the
cache `lib/pulse.ts` itself writes whenever a `humanctl pulse` run
completes): zero network calls, zero `git`/`gh` process spawns, ever, from
this command's call graph. A cache miss (no cache file, wrong config
signature, the requested repo not present in the cached data, a degraded
entry) returns `{ok: true, chip: null}`, never an error and never a trigger
to go fetch fresh data -- refreshing the underlying cache happens only when
`pulse.run` itself runs (manual `humanctl pulse`, a future Atlas-drawer
refresh action, or a future scheduled run). When the cache entry is older
than 10 minutes the chip still renders, with an honest age label ("2/3 PRs ·
as of 14m") rather than silently implying live data.

## Claude subscription quota (`quota.claude`)

Codex writes its own `rate_limits` into its rollout JSONL, so Codex quota just
falls out of the session read (`lib/sessions.ts`). Claude Code transcripts
genuinely carry no rate-limit data. The quota is still reachable, though: the
CLI registers `/usage` twice, and the second registration is a `type: "local"`
command with `supportsNonInteractive: true`, enabled only under `-p`.
`lib/claude-quota.ts` drives exactly that:

    claude -p "/usage" --safe-mode --output-format json --no-session-persistence < /dev/null

Each flag is load-bearing, all verified against a real account:

- The read **costs zero tokens**: the reply carries `num_turns: 0`,
  `duration_api_ms: 0`, `total_cost_usd: 0`. It never reaches a model. Under the
  hood the CLI does a `GET /api/oauth/usage` with its own OAuth token; humanctl
  never reads, holds, or forwards that token, and never touches the Keychain.
- `--safe-mode` is REQUIRED. Without it, every read spawns the user's MCP servers.
- `--no-session-persistence` is REQUIRED: a fleet viewer must not appear in its
  own fleet. Verified: zero new files under `~/.claude/projects`.
- **Never `--bare`**: it strips OAuth and returns only a cost summary.
- stdin is closed immediately (the `< /dev/null`), else the CLI waits on it.

`claude auth status` is the cheap precondition (no HTTP): the read proceeds only
on `loggedIn && apiProvider === "firstParty"`.

Two things this command refuses to do. It never trusts an exit code (a transient
OAuth 401 exits 0 with the error on stdout, so every decision comes from
`is_error` plus the parsed content). And it never invents an epoch: Claude
reports resets as a locale display string ("Jul 13 at 2am (America/Los_Angeles)")
with no year and no timestamp, so it is carried and rendered verbatim as
`resets_at_text`. Codex keeps its real `resets_at` epoch. The window labels are
dynamic ("Current session", "Current week (all models)", "Current week
(<model>)", plus others behind upstream feature flags), so the parser iterates
whatever comes back and the UI renders whatever it gets; nothing enumerates three
rows.

**This is an undocumented dependency, stated plainly.** Both the non-interactive
`/usage` variant (CLI >= 2.1.x) and the endpoint beneath it are undocumented.
That is the same risk class as this repo's existing `claude://` / `codex://` deep
links: if upstream changes, the read stops working and the UI degrades to `n/a`.
Every failure mode -- no `claude` on PATH, signed out, an API-key/Bedrock/Vertex
account, a timeout, a 401, unparseable output -- returns `{ok: true, quota: null}`,
never an error and never a fabricated number, exactly like `pulse.pr-chip`'s
cache-miss contract.

The desktop app does NOT use the `direct` handler above. `electron/reader-service.ts`
owns the spawn and a **5-minute TTL cache** (the windows are 5h and 7d; polling
faster buys nothing and risks a 429), dedupes concurrent reads onto one child
process, and caches null results too so a machine without `claude` stops retrying.
There is **no new timer**: the renderer's existing 20-second fleet poll calls
`quota.claude`, without awaiting it, so a cold 2-12s read never delays first paint
and never touches the Electron main process. Fixture mode (`window.humanctl`
absent) renders a synthetic quota and never shells out.

    npm run quota:selftest   # parser + orchestration, zero spawns (captured stdout only)

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
the actual prompt and output text of each call, priced via `lib/pricing.ts`'s
real haiku rate table (`lib/summary-budget.ts`). Default $1.00/day,
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
the live truth for that build); falls back to the local `lib/commands.ts`
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
`bin/humanctl.ts`); this keeps `humanctl app [dir]` behaving exactly as
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

Plain node, zero network, and no durable footprint: every case uses a temp
`HOME` or a temp socket path. The `inbox.threads` case that proves the
`note.post` -> thread-assembly join end to end is no exception, because both
halves resolve `HOME` per call now: the writer through `controlDir()` in
`lib/commands.ts`, the reader through `notesFile()` in `lib/sessions.ts`. The
real `~/.humanctl/notes.jsonl` is never read and never written. Covers: the
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
real recorded spend from `lib/summary-budget.ts`.

`npm run perf:logic-selftest` (see `docs/perf.md`) is a separate, CI-safe
pure-logic selftest covering the watcher filter, the summary-budget math, and
harness-icon path resolution in more depth than the checks above; it is not a
substitute for the required LOCAL `npm run perf:selftest` gate, which drives
a real Electron window and is not part of either selftest above.
