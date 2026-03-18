# Competing Hypotheses

## H1

### Description

`humanctl` is a local mixed-initiative coordination layer for human-in-the-loop agent work. Its primary job is to help agents package blockers, surface the right context, request the smallest useful human input, and resume from durable local state.

### Supporting Evidence

- AG-UI identifies shared state, interrupts, steering, tool-output rendering, and resumability as core primitives for user-facing agents. [S1]
- Magentic-UI shows co-planning, co-tasking, action approvals, monitoring, and human-centered oversight as concrete interaction patterns. [S15, S17]
- Interruption research suggests the human UX should optimize for compressed, high-value asks rather than repeated context reloads. [S11]
- Local-first principles strongly support keeping the primary state local when the product is meant to bridge local agents, files, and long-running tasks. [S12]
- Copilot Workspace shows that editable staged artifacts are an effective developer steering model. [S19, S20]

### Disconfirming Evidence

- The "control plane" category is gaining mindshare, and `humanctl` branding naturally gravitates toward that language even if the actual product loop is narrower. [S3, S4, S5, S7]
- A highly flexible tab/panel/artifact model could still pull the product toward a more general workspace identity.

### Unresolved Questions

- Whether the primary user-facing object should be an ask, packet, item, or thing.
- Whether v1 needs a visible plan editor or only a simpler ask/artifact model.

## H2

### Description

`humanctl` is a general local surface for agent-generated rich media, previews, dashboards, forms, and mini-apps, with human response as one use case among many.

### Supporting Evidence

- HTML is a strong payload for agents and already a natural output format in current workflows.
- AG-UI's generative UI and shared-state ideas support arbitrary rich rendering. [S1]
- The early concept discussions repeatedly gravitated toward tabs, panels, canvases, and arbitrary things.

### Disconfirming Evidence

- The user need that repeatedly surfaced was not "agents need a better canvas"; it was "agents get stuck on humans and need a better unblock surface."
- Interruption research and mixed-initiative evidence both point toward structure and reviewer throughput, not pure openness. [S11, S17]
- Infinite-canvas or generic workspace positioning risks becoming vague for agents and humans alike.

### Unresolved Questions

- How much rendering flexibility is enough before the product loses its core identity?
- Should arbitrary layout be a later capability rather than the starting point?

## H3

### Description

`humanctl` is a developer-facing local control plane / observability dashboard for tracing, runs, statuses, and oversight of agents.

### Supporting Evidence

- Adjacent products increasingly use control-plane, observability, tracing, monitoring, and governance language. [S3, S4, S5, S6, S7, S8]
- Agent runs, watches, and durable events will matter to the implementation.
- The `ctl` suffix and branding naturally invite this interpretation.

### Disconfirming Evidence

- The strongest evidence-backed product need is human unblock coordination, not fleet telemetry.
- Langfuse, LangSmith, Fiddler, and Agent 365 already occupy much of the observability/control-plane layer. [S3, S4, S5, S7]
- A trace-first dashboard does not solve the actual local reviewer bottleneck nearly as well as an ask/inbox/focus model.

### Unresolved Questions

- How much run/state observability should v1 expose for debugging without becoming the whole product?
- Should "control plane" remain brand language even if the runtime behaves more like a coordination layer?

## Current Best Explanation

H1 is the strongest explanation.

It best matches the motivating pain, aligns with mixed-initiative research, explains why local-first matters, and gives a clean reason for the product to exist beyond generic dashboards or arbitrary HTML surfaces. H2 remains a useful implementation affordance, not the thesis. H3 remains a useful category-adjacent framing for seriousness and visibility, not the core job.

## What Would Change The View Fastest

- Clear evidence that users primarily want agent-run monitoring/tracing rather than reviewer coordination would strengthen H3.
- Clear evidence that users mainly value a persistent agent-rendered dashboard/canvas with minimal human-response workflow would strengthen H2.
- Successful early usage centered on asks, approvals, comparisons, and resumable watch items would further strengthen H1.
