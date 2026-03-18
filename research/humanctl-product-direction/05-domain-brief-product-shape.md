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
# Domain Brief: Product Shape

## Bottom line

The strongest reading is that `humanctl` should own the agent-to-human unblock loop, not the entire universe of agent outputs. The product is most coherent when treated as a local mixed-initiative coordination layer: a place where agents package blockers, show the right context, request the smallest useful human input, and resume from durable local state. [S1, S11, S12, S15, S17, S18, S19, S20]

The weakest interpretations are the extremes. If `humanctl` becomes a pure "infinite canvas for anything," it risks becoming mushy for agents and vague for humans. If it becomes a generic agent observability dashboard, it collapses into an adjacent but already crowded category that optimizes for traces and governance rather than reviewer throughput. [S3, S4, S5, S7, S11, S15, S17]

## What the category says

Adjacent products increasingly describe themselves as a control plane for agents, but the repeated themes are telemetry, tracing, dashboards, evaluation, policy, and governance. Microsoft Agent 365 leads with unified observability, dashboards, alerts, registry, and access control. Fiddler leads with telemetry, evaluation, monitoring, and governance. Langfuse and LangSmith lead with traces, monitoring, evals, insights, and alerts. [S3, S4, S5, S6, S7, S8]

That category framing is useful for language about state, oversight, and visibility, but it is not the core loop `humanctl` should own. Those systems help humans supervise agents at scale. `humanctl` is better positioned to help agents coordinate with a scarce human when work gets blocked on judgment, approval, clarification, or taste. [S3, S4, S5, S7]

## What the interaction research says

AG-UI identifies the relevant primitives for user-facing agent systems more clearly than the enterprise control-plane products do: shared state, interrupts, steering, streamed tool output, multimodal attachments, and resumability. The protocol exists because user-facing agents are long-running, multi-turn, multimodal, and nondeterministic in ways that do not fit request/response UI patterns. [S1, S2]

Magentic-UI sharpens the human-facing side of this. Its core mechanisms are co-planning, co-tasking, action approvals, answer verification, memory, and multitasking, all in service of human-centered oversight of imperfect but useful agents. The important point is not the browser agent specifically; it is the mixed-initiative stance. [S15, S16, S17]

GitHub Copilot Workspace supports the same direction in a coding context: staged work, editable plan/spec/implementation, and human steering at every step rather than one-shot opaque generation. [S19, S20]

## Recommended product definition

`humanctl` should be defined as:

> A local-first mixed-initiative coordination layer for human-in-the-loop agent work.

That definition is tighter than "agent dashboard" and more accurate than "control plane" in the enterprise sense. It also leaves room for rich rendering without making "blank canvas" the actual thesis.

## Strongest evidence

- AG-UI directly describes the core interaction primitives relevant to user-facing agent systems. [S1]
- Magentic-UI demonstrates co-planning, co-tasking, and action approvals as concrete human-in-the-loop interaction mechanisms. [S15, S17]
- Copilot Workspace demonstrates that editable staged workflow is a viable steering model in a developer tool. [S19, S20]
- Interruption research shows why the human side should be optimized around small, well-packaged asks instead of forcing repeated context reloads. [S11]

## Weakest evidence

- Enterprise control-plane product pages are useful for category naming but weak evidence for the specific human bottleneck loop. [S3, S4, S5, S7]

## Unresolved questions

- How much "open-ended canvas" flexibility should exist inside a tab before it becomes agent-hostile?
- Should the user-facing primary object be called `ask`, `item`, `packet`, or `thing`?
- How much product language should lean into "control plane" versus "coordination layer" on the site and in docs?

## Local confidence

Medium-high. The product identity is much clearer than it was, even though naming and exact object model details still need refinement.
