# Ask the session

"Ask the session" injects a one-turn question into an existing agent session
from the desktop dossier and shows the answer, grounded in that session's full
context. It is the on-demand deep path next to the ambient AI summary (which
only reads the transcript tail and never touches the session).

Every injected question is prefixed with the sentinel `[humanctl btw]`. The
sentinel is stored verbatim by both harnesses, which makes the probe
self-identifying in any log and lets the reader exclude persisted probe turns
(see "Reader protection" below).

All mechanics here were verified empirically against throwaway sessions before
shipping; the commands below are the exact verified invocations.

## Claude Code: zero footprint

```
claude -p --resume <session-id> --no-session-persistence \
  --model haiku --output-format json "[humanctl btw] <question>"
```

- `--no-session-persistence` writes NOTHING: the original transcript stays
  byte-identical and no new file appears. The ask is invisible to the session's
  own history and to humanctl's reader.
- The answer is read from the stdout JSON `.result`, never from the transcript.
  The output is shape-validated (`is_error` checked), and the known
  transient-401-with-exit-0 auth failure gets one spaced retry.
- Safe while the session is open in a terminal: the probe is read-only on disk.
- Probes always run on haiku regardless of the session's own model
  (cross-model resume is proven and probing cheap into expensive is the right
  direction).
- The spawn scrubs `CLAUDE_CODE_ENTRYPOINT` and `CLAUDECODE` from the
  environment so a probe launched from inside another Claude session still
  runs as a clean SDK one-shot.
- The probe runs in the session's own working directory: Claude resolves
  `--resume <id>` against the current project, and an unrelated cwd fails
  with "No conversation found" (verified). Codex resumes by uuid from any
  cwd, but gets the same treatment so its appended environment_context stays
  faithful to the thread.

## Codex: always appends, disclosed

```
codex exec resume <thread-uuid> --skip-git-repo-check \
  -c sandbox_mode="read-only" -c model_reasoning_effort="low" \
  -o <tmpfile> "[humanctl btw] <question>"
```

