# `humanctl` Agent-First Design

## Thesis

`humanctl` is the local-first interruption layer that lets agents escalate blockers to a human with the right context, get a decision back, and continue work.

Its job is to help agents show the right thing, interrupt the human through the right channel, capture the response durably, and resume work without reconstructing context from chat scraps.

This is narrower than a dashboard, narrower than a blank canvas, and narrower than an agent observability product.

Two product lines should stay true at the same time:

> `humanctl` is an attention router for a scarce human.

> `humanctl` is local chief-of-staff infrastructure for agents.

For the deeper abstraction underneath those metaphors, see [control-layer.md](./control-layer.md).

## The Loop It Owns

`humanctl` should own exactly one loop:

1. An agent is blocked, waiting, or monitoring.
2. The agent packages the relevant context into a local object.
3. `humanctl` decides how to surface that object to the human.
4. The human responds in the smallest useful unit.
5. The response is written to durable local state.
6. The agent resumes from that state.

If a feature does not improve this loop, it is probably not core v1 scope.

## What It Is Not

`humanctl` v1 should explicitly not be:

- a generic infinite canvas for arbitrary layout play
- a general-purpose agent platform or workflow engine
- a full agent tracing / observability / fleet dashboard
- a project management or long-term knowledge system
- a cloud-hosted source of truth for local agent work
- a replacement for chat itself

Rich rendering is still important, but it exists in service of the loop above.

## Product Definition

The cleanest product sentence is:

> `humanctl` is a local-first mixed-initiative coordination layer for human-in-the-loop agent work.

The more agent-forward version is:

> `humanctl` gives agents a controlled way to show, interrupt, ask, watch, and resume through a scarce human.

Both should be true at the same time.

The behavioral standard is:

> `humanctl` should feel like a disciplined chief of staff, not a swarm of interns with notification access.

## Runtime Split

### Hosted

Near-term, `humanctl.com` should be:

- marketing
- docs
- sample workspaces
- installation/getting-started

Longer-term, a hosted service may also provide:

- identity and device registration
- optional metadata/artifact sync
- shared history and search across devices
- remote inbox views and response submission
- package distribution and policy templates

It should not be presented as the authority for active local runs.

### Local Runtime

The real product is local:

- `humanctld`
  - long-lived supervisor for runs, watches, notifications, policies, and resume
- `humanctl app`
  - the local UI
- `humanctl` CLI
  - the agent write surface
- `.humanctl/`
  - the authoritative workspace state

The key boundary:

- hosted may observe, sync, and submit
- local decides, executes, interrupts, and resumes

## Top-Level Runtime Components

- `daemon`
  - owns watches, notifications, policy enforcement, and resume
- `runner`
  - executes jobs/runs and emits lifecycle events
- `policy engine`
  - decides whether and how interruption is allowed
- `inbox/outbox`
  - durable queue for asks, responses, notices, and approvals
- `artifact store`
  - local storage for files, screenshots, HTML, diffs, logs
- `watch engine`
  - timers, fs watchers, process observers, and external triggers
- `channel adapters`
  - terminal, desktop, sound, voice, and future external channels
- `session store`
  - append-only log plus materialized state
- `sync client`
  - optional replication of selected data to a hosted service

## Core Surfaces

V1 should keep the human-facing UI small and opinionated.

### Inbox

The human's incoming queue.

Shows:

- new asks
- reopened items
- watch alerts
- blocked items
- reminders and snoozed items resurfacing

### Focus

The currently selected item.

This is where the human sees:

- the ask
- the relevant artifact(s)
- the exact response controls
- enough context to understand why the interruption happened

For the narrow Mac notch exploration, see [notch-mvp.md](./notch-mvp.md). The notch should act as an ambient and interrupt surface, not as the full artifact workspace.

### Artifact View

The rendering surface for payloads:

- HTML
- markdown
- image
- diff
- file preview
- gallery
- log/stream
- compare view

### Working Canvas

A durable visual work surface for artifacts that are worth keeping around.

This is not the thesis of the product, but it is an important capability.

The working canvas should make it easy for agents to:

- publish HTML dashboards, previews, and comparisons
- keep artifacts grouped and labeled
- pin important views
- reopen something later without hunting through old threads
- connect artifacts back to asks, runs, and responses

The working canvas is where "show me the thing" lives after the interruption has been handled.

### Watch View

A compact list of ongoing watches:

- what is being watched
- current state
- last checked
- escalation policy
- whether a watch is quiet, nudging, or blocking

### Policy View

Not necessarily a major v1 screen, but the model should exist.

This controls:

- which channels agents may use
- when voice/sound is allowed
- quiet hours
- bundling behavior
- escalation budgets

