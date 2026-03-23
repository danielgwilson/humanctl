# Notch Recovery Protocol

This doc exists because the notch spike went off the rails once we started using shape math to solve layout problems.

The fix is not "be smarter next time."
The fix is to lock a stricter protocol for how native notch changes are proposed, validated, and accepted.

## The Failure Pattern

We repeatedly changed multiple variables at once:

- shell silhouette
- shoulder width
- content padding
- interaction chin
- visual height
- open-state size
- optical centering

That created fake progress:

- builds passed
- screenshots looked "close enough" in isolation
- but the actual shell regressed

The core mistake was consistent:

**layout problems were being solved with geometry changes**

Examples:

- wanting wider shoulders and changing the black shell silhouette
- wanting better icon centering and changing the shell shape
- wanting a Willow-like feel and improvising bezier curves in native

## Hard Rules

### 1. Shape ownership is explicit

Do not make one shape primitive serve every shell state.

Current ownership:

- `Ambient` owns the boring closed-notch silhouette with small top rounding
- `Peek` owns the reference notch shape

If we need a different silhouette later, it must be approved as a mock first.

### 2. Ambient shape is locked

`Ambient` is not where we experiment with curve language.

Allowed levers:

- ambient host width
- shoulder lane width
- icon size
- badge size
- shoulder spacing
- horizontal inset
- vertical optical offset
- invisible interaction chin

Disallowed levers unless a mock is explicitly approved:

- custom bezier shoulder flare
- bowed sidewalls
- roof shortening
- trapezoid experiments in SwiftUI
- "just a small shape tweak" without a visual spec

### 3. Peek shape starts from the reference

`Peek` should inherit the boring baseline from the reference repo rather than a hand-rolled approximation.

That means:

- copy the reference topology first
- adjust size and padding second
- only tune radii after the baseline is accepted

### 4. One variable per pass

Every visual pass must change exactly one class of variable:

- shape
- width
- inset
- spacing
- optical offset
- interaction slab

If more than one class changed, the pass is invalid.

### 5. Screenshot gate every accepted change

Build success is not acceptance.

Every accepted notch change needs:

1. screenshot
2. explicit accept/reject
3. commit if accepted

Do not keep stacking uncommitted visual tweaks on top of unclear state.

### 6. Native is for platform truth, not silhouette exploration

If we want to explore a new silhouette:

1. mock it outside native first
2. approve the silhouette visually
3. port it into SwiftUI only after it is obviously correct

Do not live-debug bespoke bezier experiments in the native runtime.

## Acceptance Checklist

Treat these as regression gates.

### Ambient

- roof reads flat
- visible shell stays at real notch height
- icons feel optically centered
- shoulders read as left/right lanes, not a banner
- no visible black spill into the app UI below
- whole visible ambient object opens `Peek`

### Peek

- feels like the same object opening downward
- top corners are visibly intentional, not squared-off by accident
- content has enough padding to breathe
- open state does not flash between two different shells

### Platform basics

- menu bar extra is always visible
- standard menu opens
- `Quit humanctl` is always available
- relaunch does not leave stale duplicate processes

## Safe Iteration Order

When the shell feels off, use this order:

1. verify current state against the checklist
2. decide which single variable class is wrong
3. change only that variable class
4. rebuild and relaunch
5. capture screenshot
6. explicitly accept or reject
7. commit if accepted

## Practical Rule

If the instinct is:

- "the shoulders feel wrong"
- "the icons sit low"
- "the notch feels too narrow"
- "the queue badge is tucked under the cutout"

then the likely fix is:

- width
- inset
- lane sizing
- spacing
- optical centering

not:

- bespoke shape math
- new shoulder curves
- custom trapezoid geometry

## Current Reset

The current recovery direction is:

- `Ambient` uses the boring closed-notch silhouette with small top rounding
- `Peek` uses the reference notch shape
- further polishing is layout-first unless a mocked silhouette is explicitly approved
