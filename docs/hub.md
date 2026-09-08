# The hub: one inbox across every machine

Status: implemented in `humanctl hub` (`lib/hub.ts`, `lib/hub-store.ts`,
`lib/hub-server.ts`, `lib/hub-page.ts`, `bin/hub-commands.ts`; gate:
`npm run hub:selftest`). This document is the design the code follows; where
they disagree, fix the code or this page in the same change.

## The problem it solves

`humanctl` routes agent attention to one human, but every object it routes
used to live on the machine that created it: `~/.humanctl/notes.jsonl` on a
laptop, `.humanctl/asks/` in a repo checkout, a screenshot in a sandbox that
will be gone in an hour. The fleet does not run on one machine. A coding agent
on a VM, a computer-use lane in a hosted sandbox, and an interactive session
on the laptop all need the same human, and that human is often on a phone.

The hub is the transport. Every `humanctl note`, `ask`, and `artifact put` can
also land on one self-hosted endpoint, every machine can push a session
digest to it, and one mobile-first page answers "what needs me?" across all of
them and lets the human answer once. The agent that asked polls for the
answer and resumes.

## Setup

1. On the machine that will host the hub (an always-on box is ideal):

       humanctl hub serve --bind <its-private-address> --trust-network

   It prints the page URL. Loopback needs no flag; any other bind address
   needs `--trust-network`, because everyone on that network can then read
   the page and answer as you. A private overlay network is the intended
   case.

2. Open the printed URL on your phone. Empty queue, "Nothing needs you."

3. On every other machine that runs agents:

       humanctl hub config --url http://<hub-address>:4187

   From then on `note`, `ask create`, `ask answer`, and `artifact put` push
   after their local write.

4. Optionally, on each machine, a cron or launch agent:

       humanctl hub push --every 120

   This feeds the Fleet section: sessions per machine, titles and states.

5. For a sender that is not on the trusted network (a hosted sandbox posting
   through a public tunnel): start the hub with `--ingest-port 4189`, point
   the tunnel at that port only, and give the sandbox a token:

       humanctl hub token new --host sandbox-7          # on the hub machine
       HUMANCTL_HUB_URL=https://<tunnel>/ HUMANCTL_HUB_TOKEN=hct_... humanctl note ...

`humanctl hub status` prints what the hub currently says needs you (exit 2
if it cannot be reached).

## Why the artifact is the ask

The desktop Inbox renders every note and ask into a fixed list row. In our
own use that lost to an HTML page the agent wrote by hand, because the agent
can render exactly what *this* decision needs: a side-by-side, a screenshot,
a diff, a tally with its denominator. A fixed schema cannot compete with
that and should not try.

So the hub delegates rendering. An ask carries an artifact (HTML, markdown,
or an image); the hub shows it at full width inside a sandboxed frame and
adds only what the artifact cannot: the queue position, the origin, the age,
and the answer strip. The hub's own chrome is deliberately small.

## Information hierarchy

Top-down, the page has four levels. Each answers one question.

| Level | Question | Owner on the page |
|---|---|---|
| 0 | Do I need to do anything right now? | The header count: open items that need the human, across every origin |
| 1 | What, in what order? | The queue: only items needing the human, grouped and ranked |
| 2 | Enough context to answer this one | The item sheet: the agent's artifact at full width, the answer strip pinned below |
| 3 | What else is going on? | Fleet (sessions per origin) and Recent (answered, closed, seen, fyi, done); both recede |

### Level 1: the queue

Groups, in order:

1. **Blocked**: asks with escalation `block`, and notes at level `blocked`.
   Work has stopped.
2. **Decide**: asks that carry an explicit default and a one-clause reason.
   These are *veto-only*: one tap confirms the default or picks another
   option.
3. **Needs words**: every other open ask. The human has to write something,
   or at least read the prompt.
4. **Review**: notes at level `review`. Something is ready to look at.

Membership is decided by one function (`askGroup` in `lib/hub-store.ts`) on
signals that are only present when the agent supplied them:

| The ask has | Group |
|---|---|
| escalation `block` | Blocked |
| `--recommended` passed explicitly **and** `--reason` | Decide |
| anything else | Needs words |

