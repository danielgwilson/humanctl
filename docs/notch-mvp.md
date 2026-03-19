# `humanctl` Notch MVP

This doc captures the early notch direction.

The more current naming and interaction model now lives in [docs/notch-next-spec.md](./notch-next-spec.md):

- `Ambient`
- `Peek`
- `Workspace`

When these docs conflict, prefer `notch-next-spec.md`.

## Purpose

If `humanctl` explores a Mac notch surface, it should do one job well:

> get one decision from a busy human with the least possible interruption cost

This is an ambient and interrupt surface, not the full product.

The notch should answer:

- do I need your attention right now?
- what is the one thing you need to decide?
- do you want to answer here or open deeper context?

## Product model

Use the notch for triage, not work.

The split should be:

- ambient notch
  - awareness
  - queue state
  - urgency
- peek interrupt sheet
  - one bounded decision
  - one recommendation
  - quick response controls
- workspace
  - drill-down
  - artifacts
  - canvas
  - history
  - policy

The notch is not the briefing room.

It is the tap on the shoulder and the executive brief.

## What belongs in the ambient notch state

Keep this glanceable in under two seconds.

Show only:

- attention count
  - blocked now
  - waiting
  - digest later
- top-line status
  - `1 blocker needs a decision`
  - `2 items changed since last seen`
- severity
  - `nudge`
  - `ask`
  - `block`
- state hint
  - muted
  - snoozed
  - busy-aware

Do not show:

- full text
- option lists
- artifact previews
- multiple active asks at once
- rotating feed content

## What belongs in the expanded interrupt sheet

This is the real notch UI.

It should answer:

1. what do you need from me?
2. why now?
3. what happens if I ignore this?
4. what do you recommend?

Minimum contents:

- one-line ask
- short why-now line
- one recommended action
- up to two alternatives
- always-available freeform reply
- tiny metadata strip
  - source agent
  - changed since
  - linked artifact count
- actions
  - `Approve`
  - `Pick option`
  - `Snooze`
  - `Open context`

Rules:

- one bounded decision per sheet
- no scrolling for the core choice
- keyboard-first response path
- freeform override always available

Do not put these in the sheet by default:

- long logs
- transcripts
- multiple diffs
- full dashboards
- multiple interrupt threads

## When to hand off to the full app

Open the full app only when:

- more than one artifact is needed
- side-by-side comparison matters
- transcript or diff inspection is required
- the answer is not bounded
- the human explicitly wants detail
- something should remain pinned or revisit-able later

Rule of thumb:

- notch = attention + decision
- full app = inspection + memory

## Technical stack

Use a SwiftUI app with an AppKit shell.

Recommended shape:

- SwiftUI `App`
- `NSApplicationDelegateAdaptor`
- `NSStatusItem` for always-on runtime presence
- custom `NSPanel` for the notch surface
- SwiftUI views hosted inside the panel
- normal app window for the deeper workspace

Why:

- SwiftUI is good for the rendered surfaces
- AppKit is the right place to control window behavior, focus, levels, positioning, and screen changes

## Windowing model

Use notch-aware floating panels, not a fake full app window and not a system-private notch integration.

Recommended primitives:

- `NSPanel`
- `NSWindow.StyleMask.nonactivatingPanel`
- `becomesKeyOnlyIfNeeded`
- `isFloatingPanel`
- `NSWindow.Level.floating`

Position using screen geometry:

- `NSScreen.safeAreaInsets`
- `NSScreen.auxiliaryTopLeftArea`
- `NSScreen.visibleFrame`

Treat the notch as geometry, not as a dedicated OS extension point.

## Animation model

Only three states:

- ambient
- interrupt
- open-workspace

Animate with:

- frame and height changes
- opacity
- slight vertical movement
- corner radius changes if needed

Avoid:

- heavy spring gimmicks
- continuous pulsing
- novelty morphing
- a fake iPhone Dynamic Island imitation

## Behavior rules

Do:

- default to non-activating
- pause aggressive behavior during fullscreen and DND-like contexts
- respect `prefers-reduced-motion`
- remember seen, snoozed, and answered state
- show only materially changed items again

Do not:

- steal focus for low-severity asks
- reopen identical interrupts repeatedly
- turn the notch into a widget mall
- load it up with media/player/dashboard clutter
- require extra permissions in v1 unless truly necessary

## Multi-display and fullscreen caveats

This is where complexity lives.

Important constraints:

- only show the notch tray on the display where it actually makes sense
- recompute geometry when displays or Spaces change
- be conservative in fullscreen apps
- do not assume one coordinate system is stable across all contexts

Possible later behavior:

- ambient state may survive across Spaces
- interrupt state should be policy-gated
- deeper workspace should be a normal app window

## What to build first

1. menu bar runtime
2. one notch tray
3. ambient collapsed state
4. one interrupt sheet
5. quick actions plus freeform reply
6. `Open context` handoff into workspace

## What not to build first

- multiple concurrent notch cards
- voice in the notch
- transcript readers in the dropdown
- live dashboards inside the notch
- cross-device sync
- many-channel escalation logic
- clever feature breadth modeled after notch utility apps

## Practical conclusion

The notch concept is good for `humanctl` if it stays narrow.

The right mental model is:

- menu bar = runtime anchor
- notch = ambient + interrupt
- full app = briefing room

If this becomes a dashboard in the notch, it will get worse, not better.
