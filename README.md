# humanctl

`humanctl` is a small CLI for the human bottleneck in agent work.

You are the scarce resource in an agent fleet. Codex and Claude Code sessions
pile up faster than you can watch them, and the expensive failure mode is
silent: an agent finishes or blocks, and nobody notices for an hour.
`humanctl` gives agents one plain-file channel to tell you, and gives you one
command to see what needs you.

The core thesis: the session is not the work, the checkpoint is the work.
Agents should package blockers into the smallest unit of human attention,
keep the supporting context attached, and resume as soon as the answer lands.

**Status:** stable and low-activity. This repo is the CLI, its file formats,
and the humanctl.com site. An earlier desktop app was removed in 0.21.0.

## Install

```bash
npm i -g humanctl
```

## Quick start

```bash
humanctl init .        # create a .humanctl/ workspace in this repo
humanctl status .      # summarize what is there
```

Agents use the same CLI to escalate instead of blocking silently:

```bash
humanctl note --level review "PRs are up, need a review + merge in ~5m"
humanctl ask create --title "Redis or Postgres?" --prompt "Pick one" \
  --option "redis|Redis|fast, volatile" --option "pg|Postgres|durable"
```

## The agent inbox

`humanctl note` is the core loop: a short aside to the human, appended to
`~/.humanctl/notes.jsonl` (one global inbox across every repo).

- `humanctl note --level fyi|review|blocked|done "message"`
- `--session <id>` links a note to that agent session
- `--image <path>` attaches up to four proof screenshots
- cwd and repo are captured automatically

Underneath sits the durable object model for bigger handoffs:

- `humanctl ask create|get|list|update|answer|delete` for bounded decisions
- `humanctl artifact put|get|list|delete` for previews and evidence
- `humanctl watch create|get|list|update|delete` for standing conditions

Everything is plain files plus an append-only event log, so future sessions
resume from durable state instead of chat-history reconstruction. Prefer
`--json` when another agent or script consumes the result.

## Seeing what needs you

```bash
humanctl pulse         # needs-you, ready-for-review, blocked, stale, unowned, verified
humanctl pulse --json  # stable contract for scripts
humanctl span          # today's span of control: sessions touched, notes, PRs merged
```

Pulse reconciles Linear issues, local git worktrees, GitHub PRs and checks,
agent sessions, and notes into exclusive attention lanes, and says which
sources were degraded instead of pretending they were empty. See
[docs/pulse.md](./docs/pulse.md) and [docs/span.md](./docs/span.md).

`humanctl app list-commands` lists the command registry behind all of this.
Read-only commands run straight from disk; see
[docs/commands.md](./docs/commands.md).

## Docs

- [docs/commands.md](./docs/commands.md): the command registry and event log
- [docs/pulse.md](./docs/pulse.md): pulse lanes, join token, config, degradation
- [docs/span.md](./docs/span.md): the span-of-control counter
- [docs/agentic-control-layer.md](./docs/agentic-control-layer.md) and
  [docs/control-layer.md](./docs/control-layer.md): the control-layer framing

## Development

```bash
npm install
npm run build:lib      # compile the CLI to dist/
npm run typecheck
npm run pulse:selftest && npm run commands:selftest && npm run span:selftest
npm run dev            # the humanctl.com site (Next.js)
```

See [AGENTS.md](./AGENTS.md) for the full operator notes.

## Hygiene

This repo is public. Real session data, secrets, personal absolute paths, and
private operating notes are not allowed in tracked files or release artifacts.
`scripts/secret-scan.sh`, `npm run leak:scan`, and `npm run package:check`
gate the repository and npm artifact. See
[docs/repo-hygiene.md](./docs/repo-hygiene.md).

## Brand note

Use `humanctl` in lowercase for user-facing brand copy.

## License

Apache-2.0. See [LICENSE](./LICENSE). Contributions are expected under the
same terms unless explicitly agreed otherwise.

## Publishing (maintainers)

The published npm file surface is CLI-only. `npm run package:check` enforces
an allowlist containing the compiled CLI, its two runtime libraries, the agent
skill, README, license, and package metadata, rejects personal absolute paths,
then installs and smokes the exact tarball before publication. Publishing runs
via npm trusted publishing from GitHub Actions
(`.github/workflows/publish.yml`); maintainer notes live in
`humanctl-trusted-publishing-notes.md`.
