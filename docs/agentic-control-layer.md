# Agentic Control Layer Spec

Status: proposed  
Date: 2026-06-26

## Context

`humanctl` started as a local-first escalation layer for the human bottleneck: agents create asks, artifacts, watches, and events so a human can answer once and the agent can resume.

That thesis still holds. The new learning is that agentic engineering platforms are moving the work authority layer into issue trackers and agent sessions. Linear now exposes coding sessions, agent sessions, agent activities, agent plans, external URLs, and an assignee/delegate split. Claude Code workflows move repeatable orchestration into scripts instead of relying on a chat window to hold every intermediate result.

The product implication:

```text
Linear or issue tracker = work authority
Agent sessions = execution attempts
PRs, checks, logs, and artifacts = proof surface
humanctl = local reconciliation, control, and human-attention layer
Notch, tray, desktop app = attention surfaces
```

`humanctl` should not become a replacement for Linear. It should become the local operating layer around agent work that Linear cannot fully see.

## Product Definition

`humanctl` is a local control layer for agent work that tracks agent identity, reconciles execution truth, routes human control inputs, and preserves resumable checkpoints.

Shorter:

> `humanctl` tells a scarce human what needs attention, why, and how to resume the work after the answer.

This extends the current product sentence without replacing it:

> `humanctl` decides when human authority is needed, chooses how to obtain it, and turns the answer into durable state that agents can act on.

## What Changes

The current docs correctly focus on `ask`, `artifact`, `watch`, `event`, `run`, and `checkpoint`. The next layer should add first-class links between those objects and external work authority:

- Linear issue
- Linear project
- Linear agent session
- agent harness identity
- local repo and worktree
- branch
- PR
- checks
- proof artifact
- last verified timestamp

This does not mean `humanctl` owns project management. It means `humanctl` can answer:

- What work is active?
- Which human is accountable?
- Which agent or session is delegated?
- What branch or PR is attached?
- What proof exists?
- What is stale?
- What needs human input?
- Where should the human click next?

## Non-Goals

Do not build these as the next phase:

- a custom kanban board
- a Linear clone
- a general agent observability SaaS
- a full orchestration framework before pulse is trusted
- a native Swift product core
- a notch dashboard
- a topology taxonomy product

The notch stays useful, but only as an ambient or peek surface.

## Core Objects

### `sourceIdentity`

Describes the thing asking for attention.

```ts
type SourceIdentity = {
  harness: "codex" | "claude-code" | "opencode" | "gemini-cli" | "cursor-agent" | "copilot-coding-agent" | "unknown";
  host?: "codex-app" | "terminal" | "warp" | "cursor" | "vscode" | "browser" | "github" | "unknown";
  threadId?: string;
  sessionId?: string;
  confidence: "explicit" | "inferred" | "fallback";
};
```

This builds on `docs/source-identity.md`.

### `workRef`

Describes the external work authority.

```ts
type WorkRef = {
  provider: "linear" | "github" | "local" | "unknown";
  projectId?: string;
  issueId?: string;
  issueUrl?: string;
  title?: string;
  status?: string;
  priority?: string;
  humanOwner?: string;
  delegate?: string;
};
```

### `executionRef`

Describes a concrete execution attempt.

```ts
type ExecutionRef = {
  harness: SourceIdentity;
  repoPath?: string;
  worktreePath?: string;
  branch?: string;
  prUrl?: string;
  agentSessionUrl?: string;
  agentSessionState?: "pending" | "active" | "error" | "awaitingInput" | "complete" | "stale";
  startedAt?: string;
  lastVerifiedAt?: string;
};
```

### `proofRef`

Describes evidence that work is real.

```ts
type ProofRef = {
  kind: "pr" | "check" | "test" | "lint" | "typecheck" | "screenshot" | "artifact" | "note";
  url?: string;
  path?: string;
  status: "unknown" | "pending" | "passing" | "failing" | "stale";
  capturedAt: string;
  summary?: string;
};
```

### `checkpoint`

The durable unit of work.

```ts
type Checkpoint = {
  id: string;
  goal: string;
  status: "planned" | "active" | "blocked" | "ready_for_review" | "complete" | "stale";
  workRef?: WorkRef;
  executionRefs: ExecutionRef[];
  proofRefs: ProofRef[];
  askIds: string[];
  artifactIds: string[];
  recommendedNextStep?: string;
  lastVerifiedAt?: string;
  resumeHint?: string;
};
```

