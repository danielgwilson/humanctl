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
| `note.post` | action | yes | `message*, level, repo, session, agent, cwd` |
| `span.run` | observation | yes | `date, record` |
| `pulse.run` | observation | yes | `repo, lane, fresh` |
| `app.commands` | observation | yes | (none) |
| `app.status` | observation | no | `maxAgeH, limit` |
| `app.state` | observation | no | (none) |
| `app.set-state` | action | no | `patch*` |
| `app.set-mode` | action | no | `mode*` (`focus\|triage\|wall`) |
| `app.set-theme` | action | no | `theme*` (`light\|dark\|system`) |
| `app.set-engine` | action | no | `engine*` (`claude\|codex`) |
| `app.mark-read` | action | no | (none) |
| `session.pin` | action | no | `id*` |
| `session.unpin` | action | no | `id*` |
| `session.resume` | action | no | `id*, harness, cwd` |
| `session.open-app` | action | no | `id*, harness` |
| `session.reveal` | action | no | `id, path` |
| `session.summarize` | action | no | `id, path, harness, engine` |
| `session.ask` | action | no | `id, path, harness, cwd, question*` |
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
`boolean`, `object`. Unknown params are rejected (a typo'd flag never
silently no-ops). Free-text params (`message`, `question`) declare a `max`
and are hard-truncated, never rejected, so a long paste degrades instead of
failing outright.

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
    humanctl app app.set-mode --mode wall
    humanctl app app.set-mode --mode focus

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
- Anything else (an app-only action, like `session.pin` or `app.set-mode`)
  returns an honest error: `"humanctl desktop app is not running (start it
  with \`npm run desktop\` or open the installed app)"`. It never pretends to
  have mutated state it could not reach.

## Selftest

    npm run commands:selftest

Plain node, zero network, zero real `~/.humanctl` data (every case uses a
temp `HOME` or a temp socket path). Covers: the `COMMANDS` table shape, param
validation (required / unknown / enum / type / truncation), `digestParams`
shaping, registry dispatch (unknown command, missing handler, validation
short-circuit, a throwing handler turned into `ok: false`, a real `note.post`
write), the event log (entry shape, rotation at the byte boundary, a broken
log directory degrading to a no-op), and a real control-socket round-trip
(including the 0600 mode and stale-socket unlink).
