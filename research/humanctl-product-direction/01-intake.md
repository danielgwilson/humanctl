# Intake Brief

## Target

- Name: `humanctl`
- Type: Local-first product concept and open-source agent tool
- URL(s):
  - [https://humanctl.com](https://humanctl.com)
  - [https://github.com/danielgwilson/humanctl](https://github.com/danielgwilson/humanctl)

## User Goal

- Why this research matters:
  - The concept has strong energy and branding, but the underlying product shape is still drifting between several categories: agent dashboard, shared canvas, escalation queue, local control plane, artifact workspace, and human-in-the-loop operating surface.
  - Further implementation without clarifying the actual job-to-be-done risks building the wrong substrate.
- Decision to support:
  - Define what `humanctl` actually is.
  - Decide what the local runtime should optimize for.
  - Decide what the hosted site should and should not be.
  - Decide what v1 should include and what it should explicitly exclude.

## Key Questions

1. Is `humanctl` best understood as an async escalation layer for agents, a general shared canvas, a local agent observability surface, or a hybrid?
2. What are the core human UX primitives that reduce stall without causing unnecessary interruption?
3. What are the core agent UX primitives that make it cheap for coding agents to show, ask, watch, and resume?
4. What should be the source of truth: local files, app state, cloud state, or some combination?
5. What is the smallest durable object model that still supports rich media, live updates, and structured human input?
6. What product patterns should `humanctl` borrow from adjacent systems, and which patterns should it reject?
7. What should the hosted `humanctl.com` experience be relative to the actual local product runtime?

## Initial Hypotheses

- H1: `humanctl` is primarily a local mixed-initiative coordination layer for human-in-the-loop agent work.
- H2: `humanctl` is primarily a flexible local artifact canvas where agents can render anything and humans can respond.
- H3: `humanctl` is primarily a developer-facing control plane or observability surface for monitoring agent activity.

## Scope

- Time horizon: Near-term product direction and v1 architecture, with a light view toward future expansion.
- Geography: General software market, with emphasis on English-language product and research sources.
- Domains to prioritize:
  - human-AI interaction guidance
  - mixed-initiative agent UX
  - interruption and attention management
  - local-first software architecture
  - agent control-plane / observability category patterns
  - adjacent workflow patterns such as inbox and triage
- Domains to exclude:
  - enterprise procurement economics
  - detailed monetization strategy
  - broad consumer AI companion products
  - heavy technical implementation comparisons unrelated to the core interaction model

## Output Expectations

- Mode: `full-pack`
- Desired final deliverable:
  - A decision-ready product-direction pack with explicit rival hypotheses, evidence-backed design implications, and recommended v1 scope.
- Deadline / urgency:
  - Immediate. This research is intended to guide the next product iteration before more core UX and architecture are implemented.