The session is not the work. The checkpoint is the work.

## `humanctl pulse`

The first useful product wedge is a read-only pulse.

Command:

```bash
humanctl pulse --workspace . --json
```

Job:

- read local `.humanctl` state
- optionally read Linear project or issue state
- optionally inspect local git/worktree state
- optionally inspect GitHub PR/check state
- produce one reconciliation summary

The output should separate:

- verified now
- stale
- blocked on human
- blocked on agent
- missing proof
- missing owner
- ready for review

Do not mutate Linear or local state in the first version. Trust is the product.

## Linear Bridge

Use Linear as the canonical work graph when available.

Recommended integration order:

1. Read-only import of Linear issue/project metadata into `workRef`.
2. Humanctl URL attached to Linear issue or PR as a normal external link.
3. AgentSession external URL pointing to the local or hosted `humanctl` workspace view.
4. Agent activities mirrored into `humanctl` events.
5. `ask` objects mapped to Linear agent elicitation or comment flows only after the local loop is trusted.

Important boundary:

- Linear owns issue status, priority, and human accountability.
- `humanctl` owns local session identity, attention routing, checkpoint state, and local proof reconciliation.

## Desktop Shape

The product core should be:

```text
CLI + .humanctl files + humanctld + Next app + optional Electron shell
```

The native notch app should be retained as a platform-specific attention surface:

- Ambient: source, count, urgency
- Peek: one bounded decision
- Workspace: handoff to Codex, Claude Code, Linear, local app, or artifact

Do not rebuild orchestration logic in Swift.

## Near-Term Build Plan

### Phase 0: repo and privacy decision

- Decide whether `danielgwilson/humanctl` remains public OSS or becomes private.
- If it stays public, keep real personal operating traces out of the repo.
- If it becomes private, update docs and site copy that currently say open source/public.
- Do not move the repo into a new directory layout while the working tree is dirty.

### Phase 1: pulse prototype

- Add `humanctl pulse`.
- Read local `.humanctl` asks, artifacts, watches, and events.
- Read git branch/worktree/dirty state.
- Emit a compact JSON summary.
- Add one human-readable pulse view.

### Phase 2: checkpoint schema

- Add `runs/`, `checkpoints/`, `workRef`, `executionRef`, and `proofRef`.
- Preserve current asks/artifacts/watches.
- Map existing sample state forward without deleting it.

### Phase 3: Linear read bridge

- Add read-only Linear adapter.
- Pull issues by project, label, issue ID, or URL.
- Attach Linear IDs to checkpoints.
- Show stale/missing owner/missing proof conditions.

### Phase 4: desktop/app view

- Add a Pulse view to `humanctl app`.
- Keep Review Queue and Focus for asks.
- Keep Working Canvas for artifacts.
- Add "Open in Linear", "Open PR", "Open artifact", "Open session" actions.

### Phase 5: agent session integration

- Add Linear AgentSession external URL support.
- Add event mirroring for agent activity.
- Consider `humanctl` as a local companion for Linear Agent, not a replacement.

### Phase 6: notch as attention only

- Wire Ambient/Peek to pulse and asks.
- Do not turn Ambient into a dashboard.
- Use Workspace as a handoff to the real surface.

## Acceptance Scenarios

### Scenario A: one active issue

1. A Linear issue is active.
2. A Codex or Claude Code session is working on it.
3. A branch or PR exists.
4. `humanctl pulse` shows owner, delegate, branch, PR, last proof, and next action.
5. The human can open the right surface in one click.

### Scenario B: stale delegated work

1. A Linear issue has an agent session.
2. No PR, checkpoint, or proof has changed recently.
3. `humanctl pulse` marks the lane stale.
4. The human sees whether to nudge, restart, or close the execution attempt.

### Scenario C: human authority needed

1. An agent cannot infer a preference or approval boundary.
2. It creates an `ask` with linked artifact and workRef.
3. The human answers once.
4. The checkpoint is updated.
5. The agent resumes without chat-history reconstruction.

## Design Principle

Every new feature should make one of these cheaper:

- know what is true
- know who or what owns the next move
- give the human one bounded decision
- resume from durable state

If a feature does not do one of those, it is probably not next.
