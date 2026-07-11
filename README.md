# humanctl

`humanctl` is a control plane for the human bottleneck.

You are the scarce resource in an agent fleet. Codex and Claude Code sessions
pile up faster than you can watch them, and the expensive failure mode is
silent: an agent finishes or blocks, and nobody notices for an hour.
`humanctl` is an attention router for that scarce human. It tells you which
sessions need you, why, and how to resume the work after you answer.

The core thesis: the session is not the work, the checkpoint is the work.
Agents should package blockers into the smallest unit of human attention,
keep the supporting context attached, and resume as soon as the answer lands.

`humanctl` ships two surfaces today:

- a desktop app: a local-first, read-only control room over your real Codex
  and Claude Code session transcripts
- a CLI: the agent-facing inbox plus the durable ask / artifact / watch
  object model under `.humanctl/`

## The desktop app

The app reads recent Codex and Claude Code transcripts on your machine and
shows the whole fleet in one exception-first surface: sessions that need you
lead, everything healthy recedes. A full-height sidebar navigates Inbox
(default, unread badge), Metrics, Fleet, and Sessions, keys 1/2/3/4. Inbox is
the default: a message-centric view of every session's agent notes, detected
asks, and btw questions, one thread per session, so the primary surface
matches the thesis (attention routing, not session picking). A summonable
chief-of-staff drawer (an advisory chat grounded in the live fleet) and a
persistent bottom context bar (the fleet digest and quota) round out the
shell. Rows carry real signals only: a one-line summary, cwd and harness, and
(in session detail) context fill, token usage, spend at API rates, Codex 5h
and weekly quota, model and reasoning effort. Pins and real session titles are
kept. One click resumes a session in your terminal, or in the harness's own
desktop app via its deep link (Claude or Codex, when installed); a
per-harness setting picks which is primary.

It is read-only and offline by default. It never writes to your transcripts
and never sends anything off the machine, with explicit opt-in exceptions: AI
summaries and Atlas answers, which pipe recent messages/fleet state through
your local `claude` or `codex` CLI (you pick the engine). See
[docs/desktop.md](./docs/desktop.md).

## Install

Desktop (macOS, from source):

```bash
npm install
npm run app:install   # builds and installs to /Applications/humanctl.app
                      # (falls back to ~/Applications if /Applications is not writable)
```

CLI:

```bash
npm i -g humanctl
```

## Quick start

```bash
humanctl init .        # create a .humanctl/ workspace in this repo
humanctl status .      # summarize what is there
npm run desktop        # or run the control room live from source
```

Agents use the same CLI to escalate instead of blocking silently:

```bash
humanctl note --level review "PRs are up, need a review + merge in ~5m"
humanctl ask create --title "Redis or Postgres?" --prompt "Pick one" \
  --option "redis|Redis|fast, volatile" --option "pg|Postgres|durable"
```

The human runs one read-only command to see whether the work graph and local
reality still agree:

```bash
humanctl pulse         # needs-you, ready-for-review, blocked, stale, unowned, verified
humanctl pulse --json  # stable contract for scripts and future surfaces
```

Pulse reconciles Linear issues, local git worktrees, GitHub PRs and checks,
agent sessions, and notes into exclusive attention lanes, and says which
sources were degraded instead of pretending they were empty. See
[docs/pulse.md](./docs/pulse.md).

## The agent inbox

`humanctl note` is the core loop: a short aside to the human, appended to
`~/.humanctl/notes.jsonl` (one global inbox across every repo). The desktop
app surfaces notes at the top of the control room.

- `humanctl note --level fyi|review|blocked|done "message"`
- `--session <id>` links a note to a session so the inbox can open it
- cwd and repo are captured automatically

Underneath sits the durable object model for bigger handoffs:

- `humanctl ask create|get|list|update|answer|delete` for bounded decisions
- `humanctl artifact put|get|list|delete` for previews and evidence
- `humanctl watch create|get|list|update|delete` for standing conditions

Everything is plain files plus an append-only event log, so future sessions
resume from durable state instead of chat-history reconstruction. Prefer
`--json` when another agent or script consumes the result.

## Docs

Current:

- [docs/desktop.md](./docs/desktop.md): the desktop control room reference
- [docs/pulse.md](./docs/pulse.md): the pulse reconciliation reference (lanes,
  join token, config, degradation semantics)
- [docs/agentic-control-layer.md](./docs/agentic-control-layer.md): the
  control-layer spec (workRef / executionRef / proofRef / checkpoint, pulse)
- [docs/control-layer.md](./docs/control-layer.md): the deeper control-layer
  framing

Historical and design-trail docs (kept for context, not current direction):

- [docs/agent-first.md](./docs/agent-first.md),
  [docs/how-we-got-here.md](./docs/how-we-got-here.md),
  [docs/source-identity.md](./docs/source-identity.md),
  [docs/decision-surface-research.md](./docs/decision-surface-research.md),
  [docs/mvp-plan.md](./docs/mvp-plan.md), [docs/v1.md](./docs/v1.md)
- notch docs ([docs/notch-mvp.md](./docs/notch-mvp.md),
  [docs/notch-next-spec.md](./docs/notch-next-spec.md),
  [docs/notch-recovery-protocol.md](./docs/notch-recovery-protocol.md),
  [docs/notch-shell-contract.md](./docs/notch-shell-contract.md),
  [docs/notch-shell-lessons.md](./docs/notch-shell-lessons.md)): the native
  macOS notch shell is parked under `attic/notch/`, kept, not deleted

## Development

The renderer (`electron/renderer-vite/`, React + Vite + Tailwind + shadcn)
falls back to synthetic fixtures when the Electron bridge is absent, so the
whole UI runs in a plain browser with zero real session data. That is the
default loop:

```bash
npm run renderer       # Vite dev server, HMR, http://localhost:5183
npm run desktop        # Electron against your real local sessions
npm run desktop:sessions   # print the recent-session table to stdout
```

See [AGENTS.md](./AGENTS.md) for the full operator notes.

## Hygiene

This repo is public. Real session data, secrets, personal absolute paths, and
private operating notes are not allowed in current tracked files or release
artifacts. Screenshots and demos use synthetic fixtures, never real
transcripts. `scripts/secret-scan.sh` and `npm run package:check` gate the
repository and npm artifact. See [docs/repo-hygiene.md](./docs/repo-hygiene.md).

## Copy guardrail

On user-facing pages, do not leak builder notes into the copy. Do not narrate
implementation details like "manually curated" or "backed by files" unless
that detail is directly valuable to the user. Sell the outcome, not how the
page was assembled.

## Brand note

Use `humanctl` in lowercase for user-facing brand copy. Code identifiers and
build target names may still use `Humanctl...` where needed.

## License

Apache-2.0. See [LICENSE](./LICENSE). Contributions are expected under the
same terms unless explicitly agreed otherwise.

## Publishing (maintainers)

The published npm file surface is intentionally CLI-only.
`npm run package:check` enforces an allowlist containing the compiled CLI, its
two runtime libraries, the agent skill, README, license, and package metadata.
It rejects docs, source maps, Electron output, and personal absolute paths,
then installs and smokes the exact tarball before publication. Publishing runs via
npm trusted publishing from GitHub Actions (`.github/workflows/publish.yml`);
maintainer notes live in `humanctl-trusted-publishing-notes.md`.