`ask create` always fills in placeholder options and marks one recommended;
that fallback is recorded as `response.recommendedBy: "implicit"` and never
counts as a default. Placeholders render outlined, never filled.

Within a group: items whose agent is currently polling for the answer
(`agent waiting`, a poll in the last two minutes) come first, then older
first. The oldest waiting item has cost the most.

A row shows exactly: the one-line question, the default with its reason
(Decide only), an origin chip (host, harness, repo), the age, and the
waiting mark. The message body, the options, and the artifact belong to
level 2.

Items leave the queue when: the human answers (Recent, `answered`); the
agent closes the ask (`ask close`, `ask delete`; Recent, `withdrawn` /
`expired` / `deleted`, with what the agent proceeded with); the human taps
Seen on a note (Recent, `seen`); or a `done` note from the same session
arrives after a `blocked` or `review` note (Recent, `superseded`). An answer
is final: the first one recorded wins, a later one is kept in the log and
never overwrites what the agent may already have acted on.

### Level 2: the item sheet

On a phone the sheet is a full-screen push, so its header repeats the title,
origin, and age from the row (the one deliberate exception to "nothing
repeats across levels"; the row is off-screen). Then, top-down:

- the artifacts, each in an `<iframe sandbox>` at full width (images render
  directly, so they reflow);
- a collapsed **more** line with the prompt, `unblocks`, `why now`, `if
  ignored`, and the cwd;
- if there is no artifact, the prompt and the options' descriptions as the
  body, with **more** open;
- the answer strip, pinned to the bottom.

**One tap answers.** Tapping any option queues the answer, shows an undo
toast for four seconds, then posts it and advances to the next item. The
recommended option is the filled button. "Add a note" reveals a text field;
with it open, tapping an option selects it and Send posts both. A note gets
one action, Seen.

If the hub answers 409 (answered or closed elsewhere first) the sheet says so
and moves on; nothing is overwritten.

An artifact written for a desktop may not fit 390px. The frame starts at 62%
of the viewport height and the page is the only scroller; an artifact can
size its own frame with two lines:

    <script>parent.postMessage({ type: 'humanctl:height', height: document.documentElement.scrollHeight }, '*');</script>

### Level 3: fleet and recent

Fleet lists, per origin, the sessions the last digest reported: state,
title, repo, age, context fill, spend; needs-input first. A digest older
than three hours is marked stale. It is an inventory, not a queue. Recent is
the tail of answered and closed asks, seen and superseded notes, and
`fyi` / `done` notes.

## The ask contract

An ask the queue can rank and the human can answer from a phone in under
thirty seconds carries:

| Field | Flag | Meaning |
|---|---|---|
| `title` | `--title` | The question, one line |
| `prompt` | `--prompt` | The context the human needs if the artifact is not enough |
| `response.options[]` | `--option "id\|Label\|Description"` | The bounded choices (up to 12) |
| recommended option | `--recommended id` | The default the agent would take; must name an option, else exit 1 |
| `reason` | `--reason` | Why that default, one clause |
| `unblocks` | `--unblocks` | What proceeds once answered |
| `whyNow`, `ifIgnored` | `--why-now`, `--if-ignored` | Kept from the original contract: why interrupt now, and the cost of no answer; shown under **more** |
| `escalation` | `--escalation` | `log`, `nudge`, `ask`, or `block` |
| `artifactIds[]` | `--artifact id` or `--attach file` | The evidence the human answers from |
| `origin` | stamped at create | Host, workspace, harness, session, cwd, repo, agent; reused by `--wait` |

`ask create` succeeds without `--recommended`, `--reason`, or an artifact,
but says so on stderr, and the hub places such an ask in **Needs words**.
A well-formed ask is answered with one tap; a vague one waits for prose.

`--attach <file>` (up to four) is sugar for `artifact put` plus a link: the
artifact id is `<askId>-<n>-<file basename>`, kind `preview`, title the
ask's. `--artifact <id>` links an artifact that already exists in the
workspace; both kinds are pushed with the ask.

    humanctl ask create \
      --title "Ship the pricing page as drafted?" \
      --prompt "Draft renders both plans; the annual toggle is new." \
      --option "ship|Ship it|Merge and deploy" \
      --option "hold|Hold|Leave the PR open" \
      --recommended ship --reason "copy and layout match the spec" \
      --unblocks "merge, deploy, close the ticket" \
      --attach ./pricing-preview.html --json

The `--json` output carries `hub: { configured, pushed, error, url }`. In
human output the push prints one line, `hub: pushed to ...` or `hub: not
pushed (...)`. A failed push never fails the local write (exit 0); the local
manifest is the durable record and `manifest.hub` records the outcome.
`--require-hub` turns a failed or unconfigured push into exit 1.

### Waiting for the answer

    humanctl ask get <id> --wait [--timeout 540] [--json]

`--wait` checks the local manifest first on every tick (an answer given
through the desktop app or `ask answer` wins immediately), then the hub.
A hub answer is written back through the same code path as `ask answer`
(same manifest fields, same workspace event, `via: "hub"`). Cadence, named
`askWaitPoll`: 3 s for the first minute, then 10 s, for the life of the
command only. If the create-time push failed, `--wait` retries the upsert
once before polling.

| Outcome | Exit | `--json` |
|---|---|---|
| answered | 0 | `{ ok: true, ask, answer: { choiceId, note, answeredAt, via }, waitedSeconds }` |
| timed out | 3 | `{ ok: false, timedOut: true, askId, waitedSeconds, hub, lastPoll? }` |
| closed | 4 | `{ ok: false, closed: true, status, askId, waitedSeconds }` |

The default timeout is 540 s because coding-agent shells commonly cap one
command at 600 s. A timeout is "still waiting", not a no: run the same
command again. A poll the hub refuses (a revoked token, another host's
scope, an ask it never received) is said once on stderr and reported as
`lastPoll` in the timed-out JSON.

Two edge rules worth knowing. An `ask update` that carries no answer and an
open status reopens the ask on the hub, so an answer the human gave there
that the agent has not yet picked up is dropped: pick it up with `--wait`
before editing. And if `ask answer` is run locally after the human already
answered on the hub, the CLI says so (`hub: already held a different
answer`); the hub keeps its answer, the local manifest keeps the local one,
so an agent should `--wait` rather than answer on the human's behalf.

### Closing an ask

    humanctl ask close <id> [--status withdrawn|expired] [--proceeded-with choice-id] [--note text]

The agent withdrew the ask, gave up on it, or went ahead with a default. The
hub moves it to Recent as "withdrawn, agent took Hold". `ask delete` sends
the same signal with status `deleted`.

### From a skill

The instruction the agent skill carries (`.agents/skills/humanctl/SKILL.md`):
when a human decision is needed, write the evidence to one HTML file that
reads at phone width, then `ask create` with a title that is the question,
two sentences of prompt, the bounded options, `--recommended`, `--reason`,
`--unblocks`, and `--attach`, with `--json`. Read `hub.pushed` from the
output; if it is false, say so in a `humanctl note --level blocked`. Then
`ask get <id> --wait --json` in a loop until `ok` is true (exit 0), treating
exit 3 as "keep waiting" and exit 4 as "closed". Never re-create the ask
with the same title while waiting; `ask update` changes it. If the agent
proceeds without an answer, `ask close --proceeded-with <id>` first.

## Origin

Every object the hub receives is stamped with where it came from:

```json
{ "host": "laptop", "workspace": "app-1a2b3c", "harness": "claude-code", "session": "...", "cwd": "/work/app", "repo": "app", "agent": "..." }
```

- `host` is the machine's hostname unless `HUMANCTL_HOST` overrides it (a
  sandbox with a random hostname should set a readable one). A token-bearing
  sender's host comes from the token, whatever it claims.