### Daily Digest

A low-pressure summary of items that almost escalated but did not.

This is the place for:

- `log` items worth a glance
- lower-priority updates
- bundled follow-ups that should not interrupt immediately

## Primary Objects

The current generic `Thing` model is useful internally, but too vague as a product-facing abstraction.

V1 should center on these objects:

### `ask`

An explicit request for human input.

Examples:

- choose direction A or B
- approve this action
- rank these options
- answer this clarifying question
- upload a file
- review this diff

Suggested fields:

```json
{
  "id": "ask_hero_direction",
  "workspaceId": "workspace_humanctl",
  "status": "open",
  "priority": "normal",
  "escalation": "ask",
  "prompt": "Which landing-page direction should I continue with?",
  "responseType": "single-select",
  "artifactIds": ["artifact_preview_a", "artifact_preview_b"],
  "watchIds": [],
  "createdAt": "2026-03-15T21:00:00.000Z",
  "updatedAt": "2026-03-15T21:00:00.000Z"
}
```

### `artifact`

Something the agent wants to show the human.

Examples:

- HTML preview
- HTML dashboard
- screenshot
- diff
- markdown note
- generated report
- comparison bundle

Artifacts should be durable and organized, not disposable throwaways.

That means each artifact should be easy to:

- label
- group
- pin
- reopen
- search
- trace back to the ask, run, or watch that created it

Suggested fields:

```json
{
  "id": "artifact_preview_a",
  "kind": "html",
  "title": "Hero direction A",
  "entry": "content.html",
  "summary": "Tighter hero with heavier product language.",
  "labels": ["landing-page", "hero", "comparison"],
  "pinned": false,
  "createdAt": "2026-03-15T21:00:00.000Z",
  "updatedAt": "2026-03-15T21:00:00.000Z"
}
```

### `watch`

A long-running condition an agent is monitoring.

Examples:

- wait for a human answer
- watch a file or folder
- watch a build log
- monitor a website or command
- wait for external approval or data change

Suggested fields:

```json
{
  "id": "watch_build_status",
  "kind": "command",
  "status": "active",
  "check": {
    "command": "npm run build"
  },
  "policyId": "policy_default",
  "lastCheckedAt": "2026-03-15T21:00:00.000Z"
}
```

### `response`

The human's answer, stored durably and attached to the ask.

Suggested fields:

```json
{
  "id": "response_01",
  "askId": "ask_hero_direction",
  "actor": "human",
  "choiceId": "direction_b",
  "note": "Use the more shameless copy, but keep the calmer composition.",
  "answeredAt": "2026-03-15T21:03:14.000Z"
}
```

### `event`

The append-only history and bridge between sessions.

Examples:

- created
- updated
- answered
- snoozed
- reopened
- escalated
- dismissed
- watch_triggered

Suggested fields:

```json
{
  "id": "evt_01",
  "ts": "2026-03-15T21:03:14.000Z",
  "kind": "answered",
  "target": {
    "type": "ask",
    "id": "ask_hero_direction"
  },
  "actor": "human",
  "payload": {
    "choiceId": "direction_b"
  }
}
```

### `policy`

The rule set that determines how interruption is allowed.

Suggested fields:

```json
{
  "id": "policy_default",
  "channels": ["inbox", "desktop"],
  "quietHours": {
    "start": "22:00",
    "end": "08:00"
  },
  "voice": {
    "enabled": true,
    "minEscalation": "block"
  },
  "bundleWindowSeconds": 300
}
```

### `attention`

Human-facing state that prevents thrash.

Suggested fields:

```json
{
  "targetType": "ask",
  "targetId": "ask_hero_direction",
  "seenAt": "2026-03-15T21:01:00.000Z",
  "snoozedUntil": null,
  "dismissedAt": null,
  "focusedAt": "2026-03-15T21:02:10.000Z"
}
```

### `run`

One execution instance, with lineage and status.

This matters because the product is not just about static asks; it is about interrupted work that later resumes.

Suggested fields:

```json
{
  "id": "run_01",
  "agent": "codex",
  "status": "blocked",
  "startedAt": "2026-03-15T21:00:00.000Z",
  "updatedAt": "2026-03-15T21:02:00.000Z",
  "checkpointIds": ["ckpt_01"],
  "activeAskId": "ask_hero_direction"
}
```

### `checkpoint`

A resumable execution snapshot.

Suggested fields:

```json
{
  "id": "ckpt_01",
  "runId": "run_01",
  "createdAt": "2026-03-15T21:02:00.000Z",
  "summary": "Waiting on hero direction before continuing landing-page work."
}
```

## IDs And Naming

