# Research Plan

## Main Question

What product is `humanctl`, really, if it is optimized for helping agents avoid getting stuck on a scarce human reviewer?

## Decision Context

- The current concept has unusually strong branding and emotional clarity, but the product definition is unstable.
- The architecture question is material: a hosted dashboard, a local-first workspace, and an agent protocol surface imply different object models and UX priorities.
- The immediate decision is not "what features should we add?" but "what loop should the product own?"

## Issue Tree

- Identity / positioning
  - Is `humanctl` a control plane, a coordination layer, a workspace, an inbox, or a protocol?
  - What is the core sentence that is true without relying on jokes?
- Product / offering
  - What is the primary object: ask, task, tab, artifact, thread, or event?
  - What are the native actions for agents and humans?
  - How structured should the UX be versus open-ended?
- Human UX
  - How should interruptions be packaged?
  - What attention states matter?
  - Which patterns reduce context reload and reviewer friction?
- Agent UX
  - What write interface should agents target?
  - How much schema is enough?
  - What needs stable IDs, resumability, and live steering?
- Technical architecture
  - What belongs in local files versus an app index or cache?
  - What should the local runtime do?
  - What role, if any, should hosted state play?
- Market / adjacent products
  - Which nearby categories already exist?
  - Where is the white space?
  - Which borrowed patterns are beneficial versus misleading?

## Priority Questions

1. What loop should `humanctl` own end to end?
2. What minimal object model supports that loop without overfitting?
3. What are the strongest reasons to choose local-first as the source of truth?
4. What patterns from mixed-initiative and human-AI research should directly shape the UX?
5. Which adjacent category should inform the language, and which should only inform implementation patterns?

## Source Classes

- Primary:
  - official docs/specs for AG-UI, LangSmith, Langfuse, Linear, Ink & Switch
  - official Microsoft Research papers/blog posts for Magentic-UI, Tell me When, and human-AI guidelines
  - peer-reviewed interruption research
- First-party self-report:
  - product marketing pages for Agent 365, Fiddler, GitHub Copilot Workspace
- Secondary:
  - narrow supporting explainers only if they add context not present in primary sources
- Weak-signal / rumor:
  - avoid unless needed to explain perception, not truth

## Minimum Evidence Thresholds

- Material factual claims:
  - Prefer official docs, papers, or product pages.
- Revenue / customer claims:
  - Out of scope unless directly relevant to product direction.
- Technical architecture claims:
  - Prefer specs, docs, open-source repos, or research reports over marketing summaries.

## Rival Hypotheses

- H1: `humanctl` is a local mixed-initiative escalation layer for agent-to-human coordination.
- H2: `humanctl` is a general-purpose local surface for agent-generated rich media and app-like artifacts.
- H3: `humanctl` is a local developer control plane for traces, runs, alerts, and oversight of agent activity.

## Planned Outputs

- Files to create:
  - full source inventory
  - claim ledger
  - domain briefs for product shape, human UX, agent UX, local architecture, and competition
  - contradiction matrix
  - competing hypotheses memo
  - BLUF-first final rollup
- Visuals or tables needed:
  - source inventory CSV
  - claim ledger CSV
  - contradiction matrix CSV
  - concise recommended v1 model in prose
