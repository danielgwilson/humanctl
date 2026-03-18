# Domain Brief

## Domain

## Core Question

## Key Findings

- 

## Evidence

- 

## Important Claims

- 

## Contradictions

- 

## Strongest Evidence

- 

## Weakest Evidence

- 

## Open Questions

- 

## Local Assessment

- Confidence:
- Practical implication:
# Domain Brief: Local Architecture

## Bottom line

The real product should be local-first, with the local workspace as the primary source of truth. The hosted site should remain marketing plus a sample workspace, not the canonical runtime. [S12, S18]

The architecture should favor durable local files plus an append-only event log, with any local index/cache existing to accelerate rendering rather than to replace the underlying state.

## Why local-first is the right architectural posture

Ink & Switch's local-first framing is directly relevant: the primary copy of data should live on the local device, and servers should be secondary copies that help with synchronization rather than authority. This fits `humanctl` unusually well because the thesis depends on continuity across local agents, CLI sessions, files, and long-running tasks. [S12]

It also solves the exact product confusion we hit in the current prototype. A hosted web app cannot be the true runtime for a tool whose source of truth is a user's local files and agent sessions. The hosted app can demonstrate the model, but it cannot own the real state without changing the nature of the product. [S12]

## Architectural implications from long-running agents

Tell me When adds a second architectural requirement: long-running monitoring tasks create both polling tradeoffs and context-overflow problems. Their answer is to persist state after the first check and reuse it across subsequent checks. That pattern maps well to `humanctl` watches and asks: long-lived work should not depend on an ever-growing transient conversation context. [S18]

Magentic-UI's monitoring and pause/resume behavior points in the same direction. If agents can wait, monitor, pause, re-plan, and request approval, then the system needs durable state transitions that survive time and process boundaries. [S17, S18]

## Recommended runtime split

- `humanctl.com`
  - marketing site
  - docs
  - sample/demo workspace
- local `humanctl app`
  - actual runtime
  - reads and writes local `.humanctl/`
  - can optionally watch local files and logs
- `.humanctl/`
  - project-local source of truth
  - file-backed objects and event history
- optional local index
  - SQLite or similar for search, subscriptions, and UI caches
  - derived, rebuildable, not authoritative

## Recommended storage model

For v1, the cleanest model is:

- file-backed objects for asks, artifacts, watches, manifests, and attachments
- append-only `events.jsonl` for state changes and answers
- derived UI state for read/snooze/pin/focus metadata

That is close to the current direction, but the research suggests strengthening the semantic object types and being explicit that the event queue is the durable bridge between humans and agents.

## Strongest evidence

- Ink & Switch on local-first authority and ownership. [S12]
- Tell me When on persisted state for long-running monitoring. [S18]
- Magentic-UI on pause, re-plan, approval, and resume dynamics. [S17]

## Weakest evidence

- Enterprise cloud control-plane products are not good models for local source-of-truth decisions. [S3, S4, S5, S7]

## Unresolved questions

- Should the local index be SQLite from v1, or should the app initially read files directly?
- How should file watches and command/log streams be represented on disk?
- What optional sync path, if any, should be considered later without undermining local-first principles?

## Local confidence

High on local-first source of truth, medium on the index/cache design.