Durable IDs matter because the product is about resumption.

Rules:

- every `ask`, `artifact`, `watch`, `response`, `event`, and `policy` gets a stable ID
- agents should target IDs directly in updates
- user-facing titles can change; IDs should not
- current `Thing` IDs can be migrated into the new model

## Interrupt Model

### Escalation Ladder

Keep the semantic ladder small and make it hard to jump levels:

- `log`
  - record only
- `nudge`
  - low-cost attention signal
- `ask`
  - explicit response required soon
- `block`
  - work cannot continue without human input

But escalation must map to channels and policy, not just badges.

### Channels

The system should support channel selection per policy:

- `inbox`
- `badge`
- `desktop`
- `focus-app`
- `sound`
- `voice`

### Default Policy Behavior

Reasonable defaults:

- `log`
  - digest/history only
- `nudge`
  - inbox or badge
- `ask`
  - inbox or desktop notification
- `block`
  - inbox + desktop + optional focus-app, sound, or voice

### Attention Rules

The daemon should apply rules like:

- quiet hours
- rate limits
- bundle related asks
- avoid escalating the same item repeatedly
- prefer inline steer when the app is already open
- only allow voice for `block` unless explicitly configured otherwise
- one item, one owner, one channel at a time
- start in inbox unless urgency, relevance, and actionability are explicit

Every interrupt should carry:

- `why now`
- `what decision is needed`
- `what happens if ignored`

## Agent-Facing Verbs

The CLI should be semantic, not layout-first.

V1 target verbs:

- `humanctl init`
- `humanctl status`
- `humanctl doctor`
- `humanctl app`
- `humanctl run`
- `humanctl resume`
- `humanctl pause`
- `humanctl cancel`
- `humanctl ask create`
- `humanctl ask update`
- `humanctl ask list`
- `humanctl artifact put`
- `humanctl artifact open`
- `humanctl watch create`
- `humanctl watch update`
- `humanctl watch list`
- `humanctl interrupt send`
- `humanctl interrupt ack`
- `humanctl policy get`
- `humanctl policy set`
- `humanctl event tail`
- `humanctl focus`

Later:

- `humanctl notify test`
- `humanctl sync push`
- `humanctl sync pull`

## Storage Model

The local workspace should keep local files authoritative.

Suggested shape:

```text
.humanctl/
  manifest.json
  runs/
    run_01/
      manifest.json
      checkpoints/
  asks/
    ask_hero_direction/
      manifest.json
      response.json
  artifacts/
    artifact_preview_a/
      manifest.json
      content.html
      attachments/
  watches/
    watch_build_status/
      manifest.json
      state.json
  policies/
    default.json
  inbox/
    events.jsonl
  state/
    attention.json
    ui.json
```

Notes:

- JSON files are the source of truth
- `events.jsonl` is the durable append-only bridge between sessions
- a local SQLite index is optional and derived
- the app may cache aggressively, but caches must be rebuildable

## What Happens To `Thing`

`Thing` can survive as an internal rendering union if that helps implementation speed.

But product-facing docs and CLI should not lead with `thing`. The clearer external model is:

- asks
- artifacts
- watches
- events

That reduces ambiguity for both agents and humans.

## V1 Deliverable

The smallest real v1 is:

1. `humanctl app` opens a local review queue + focus UI.
2. Agents can create asks and artifacts locally.
3. Humans can answer asks through structured controls.
4. Responses append to the event log and update local state.
5. Watches can trigger asks or nudges.
6. Desktop notifications work under a local policy model.
7. Runs/checkpoints exist at least well enough to resume after interruption.
8. Important artifacts can live on a durable working canvas with labels, pinning, and reopenability.

Voice can be designed now but can remain behind a feature flag or later milestone if needed.

## Failure Modes To Avoid

The runtime should be optimized against these failures:

- `alert inflation`
  - if everything escalates, nothing is trusted
- `channel duplication`
  - the same ask should not hit inbox, notification, and voice simultaneously
- `context dumping`
  - the agent must package a decision, not dump reconstruction work on the human
- `ambiguous asks`
  - every interrupt should say what is needed, why now, and what happens if ignored
- `category drift`
  - the product should not quietly turn into a generic workspace or observability suite

## Immediate Repo Implications

Next implementation changes should be:

1. Rewrite docs and site copy around the interrupt-and-response thesis.
2. Refactor the local schema from generic `Thing` toward semantic objects.
3. Replace the current queue/detail prototype with review-queue/focus language and a digest path for low-priority items.
4. Add a local `humanctld` + `humanctl app` split as the real runtime entrypoint.
5. Introduce policy-aware notification plumbing before experimenting with voice.
