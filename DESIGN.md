# Humanctl interface

Humanctl is an attention router for one human supervising many coding-agent
sessions. The interface must answer three questions quickly:

1. What needs me?
2. What changed?
3. What can I do next?

When a visible element does not improve one of those answers, remove it.

## Authority

- [UI foundation contract](./docs/ui-foundation-contract.md) defines package
  ownership, the runtime and viewport seams, geometry, loading, accessibility,
  debt, and acceptance gates.
- [Frontend reset behavior ledger](./docs/frontend-reset-behavior-ledger.md)
  defines behavior that must survive the renderer replacement.
- [Design system](./docs/design-system.md) summarizes the active visual rules
  implemented in `packages/ui`.
- [Performance](./docs/perf.md) defines the measured release budgets.

`packages/ui` is the only visual owner. The Electron renderer contains a
runtime adapter and a thin viewport adapter. It does not maintain a second
design system.

## One owner per signal

Every signal has one visible owner per screen. A compact digest may link to a
detailed owner, but it must not reproduce the detail.

| Signal | Owner |
|---|---|
| Ranked work requiring the human | Inbox list |
| Complete recent session inventory | Sessions view |
| Spend, tokens, and quota detail | Metrics view |
| Fleet distribution | Fleet view |
| Session conversation and pending asks | Session detail |
| Global fleet and quota digest | Bottom status band |
| Persisted preferences | Settings view |
| Chief-of-staff conversation | Chief-of-staff overlay |

A new count, digest, status, or action requires naming its owner in the PR. If
the same signal already exists on that screen, delete one of them.

## Product vocabulary

Session states are `running`, `needs input`, `blocked`, `idle`, and `complete`.
Freshness tiers are `hot`, `drifting`, and `archived`. Note levels are `fyi`,
`review`, `blocked`, and `done`. Note levels never become session states.

State is never color alone. A state treatment includes a text label and a
semantic mark. Harness identity is conveyed by text and a neutral mark, not by
assigning a harness its own interface color.

## Visual direction

- Neutral surfaces carry structure. Blue owns selection, focus, links, and the
  primary action.
- Space Grotesk is the primary face. JetBrains Mono is limited to paths, IDs,
  timestamps, numeric telemetry, and keyboard hints.
- Controls are 28px or 32px high. Top chrome is 44px. The navigation rail is
  256px.
- Lists are continuous flat fields separated by hairline rules. No cards.
- In-flow content has no shadow. Only floating overlays may cast a shadow.
- Each visible region has at most one filled primary action.
- Light and dark themes are first-class and independently checked.
- The shell and resource-specific skeletons paint immediately. Sessions,
  inbox, status, quota, skills, budget, and timeline load independently.
- A desktop launch shows the compiled application version immediately. It
  never shows fixture labeling while status is loading.

## Rows and detail

Session and Inbox rows prioritize title, state, the message to the human,
recency, and compact metadata. Rows remain keyboard-operable and virtualized at
real fleet size. Complete content belongs in detail, not in taller list rows.

Session detail uses one package-owned block in split and full-width contexts.
It has one vertical body scroll owner. Notes, summary, conversation, pending
ask, and composer do not create nested scroll traps. Prose may have a reading
width; the detail block itself stays aligned to its pane.

## Interaction and accessibility

- Commodity interaction behavior comes from the Base UI Registry foundation.
- Every interactive item has a keyboard path, visible focus, an accessible
  name, and at least a 28px pointer target.
- Menus, popovers, sheets, dialogs, and the command palette handle focus entry,
  Escape, outside interaction, and focus return.
- Hover-only disclosure is forbidden.
- Live updates preserve focus, selection, draft text, and scroll position.
- Normal text meets 4.5:1 contrast. Large text and essential UI marks meet
  3:1.
- One global reduced-motion rule removes nonessential animation.

## Performance

- Cold open to interactive: under 1500ms on fixture data.
- Click to paint: under 100ms.
- Worst steady-state Electron main-process stall: under 16.7ms.
- Idle work: only the declared 20-second fleet poll and real external events.
- Unchanged resources do not replace state or rebuild their subtree.
- Heap reaches steady state across 20 refresh cycles.
- Quota and route-specific heavy reads never block fleet first paint.

## UI change gate

Every visible PR must include:

1. Full application screenshots for every affected route and detail state in
   both themes, using synthetic fixtures.
2. A one-owner statement for every new visible signal.
3. Keyboard and focus verification for every changed interaction.
4. Registry ownership and source-name hygiene gates.
5. Renderer typecheck, package catalog checks, bundle check, packaged smoke,
   and the local performance gates.

Real transcripts, local paths, secrets, and third-party brand assets never
enter fixtures, screenshots, or tracked interface source.
