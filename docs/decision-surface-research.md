# Decision Surface Research

## Working conclusion

The ask surface should behave like a **decision brief**, not a dashboard.

That means:

- put the bottom line up front
- show one bounded decision at a time
- make the primary response obvious within a single viewport
- collapse or defer secondary detail
- always provide a freeform reply path for "none of the above" context

## Evidence

### 1. Notifications should match urgency and actionability

NN/g distinguishes between passive notifications and action-required notifications. Action-required notifications should be intrusive only when they genuinely require action, while passive notifications should be less intrusive and easy to ignore.

It also notes that notifications need more context than validation messages because they are often not the immediate result of a user action.

Implication for `humanctl`:

- reserve interrupt surfaces for decisions that genuinely need a response
- include enough context to explain why the interrupt appeared
- do not treat every ask like a full workspace

Source:

- [NN/g: Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/)

### 2. Compact actionable cards work best when designed narrow-first

Microsoft’s actionable-card guidance explicitly recommends designing for a narrow screen first and using collapsible containers for secondary detail.

Implication for `humanctl`:

- the main ask surface should be readable as a compact card
- secondary detail should be progressively disclosed
- one-screen usability matters more than spacious composition

Source:

- [Microsoft Learn: Designing Outlook Actionable Message cards](https://learn.microsoft.com/en-us/outlook/actionable-messages/adaptive-card)

### 3. Decision-makers want BLUF, recommendation, and rationale

AAAS’s one-page briefing memo guidance for executive-branch decision-makers emphasizes:

- brevity
- a single main point
- a bottom-line-up-front summary
- recommendation plus rationale near the start
- only the minimum background needed to support the decision

Implication for `humanctl`:

- lead with the question and recommended response
- keep background subordinate
- avoid broad monitoring/dashboard framing inside an interrupt

Source:

- [AAAS: One-page briefing memorandum](https://www.aaaspolicyfellowships.org/blog/how-write-one-page-briefing-memorandum-your-aaas-stpf-executive-branch-semi-finalist-interview)

### 4. Attention is a scarce resource and urgency-based distribution helps

Recent MR notification research found that urgency-based notification placement reduced mental workload, temporal workload, and frustration while maintaining comparable awareness. The broader principle is that user attention should be treated as a scarce cognitive resource, and non-urgent items should stay peripheral.

Implication for `humanctl`:

- non-urgent asks belong in inbox/queue, not in the main interrupt surface
- the interrupt view should show only the active decision and the minimum context needed to answer it
- queue and history should be demoted below the main surface

Source:

- [Non-urgent Messages Do Not Jump into My Headset Suddenly!](https://arxiv.org/html/2603.05893v1)

## Product rules derived from the research

1. One interrupt, one decision.
2. Prompt first, not branding first.
3. Recommended action should be visually obvious.
4. Alternative actions should remain available but compact.
5. Freeform reply is mandatory.
6. Context should be linkable and expandable, not always expanded.
7. Queue, watches, and activity are support surfaces, not the interrupt itself.
