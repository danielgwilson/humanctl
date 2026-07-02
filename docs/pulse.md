# `humanctl pulse`

Read-only reconciliation of four sources of truth about agent work, plus the
notes inbox, into one answer: what is true, who owns the next move, and what
needs the human.

    humanctl pulse [--json] [--repo <name>] [--lane <lane>] [--fresh]

Pulse mutates nothing. It never writes to Linear, GitHub, git, or local state
(its only writes are its own cache file). The desktop app shows sessions;
pulse shows whether the work graph and local reality agree.

## Sources

| Source | Read via | Contributes |
|---|---|---|
| Work authority | `linear issue query --team <team> --state <state> --json` (one call per configured team and state) | issue identifier, title, state, priority, url, updatedAt |
| Execution | `git worktree list --porcelain` + `for-each-ref` + `status` per configured repo | branches, worktree paths, dirty state, ahead/behind, last commit age |
| Proof | `gh pr list -R <owner/repo> --state open --json ...` plus a bounded `--state merged` list | PR state, draft flag, review decision, checks rollup |
| Attempts | `lib/sessions.js` (bounded reads of local Codex and Claude Code transcripts) | session activity, last role, issue references |
| Escalations | `~/.humanctl/notes.jsonl` | blocked / review / done notes |

Worktrees always come from git, never from configuration: agent harnesses
create worktrees in places no config file would list (including nested
`.claude/worktrees/agent-*` paths), and git is the only source that knows
them all.

## The join key

The one join key across all sources is the extracted issue-key token: a match
of `[A-Za-z]{2,}-[0-9]+` (case-insensitive, normalized to uppercase
`TEAM-123`), extracted from:

- git branch names (`codex/team-123-anything`, `team-123-anything`)
- worktree directory names
- PR head branch, title, and body
- session transcripts, as both Linear issue URLs and bare tokens

Linear `branchName` equality is explicitly rejected as a join: Linear
generates `feature/team-123-title-slug` while real branches are named by
agents and humans, and the two never match. The token is what survives every
renaming convention.

Because the token is a regex over messy text, two honesty rules keep it from
fabricating work:

- Tokens whose number reads as a year or a longer date (`OCTOBER-2025`,
  `SBOM-20260225`) never mint a work unit on their own. They still join when
  Linear confirms them as a real issue identifier.
- Branch names and PR head branches can mint new units (branch naming is the
  execution convention). PR titles, bodies, and transcript text are free
  text: tokens found there only join units that Linear, git, or GitHub
  already know.

Every item carries a confidence tag: `explicit` (token or Linear URL match),
`inferred` (directory-containment or branch-name heuristics), `fallback`.
Non-explicit joins render marked, never silently as fact.

## Lanes

Each reconciled unit lands in exactly one lane, the first match in this
order. A unit is an issue plus everything joined to it, or, for unowned local
work, a branch/worktree/session cluster. The header counts are the lane
lengths; no unit is ever counted twice.

1. `needs-you`: an open `blocked` or `review` note, or an attached session
   whose last message is from the agent (within the desktop's needs-you decay
   window) with no newer activity on the unit. The human is the blocker.
2. `ready-for-review`: an open non-draft PR, checks passing (or no checks
   configured, which the item says explicitly), not yet approved.
3. `blocked-on-agent`: an open PR with failing checks.
4. `stale`: execution or proof exists but nothing moved (commit, PR update,
   session activity, note) within `staleHours`. Includes worktrees whose PR
   already merged: those are cleanup candidates and say so.
5. `missing-owner`: local execution with real activity but no reconciled
   issue, or a tracked started issue with no local execution or PR evidence.
6. `verified`: issue, execution, and proof present, consistent, and fresh.

Anything matching no lane is emitted under `diagnostics` in `--json`, never
silently dropped, so gaps in the lane definitions stay visible. Sessions that
join no unit are counted there too (per repo, and one count for sessions
outside every configured repo). One deliberate scope rule: a clean primary
checkout sitting on `main` with nothing unpushed is healthy baseline and does
not form a unit.