- `workspace` is the checkout: the directory's basename plus a six-hex-digit
  hash of its full path. Two checkouts on one machine can hold the same ask
  id; this keeps them apart.
- `harness` comes from `HUMANCTL_HARNESS`, else: `CLAUDECODE` or
  `CLAUDE_CODE_ENTRYPOINT` set means `claude-code`; `CODEX_SANDBOX`,
  `CODEX_THREAD_ID`, or `CODEX_HOME` set means `codex`; else `unknown`. The
  selftest pins that table.
- `session` and `agent` come from `--session` / `--agent` and
  `HUMANCTL_SESSION` / `HUMANCTL_AGENT`.

Keys are `host/workspace/id`. The origin is stored in the ask manifest at
create time and read back by `--wait`, so `HUMANCTL_HOST` only has to be
right once.

## Protocol

A plain HTTP server with a JSON API. The wire format is the existing
`.humanctl` object model plus `origin`; no new object types.

Main listener (the human surface, plus pushes from the trusted network):

| Method and path | Purpose |
|---|---|
| `GET /` | The page |
| `GET /api/state` | The folded state: queue, fleet, recent, counts, origins |
| `POST /api/ingest` | One event: `{ kind, origin, payload, id? }` |
| `GET /api/asks/:host/:workspace/:askId` | One ask with its answer; records the poll (`agent waiting`), so it needs the `X-Humanctl-Client` header like a POST |
| `POST /api/asks/:host/:workspace/:askId/answer` | `{ choiceId?, note? }` from the human; 409 once answered or closed |
| `POST /api/notes/:host/:workspace/:noteId/ack` | Seen |
| `GET /a/:host/:workspace/:artifactId/:entry` | An artifact body, for the sandboxed frame |
| `GET /healthz` | Liveness |

