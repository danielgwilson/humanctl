# `humanctl` as a Control Layer

## Why this doc exists

The chief-of-staff / executive-office analogy is useful, but it is still only an analogy.

This document states the simpler, more general model underneath it.

## The simplifying idea

Agents are not primarily trying to "show the human things."

They are trying to obtain missing human-supplied control inputs needed to keep the system aligned and moving.

That is the core abstraction.

## The generalized model

A human is a scarce control resource inside a larger agentic system.

The job of the agent layer is to:

1. infer when human input is actually needed
2. minimize the cost of obtaining that input
3. choose the best format and channel for getting it
4. preserve the answer as durable state
5. continue execution from that state

In this model:

- a memo is a control-acquisition artifact
- a dashboard is a control-acquisition artifact
- a screenshot is a control-acquisition artifact
- a voice nudge is a control-acquisition artifact
- a transcript excerpt is a control-acquisition artifact
- an HTML page is a control-acquisition artifact

These are all interventions optimized to elicit the right control signal from the human.

## What the human provides

The human is not in the loop for everything.

The human is the source of authority when the system encounters:

- ambiguity
- conflicting objectives
- missing preference data
- elevated risk
- taste or approval boundaries
- delegated-authority limits

So the deeper model is not "ask the human whenever work exists."

It is:

> acquire human authority only when it is needed, and do so in the cheapest effective way.

## Why "just another chat" is insufficient

A single supervisor-agent chat has real value because agents are often the best compression instrument for other agents.

But chat alone does not fully solve:

- interruption policy
- durable shared state
- artifact memory
- multimodal presentation
- resumability across sessions
- a clear drill-down path from summary to evidence

So the fuller stack is:

- workers produce raw work
- a coordinator compresses and prioritizes it
- a control layer decides whether human authority is needed
- the system presents the minimum effective intervention
- the answer is recorded as durable state
- execution resumes

## How the org analogy maps

The company analogy still holds, but the mapping is more precise if written this way:

- workers
  - execute tasks
  - emit checkpoints, artifacts, and blockers
- chief-of-staff / briefing layer
  - synthesizes worker output
  - chooses reporting format
  - routes attention
  - escalates exceptions
- executive
  - handles decisions, priorities, approvals, and corrections
  - drills down only when needed

This means the executive should not:

- look over every worker's shoulder
- keep every execution container alive manually
- hold ad hoc 1:1s with every thread

And it means the CoS layer should not be a static dashboard.

It should be free to produce:

- memos
- TL;DRs
- screenshots
- callouts
- side-by-side comparisons
- dashboards
- slides
- transcript excerpts
- voice updates

The right output is the one that gets the needed control input with the least cost.

## What the system must preserve

If the system is going to act like a real executive operating layer, the durable unit cannot be "the thread."

The durable unit has to be something closer to a checkpoint.

At minimum, a meaningful checkpoint should preserve:

- goal
- current status
- what changed
- blockers
- recommended next step
- linked artifacts
- what decision, if any, is needed
- how to resume

This is why:

> the session is not the work  
> the checkpoint is the work

## How the surfaces map

This model does not imply one fixed interface.

It implies a stack of surfaces with different jobs:

- ambient surface
  - menu bar, notch tray, phone lock screen, watch, glasses, or voice cue
  - job: answer "do I need your attention right now?"
- interrupt surface
  - a compact brief, decision sheet, or heads-up panel
  - job: obtain the minimum useful control input
- deep workspace
  - canvas, dashboard, transcript, diff, slide, or artifact view
  - job: support drill-down when the brief is not enough

So the deeper rule is not "everything belongs in the dashboard."

It is:

> use the cheapest surface that can successfully obtain the needed control input.

## The practical product consequence

`humanctl` should not be thought of only as:

- a dashboard
- a canvas
- a supervisor chat
- a notification layer

It is more generally:

> a control layer for human authority in agentic systems

Or, more operationally:

> a runtime for acquiring, routing, and applying human control inputs

The chief-of-staff metaphor is still useful because it is human-legible.

But the underlying mechanism is about control, authority, escalation, and resumable state.

## Short version

If the product thesis needs to collapse to one sentence, it should be this:

> `humanctl` decides when human authority is needed, chooses how to obtain it, and turns the answer into durable state that agents can act on.