Every lane item carries `workRef` (the tracker issue, only when the tracker
confirmed it), `executionRef` (repo, branch, worktree, dirty, ahead/behind,
attached sessions), `proofRef` (PR, checks, review state), `age`,
`confidence`, and `next`: one recommended action with a path or URL.

## Honesty and degradation

Exit codes are untrusted. The linear CLI exits 0 on unknown options, auth
failures, and help dumps, so every adapter validates the shape of what came
back (a `nodes` array from linear, a JSON array from gh) and treats anything
else as a degraded source with a reason. Each subprocess gets a 10 second
timeout; a timeout is a degradation, not a crash.

A degraded source never renders as an empty success:

- the affected data is reported as `null`, not as zero items
- the header says `(degraded: <sources>)`
- every item whose lane decision the degraded source could have changed
  carries a `degraded` marker
- a unit known only by its token is never filed as `missing-owner` while
  Linear is unreadable, because that claim would be unverifiable

Missing is different from failed: a machine with no notes file or no session
logs reports empty truth, not degradation.

## Output

Human view: a one-line header (`pulse: 2 need you, 3 ready for review, 0
blocked on agent, 4 stale, 1 unowned, 12 verified`), then lanes as sections
with needs-you first. On large fleets every lane except needs-you caps its
listing and says how many more there are; header counts and `--json` are
never capped.

`--json` emits a stable contract for future desktop consumption:

    {
      "generatedAt": "...",
      "config": { "reposScanned": [...], "linearScope": {...} },
      "lanes": { "needsYou": [], "readyForReview": [], "blockedOnAgent": [],
                 "stale": [], "missingOwner": [], "verified": [] },
      "diagnostics": [],
      "degraded": { "git": null, "gh": null, "linear": null,
                    "sessions": null, "notes": null }
    }

`--lane <lane>` filters to one lane (accepts the human names, e.g.
`needs-you`, `missing-owner` or `unowned`). `--repo <name>` filters to units
with execution in that repo; collection still scans everything so joins stay
correct, and issue-only units are excluded from a repo-filtered view.

## Config

`~/.humanctl/pulse.json` (`--config <path>` overrides, mainly for testing):

    {
      "staleHours": 24,
      "repos": [
        { "name": "app", "path": "~/work/app/main", "github": "example/app" },
        { "name": "infra", "path": "~/work/infra", "github": "example/infra" }
      ],
      "linear": {
        "workspace": "example",
        "assignee": "dev@example.com",
        "teams": ["TEAM"],
        "states": ["started"]
      }
    }

- `staleHours` (default 24): the no-movement window for the stale lane.
- `repos`: the fleet to scan. `path` is the primary checkout; worktrees are
  discovered from git. `github` is the `owner/repo` for PR truth.
- `linear`: optional. `teams` drives one query per team per state; `states`
  defaults to `["started"]` (add `"unstarted"` to include queued work);
  `assignee` scopes to one person. Without a `linear` block the source
  reports itself as not configured rather than pretending there are no
  issues.

There is no worktrees directory setting on purpose; git owns worktree
discovery.

## Caching and performance

`gh` and `linear` responses are cached in `~/.humanctl/pulse-cache.json` for
120 seconds; `--fresh` bypasses the cache. Only successful responses are
cached, so a degraded source is retried on the next run. Local git, session,
and notes reads are always live.

Call budget per run: one linear query per team/state, two `gh pr list` calls
per repo, one bounded session scan, and local git commands (worktree list and
for-each-ref per repo, status per recently-active worktree).

## Non-goals

- No mutations: no nudging agents, no state changes anywhere.
- No kanban and no Linear clone: pulse never re-renders issue boards; it
  reports where local reality and the work graph disagree or need a human.
- No daemon and no notifications in v1: it runs when invoked.

## Testing

    npm run pulse:selftest

Fixture-driven unit tests for the reconciler: the join across real-world
branch shapes, lane exclusivity (no unit in two lanes), degradation honesty,
and the note lifecycle. No network, no real data.
