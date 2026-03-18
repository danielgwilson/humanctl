# Notch Shell Lessons

This doc exists so we do not have to re-learn the same native notch mistakes.

## The Core Failure

The notch shell got hard because we mixed three different concerns:

- product payload
- shell geometry
- hover/open/close behavior

That produced a UI that looked plausible in screenshots but behaved wrong in use.

The correct model is:

- one persistent shell
- hardware-derived notch geometry
- one compact rendering path
- one expanded rendering path
- payload inserted into that shell

## Rules We Should Not Violate Again

### 1. Do not guess notch geometry

Do not infer notch width from screen width heuristics.

Use:

- `safeAreaInsets.top`
- `auxiliaryTopLeftArea`
- `auxiliaryTopRightArea`

The shell should be derived from the actual screen geometry, not from vibes.

### 2. Do not keep two compact architectures alive at once

We had both:

- a generic compact card/banner
- a more notch-aware compact shell

That was a structural mistake.

There must be one compact renderer only.

### 3. Compact mode is signal, not summary

Closed notch mode only has room for:

- severity
- small count
- maybe one tiny changed indicator

It does not have room for:

- headlines
- detail sentences
- metadata footers
- queue explanations
- timestamps

If it needs more than a glance, it belongs in expanded mode.

### 4. Compact mode must match the notch

The compact surface should read like hardware-adjacent chrome.

That means:

- black background
- notch-height constraints
- minimal content
- attached to the camera/notch band

It should not look like:

- a pill
- a floating banner
- a mini dashboard card

### 5. Placement rect and hit region are not the same thing

The panel can be rectangular for hosting.
The interaction region cannot just be `panel.frame`.

Hover, click-away, and close behavior must use the visible shell region, not the full transparent host window.

If we forget this, we get:

- giant invisible hover zones
- edge jitter
- weird vertical/offscreen hit behavior

### 6. Open state must be the same object as closed state

Expanded mode should feel like the shell grew.

It should not feel like:

- ambient widget up top
- unrelated popup below

The user should perceive one physical object in two states.

### 7. The shell needs a real state machine

One `hoverRegion` bit was not enough.

We need distinct concepts for:

- pointer inside host
- pointer inside compact interactive region
- pointer inside expanded interactive region
- stable anchor screen while visible

Otherwise ambient exit and expanded enter fight each other during animation.

### 8. Do not let live mouse position choose the screen on every render

The target display should be stable while the shell is visible.

Do not retarget the shell to `screenContainingMouse` on every update.

That causes:

- jitter near display boundaries
- weird restores
- shells appearing to jump

### 9. Stop rebuilding the view tree on every snapshot

The panel controller should manage:

- frame
- visibility
- monitors

The SwiftUI root should stay stable and observe the store.

Rebuilding root views during interaction makes hover continuity brittle.

### 10. Keep the first spike shell-only

Do not mix in:

- full app context windows
- freeform writing flows
- real `.humanctl` persistence
- artifact browsing

until the shell itself feels correct.

The shell UX comes first.

## Practical Debugging Notes

### Stale process gotcha

During the reset, a stale `HumanctlNotch` process made it look like code changes were not working.

The safe launch path is:

```bash
pkill -x HumanctlNotch || true
open -a /Users/danielgwilson/local_git/humanctl/native/macos/.deriveddata/Build/Products/Debug/HumanctlNotch.app
```

Or just:

```bash
cd /Users/danielgwilson/local_git/humanctl
npm run native:open
```

`native:open` should continue to kill stale instances first.

### Status item expectations

The menu bar item should behave like a normal menu bar extra:

- click opens a standard menu
- the menu contains a notch toggle action
- the menu always contains `Quit`

If quitting the app is awkward, that is a product-quality failure, not a small papercut.

## Current Reset Direction

What we are building now:

- one native shell
- one compact state
- one expanded state
- one fixed sample payload only
- menu bar extra as the only control surface outside the shell

What we are not building yet:

- full `humanctl` integration
- context window complexity
- real multi-surface workflow
- rich payload authoring

## Short Version

If the notch shell feels wrong, check this list first:

1. Are we measuring the real notch?
2. Do we only have one compact renderer?
3. Is compact mode black and notch-height only?
4. Are we using visible shell hit-testing instead of panel-frame hit-testing?
5. Does expanded mode feel like the same object?
6. Is the anchor screen stable while visible?
7. Can the user quit it like a normal app?

## Current Baseline Contract

The current spike is intentionally more austere than the product will be later.

That is on purpose.

Right now the contract is:

- compact state is just a black notch shell with a tiny signal dot
- expanded state is just a larger attached black shell
- no gradients
- no borders
- no shadows
- no text or controls rendered inside the shell yet
- one fixed sample payload exists only to keep the shell visible
- the menu bar extra is always the escape hatch for `Toggle Notch` and `Quit HumanctlNotch`

If we break any of those while adding polish later, we should treat that as regression, not progress.
