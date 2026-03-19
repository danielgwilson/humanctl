# Notch Next Spec

This doc captures the next intentional layer above the current shell-only baseline.

The baseline shell contract still lives in [docs/notch-shell-contract.md](./notch-shell-contract.md).
This doc describes what should come next once we start adding meaning back into the shell.

## State Model

Use state names based on **job**, not size.

- `Ambient`
- `Peek`
- `Workspace`

Why:

- `mini` / `full` only describe size
- `expanded` / `maximized` sound like window management
- `Ambient` / `Peek` / `Workspace` describe user intent

## Surface Roles

### Ambient

The always-on notch state.

Job:

- signal that something wants attention
- show where it is coming from
- show roughly how much attention is waiting
- stay readable at a glance

Ambient must remain notch-height only.

### Peek

The quick interrupt surface.

Job:

- reveal one bounded decision
- let the human act quickly
- keep interruption cost low

Peek should feel like the same notch object opening downward.

### Workspace

The deep handoff surface.

Job:

- open the relevant context when the quick decision is not enough
- preserve drill-down, artifacts, and thread context

`Workspace` does **not** need to be a fully native `humanctl` window in v1.

It can simply route to:

- the relevant Codex thread
- the relevant Claude Code/OpenCode/Pi harness
- the relevant artifact or local app page

## Ambient Layout

Ambient should use the notch shoulders, not sentence text.

Recommended layout:

- left shoulder: source harness icon for the top pending interrupt
- optional tiny badge on the left icon: active thread count for that harness
- center: real notch dead zone stays visually dead
- right shoulder: queue count plus urgency/status glyph

Example shape:

`HARNESS_ICON[3] | NOTCH | 2 + BLOCK_DOT`

See [docs/source-identity.md](./source-identity.md) for the harness-vs-host model and the initial support matrix.

Rules:

- no prose in Ambient
- no timestamps
- no metadata strings
- no scrolling
- no rotating feed behavior just because multiple harnesses exist

If the top-of-queue owner changes, the Ambient source may change.
It should not cycle continuously for decoration.

## Peek Layout

Peek is the first real decision surface.

It should answer:

1. what wants my attention?
2. what is the recommended next move?
3. do I need to go deeper?

For the first meaningful `Peek`, keep it narrow:

- top harness identity
- one-line ask or blocker
- one recommended action
- one alternate or snooze path
- one `Open workspace` / `Open context` action

Do not make `Peek` a dashboard.

## Menu Bar Role

If the notch is the primary attention surface, the menu bar must become a utility handle.

Recommended menu bar behavior:

- icon-only `humanctl` glyph
- optional tiny dot/badge when blocked
- opens menu
- gives access to:
  - toggle notch
  - settings
  - quit

The menu bar item should **not** be the main information surface.

It is also **not** the right place to expose host identity as primary meaning.

The notch shoulders should carry source identity.

## Interaction Model

Recommended interactions:

- click Ambient -> open `Peek`
- click away from `Peek` -> close
- `Esc` while `Peek` is open -> close
- menu bar icon -> open standard control menu
- hotkey -> open `Peek`

Do **not** make hover the primary affordance.

Hover can be explored later as optional polish, but the primary model should be explicit and predictable.

## Hotkey Policy

Default recommendation:

- `⌥Space`

Why:

- low effort
- one-hand
- fits the product thesis of minimizing human cost

But:

- do not silently steal it
- detect conflicts during setup
- require an explicit user choice if unavailable

Recommended setup flow:

1. propose `⌥Space`
2. test whether it can be claimed
3. if it conflicts, present fallback options
4. require explicit confirmation

Recommended fallback ideas:

- `⌥⇧Space`
- user-defined custom chord

Avoid choosing an annoying but "safe" shortcut by default.

The point of `humanctl` is low-friction human interruption when warranted.

## Workspace v1

`Workspace` in v1 should be a handoff, not a full rebuild of the world.

Recommended first version:

- `Open workspace` deep-links into the relevant source surface
- if the ask came from Codex, open the Codex thread
- if the ask came from a local artifact, open the artifact
- if the ask came from another harness, focus that harness

This keeps `humanctl` acting like a chief of staff rather than trying to become every app at once.

## What Ambient Must Never Become

Avoid these failure modes:

- a status dashboard
- a rotating banner
- a sentence-based mini app
- a widget mall
- a second menu bar inside the notch

Ambient is for:

- source
- count
- urgency

Nothing more unless the added signal clearly pays for itself.

## Implementation Direction

When we start adding content above the black shell baseline:

1. keep the shell geometry and state machine stable
2. add icon-only menu bar control
3. layer in Ambient shoulders
4. switch primary interaction to click and hotkey
5. add a minimal Peek
6. keep Workspace as a handoff first

That order matters.

The shell should not be destabilized again by trying to add too much product meaning at once.