- Codex has no headless fork and `--ephemeral` does not prevent the append:
  every ask permanently writes the question and answer into the real rollout.
  The user sees the probe turn on their next resume and it costs context
  window from then on. The UI says this plainly before the first Codex ask
  ("Codex questions are written into the thread itself; Claude questions leave
  no trace") and persists the acknowledgement.
- `-c sandbox_mode="read-only"` is mandatory, not optional: `codex exec
  resume` takes its sandbox from config defaults, NOT from the session being
  resumed, and otherwise runs with danger-full-access even into a thread that
  was created read-only. A "status question" is still a full agent turn.
- Asks are refused while the session's state is working: appending into a live
  turn is unsupported territory, and the refusal says so instead of failing
  silently.
- The answer is read from the `-o` output file (the clean final agent
  message), not scraped from stdout.

## Reader protection (the sentinel contract)

Persisted probe turns must never change what humanctl believes about a
session. `lib/sessions.ts` enforces this for the paths that persist (Codex
always; Claude only if a future fork path is used):

- `isBoilerplate` treats `[humanctl btw]`-prefixed user text as
  non-substantive, so a probe can never become a session title or
  `lastUserText`.
- `readNeedSignals` pair-drops the whole probe exchange: a sentinel user event
  opens a skip window over the following assistant and tool events until the
  next genuine user event (or an interrupt). Without the pair-drop, the
  probe's ANSWER would flip `lastKind`, refresh `lastActiveMs`, and get
  classified by the needs-you rules, masking a real ask or fabricating one.
- Codex probes still bump the rollout file's mtime, so a probed session
  lingers in the recency window; the excluded events keep the displayed age
  and state honest. Accepted trade-off.

Covered by fixtures in `npm run pulse:selftest`.

## Persistence (the Inbox btw thread)

Every ask exchange (question, answer, engine, timestamp) is appended to
`~/.humanctl/asks/<sessionId>.jsonl` by `electron/main.ts`'s
`sessionAskPersisted` wrapper around `sessionAsk`, using the same
`appendAskLog`/`readAskLog` helpers `lib/commands.ts` exposes for the
`inbox.threads` command. This is independent of the renderer's own
`state.json` copy (`asks`, used for the Focus dossier's compact thread and
capped in memory): the jsonl log is the durable record the Inbox surfaces and
restores across a restart.

A probe still in flight (the process has been spawned but has not resolved)
when the app quits is recorded as `{status: "interrupted", q, ts}` rather than
silently dropped: `will-quit` sweeps an in-memory map of in-flight asks before
the control socket closes. The Inbox thread renders an interrupted entry with
a retry button; retrying re-runs the same question through the normal ask
path (a fresh probe, not a resume of the dropped one, since a headless CLI
call has no resumable handle once its process is gone).

## Replying to an ask (`ask.answer`, the reply sentinel)

`ask.answer` (`lib/commands.ts`'s `answerAsk`) is the reply half of the flow
the rest of this doc documents: once a session shows a needs-you ask, a
human can reply to it without leaving humanctl. It is a separate command
from `session.ask` above -- that command injects a QUESTION from the human
INTO the session; this one delivers the human's ANSWER back. Params: `id*`
(session id), `harness`, `path`, `cwd`, `text*` (the reply), `askId`
(optional, binds the reply to a specific ask item in the thread when a
session has more than one open ask).

### The reply sentinel: `[humanctl reply]`, distinct from `[humanctl btw]`

Every delivered reply is prefixed with `[humanctl reply]`, a SEPARATE
sentinel from `[humanctl btw]` above, because the reader (`lib/sessions.ts`)
must treat the two oppositely:

- `[humanctl btw]` marks a throwaway status probe: `readNeedSignals`
  pair-drops the whole exchange (question and answer), so it never counts as
  a user turn, never flips `lastKind`, and never clears a pending
  needs-input state. See "Reader protection" above.
- `[humanctl reply]` marks the human's real answer to a pending ask: it
  counts as a REAL user turn -- it increments `userCount`, becomes
  `lastKind: 'user'`, refreshes `lastActiveMs`, and clears whatever
  needs-input state was pending, the same way a genuinely typed reply would.
  It never opens a probe-skip window, so anything the harness says after the
  reply (its next turn) stays visible instead of being dropped. The sentinel
  itself is stripped from the stored text (`readNeedSignals`'s
  `lastUserText` carries the human's own words, not the wire marker), and it
  is deliberately absent from `isBoilerplate`'s regex -- do not add it
  there; it is not the same class of thing as a btw probe.

Covered by fixtures in `npm run pulse:selftest`: one check proves a reply
counts as a user turn, clears needs-input, and never pair-drops; the check
next to it proves a btw probe, on the same setup, still does none of those
things.

### Delivery, per harness

Every call, regardless of harness, first appends a durable record to
`~/.humanctl/asks/<sessionId>.jsonl`: `{at, kind: 'answer', text, askId?,
actor: 'human', delivery}` (`at` is an epoch-ms number, unlike the ISO `ts`
the probe Q&A records above use; `inbox.threads` normalizes it back to `ts`
for its own sort). This record is the one guarantee every successful call
makes: a human's typed reply is not lost to a failed spawn, regardless of
delivery channel.

- **Codex**: additionally live-injects the reply into the real rollout via

      codex exec resume <thread-uuid> --skip-git-repo-check \
        -c sandbox_mode="read-only" \
        -o <tmpfile> "[humanctl reply] <text>"

  Gated exactly like `session.ask`'s Codex path above: the same disclosure
  ack (`state.json`'s `askCodexAck`) and the same refusal while the
  session's state is `work` (appending into a live turn is unsupported
  territory; the refusal says so instead of failing silently). Unlike the
  probe above, this never pins `model_reasoning_effort=low` -- that pin is
  `session.ask`'s probe-specific choice for a cheap status check; a reply
  runs on the session's own default model and reasoning effort, since it is
  real input the agent has to act on.

  **Security posture, stated plainly**: `sandbox_mode=read-only` is pinned
  DELIBERATELY, for the same reason as the probe above, restated for a
  reply specifically: a reply delivers INFORMATION into the session's
  context, and it must not grant execution authority the original session
  did not already have. A reply typed through humanctl must not grant
  `danger-full-access` merely because it arrived through `codex exec resume`
  instead of the session's own terminal.

  Delivery success or failure is reported separately from the durable
  record: a spawn failure (missing CLI, timeout, etc.) still leaves the
  reply recorded (`delivered: false, deliverError`) instead of discarding a
  human's typed answer over a failed CLI call.

- **Claude Code**: no live-injection channel exists for Claude (see "Claude
  Code: zero footprint" above -- the same `--no-session-persistence`
  isolation that makes the probe safe also means there is no way to append a
  turn into a live Claude session from outside it). v1 is a staged handoff,
  stated as such: the reply text is copied to the clipboard (async
  `pbcopy`, never synchronous on Electron's main process), then the
  existing Terminal-resume flow (`session.resume`) reopens the session in a
  Terminal window in its own cwd, so the human pastes the reply in
  themselves. The response reports `delivery: 'staged'`, never anything
  implying the reply was actually delivered into the session.

- **Any other/unrecognized harness**: the durable record only
  (`delivery: 'file'`). No delivery channel is invented for a harness this
  module cannot identify.

### Thread shape

`inbox.threads` surfaces a recorded reply as a `kind: 'answer'` item
(`{kind: 'answer', text, askId, delivery, actor, ts}`), next to the existing
`qa` (probe Q&A) and `ask-interrupted` item kinds a thread can already
carry. This PR is backend-only: rendering a reply affordance in the UI is a
separate, later change.

## Cost honesty

- Claude asks are metered API spend on your account: about $0.006 per warm
  haiku probe on a ~47k-token session. The first probe (or after the cache
  TTL) pays the prompt-cache write, roughly $1.25 per million tokens of
  session context on haiku; repeats are roughly $0.10 per million.
- Codex asks are plan-billed (no dollar line) but re-send the session's full
  context on every probe, burning rate-limit quota that humanctl already
  surfaces.
- Expect around 10 seconds of wall clock per ask on either harness.
