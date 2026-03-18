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
# Domain Brief: Agent UX

## Bottom line

Agents need a write surface, not just a pretty UI. The local runtime should expose a very small, durable object model with stable IDs, evented updates, and support for rich payloads. HTML should remain a payload option, but the app should not depend on agents hand-rolling full custom UIs every time. [S1, S15, S17, S19, S20]

In practical terms, the agent UX should optimize for a few cheap actions:

- show this
- ask this
- watch this
- update this
- focus this
- resume from this

## What AG-UI and mixed-initiative systems imply

AG-UI is useful because it names the underlying primitives plainly: shared state, interrupts, steering, frontend tool calls, tool-output rendering, and custom events. That is close to the underlying contract `humanctl` should eventually expose, even if v1 is file-backed and local instead of protocol-first. [S1]

Magentic-UI and Copilot Workspace suggest a second important pattern: humans should be able to edit or steer intermediate artifacts such as plans, asks, or execution context. In other words, the agent UX should support resumable objects rather than just append-only text output. [S15, S17, S19, S20]

## Recommended agent-facing object model

The current `thing` abstraction is directionally useful but too generic for the product story. A stronger v1 model would separate:

- `ask`: explicit request for human input
- `artifact`: preview, note, diff, image, HTML, markdown, or report
- `watch`: long-running or recurring state that may later produce asks or nudges
- `event`: append-only activity / answer / state transition
- `view-state`: attention metadata such as seen, snoozed, pinned, dismissed, reopened

Tabs and workspaces still matter, but as containers rather than the product thesis.

## Recommended agent verbs

V1 CLI should prioritize a tiny set of commands:

- `humanctl ask`
- `humanctl artifact put`
- `humanctl watch create`
- `humanctl event append`
- `humanctl focus`
- `humanctl status`
- `humanctl app`

This is a better fit than leading with generic layout commands because it keeps the interaction model tied to the unblock loop.

## Design implications for agents

- Stable IDs are mandatory. Resumption without durable IDs is brittle. [S1, S17]
- Human answers must arrive as structured state changes, not only as chat text. [S1, S17]
- Agents need live steering when available, but durable event history as the truth. [S1, S17]
- Long-running monitors need resumable state rather than growing context windows. [S18]
- Agent-authored HTML is useful, but should slot into known surfaces such as artifact preview or compare view, not replace the whole app. [S1, S19]

## Strongest evidence

- AG-UI for primitive vocabulary and shared-state semantics. [S1]
- Magentic-UI for resumable mixed-initiative objects and approvals. [S15, S17]
- Tell me When for durable long-running watch state. [S18]
- Copilot Workspace for editable staged objects in a coding workflow. [S19, S20]

## Weakest evidence

- Generic "control plane" product pages do not strongly inform agent write ergonomics. [S3, S4]

## Unresolved questions

- Should `ask` subsume `compare`, or should compare be explicit?
- Should `watch` be a first-class object in v1 or a subtype of artifact plus scheduler?
- How much schema should be standardized for responses versus left open via JSON payloads?

## Local confidence

Medium-high. The verb set is clear; the exact schema details still need design work.
