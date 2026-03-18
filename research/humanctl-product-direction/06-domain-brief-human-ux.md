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
# Domain Brief: Human UX

## Bottom line

The human should be treated as a scarce reviewer, not as a continuously available chat participant. The UX should optimize for minimum useful interruption, low context reload, easy correction, easy dismissal, and durable resumption. [S9, S10, S11, S13, S14, S17]

That means the primary human surface should look more like an inbox plus focus view than a freeform blank canvas. The human needs to see what changed, what needs a response, what can be snoozed, what can be ignored, and what is actually blocking progress. [S11, S13, S14, S17]

## Human attention model

The most relevant research signal here is interruption cost. People may compensate for interruptions by working faster, but the stress, frustration, time pressure, and effort go up. That means "quick question" is not free. The product should assume that each interruption has an opportunity cost and should therefore be aggressively compressed. [S11]

Magentic-UI's explicit design principle is close to the right norm: interrupt the user as little as possible and only when necessary. In the report, the user is asked clarifying questions or help after failures, not dragged into every micro-step. [S17]

The Microsoft human-AI guidelines support the same direction: make capabilities legible, show contextually relevant information, support efficient dismissal and correction, explain why the system behaved as it did, and update cautiously over time. [S9, S10]

## Recommended human-facing primitives

- Inbox: a notification center for new asks, updates, reminders, and reopened items. [S13]
- Focus item: the currently selected ask/blocker, with relevant previews, notes, plan, and answer controls attached.
- Triage state: a way to review incoming items before they become active commitments. [S14]
- Snooze / dismiss / reopen: explicit state changes so agents do not thrash the human. [S13]
- Compare / choose / comment: support side-by-side alternatives and small structured replies rather than forcing prose replies every time. [S17, S19, S20]
- Explain / provenance: enough context to understand why the agent is asking now. [S9, S10]

## Escalation design implications

The existing `log` / `nudge` / `ask` / `block` model is directionally right. It should not just be a label though; it should change presentation and interruption behavior.

- `log`: persists silently, appears in history, no active interruption
- `nudge`: light resurfacing, visible in inbox/focus but intended to be glanceable
- `ask`: explicit response requested, but not necessarily stop-the-world
- `block`: work cannot continue without human input and should be visually obvious

This ladder matches both interruption research and mixed-initiative systems better than treating every agent output as equally important. [S11, S17]

## Recommended v1 human UX

V1 should bias toward a narrow but reliable reviewer loop:

1. Agent creates an ask or watch update.
2. Human sees it in an inbox.
3. Human opens one focus item with all relevant context attached.
4. Human answers with the smallest useful response.
5. The item transitions cleanly to answered, snoozed, dismissed, or blocked.

That is a stronger v1 than a broad dashboard, because it targets the actual bottleneck.

## Strongest evidence

- Interruption research on speed vs stress. [S11]
- Microsoft human-AI guidelines around dismissal, correction, explanation, and cautious adaptation. [S9, S10]
- Linear inbox and triage patterns for attention management. [S13, S14]
- Magentic-UI's minimal-necessary interruption stance. [S17]

## Weakest evidence

- Pure marketing examples from agent-control-plane vendors do not say much about reviewer UX. [S3, S4]

## Unresolved questions

- How much of the inbox should be chronological versus grouped by project/tab/focus state?
- Should compare/choice be a first-class object in v1, or represented as an ask with attachments?
- How much of the agent's plan should be visible by default versus tucked behind a details affordance?

## Local confidence

High on the attention model, medium on the exact surface design.
