# `humanctl` MVP Plan

## Goal

Build the smallest version of `humanctl` that proves a real advantage over staying purely inside the Codex app.

That means proving this loop:

1. An agent gets blocked or needs judgment.
2. The agent creates a durable local `ask` with the right artifact attached.
3. `humanctl` routes that ask to the human through the cheapest sufficient channel.
4. The human answers once.
5. The answer lands in durable local state.
6. The agent resumes without reconstructing context.

If the MVP does not make that loop materially better, faster, or calmer than chat alone, the product is not yet justified.

## Product Promise

`humanctl` is an attention router for a scarce human.

More operationally:

`humanctl` is local chief-of-staff infrastructure for agents.

The MVP should feel like:

- disciplined
- legible
- low-spam
- easy to resume
- good at keeping important artifacts around

It should not feel like:

- another dashboard
- another chat client
- a random pile of generated HTML

## MVP Success Criteria

The MVP is successful if it can do all of the following locally:

1. An agent can create a structured `ask`.
2. The ask can attach one or more durable `artifacts` such as HTML previews, diffs, or notes.
3. The ask shows up in a local review queue and focus view.
4. The system can optionally send a desktop notification based on policy.
5. The human can answer with a bounded structured response.
6. That response is appended to the event log and stored against the ask.
7. The agent can query the answer and resume.
8. Important artifacts remain organized, labeled, searchable-enough, pinnable, and reopenable on a working canvas.

## Explicit Non-Goals

V1 should not try to solve these:

- full multi-agent orchestration
- full trace/eval/observability dashboarding
- team collaboration and remote sync as the primary runtime
- voice-first interaction
- Slack/email/SMS fanout by default
- generalized infinite canvas editing

## MVP Surfaces

### 1. Review Queue

The system of record for incoming human attention items.

Needed behaviors:

- prioritized list of asks and escalations
- dedupe / grouping of related items
- snooze and dismiss
- simple filters by escalation and status

### 2. Focus View

The currently selected item.

Needed behaviors:

- show one ask clearly
- show the linked artifacts
- show why the interruption happened
- show one primary response flow

### 3. Working Canvas

A durable place for artifacts worth keeping.

Needed behaviors:

- render HTML dashboards, previews, and comparisons
- group artifacts by label or source run
- pin artifacts
- reopen artifacts later
- preserve lineage to the ask/run/watch that created them

This is where the old “working canvas” idea survives, but as an organized artifact memory instead of the thesis of the product.

### 4. History

A simple log of:

- answered asks
- dismissed asks
- reopened asks
- delivered notifications
- important state transitions

### 5. Policy

A small settings surface for interruption behavior.

Needed behaviors:

- quiet hours
- allowed channels
- default escalation thresholds
- whether focus-steal is allowed
- whether voice is allowed

## MVP Object Model

The MVP should stop leading with `Thing` and move to semantic objects.

### Required objects

- `ask`
- `artifact`
- `response`
- `watch`
- `event`
- `policy`
- `attention`
- `run`
- `checkpoint`

### Suggested local layout