Ingest listener (`--ingest-port`; token always required): `POST /api/ingest`,
`GET /api/asks/:host/:workspace/:askId` for the token's own host only, and
`/healthz`. Nothing else, so a tunnel to it exposes nothing else.

Event kinds: `note`, `note.ack`, `ask.upsert`, `ask.answer`, `ask.close`,
`artifact.put`, `digest`. `ask.upsert` carries workspace asks
(`.humanctl/asks/<id>/manifest.json`); the desktop app's per-session ask log
under `~/.humanctl/asks/` is not sent. The server assigns `ts`. A
client-supplied event `id` makes an ingest idempotent per `(host, kind,
id)`; the CLI derives one id per logical push (the object's id plus its
`updatedAt` or timestamp), so a retry is deduped and an edit is not. The
idempotency set is rebuilt from the log at boot.

An event's payload is capped at 64 KB (a digest at 1 MB); an artifact's
body never enters the log. The answer to an ask that already has one is
kept in the log and reported back to the sender as `conflict`; the first
answer stands.

Files, all under `~/.humanctl/hub/` (directory mode 0700, files 0600):

- `ingest.jsonl`: every event except digests, append-only. A process killed
  mid-append leaves a torn last line; it is skipped at boot and the next
  append starts on its own line.
- `digests/<host>.json`: the latest digest per host (state, not history).
- `artifacts/<host>/<workspace>/<id>/<entry>`: bodies, capped at 4 MB each
  and 256 MB per host (oldest evicted). Every path component must be a plain
  name, on write and on read.
- `tokens.json` (mode 0600): SHA-256 of each token, never the token.
- `serve.lock`: the serving pid. A second `hub serve` on the same directory
  refuses to start, because two servers would each hold stale memory.

State is folded from the files at boot and updated in memory on every write;
`GET /api/state` never re-reads the log.

### The digest

`humanctl hub push` reads the machine's recent sessions through the existing
reader and posts one digest: needs-you and working totals, and per session
its harness, id, repo, title, state and reason, tier, last activity, context
fill, spend, and model. The field list is a whitelist. Transcript bodies
never leave the machine; neither does `cwd`.

A session's title is derived from its first prompt and can contain anything
the human typed, so titles and state reasons are clipped to 120 characters
and can be withheld: `--no-titles` sends ids and states only, and that is
the default when the hub URL is not loopback, a private range, the overlay
range, a `*.local` name, or a `*.ts.net` name. `--titles` overrides.

### Timers

| Name | Cadence | Lives in | Default |
|---|---|---|---|
| page state poll | 15 s while the page is visible; refetch on focus | the browser tab | on |
| answer undo window | 4 s per tap | the browser tab | on |
| `hubPushLoop` | `--every` seconds (min 15) | the `hub push` process | off |
| `askWaitPoll` | 3 s for a minute, then 10 s | the `ask get --wait` process | off |

