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
  window are missed. Non-interactive sessions (`codex exec`, subagents) are
  only detectable by reading file contents, so they are included in the count
  rather than guessed at.
- `claudeSessionsTouched`: `*.jsonl` files directly inside each
  `~/.claude/projects/<project>/` directory with an mtime in the day.
  Subdirectories (subagent transcripts) are not counted.
- `notes`: counts by level (`fyi` / `review` / `blocked` / `done`) from
  `~/.humanctl/notes.jsonl` with a `ts` in the day.
- `prsMergedByMe`: `gh search prs --author=@me --merged --merged-at=<date>`.

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
- Any missing source reports `null`, never a fabricated zero: no
  `~/.codex/sessions`, no `~/.claude/projects`, no notes file, or any `gh`
  failure (not installed, offline, rate-limited).
- Session counts include automation noise where it cannot be cheaply excluded
  (see `codexSessionsTouched` above). The field names say what is counted, not
  what we wish were counted.