```text
.humanctl/
  manifest.json
  runs/
    run_<id>/
      manifest.json
      checkpoints/
  asks/
    ask_<id>/
      manifest.json
      response.json
  artifacts/
    art_<id>/
      manifest.json
      content.html
      attachments/
  watches/
    watch_<id>/
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

### Migration rule

Current `Thing`s should map like this:

- `request` -> `ask`
- `artifact` -> `artifact`
- `note` / `comparison` / `report` -> `artifact` subtypes
- watch-like `Thing`s -> `watch`

The old `Thing` abstraction can remain as an internal rendering union temporarily, but all product-facing language and new code should target the semantic objects above.

## MVP Runtime Components

### `humanctld`

This is the new backbone.

Responsibilities:

- watch local workspace state
- evaluate interruption policy
- deliver desktop notifications
- maintain delivery cooldowns
- expose a tiny local API or socket

### `humanctl app`

Responsibilities:

- review queue
- focus view
- working canvas
- history
- basic policy settings

### CLI

Minimum commands for MVP:

- `humanctl init`
- `humanctl status`
- `humanctl app`
- `humanctl ask create`
- `humanctl ask answer`
- `humanctl artifact put`
- `humanctl watch create`
- `humanctl events tail`
- `humanctl focus`
- `humanctl doctor`

## Notifications And Presence

### MVP notification scope

Start with:

- inbox only
- desktop notification
- app focus / open

Do not start with:

- voice
- SMS
- Slack
- email

Those can come later once the trust model is proven.

### Default escalation ladder

- `log`
  - history/digest only
- `nudge`
  - review queue or passive badge
- `ask`
  - review queue + single desktop notification if policy allows
- `block`
  - persistent queue item + stronger local notification

### Presence awareness

Presence is important, but should start narrow.

MVP presence inputs:

- app currently open or not
- app focused or not
- recent activity timestamp
- manual “busy” or “heads down” state

Next layer after MVP:

- calendar busy/free
- active meeting detection
- optional system focus / do-not-disturb signals

The point is not omniscience. The point is to avoid obvious bad interruptions.

## Artifact Strategy

Artifacts are one of the differentiators because chat is bad at preserving them.

The MVP should make artifacts:

- durable
- labeled
- pinnable
- reopenable
- associated with a run or ask
- easy to preview locally

This is where HTML dashboards and mini-surfaces remain very valuable.

Examples:

- landing-page comparisons
- code review diffs
- markdown briefs
- log snapshots
- screenshots
- lightweight dashboards

## Build Sequence

### Phase 0: Canonical docs

Already mostly done:

- agent-first framing
- chief-of-staff framing
- attention router framing

Finish by:

- making the MVP plan canonical
- ensuring stale docs do not conflict

### Phase 1: Schema refactor

Implement the new local directories and manifests.

Deliverables:

- ask/artifact/watch schemas
- response and event schemas
- migration of seeded `.humanctl` sample data from `things/`

### Phase 2: App refactor

Refactor the current `/app` prototype away from generic `Thing`s.

Deliverables:

- review queue replacing generic queue
- focus view replacing generic detail pane
- working canvas for pinned artifacts
- basic history view

### Phase 3: CLI write path

Deliverables:

- `ask create`
- `artifact put`
- `watch create`
- `ask answer` or equivalent consumer path

### Phase 4: Local daemon and notifications

Deliverables:

- `humanctld`
- desktop notifications
- cooldown logic
- channel policy evaluation

### Phase 5: Presence-aware routing

Deliverables:

- app open/focus awareness
- manual busy state
- notification suppression rules

Calendar integration is explicitly after this, not before.

## Acceptance Test Scenarios

The MVP should pass these manual scenarios:

### Scenario A: Decision unblock

1. Agent creates an ask with two HTML artifacts.
2. Human gets one desktop notification.
3. Human opens the app, picks one option, adds a note.
4. Answer is stored locally.
5. Agent reads the answer and continues.

### Scenario B: Durable artifact memory

1. Agent publishes an HTML dashboard artifact without needing an answer.
2. Human can find it later by label or pin.
3. Human can reopen it without using chat history.

### Scenario C: Watch-triggered escalation

1. Agent creates a watch for a local process/log or delayed condition.
2. Watch triggers an ask.
3. Policy routes it as `nudge` or `ask`.
4. Human sees it in review queue even if the original agent session is gone.

## Open Questions

- Should the working canvas be a dedicated route or a pane inside the main app?
- Should `run` and `checkpoint` be implemented immediately in schema, or first as simpler metadata?
- Should the MVP CLI create HTML shell artifacts automatically, or only accept files created elsewhere?
- How much of the old tabs model should survive, if any, beyond a simple grouping primitive?

## Recommended Immediate Next Step

Do not jump to presence/calendar or voice yet.

The next implementation move should be:

1. migrate schema from `Thing` to `ask` / `artifact` / `watch`
2. refactor `/app` into review queue + focus + working canvas
3. add `humanctl ask create` and `humanctl artifact put`

That is the fastest path to learning whether `humanctl` is actually better than just staying in chat.