The hub server itself has no timer.

## Trust model

The hub has no accounts. It trusts its network, and it says so.

- By default it binds `127.0.0.1`. Binding any other address requires
  `--trust-network`, because every device on that network can then read the
  page and answer.
- Whoever can reach the page can answer as you. Only bind to a network where
  that is acceptable, or put an authenticating proxy in front.
- Tokens are per sender and scoped to a host (`hub token new --host vm-1`).
  A request carrying a token has its `origin.host` set to the token's host,
  whatever the payload claims, so one sender cannot rewrite another
  machine's asks, forge an answer to them, or blank its fleet entry. On the
  main listener a token is optional; on the ingest listener it is required,
  and polling is limited to the token's own host.
- Within one host the trust is local: a process that can run `humanctl` on
  your machine could also edit your files. `ask.answer` over ingest is
  accepted for the sender's own asks only, which is no more than the sender
  could do by not asking.
- Browser-side hardening, because an artifact is agent-authored HTML: every
  `POST` must carry `Content-Type: application/json` and an
  `X-Humanctl-Client` header, so a browser must preflight it and the hub
  never grants a preflight; a request with `Origin: null` (a sandboxed
  frame), a cross-site `Origin`, or `Sec-Fetch-Site: cross-site` is
  rejected; the `Host` header must be an IP literal, `localhost`, a
  `*.ts.net` name, or an `--allow-host` entry, which defeats DNS rebinding.
- Artifacts render in `<iframe sandbox="allow-scripts allow-forms
  allow-popups">` with no `allow-same-origin`, and are served with
  `Content-Security-Policy: sandbox ...; frame-ancestors 'self'` and
  `nosniff`. An artifact can run its own scripts but cannot read the hub's
  storage or call its API as the human. The page's own CSP allows only its
  per-response nonce and no external hosts.

## Client configuration

    humanctl hub config --url http://<hub-address>:4187 [--token hct_...]

writes `~/.humanctl/hub.json` (mode 0600). `HUMANCTL_HUB_URL` and
`HUMANCTL_HUB_TOKEN` override it per process, which is how a sandbox or a
cron job is configured. `--no-hub` skips the push for one command; `--hub
<url>` targets another hub for one command.

## Scope

- The desktop app remains the local, read-only control room over full
  transcripts. The hub carries the routed objects and a digest.
- Objects flow toward the hub. The one thing that flows back is an answer,
  pulled by the agent that asked.
- One human, many machines.
- Transcripts stay on their machines (see the digest).

## Where every write goes

Every hub write and push is a registered command in `lib/commands.ts`, one
line in `~/.humanctl/events.jsonl`: `hub.ingest` (server side, every accepted
event), `hub.send` (client side, one push of a note, ask, answer, close, or
artifact), `hub.digest` (build and push), `hub.wait` (the outcome of one
`--wait`). The workspace writes that `ask`, `artifact`, and `watch` perform
predate the registry and still write files directly; that is unchanged by
this work.

The hub's files live under `~/.humanctl/hub/` and `~/.humanctl/hub.json`.
Neither is on the desktop app's inbox-watcher allowlist
(`isInboxRelevantChange`), so hub writes never trigger an Inbox refresh; the
commands selftest pins that.

## Surface

    humanctl hub serve [--bind 127.0.0.1] [--port 4187] [--dir ~/.humanctl/hub] [--trust-network]
                       [--allow-host name ...] [--ingest-port n] [--ingest-bind 127.0.0.1] [--open]
    humanctl hub config [--url URL] [--token hct_...] [--clear]
    humanctl hub push [--every seconds] [--limit 60] [--max-age-h 72] [--titles|--no-titles] [--host name]
    humanctl hub status [--json]
    humanctl hub token new --host name [--label text] | list | revoke <prefix|host>  [--dir dir]
    humanctl ask create ... [--recommended id] [--reason text] [--unblocks text] [--attach file ...]
    humanctl ask get <id> --wait [--timeout seconds]
    humanctl ask close <id> [--status withdrawn|expired] [--proceeded-with id] [--note text]
    humanctl note|ask|artifact ... [--no-hub] [--require-hub] [--hub URL]
