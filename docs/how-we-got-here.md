# How We Got Here

This doc exists because `humanctl` did not start with its current shape.

The product got sharper by passing through several different lenses.

This is the shortest honest record of that evolution.

## 1. Shared Surface / Dashboard

The first instinct was:

- agents need a shared place to show work
- humans need a persistent dashboard instead of disposable HTML files
- a canvas, tab system, or artifact board could make that easier

This was directionally right, but incomplete.

Why it was not enough:

- it focused on display more than interruption
- it treated the human as a viewer more than a scarce control resource
- it risked becoming “another dashboard” instead of a product with a sharp job

What survived from this phase:

- durable local state
- artifact memory
- working canvas / artifact surface
- openness to rich payloads like HTML, screenshots, and comparisons

## 2. Chief Of Staff / Attention Router

The next improvement was realizing the product was not really a dashboard.

It was closer to:

- a chief of staff
- an executive briefing layer
- an attention router for a scarce human

This was a major upgrade because it shifted the question from:

- “where do agents put things?”

to:

- “how do agents get the right human decision with the least attention cost?”

Why this lens was better:

- it centered interruption, triage, and resumption
- it matched the real problem of many concurrent agent threads
- it made queue discipline and escalation policy feel central

What survived from this phase:

- `humanctl` as local chief-of-staff infrastructure for agents
- the idea of `Ambient / Peek / Workspace`
- the idea that the system should feel disciplined, not spammy

## 3. Control Layer

The next simplification went deeper.

Agents are not mainly trying to “show the human things.”

They are trying to obtain missing human-supplied control inputs needed to keep the system aligned and moving.

This reframed `humanctl` as:

- a runtime for acquiring, routing, and applying human control inputs
- a control layer for human authority in agentic systems

This mattered because it generalized the product:

- a memo
- a screenshot
- a dashboard
- a transcript excerpt
- a voice nudge
- an HTML page

are all just different interventions optimized to elicit the right control signal.

What survived from this phase:

- the human as a scarce authority source
- checkpoint-first thinking
- the rule that the session is not the work, the checkpoint is the work
- the use of the cheapest surface that can obtain the needed control input

## 4. Notch / Surface Stack

From there, the surface model got clearer.

There is not one interface.

There is a stack of surfaces with different jobs:

- `Ambient`
  - do I need your attention right now?
- `Peek`
  - here is the smallest useful decision surface
- `Workspace`
  - here is the deeper drill-down when needed

This helped separate:

- shell UX
- interruption policy
- deep context/workspace

It also made it easier to keep the notch exploration narrow and sane.

What survived from this phase:

- menu bar as utility handle
- notch as ambient + interrupt
- workspace as a deeper handoff surface

## 5. The Current Synthesis

The current stance is:

> `humanctl` should be rigid about control flow, permissive about payloads.

Or more compactly:

> closed protocol, open payloads

This is the middle path between two bad extremes.

### Too opinionated

If `humanctl` dictates the whole presentation end-to-end:

- agents get handicapped
- weird but effective presentations are ruled out
- the system cannot adapt to what actually works for a given human

### Too open

If `humanctl` is pure blank canvas:

- interruption quality gets inconsistent
- provenance gets muddy
- trust degrades
- resume semantics get sloppy
- the product turns into chaos

### The right split

`humanctl` should be **opinionated about human factors and system integrity**:

- who may interrupt
- when
- how often
- escalation levels
- identity and provenance
- response controls
- durable state and resume semantics
- surface lifecycle

And it should be **open about artifacts and rendering**:

- HTML dashboards
- screenshots
- transcripts
- comparisons
- slide-like payloads
- custom visual explanations
- whatever else an agent learns is effective for this human

That is the current product philosophy.

## What We Believe Now

The product is not best thought of as:

- a dashboard
- a canvas
- a chat client
- a notification layer

It is best thought of as:

- a local control layer for human authority
- an attention router for a scarce human
- chief-of-staff infrastructure for agents

And in practical UI terms:

- strict `Ambient`
- mostly strict `Peek`
- open `Workspace`

## Short Version

If this whole evolution needs to collapse to a few lines, it is this:

1. A dashboard alone was too shallow.
2. A chief-of-staff model made the interruption loop clear.
3. A control-layer model made the abstraction cleaner.
4. A notch/surface stack made the UI responsibilities clearer.
5. The right product stance is now:

> closed protocol, open payloads
