# Final Rollup

## BLUF

`humanctl` is most likely not a generic dashboard, not a blank infinite canvas, and not primarily an agent observability product. The strongest evidence-backed definition is: a local-first mixed-initiative coordination layer for human-in-the-loop agent work.

The product should own one loop end to end: when an agent gets blocked on human judgment, approval, clarification, or taste, it should be able to package the blocker into a durable local object, surface the right context, request the smallest useful response, and resume from the answer. That is a sharper and more defensible product than "an app where agents can put anything," even though rich rendering should still be supported inside that loop.

This implies a clean split: `humanctl.com` should stay marketing, docs, and sample/demo workspaces; the real product runtime should be local, file-backed, and centered on asks, watches, artifacts, inbox/focus state, and append-only events.

## What Is Most Likely True

- The adjacent market is converging on control-plane and observability language for agents, but those products mostly optimize for telemetry, evaluation, governance, and fleet oversight. [S3, S4, S5, S6, S7, S8]
- User-facing agent systems need shared state, steering, interrupts, streaming, and resumability, not just request/response chat. [S1]
- Human-centered agent UX benefits from co-planning, co-tasking, approvals, and plan/edit loop surfaces. [S15, S17, S19, S20]
- Human interruption has real cognitive cost, so escalation should be compressed, stateful, and easy to dismiss, defer, or correct. [S9, S10, S11, S13, S14]
- Local-first architecture is the right default because the product's real value depends on durable state across local files, local agents, and long-running tasks. [S12, S18]
- V1 should be structured around the unblock loop, not around generic layout freedom or full-blown observability.

## What Is Verified Vs Claimed

### Verified facts

- AG-UI explicitly defines shared state, human-in-the-loop interrupts, agent steering, and tool-output streaming as first-class concepts. [S1]
- Magentic-UI explicitly supports co-planning, co-tasking, action approvals, and monitoring-oriented workflows. [S15, S17]
- The interruption study found that interrupted tasks were completed faster but with increased stress, frustration, time pressure, and effort. [S11]
- Ink & Switch explicitly argues that local-first software treats the local device copy as the primary copy and servers as secondary. [S12]
- Linear explicitly separates inbox notifications from triage review flow. [S13, S14]
- GitHub Copilot Workspace explicitly describes plan/spec/code artifacts as editable and designed to be steered at each stage. [S19, S20]

### Target representations

- Agent 365 represents itself as a control plane for agents with observability, registry, analytics, and governance. [S3]
- Fiddler represents itself as a control plane for AI agents with telemetry, evaluation, monitoring, policy, and governance. [S4]
- Langfuse and LangSmith represent themselves as observability/tracing platforms for agents and LLM applications. [S5, S6, S7, S8]

### Analytical inferences

- `humanctl` should borrow seriousness about state and visibility from control-plane products without copying their primary job-to-be-done.
- The local runtime should be the real product, while the hosted site should be a sample/demo and documentation surface.
- The current generic `thing` model is probably too vague as a product-facing abstraction; `ask`, `artifact`, and `watch` are stronger user-facing objects.
- An inbox/focus model will likely outperform an infinite canvas as the core reviewer surface.

## Key Contradictions And Unknowns

- The branding naturally pulls toward "control plane," while the strongest UX evidence points toward "coordination layer." [S3, S4, S17]
- AG-UI-style openness suggests flexible rendering, while mixed-initiative product patterns suggest structured stages and explicit asks. [S1, S19, S20]
- The current implementation model uses a generic `thing`, but the product may need more semantic object types to stay legible.
- It is still unresolved how much plan editing should be first-class in v1.

## Competing Hypotheses Summary

- H1: `humanctl` is a local mixed-initiative coordination layer for human-in-the-loop agent work. This best fits the evidence.
- H2: `humanctl` is a general local artifact canvas for agent-generated rich media. This is useful as an affordance but weak as the main thesis.
- H3: `humanctl` is a local developer control plane / observability surface for agent runs. This is category-adjacent but not the strongest fit to the motivating problem.

## Practical Implications

- Keep the hosted site clearly separate from the product runtime.
- Make local `.humanctl/` the authoritative store.
- Center the runtime on asks, artifacts, watches, events, and attention state.
- Make live steers a convenience over a durable queue, not the source of truth.
- Bias the human UI toward inbox, focus, compare, answer, snooze, and reopen.
- Let agents render HTML, markdown, images, diffs, and forms, but keep those as payloads within known surfaces rather than as the architecture itself.

## Recommended Next Actions

1. Rewrite the product definition in the repo and site around "local mixed-initiative coordination layer" and stop talking about the hosted `/app` as the actual runtime.
2. Narrow the object model for v1 from generic `thing` toward `ask`, `artifact`, `watch`, `event`, and attention state; keep `thing` only if it remains an internal storage abstraction.
3. Build the real local loop next: `humanctl app`, `humanctl ask`, `humanctl artifact put`, `humanctl watch create`, and a local inbox/focus view with structured answer flows.

## Source Highlights

- AG-UI docs are the best source for user-facing agent interaction primitives. [S1]
- Magentic-UI report is the best source for concrete mixed-initiative agent UX patterns. [S17]
- The interruption paper is the best evidence for why human asks must be small and well-timed. [S11]
- Ink & Switch provides the strongest architectural justification for local-first source of truth. [S12]
- Copilot Workspace is the clearest adjacent example of editable staged steering in a developer workflow. [S19, S20]
