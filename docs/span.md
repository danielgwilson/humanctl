# `humanctl span`

Daily span-of-control instrumentation. The north-star metric for `humanctl` is
how many agents one human can run with real oversight. That claim needs a
denominator and a trend before any tool-vs-product decision, so `span` counts
what actually happened in one local calendar day.

## What it measures

    humanctl span [--date YYYY-MM-DD] [--record] [--json]

All counts are for one local calendar day (default: today).

- `codexSessionsTouched`: Codex `rollout-*.jsonl` session files under
  `~/.codex/sessions/` with an mtime in the day. Only date directories within
  7 days of the target are scanned, so long-idle resumed sessions outside that
  window are missed.
- `codexInteractiveTouched` / `codexAutomationTouched` / `codexUnknown`: the
  same files, split by the `session_meta` JSON line at the top of each rollout
  (a bounded head read; the rest of the file is never read). Interactive means
  a human drove the session: Codex Desktop, VS Code, or the interactive CLI.
  Automation means Codex spawned it: subagent sub-threads (`parent_thread_id`,
  `agent_role` / `agent_nickname`, a `subagent` source), headless `codex exec`
  runs (`originator: codex_exec` or `source: exec`), and scheduled automation
  runs (`thread_source: automation`). This is the same classification the
  humanctl desktop app uses to hide noise (`isCodexAutomation` in
  `lib/sessions.ts`). Files whose first line is unparseable or carries no
  recognizable meta land in `codexUnknown`, never guessed into a bucket. The
  three buckets always sum to `codexSessionsTouched`.
- `claudeSessionsTouched`: `*.jsonl` files directly inside each
  `~/.claude/projects/<project>/` directory with an mtime in the day.
  Subdirectories (subagent transcripts) are not counted.
- `claudeInteractiveTouched`: the same files, minus the headless `claude -p`
  one-shots that humanctl's own desktop summarize feature spawns, detected by
  their fixed prompt within an 8KB head read. Other headless Claude runs are
  not detectable this cheaply and stay in the interactive count; see the
  caveats below.
- `notes`: counts by level (`fyi` / `review` / `blocked` / `done`) from
  `~/.humanctl/notes.jsonl` with a `ts` in the day.
- `prsMergedByMe`: `gh search prs --author=@me --merged --merged-at=<date>`.

Interactive counts are the span-of-control signal; the automation counts stay
visible as context because they are real machine work the human is nominally
responsible for, just not sessions the human drove.

## Recording a daily series

    humanctl span --record

Upserts one JSON line for the day into `~/.humanctl/span.jsonl`, keyed by
`date`. Re-running on the same day replaces that day's line, so a cron or
end-of-day habit is idempotent. The file is local only and never belongs in a
repo.

## Honest-signals caveats

- mtime-touched is a proxy for "an agent session was active", not a measure of
  oversight quality. Fifty barely-glanced-at sessions is not more span than
  ten well-reviewed ones.
- The 7-day date-directory window undercounts interactive sessions more than
  automation: humans resume old threads, automation rarely does, and a resumed
  session's rollout file stays in its original date directory. On a sampled
  day the desktop app (which scans the whole year) saw roughly twice as many
  interactive Codex sessions as the windowed scan.
- Any missing source reports `null`, never a fabricated zero: no
  `~/.codex/sessions`, no `~/.claude/projects`, no notes file, or any `gh`
  failure (not installed, offline, rate-limited). When a source is missing,
  its split fields are `null` too.
- The Codex split reads only the first line of each rollout. The rollout
  format is undocumented Codex-internal state, so a format change degrades
  honestly: files move to `codexUnknown` rather than being misclassified.
- The Claude interactive count only filters humanctl's own summarize
  one-shots. Claude Code has no session-level originator field in its
  transcripts, so other `claude -p` automations still count as interactive.

## Future: the Codex app-server thread list

Recon note, current as of codex-cli 0.142.x. Codex ships an experimental
`codex app-server` (JSON-RPC over stdio, documented in the openai/codex repo
under `codex-rs/app-server/README.md`, with checked-in JSON schemas under
`codex-rs/app-server-protocol/schema/json/v2/`). Its `thread/list` request
already exposes exactly what this command derives by parsing rollout heads:
a `sourceKinds` filter (`cli`, `vscode`, `exec`, `appServer`, four `subAgent`
variants, `unknown`) that defaults to interactive sources only, an `archived`
filter, cwd filtering, pagination, and per-thread `source`, `threadSource`,
`parentThreadId`, and `agentRole` fields backed by Codex's own sqlite state
DB. When app-server stabilizes, spawning it as a short-lived stdio child and
asking for one page of threads per day would replace the rollout parsing with
a documented, schema-versioned surface. `span` deliberately does not depend
on a running server today: the rollout head read works offline, adds no
runtime dependency, and degrades to `codexUnknown` instead of failing.
